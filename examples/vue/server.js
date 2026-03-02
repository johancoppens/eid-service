/**
 * Belgian eID PC/SC Backend Server
 *
 * Reads Belgian eID smart cards via PC/SC (pcsc-mini) and exposes data via REST API.
 * The frontend Vue app calls this server to read identity, address, and photo data.
 *
 * Endpoints:
 *   GET /api/health  — Reader/card status
 *   GET /api/card    — Read identity + address + photo from inserted card
 *
 * Usage:
 *   node server.js
 *
 * Requires:
 *   - pcscd running (sudo systemctl start pcscd)
 *   - A smart card reader connected
 *   - Belgian eID inserted
 */

import Fastify from "fastify"
import cors from "@fastify/cors"
import * as pcsc from "pcsc-mini"

const { CardMode, CardDisposition, ReaderStatus } = pcsc

// --- Belgian eID constants ---

/** BELPIC PKCS#15 Applet AID */
const BELPIC_AID = Uint8Array.of(
  0xa0, 0x00, 0x00, 0x01, 0x77,
  0x50, 0x4b, 0x43, 0x53, 0x2d, 0x31, 0x35
)

/** File paths (full path from MF) */
const FILES = {
  IDENTITY: Uint8Array.of(0x3f, 0x00, 0xdf, 0x01, 0x40, 0x31),
  ADDRESS: Uint8Array.of(0x3f, 0x00, 0xdf, 0x01, 0x40, 0x33),
  PHOTO: Uint8Array.of(0x3f, 0x00, 0xdf, 0x01, 0x40, 0x35),
}

/** Maximum expected file sizes (used as upper bound for reading) */
const MAX_SIZES = {
  IDENTITY: 200,
  ADDRESS: 200,
  PHOTO: 4096,
}

const READ_BLOCK_SIZE = 0xff // 255 bytes per READ BINARY

// --- APDU helpers ---

/**
 * Build SELECT FILE by AID APDU.
 * CLA=00 INS=A4 P1=04(by DF name) P2=0C(no FCI)
 */
function buildSelectApplet(aid) {
  const apdu = new Uint8Array(5 + aid.length)
  apdu[0] = 0x00 // CLA
  apdu[1] = 0xa4 // INS: SELECT
  apdu[2] = 0x04 // P1: Select by DF name
  apdu[3] = 0x0c // P2: No FCI response
  apdu[4] = aid.length // Lc
  apdu.set(aid, 5)
  return apdu
}

/**
 * Build SELECT FILE by path APDU.
 * CLA=00 INS=A4 P1=08(by path from MF) P2=0C(no FCI)
 */
function buildSelectFile(path) {
  const apdu = new Uint8Array(5 + path.length)
  apdu[0] = 0x00 // CLA
  apdu[1] = 0xa4 // INS: SELECT
  apdu[2] = 0x08 // P1: Select by path from MF
  apdu[3] = 0x0c // P2: No FCI response
  apdu[4] = path.length // Lc
  apdu.set(path, 5)
  return apdu
}

/**
 * Build READ BINARY APDU.
 * CLA=00 INS=B0 P1=offset_hi P2=offset_lo Le=length
 *
 * Important: offset must be a full 16-bit integer, not truncated to byte.
 * (Belgian eID photo file is >255 bytes, so high byte matters.)
 */
function buildReadBinary(offset, length) {
  return Uint8Array.of(
    0x00, // CLA
    0xb0, // INS: READ BINARY
    (offset >> 8) & 0xff, // P1: offset high byte
    offset & 0xff, // P2: offset low byte
    length & 0xff // Le: number of bytes to read
  )
}

/**
 * Extract SW1-SW2 status word from response.
 */
function getStatusWord(response) {
  if (response.length < 2) return 0xffff
  return (response[response.length - 2] << 8) | response[response.length - 1]
}

/**
 * Get response data (everything except the last 2 status bytes).
 */
function getResponseData(response) {
  if (response.length <= 2) return new Uint8Array(0)
  return response.slice(0, response.length - 2)
}

