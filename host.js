#!/usr/bin/env node
/**
 * Belgian eID Local WebSocket Service
 *
 * Reads Belgian eID smart cards via PC/SC (pcsc-mini) and communicates
 * with the Data Hub web client via WebSocket on a local port.
 *
 * Configuration: ~/.config/eid-service/config.json
   { "port": 17365, "allowedOrigins": ["https://example.com"] }
 *
 * Protocol:
 *
 * Client → Server:
 *   { "action": "health", "id": "uuid" }
 *   { "action": "read", "id": "uuid" }
 *
 * Server → Client (on connection):
 *   { "type": "event", "event": "ready", "pcscReady": true, "readerConnected": true, "cardPresent": true }
 *
 * Server → Client (events, broadcast):
 *   { "type": "event", "event": "card-inserted", "reader": "..." }
 *   { "type": "event", "event": "card-removed", "reader": "..." }
 *   { "type": "event", "event": "reader-added", "reader": "..." }
 *   { "type": "event", "event": "reader-removed", "reader": "..." }
 *
 * Server → Client (responses, to requesting client only):
 *   { "id": "uuid", "success": true, "data": { ... } }
 *   { "id": "uuid", "success": false, "error": "...", "code": "..." }
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { createInterface } from "node:readline"
import { WebSocketServer } from "ws"
import * as pcsc from "pcsc-mini"
const { CardMode, CardDisposition, ReaderStatus } = pcsc

// --- Configuration ---

const CONFIG_DIR = join(homedir(), ".config", "eid-service")
const CONFIG_FILE = join(CONFIG_DIR, "config.json")
const DEFAULT_PORT = 17365

function loadConfig () {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8")
    const config = JSON.parse(raw)
    return {
      port: config.port || 17365,
      allowedOrigins: config.allowedOrigins || [],
    }
  } catch {
    console.error(`[eid-service] Configuratie niet gevonden: ${CONFIG_FILE}`)
    console.error("[eid-service] Voer 'eid-service config' uit om de service te configureren.")
    process.exit(1)
  }
}

function ask (rl, question) {
  return new Promise((resolve) => rl.question(question, resolve))
}

async function runConfigWizard () {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  // Load existing config if available
  let existing = { port: DEFAULT_PORT, allowedOrigins: [] }
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8")
    existing = { ...existing, ...JSON.parse(raw) }
  } catch {
    // No existing config — fresh setup
  }

  console.log("")
  console.log("  \x1b[1meID Service — Configuratie\x1b[0m")
  console.log("  ==========================")
  console.log("")

  // Port
  const portInput = await ask(rl, `  Poort [${existing.port}]: `)
  const port = portInput.trim() ? parseInt(portInput.trim(), 10) : existing.port
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error("  \x1b[31m✗\x1b[0m Ongeldige poort")
    rl.close()
    process.exit(1)
  }

  // Origins
  console.log("")
  console.log("  Welke website(s) mogen de eID service gebruiken?")
  console.log("  Geef volledige URL(s), bv. https://mijn-app.example.com")
  console.log("  Meerdere origins scheiden met komma's.")
  console.log("  Leeg laten om alle origins toe te staan (enkel voor development).")
  console.log("")
  if (existing.allowedOrigins.length > 0) {
    console.log(`  Huidig: ${existing.allowedOrigins.join(", ")}`)
  }
  const originsInput = await ask(rl, "  Origin(s): ")

  let allowedOrigins
  if (originsInput.trim()) {
    allowedOrigins = originsInput.split(",").map(o => o.trim().replace(/\/+$/, "")).filter(Boolean)
  } else {
    allowedOrigins = existing.allowedOrigins
  }


  // Write config
  mkdirSync(CONFIG_DIR, { recursive: true })
  const configData = JSON.stringify({ port, allowedOrigins }, null, 2)
  writeFileSync(CONFIG_FILE, configData + "\n")

  console.log("")
  console.log("  \x1b[32m✓\x1b[0m Configuratie opgeslagen: " + CONFIG_FILE)
  console.log("")
  console.log(`  Poort:       ${port}`)
  if (allowedOrigins.length > 0) {
    console.log(`  Origins:     ${allowedOrigins.join(", ")}`)
  } else {
    console.log("  Origins:     \x1b[33m⚠\x1b[0m  alle origins (development mode)")
  }
  console.log("")

  rl.close()
}

// --- CLI: `eid-service config` ---

if (process.argv.includes("config")) {
  runConfigWizard()
} else {
  startServer()
}

function startServer () {
const config = loadConfig()


// --- Belgian eID constants (proven working) ---

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

/** Maximum expected file sizes */
const MAX_SIZES = {
  IDENTITY: 200,
  ADDRESS: 200,
  PHOTO: 4096,
}

