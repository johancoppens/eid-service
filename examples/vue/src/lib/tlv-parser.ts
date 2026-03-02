/**
 * TLV (Tag-Length-Value) parser for Belgian eID identity and address files.
 *
 * The eID card stores identity and address data as binary TLV structures.
 * Each record has: 1 byte tag, variable-length length field, value bytes.
 *
 * Length encoding (BER-TLV):
 * - If first byte < 0x80: length is that byte
 * - If first byte is 0x81: length is the next byte
 * - If first byte is 0x82: length is the next two bytes (big-endian)
 *
 * Official Belgian eID Identity File tags (EF(ID)):
 *   0x01  Card Number
 *   0x02  Chip Number
 *   0x03  Card Validity Date Begin (DD.MM.YYYY)
 *   0x04  Card Validity Date End (DD.MM.YYYY)
 *   0x05  Card Delivery Municipality
 *   0x06  National Number (Rijksregisternummer)
 *   0x07  Surname
 *   0x08  First Names (first two given names)
 *   0x09  First Letter of Third Given Name
 *   0x0A  Nationality
 *   0x0B  Birth Location
 *   0x0C  Birth Date
 *   0x0D  Sex (M/F/V/W)
 *   0x0E  Noble Condition
 *   0x0F  Document Type
 *   0x10  Special Status
 *   0x11  Hash of Photo
 *
 * Official Belgian eID Address File tags (EF(Address)):
 *   0x01  Street and Number
 *   0x02  Zip Code
 *   0x03  Municipality
 */

// --- Raw TLV parser ---

export interface TlvRecord {
  tag: number
  value: Uint8Array
}

/**
 * Parse a binary TLV stream into individual records.
 */
export function parseTlv(data: Uint8Array): TlvRecord[] {
  const records: TlvRecord[] = []
  let offset = 0

  while (offset < data.length) {
    // Tag: 1 byte
    const tag = data[offset++]
    if (tag === 0x00 || offset >= data.length) break

    // Length: BER-TLV encoded
    let length: number
    const firstLenByte = data[offset++]

    if (firstLenByte < 0x80) {
      length = firstLenByte
    } else if (firstLenByte === 0x81) {
      if (offset >= data.length) break
      length = data[offset++]
    } else if (firstLenByte === 0x82) {
      if (offset + 1 >= data.length) break
      length = (data[offset] << 8) | data[offset + 1]
      offset += 2
    } else {
      // Unsupported length encoding, stop parsing
      break
    }

    if (offset + length > data.length) break

    const value = data.slice(offset, offset + length)
    offset += length

    records.push({ tag, value })
  }

  return records
}

// --- Decoded types ---

export interface EidIdentity {
  cardNumber: string
  chipNumber: string
  validityBegin: string
  validityEnd: string
  deliveryMunicipality: string
  nationalNumber: string
  surname: string
  firstNames: string
  thirdNameInitial: string
  nationality: string
  birthLocation: string
  birthDate: string
  sex: string
  nobleCondition: string
  documentType: string
  specialStatus: string
}

export interface EidAddress {
  street: string
  zipCode: string
  municipality: string
}

export interface EidCardData {
  identity: EidIdentity
  address: EidAddress
  photoUrl: string
  /** Raw TLV records for debugging */
  rawIdentity: TlvRecord[]
  rawAddress: TlvRecord[]
}

// --- Helpers ---

const textDecoder = new TextDecoder("utf-8")

