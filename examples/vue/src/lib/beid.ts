/**
 * Belgian eID Local Service client.
 *
 * Communicates with the Data Hub eID local WebSocket service
 * that reads the smart card via PC/SC.
 *
 * Communication flow:
 *   Web Page → WebSocket (ws://localhost:PORT) → Local Service (PC/SC)
 */

// --- Configuration ---

const DEFAULT_PORT = 17365
const RECONNECT_DELAY = 2000
const MAX_RECONNECT_DELAY = 30000
const REQUEST_TIMEOUT = 15000

// --- Types ---

export interface EidHealthResponse {
  pcscReady: boolean
  readerName: string | null
  readerConnected: boolean
  cardPresent: boolean
}

export interface EidCardResponse {
  /** Base64-encoded identity file (TLV binary) */
  identity: string
  /** Base64-encoded address file (TLV binary) */
  address: string
  /** Base64-encoded photo (JPEG) */
  photo: string
}


interface ServiceResponse<T> {
  success: boolean
  data?: T
  error?: string
  code?: string
  id?: string
}

interface ServiceEvent {
  type: "event"
  event: string
  pcscReady?: boolean
  readerConnected?: boolean
  cardPresent?: boolean
  reader?: string
  error?: string
}

// --- Error types ---

export type EidErrorCode =
  | "SERVICE_NOT_RUNNING"
  | "SERVICE_DISCONNECTED"
  | "NO_READER"
  | "NO_CARD"
  | "READ_FAILED"
  | "CONNECT_FAILED"
  | "TIMEOUT"
  | "UNKNOWN"

export class EidError extends Error {
  code: EidErrorCode

  constructor(code: EidErrorCode, message: string) {
    super(message)
    this.name = "EidError"
    this.code = code
  }
}

// --- WebSocket connection ---

type EventCallback = (event: ServiceEvent) => void

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = RECONNECT_DELAY
let eventCallback: EventCallback | null = null
let requestCounter = 0
let connectionResolve: ((connected: boolean) => void) | null = null

/** Pending request resolvers keyed by request id */
const pendingRequests = new Map<string, {
  resolve: (value: ServiceResponse<unknown>) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

function nextId (): string {
  return `req_${++requestCounter}_${Date.now()}`
}

function getWsUrl (): string {
  return `ws://localhost:${DEFAULT_PORT}`
}

/**
 * Connect to the local eID service via WebSocket.
 * Returns true if connected, false if failed.
 */
export function connect (onEvent?: EventCallback): Promise<boolean> {
  if (onEvent) {
    eventCallback = onEvent
  }

  return new Promise((resolve) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve(true)
      return
    }

    // Close existing connection if in bad state
    if (ws) {
      try { ws.close() } catch { /* ignore */ }
      ws = null
    }

    connectionResolve = resolve

    try {
      ws = new WebSocket(getWsUrl())
    } catch {
      resolve(false)
      return
    }

    ws.onopen = () => {
      reconnectDelay = RECONNECT_DELAY
      // Don't resolve yet — wait for the "ready" event
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)

        // Check if it's an event
        if (msg.type === "event") {
          // The "ready" event resolves the connection promise
          if (msg.event === "ready" && connectionResolve) {
            connectionResolve(true)
            connectionResolve = null
          }
          if (eventCallback) {
            eventCallback(msg as ServiceEvent)
          }
          return
        }

        // It's a response to a request
        if (msg.id && pendingRequests.has(msg.id)) {
          const pending = pendingRequests.get(msg.id)!
          pendingRequests.delete(msg.id)
          clearTimeout(pending.timer)
          pending.resolve(msg as ServiceResponse<unknown>)
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.onclose = () => {
      ws = null

      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer)
        pending.reject(new EidError("SERVICE_DISCONNECTED", "Verbinding met eID service verbroken."))
        pendingRequests.delete(id)
      }

      // If we were still waiting for initial connection
      if (connectionResolve) {
        connectionResolve(false)
        connectionResolve = null
      }

      // Notify about disconnect
      if (eventCallback) {
        eventCallback({ type: "event", event: "disconnected" })
      }

      // Auto-reconnect
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose will fire after this, handle there
    }
  })
}

function scheduleReconnect () {
  if (reconnectTimer) return

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    const connected = await connect()
    if (!connected) {
      // Exponential backoff
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY)
    }
  }, reconnectDelay)
}

/**
 * Disconnect from the local eID service.
 */
export function disconnect (): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  eventCallback = null

  if (ws) {
    try { ws.close() } catch { /* ignore */ }
    ws = null
  }

  // Reject all pending requests
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new EidError("SERVICE_DISCONNECTED", "Verbinding afgesloten."))
    pendingRequests.delete(id)
  }
}

/**
 * Check if the WebSocket is currently connected.
 */
export function isConnected (): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN
}

// --- Request/Response ---

function sendRequest<T> (message: Record<string, unknown>): Promise<ServiceResponse<T>> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new EidError(
        "SERVICE_NOT_RUNNING",
        "Niet verbonden met de eID service. Is de lokale service gestart?"
      ))
      return
    }

    const id = nextId()
    message.id = id

    const timer = setTimeout(() => {
      pendingRequests.delete(id)
      reject(new EidError("TIMEOUT", "Geen antwoord van de eID service (timeout)."))
    }, REQUEST_TIMEOUT)

    pendingRequests.set(id, {
      resolve: resolve as (value: ServiceResponse<unknown>) => void,
      reject,
      timer,
    })

    ws.send(JSON.stringify(message))
  })
}

// --- Public API ---

/**
 * Check the health of the eID service.
 * Returns reader and card status.
 *
 * @throws {EidError} if the service is unreachable
 */
export async function checkHealth (): Promise<EidHealthResponse> {
  const response = await sendRequest<EidHealthResponse>({
    action: "health",
  })

  if (!response.success || !response.data) {
    const code = (response.code ?? "UNKNOWN") as EidErrorCode
    throw new EidError(code, response.error ?? "Onverwachte fout bij health check")
  }

  return response.data
}

/**
 * Read identity, address, and photo from the eID card.
 * Returns base64-encoded data for TLV parsing by the frontend.
 *
 * @throws {EidError} with appropriate error code
 */
export async function readCard (): Promise<EidCardResponse> {
  const response = await sendRequest<EidCardResponse>({
    action: "read",
  })

  if (!response.success || !response.data) {
    const code = (response.code ?? "READ_FAILED") as EidErrorCode
    throw new EidError(code, response.error ?? "Fout bij het lezen van de kaart")
  }

  return response.data
}