const READ_BLOCK_SIZE = 0xff

// --- APDU helpers ---

function buildSelectApplet (aid) {
  const apdu = new Uint8Array(5 + aid.length)
  apdu[0] = 0x00 // CLA
  apdu[1] = 0xa4 // INS: SELECT
  apdu[2] = 0x04 // P1: Select by DF name
  apdu[3] = 0x0c // P2: No FCI response
  apdu[4] = aid.length // Lc
  apdu.set(aid, 5)
  return apdu
}

function buildSelectFile (path) {
  const apdu = new Uint8Array(5 + path.length)
  apdu[0] = 0x00
  apdu[1] = 0xa4
  apdu[2] = 0x08 // P1: Select by path from MF
  apdu[3] = 0x0c
  apdu[4] = path.length
  apdu.set(path, 5)
  return apdu
}

function buildReadBinary (offset, length) {
  return Uint8Array.of(
    0x00,
    0xb0,
    (offset >> 8) & 0xff,
    offset & 0xff,
    length & 0xff
  )
}

function getStatusWord (response) {
  if (response.length < 2) return 0xffff
  return (response[response.length - 2] << 8) | response[response.length - 1]
}

function getResponseData (response) {
  if (response.length <= 2) return new Uint8Array(0)
  return response.slice(0, response.length - 2)
}

// --- Card reading logic ---

async function readFile (card, maxSize) {
  const chunks = []
  let offset = 0

  while (offset < maxSize) {
    const len = Math.min(READ_BLOCK_SIZE, maxSize - offset)
    const apdu = buildReadBinary(offset, len)
    const response = await card.transmit(apdu)
    const sw = getStatusWord(response)

    if (sw === 0x9000) {
      const data = getResponseData(response)
      if (data.length === 0) break
      chunks.push(data)
      offset += data.length
      if (data.length < len) break
    } else if ((sw >> 8) === 0x6c) {
      const exactLen = sw & 0xff
      const retryApdu = buildReadBinary(offset, exactLen)
      const retryResponse = await card.transmit(retryApdu)
      const retrySw = getStatusWord(retryResponse)
      if (retrySw === 0x9000) {
        const data = getResponseData(retryResponse)
        if (data.length > 0) chunks.push(data)
      }
      break
    } else if (sw === 0x6b00 || sw === 0x6a82 || sw === 0x6a83) {
      break
    } else {
      throw new Error(`READ BINARY failed at offset ${offset}: SW=${sw.toString(16).padStart(4, "0")}`)
    }
  }

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0)
  const result = new Uint8Array(totalLen)
  let pos = 0
  for (const chunk of chunks) {
    result.set(chunk, pos)
    pos += chunk.length
  }
  return result
}

async function readBelgianEid (card) {
  // 1. Select BELPIC applet
  const selectAppletResponse = await card.transmit(buildSelectApplet(BELPIC_AID))
  const selectSw = getStatusWord(selectAppletResponse)
  if (selectSw !== 0x9000 && selectSw !== 0x6a86) {
    throw new Error(`SELECT BELPIC applet failed: SW=${selectSw.toString(16).padStart(4, "0")}`)
  }

  // 2. Read Identity
  const selectIdResponse = await card.transmit(buildSelectFile(FILES.IDENTITY))
  if (getStatusWord(selectIdResponse) !== 0x9000) {
    throw new Error("SELECT Identity file failed")
  }
  const identityBytes = await readFile(card, MAX_SIZES.IDENTITY)

  // 3. Read Address
  const selectAddrResponse = await card.transmit(buildSelectFile(FILES.ADDRESS))
  if (getStatusWord(selectAddrResponse) !== 0x9000) {
    throw new Error("SELECT Address file failed")
  }
  const addressBytes = await readFile(card, MAX_SIZES.ADDRESS)

  // 4. Read Photo
  const selectPhotoResponse = await card.transmit(buildSelectFile(FILES.PHOTO))
  if (getStatusWord(selectPhotoResponse) !== 0x9000) {
    throw new Error("SELECT Photo file failed")
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

function findReaderWithCard () {
  for (const [reader, info] of readers) {
    if (info.hasCard) return { reader, name: info.name }
  }
  return null
}

function getStatus () {
  const match = findReaderWithCard()
  const firstReader = readers.size > 0 ? [...readers.values()][0] : null
  return {
    pcscReady: pcscClient !== null,
    readerName: match?.name ?? firstReader?.name ?? null,
    readerConnected: readers.size > 0,
    cardPresent: match !== null,
  }
}

// --- WebSocket server ---

/** @type {Set<import("ws").WebSocket>} */
const clients = new Set()

function broadcast (msg) {
  const json = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(json)
    }
  }
}