function decodeText(value: Uint8Array): string {
  return textDecoder.decode(value).trim()
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function buildMap(records: TlvRecord[]): Map<number, string> {
  const map = new Map<number, string>()
  for (const record of records) {
    map.set(record.tag, decodeText(record.value))
  }
  return map
}

// --- Identity file parser ---

/** Identity file tag constants */
const ID_TAG = {
  CARD_NUMBER: 0x01,
  CHIP_NUMBER: 0x02,
  VALIDITY_BEGIN: 0x03,
  VALIDITY_END: 0x04,
  DELIVERY_MUNICIPALITY: 0x05,
  NATIONAL_NUMBER: 0x06,
  SURNAME: 0x07,
  FIRST_NAMES: 0x08,
  THIRD_NAME_INITIAL: 0x09,
  NATIONALITY: 0x0a,
  BIRTH_LOCATION: 0x0b,
  BIRTH_DATE: 0x0c,
  SEX: 0x0d,
  NOBLE_CONDITION: 0x0e,
  DOCUMENT_TYPE: 0x0f,
  SPECIAL_STATUS: 0x10,
  PHOTO_HASH: 0x11,
} as const

export function parseIdentity(base64Data: string): { identity: EidIdentity; raw: TlvRecord[] } {
  const bytes = base64ToUint8Array(base64Data)
  const records = parseTlv(bytes)
  const map = buildMap(records)

  const identity: EidIdentity = {
    cardNumber: map.get(ID_TAG.CARD_NUMBER) ?? "",
    chipNumber: map.get(ID_TAG.CHIP_NUMBER) ?? "",
    validityBegin: map.get(ID_TAG.VALIDITY_BEGIN) ?? "",
    validityEnd: map.get(ID_TAG.VALIDITY_END) ?? "",
    deliveryMunicipality: map.get(ID_TAG.DELIVERY_MUNICIPALITY) ?? "",
    nationalNumber: map.get(ID_TAG.NATIONAL_NUMBER) ?? "",
    surname: map.get(ID_TAG.SURNAME) ?? "",
    firstNames: map.get(ID_TAG.FIRST_NAMES) ?? "",
    thirdNameInitial: map.get(ID_TAG.THIRD_NAME_INITIAL) ?? "",
    nationality: map.get(ID_TAG.NATIONALITY) ?? "",
    birthLocation: map.get(ID_TAG.BIRTH_LOCATION) ?? "",
    birthDate: map.get(ID_TAG.BIRTH_DATE) ?? "",
    sex: map.get(ID_TAG.SEX) ?? "",
    nobleCondition: map.get(ID_TAG.NOBLE_CONDITION) ?? "",
    documentType: map.get(ID_TAG.DOCUMENT_TYPE) ?? "",
    specialStatus: map.get(ID_TAG.SPECIAL_STATUS) ?? "",
  }

  return { identity, raw: records }
}

// --- Address file parser ---

const ADDR_TAG = {
  STREET: 0x01,
  ZIP_CODE: 0x02,
  MUNICIPALITY: 0x03,
} as const

export function parseAddress(base64Data: string): { address: EidAddress; raw: TlvRecord[] } {
  const bytes = base64ToUint8Array(base64Data)
  const records = parseTlv(bytes)
  const map = buildMap(records)

  const address: EidAddress = {
    street: map.get(ADDR_TAG.STREET) ?? "",
    zipCode: map.get(ADDR_TAG.ZIP_CODE) ?? "",
    municipality: map.get(ADDR_TAG.MUNICIPALITY) ?? "",
  }

  return { address, raw: records }
}

// --- Full card parser ---

/**
 * Parse all card data from the raw BeID Connect response.
 */
export function parseCardData(
  idBase64: string,
  addrBase64: string,
  photoBase64: string
): EidCardData {
  const { identity, raw: rawIdentity } = parseIdentity(idBase64)
  const { address, raw: rawAddress } = parseAddress(addrBase64)
  const photoUrl = `data:image/jpeg;base64,${photoBase64}`

  return { identity, address, photoUrl, rawIdentity, rawAddress }
}

/**
 * Format the national number for display: YY.MM.DD-XXX.CC
 */
export function formatNationalNumber(nn: string): string {
  if (nn.length !== 11) return nn

  return `${nn.slice(0, 2)}.${nn.slice(2, 4)}.${nn.slice(4, 6)}-${nn.slice(6, 9)}.${nn.slice(9, 11)}`
}

/**
 * Dump raw TLV records to console for debugging.
 */
export function dumpTlvRecords(label: string, records: TlvRecord[]): void {
  console.group(`[eID TLV] ${label}`)
  for (const record of records) {
    const hex = `0x${record.tag.toString(16).padStart(2, "0")}`
    const text = decodeText(record.value)
    console.log(`Tag ${hex} (${record.tag}): "${text}" [${record.value.length} bytes]`)
  }
  console.groupEnd()
}
