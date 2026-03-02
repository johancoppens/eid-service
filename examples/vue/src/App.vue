<script setup lang="ts">
import { useEid } from "@/composables/useEid"
import EidCard from "@/components/EidCard.vue"

const {
  status,
  serviceConnected,
  readerConnected,
  readerName,
  cardPresent,
  cardData,
  errorMessage,
  errorCode,
  connectToService,
  checkBackend,
} = useEid()
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-12">
    <div class="mb-8 text-center">
      <h1 class="text-3xl font-bold text-gray-900">
        eID Kaartlezer
      </h1>
      <p class="mt-2 text-gray-500">
        Lees de gegevens en foto van een Belgische eID kaart
      </p>
    </div>


    <!-- Status indicators -->
    <div class="mb-6 space-y-3">
      <!-- Service status -->
      <div class="flex items-center gap-3 rounded-lg border bg-white px-4 py-3 text-sm">
        <div
          class="h-2.5 w-2.5 rounded-full"
          :class="serviceConnected ? 'bg-green-500' : 'bg-red-500'"
        />
        <span class="text-gray-700">
          Lokale service
        </span>
        <span v-if="serviceConnected" class="ml-auto text-xs text-green-600">
          Verbonden
        </span>
        <span v-else class="ml-auto text-xs text-red-500">
          Niet bereikbaar
        </span>
      </div>

      <!-- Reader status -->
      <div class="flex items-center gap-3 rounded-lg border bg-white px-4 py-3 text-sm">
        <div
          class="h-2.5 w-2.5 rounded-full"
          :class="readerConnected ? 'bg-green-500' : 'bg-gray-300'"
        />
        <span class="text-gray-700">
          Kaartlezer
        </span>
        <span v-if="readerName" class="ml-auto font-mono text-xs text-gray-400">
          {{ readerName }}
        </span>
        <span v-else class="ml-auto text-xs text-gray-400">
          Niet aangesloten
        </span>
      </div>

      <!-- Card status -->
      <div class="flex items-center gap-3 rounded-lg border bg-white px-4 py-3 text-sm">
        <div
          class="h-2.5 w-2.5 rounded-full"
          :class="cardPresent ? 'bg-green-500' : 'bg-gray-300'"
        />
        <span class="text-gray-700">
          eID kaart
        </span>
        <span v-if="cardPresent" class="ml-auto text-xs text-green-600">
          Gedetecteerd
        </span>
        <span v-else class="ml-auto text-xs text-gray-400">
          Niet aanwezig
        </span>
      </div>

      <!-- Status messages -->
      <div
        v-if="status === 'connecting'"
        class="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700"
      >
        <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Verbinden met lokale service...
      </div>

      <div
        v-if="status === 'checking'"
        class="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700"
      >
        <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Kaartlezer controleren...
      </div>

      <div
        v-if="status === 'reading'"
        class="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700"
      >
        <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Kaart uitlezen... Wacht even.
      </div>
    </div>

    <!-- Error message -->
    <div
      v-if="status === 'error'"
      class="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-4"
    >
      <div class="flex items-start gap-3">
        <svg class="mt-0.5 h-5 w-5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p class="text-sm font-medium text-red-800">{{ errorMessage }}</p>
          <p class="mt-1 font-mono text-xs text-red-500">Code: {{ errorCode }}</p>
        </div>
      </div>

      <div class="mt-3 flex gap-2">
        <button
          v-if="errorCode === 'SERVICE_NOT_RUNNING'"
          class="rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
          @click="connectToService"
        >
          Opnieuw verbinden
        </button>
        <button
          v-else
          class="rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
          @click="checkBackend"
        >
          Opnieuw controleren
        </button>
      </div>
    </div>


    <!-- Card data display -->
    <EidCard v-if="cardData" :data="cardData" />

    <!-- Help section (shown when no card data) -->
    <div v-if="!cardData && status !== 'reading'" class="rounded-lg border border-gray-200 bg-white p-6">
      <h3 class="text-sm font-semibold text-gray-900">Vereisten</h3>
      <ul class="mt-3 space-y-2 text-sm text-gray-600">
        <li class="flex items-start gap-2">
          <svg class="mt-0.5 h-4 w-4 shrink-0" :class="serviceConnected ? 'text-green-500' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          eID lokale service geïnstalleerd en gestart (<code class="rounded bg-gray-100 px-1 text-xs">./install.sh</code>)
        </li>
        <li class="flex items-start gap-2">
          <svg class="mt-0.5 h-4 w-4 shrink-0" :class="readerConnected ? 'text-green-500' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          PC/SC daemon actief (<code class="rounded bg-gray-100 px-1 text-xs">sudo systemctl start pcscd</code>)
        </li>
        <li class="flex items-start gap-2">
          <svg class="mt-0.5 h-4 w-4 shrink-0" :class="readerConnected ? 'text-green-500' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          eID kaartlezer aangesloten
        </li>
        <li class="flex items-start gap-2">
          <svg class="mt-0.5 h-4 w-4 shrink-0" :class="cardPresent ? 'text-green-500' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Belgische eID kaart in de lezer
        </li>
      </ul>

      <div class="mt-4 rounded-md bg-blue-50 px-4 py-3 text-xs text-blue-700">
        <strong>Setup stappen:</strong>
        <ol class="mt-1 list-inside list-decimal space-y-1">
          <li>Installeer en start de eID service: <code class="rounded bg-blue-100 px-1">./eid-service/install.sh</code></li>
          <li>Start de service: <code class="rounded bg-blue-100 px-1">node eid-service/host.js</code></li>
          <li>Steek je eID kaart in de lezer — de kaart wordt automatisch uitgelezen</li>
        </ol>
      </div>
    </div>

    <!-- Debug: raw data dump -->
    <details v-if="cardData" class="mt-6">
      <summary class="cursor-pointer text-xs font-medium text-gray-400 hover:text-gray-600">
        Raw TLV data (debug)
      </summary>
      <div class="mt-2 overflow-auto rounded-lg bg-gray-900 p-4">
        <pre class="text-xs text-green-400">{{ JSON.stringify({
          identity: cardData.rawIdentity.map(r => ({
            tag: `0x${r.tag.toString(16).padStart(2, '0')}`,
            length: r.value.length,
          })),
          address: cardData.rawAddress.map(r => ({
            tag: `0x${r.tag.toString(16).padStart(2, '0')}`,
            length: r.value.length,
          })),
        }, null, 2) }}</pre>
      </div>
    </details>
  </div>
</template>