// --- Card reading logic ---

/**
 * Read an entire file from the selected EF using READ BINARY.
 * Reads in chunks of READ_BLOCK_SIZE until EOF or maxSize reached.
 */
async function readFile(card, maxSize) {
  const chunks = []
  let offset = 0

  while (offset < maxSize) {
    const len = Math.min(READ_BLOCK_SIZE, maxSize - offset)
    const apdu = buildReadBinary(offset, len)
    const response = await card.transmit(apdu)
    const sw = getStatusWord(response)

    if (sw === 0x9000) {
      // Success
      const data = getResponseData(response)
      if (data.length === 0) break // No more data
      chunks.push(data)
      offset += data.length
      if (data.length < len) break // Short read = EOF
    } else if ((sw >> 8) === 0x6c) {
      // SW 6C XX: wrong Le, retry with exact length XX
      const exactLen = sw & 0xff
      const retryApdu = buildReadBinary(offset, exactLen)
      const retryResponse = await card.transmit(retryApdu)
      const retrySw = getStatusWord(retryResponse)
      if (retrySw === 0x9000) {
        const data = getResponseData(retryResponse)
        if (data.length > 0) chunks.push(data)
      }
      break // 6C response means we've hit the end
    } else if (sw === 0x6b00 || sw === 0x6a82 || sw === 0x6a83) {
      // 6B00: Wrong parameters (offset beyond EOF)
      // 6A82: File not found
      // 6A83: Record not found
      break
    } else {
      throw new Error(`READ BINARY failed at offset ${offset}: SW=${sw.toString(16).padStart(4, "0")}`)
    }
  }

  // Concatenate all chunks
  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0)
  const result = new Uint8Array(totalLen)
  let pos = 0
  for (const chunk of chunks) {
    result.set(chunk, pos)
    pos += chunk.length
  }
  return result
}

/**
 * Select the BELPIC applet and read all three files (identity, address, photo).
 */
async function readBelgianEid(card) {
  // 1. Select BELPIC applet
  const selectAppletApdu = buildSelectApplet(BELPIC_AID)
  const selectAppletResponse = await card.transmit(selectAppletApdu)
  const selectSw = getStatusWord(selectAppletResponse)
  if (selectSw !== 0x9000 && selectSw !== 0x6a86) {
    throw new Error(`SELECT BELPIC applet failed: SW=${selectSw.toString(16).padStart(4, "0")}`)
  }

  // 2. Read Identity file
  const selectIdApdu = buildSelectFile(FILES.IDENTITY)
  const selectIdResponse = await card.transmit(selectIdApdu)
  const selectIdSw = getStatusWord(selectIdResponse)
  if (selectIdSw !== 0x9000) {
    throw new Error(`SELECT Identity file failed: SW=${selectIdSw.toString(16).padStart(4, "0")}`)
  }
  const identityBytes = await readFile(card, MAX_SIZES.IDENTITY)

  // 3. Read Address file
  const selectAddrApdu = buildSelectFile(FILES.ADDRESS)
  const selectAddrResponse = await card.transmit(selectAddrApdu)
  const selectAddrSw = getStatusWord(selectAddrResponse)
  if (selectAddrSw !== 0x9000) {
    throw new Error(`SELECT Address file failed: SW=${selectAddrSw.toString(16).padStart(4, "0")}`)
  }
  const addressBytes = await readFile(card, MAX_SIZES.ADDRESS)

  // 4. Read Photo file
  const selectPhotoApdu = buildSelectFile(FILES.PHOTO)
  const selectPhotoResponse = await card.transmit(selectPhotoApdu)
  const selectPhotoSw = getStatusWord(selectPhotoResponse)
  if (selectPhotoSw !== 0x9000) {
    throw new Error(`SELECT Photo file failed: SW=${selectPhotoSw.toString(16).padStart(4, "0")}`)
  }
  const photoBytes = await readFile(card, MAX_SIZES.PHOTO)

  return {
    identity: Buffer.from(identityBytes).toString("base64"),
    address: Buffer.from(addressBytes).toString("base64"),
    photo: Buffer.from(photoBytes).toString("base64"),
  }
}

