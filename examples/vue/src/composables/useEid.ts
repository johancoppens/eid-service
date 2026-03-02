import { ref, readonly, onMounted, onUnmounted } from "vue"
import {
  connect,
  disconnect,
  checkHealth,
  readCard,
  isConnected,
  EidError,
  type EidHealthResponse,
} from "@/lib/beid"
import { parseCardData, dumpTlvRecords, type EidCardData } from "@/lib/tlv-parser"

export type EidStatus =
  | "idle"
  | "connecting"
  | "checking"
  | "ready"
  | "reading"
  | "success"
  | "error"

const HEALTH_POLL_INTERVAL = 2000


export function useEid () {
  const status = ref<EidStatus>("idle")
  const serviceConnected = ref(false)
  const readerConnected = ref(false)
  const readerName = ref("")
  const cardPresent = ref(false)
  const cardData = ref<EidCardData | null>(null)
  const errorMessage = ref("")
  const errorCode = ref("")

  let healthTimer: ReturnType<typeof setInterval> | null = null

  function clearError () {
    errorMessage.value = ""
    errorCode.value = ""
  }

  function setError (code: string, message: string) {
    status.value = "error"
    errorCode.value = code
    errorMessage.value = message
  }

  function applyHealth (health: EidHealthResponse) {
    readerConnected.value = health.readerConnected
    readerName.value = health.readerName ?? ""
    cardPresent.value = health.cardPresent
  }


  async function connectToService (): Promise<boolean> {
    status.value = "connecting"
    clearError()

    const connected = await connect((event) => {
      if (event.event === "ready") {
        serviceConnected.value = true
        readerConnected.value = event.readerConnected ?? false
        cardPresent.value = event.cardPresent ?? false
      } else if (event.event === "card-inserted") {
        cardPresent.value = true
        read()
      } else if (event.event === "card-removed") {
        cardPresent.value = false
        cardData.value = null
        if (status.value === "success" || status.value === "error") {
          clearError()
          status.value = "ready"
        }
      } else if (event.event === "reader-added") {
        readerConnected.value = true
        readerName.value = event.reader ?? ""
      } else if (event.event === "reader-removed") {
        readerConnected.value = false
        readerName.value = ""
        cardPresent.value = false
      } else if (event.event === "disconnected") {
        serviceConnected.value = false
      }
    })

    if (!connected) {
      serviceConnected.value = false
      setError(
        "SERVICE_NOT_RUNNING",
        "Kan niet verbinden met de eID service. Is de lokale service gestart?"
      )
      return false
    }

    serviceConnected.value = true
    return true
  }

  async function checkBackend () {
    if (status.value === "reading" || status.value === "success") return

    if (!isConnected()) {
      const connected = await connectToService()
      if (!connected) return false
    }

    status.value = "checking"
    clearError()

    try {
      const health = await checkHealth()
      applyHealth(health)

      status.value = "ready"
      if (health.cardPresent) {
        read()
      }
      return true
    } catch (err) {
      if (err instanceof EidError) {
        if (err.code === "SERVICE_NOT_RUNNING" || err.code === "SERVICE_DISCONNECTED") {
          serviceConnected.value = false
        }
        setError(err.code, err.message)
      } else {
        setError("UNKNOWN", `Onverwachte fout: ${err}`)
      }
      return false
    }
  }

  async function pollHealth () {
    if (status.value === "reading") return
    if (!isConnected()) return

    try {
      const health = await checkHealth()
      applyHealth(health)

      if (status.value === "success" && !health.cardPresent) {
        status.value = "idle"
        cardData.value = null
        await checkBackend()
      }
    } catch {
      // Silently fail on poll errors
    }
  }

  async function read () {
    status.value = "reading"
    clearError()
    cardData.value = null

    try {
      const raw = await readCard()

      console.log("[eID] Raw response:", {
        identityLen: raw.identity.length,
        addressLen: raw.address.length,
        photoLen: raw.photo.length,
      })

      const data = parseCardData(raw.identity, raw.address, raw.photo)

      dumpTlvRecords("Identity", data.rawIdentity)
      dumpTlvRecords("Address", data.rawAddress)

      cardData.value = data
      status.value = "success"
    } catch (err) {
      if (err instanceof EidError) {
        setError(err.code, err.message)
      } else {
        setError("UNKNOWN", `Onverwachte fout bij het lezen: ${err}`)
      }
    }
  }


  onMounted(async () => {
    await connectToService()
    if (serviceConnected.value) {
      await checkBackend()
    }
    healthTimer = setInterval(pollHealth, HEALTH_POLL_INTERVAL)
  })

  onUnmounted(() => {
    if (healthTimer) {
      clearInterval(healthTimer)
      healthTimer = null
    }
    disconnect()
  })

  return {
    status: readonly(status),
    serviceConnected: readonly(serviceConnected),
    readerConnected: readonly(readerConnected),
    readerName: readonly(readerName),
    cardPresent: readonly(cardPresent),
    cardData: readonly(cardData),
    errorMessage: readonly(errorMessage),
    errorCode: readonly(errorCode),

    connectToService,
    checkBackend,
  }
}