function sendTo (ws, msg) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(msg))
  }
}

function initPcsc () {
  pcscClient = new pcsc.Client()
    .on("reader", (reader) => {
      const name = reader.name()
      readers.set(reader, { name, hasCard: false })

      reader.on("change", (status) => {
        const info = readers.get(reader)
        if (!info) return

        if (status.has(ReaderStatus.PRESENT)) {
          if (!info.hasCard) {
            info.hasCard = true
            broadcast({ type: "event", event: "card-inserted", reader: info.name })
          }
        } else {
          if (info.hasCard) {
            info.hasCard = false
            broadcast({ type: "event", event: "card-removed", reader: info.name })
          }
        }
      })

      reader.on("disconnect", () => {
        readers.delete(reader)
        broadcast({ type: "event", event: "reader-removed", reader: name })
      })

      broadcast({ type: "event", event: "reader-added", reader: name })
    })
    .on("error", (err) => {
      broadcast({ type: "event", event: "pcsc-error", error: err.message })
    })
    .start()
}

// --- Message handler ---

async function handleMessage (ws, message) {
  const { action, id } = message

  try {
    switch (action) {
      case "health": {
        const status = getStatus()
        sendTo(ws, { id, success: true, data: status })
        break
      }

      case "read": {
        const match = findReaderWithCard()

        if (readers.size === 0) {
          sendTo(ws, {
            id,
            success: false,
            error: "Geen kaartlezer gevonden. Sluit een eID kaartlezer aan.",
            code: "NO_READER",
          })
          return
        }

        if (!match) {
          sendTo(ws, {
            id,
            success: false,
            error: "Geen kaart in de lezer. Steek je eID kaart in de lezer.",
            code: "NO_CARD",
          })
          return
        }

        let card
        try {
          card = await match.reader.connect(CardMode.SHARED)
        } catch (err) {
          sendTo(ws, {
            id,
            success: false,
            error: `Kan niet verbinden met de kaart: ${err.message}`,
            code: "CONNECT_FAILED",
          })
          return
        }

        try {
          const data = await readBelgianEid(card)
          sendTo(ws, { id, success: true, data })
        } finally {
          try {
            await card.disconnect(CardDisposition.LEAVE)
          } catch {
            // Ignore disconnect errors
          }
        }
        break
      }

      default:
        sendTo(ws, {
          id,
          success: false,
          error: `Onbekende actie: ${action}`,
          code: "UNKNOWN_ACTION",
        })
    }
  } catch (err) {
    sendTo(ws, {
      id,
      success: false,
      error: `Fout: ${err.message}`,
      code: "READ_FAILED",
    })
  }
}

// --- Start ---

initPcsc()

const ALLOWED_HOSTS_BASE = ["localhost", "127.0.0.1"]

function verifyClient ({ req }) {
  const origin = req.headers.origin
  const host = req.headers.host

  // Host header check (DNS rebinding protection)
  if (host) {
    const hostname = host.split(":")[0]
    if (!ALLOWED_HOSTS_BASE.includes(hostname)) {
      console.warn(`[eid-service] Verbinding geweigerd — ongeldige Host: ${host}`)
      return false
    }
  }

  // Origin check (CSWSH protection)
  if (config.allowedOrigins.length > 0) {
    if (!origin || !config.allowedOrigins.includes(origin)) {
      console.warn(`[eid-service] Verbinding geweigerd — ongeldige Origin: ${origin || "(geen)"}`)
      return false
    }
  }

  return true
}

const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: config.port,
  verifyClient,
})

wss.on("connection", (ws, req) => {
  clients.add(ws)

  // Send ready event with current status
  const status = getStatus()
  sendTo(ws, {
    type: "event",
    event: "ready",
    ...status,
  })

  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString("utf-8"))
      handleMessage(ws, message)
    } catch (err) {
      sendTo(ws, {
        success: false,
        error: `Invalid JSON: ${err.message}`,
        code: "INVALID_MESSAGE",
      })
    }
  })

  ws.on("close", () => {
    clients.delete(ws)
  })

  ws.on("error", () => {
    clients.delete(ws)
  })
})

wss.on("listening", () => {
  console.log(`[eid-service] WebSocket server gestart op ws://127.0.0.1:${config.port}`)
  if (config.allowedOrigins.length > 0) {
    console.log(`[eid-service] Toegestane origins: ${config.allowedOrigins.join(", ")}`)
  } else {
    console.warn("[eid-service] ⚠️  Geen allowedOrigins geconfigureerd — alle origins toegestaan")
  }
})

// Graceful shutdown
function shutdown () {
  console.log("[eid-service] Afsluiten...")
  wss.close()
  if (pcscClient) {
    pcscClient.stop()
  }
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
}