// --- PC/SC state management ---

/** @type {pcsc.Client | null} */
let pcscClient = null
/** @type {Map<object, { name: string, hasCard: boolean }>} */
const readers = new Map()

/**
 * Find the first reader that has a card inserted.
 * @returns {{ reader: object, name: string } | null}
 */
function findReaderWithCard() {
  for (const [reader, info] of readers) {
    if (info.hasCard) return { reader, name: info.name }
  }
  return null
}

function getStatus() {
  const match = findReaderWithCard()
  const firstReader = readers.size > 0 ? [...readers.values()][0] : null
  return {
    pcscReady: pcscClient !== null,
    readerName: match?.name ?? firstReader?.name ?? null,
    readerConnected: readers.size > 0,
    cardPresent: match !== null,
  }
}

function initPcsc() {
  pcscClient = new pcsc.Client()
    .on("reader", (reader) => {
      const name = reader.name()
      console.log(`[pcsc] Reader detected: ${name}`)
      readers.set(reader, { name, hasCard: false })

      reader.on("change", (status) => {
        const info = readers.get(reader)
        if (!info) return

        if (status.has(ReaderStatus.PRESENT)) {
          if (!info.hasCard) {
            console.log(`[pcsc] Card inserted in ${info.name}`)
            info.hasCard = true
          }
        } else {
          if (info.hasCard) {
            console.log(`[pcsc] Card removed from ${info.name}`)
            info.hasCard = false
          }
        }
      })

      reader.on("disconnect", () => {
        const info = readers.get(reader)
        console.log(`[pcsc] Reader removed: ${info?.name ?? "unknown"}`)
        readers.delete(reader)
      })
    })
    .on("error", (err) => {
      console.error("[pcsc] Client error:", err.message)
    })
    .start()

  console.log("[pcsc] Client started, waiting for readers...")
}

// --- Fastify server ---

const PORT = parseInt(process.env.EID_SERVER_PORT || "3141", 10)

const fastify = Fastify({ logger: true })

await fastify.register(cors, {
  origin: true, // Allow all origins in dev
  methods: ["GET"],
})

/**
 * GET /api/health
 * Returns the current status of the PC/SC subsystem.
 */
fastify.get("/api/health", async () => {
  return { success: true, data: getStatus() }
})

/**
 * GET /api/card
 * Read identity, address, and photo from the Belgian eID card.
 * Returns base64-encoded data for each file.
 */
fastify.get("/api/card", async (request, reply) => {
  const match = findReaderWithCard()

  if (readers.size === 0) {
    reply.code(503)
    return { success: false, message: "Geen kaartlezer gevonden. Sluit een eID kaartlezer aan." }
  }

  if (!match) {
    reply.code(503)
    return { success: false, message: "Geen kaart in de lezer. Steek je eID kaart in de lezer." }
  }

  let card
  try {
    card = await match.reader.connect(CardMode.SHARED)
  } catch (err) {
    console.error("[pcsc] Connect failed:", err)
    reply.code(503)
    return { success: false, message: `Kan niet verbinden met de kaart: ${err.message}` }
  }

  try {
    const data = await readBelgianEid(card)
    return { success: true, data }
  } catch (err) {
    console.error("[pcsc] Read failed:", err)
    reply.code(500)
    return { success: false, message: `Fout bij het lezen van de kaart: ${err.message}` }
  } finally {
    try {
      await card.disconnect(CardDisposition.LEAVE)
    } catch {
      // Ignore disconnect errors
    }
  }
})

// --- Start ---

initPcsc()

try {
  await fastify.listen({ port: PORT, host: "0.0.0.0" })
  console.log(`\n  eID Backend Server running on http://localhost:${PORT}`)
  console.log(`  Endpoints:`)
  console.log(`    GET /api/health  — Reader/card status`)
  console.log(`    GET /api/card    — Read eID card data\n`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
