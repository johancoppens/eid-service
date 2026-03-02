<script setup lang="ts">
import { computed, type DeepReadonly } from "vue"
import type { EidCardData } from "@/lib/tlv-parser"
import { formatNationalNumber } from "@/lib/tlv-parser"

const props = defineProps<{
  data: DeepReadonly<EidCardData> | EidCardData
}>()

const fullName = computed(() => {
  const { firstNames, surname } = props.data.identity
  return `${firstNames} ${surname}`.trim()
})

const formattedNN = computed(() => {
  return formatNationalNumber(props.data.identity.nationalNumber)
})

const sexLabel = computed(() => {
  const s = props.data.identity.sex.toUpperCase()
  if (s === "M") return "Man"
  if (s === "V" || s === "W" || s === "F") return "Vrouw"
  return s
})

interface InfoField {
  label: string
  value: string
}

const identityFields = computed<InfoField[]>(() => {
  const id = props.data.identity
  return [
    { label: "Rijksregisternummer", value: formattedNN.value },
    { label: "Geboortedatum", value: id.birthDate },
    { label: "Geboorteplaats", value: id.birthLocation },
    { label: "Geslacht", value: sexLabel.value },
    { label: "Nationaliteit", value: id.nationality },
  ].filter((f) => f.value)
})

const addressFields = computed<InfoField[]>(() => {
  const addr = props.data.address
  return [
    { label: "Straat", value: addr.street },
    { label: "Postcode", value: addr.zipCode },
    { label: "Gemeente", value: addr.municipality },
  ].filter((f) => f.value)
})

const cardFields = computed<InfoField[]>(() => {
  const id = props.data.identity
  return [
    { label: "Kaartnummer", value: id.cardNumber },
    { label: "Geldig van", value: id.validityBegin },
    { label: "Geldig tot", value: id.validityEnd },
    { label: "Afgifte", value: id.deliveryMunicipality },
    { label: "Documenttype", value: id.documentType },
    { label: "Speciale status", value: id.specialStatus },
  ].filter((f) => f.value)
})
</script>

<template>
  <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
    <!-- Header with Belgian colors -->
    <div class="flex h-2">
      <div class="w-1/3 bg-black" />
      <div class="w-1/3 bg-yellow-400" />
      <div class="w-1/3 bg-red-600" />
    </div>

    <!-- Main content -->
    <div class="p-6">
      <!-- Photo + Name header -->
      <div class="flex items-start gap-6">
        <!-- Photo -->
        <div class="shrink-0">
          <img
            :src="data.photoUrl"
            :alt="`Foto van ${fullName}`"
            class="h-32 w-24 rounded-lg border border-gray-200 object-cover shadow-sm"
          />
        </div>

        <!-- Name + key info -->
        <div class="min-w-0 flex-1">
          <h2 class="text-2xl font-bold text-gray-900">
            {{ fullName }}
          </h2>
          <p class="mt-1 font-mono text-sm text-gray-500">
            {{ formattedNN }}
          </p>
        </div>
      </div>

      <!-- Info sections -->
      <div class="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <!-- Identity -->
        <div>
          <h3 class="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-gray-400 uppercase">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Identiteit
          </h3>
          <dl class="space-y-2">
            <div v-for="field in identityFields" :key="field.label">
              <dt class="text-xs text-gray-400">{{ field.label }}</dt>
              <dd class="text-sm font-medium text-gray-900">{{ field.value }}</dd>
            </div>
          </dl>
        </div>

        <!-- Address -->
        <div>
          <h3 class="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-gray-400 uppercase">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Adres
          </h3>
          <dl class="space-y-2">
            <div v-for="field in addressFields" :key="field.label">
              <dt class="text-xs text-gray-400">{{ field.label }}</dt>
              <dd class="text-sm font-medium text-gray-900">{{ field.value }}</dd>
            </div>
          </dl>
        </div>

        <!-- Card info -->
        <div>
          <h3 class="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-gray-400 uppercase">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            Kaart
          </h3>
          <dl class="space-y-2">
            <div v-for="field in cardFields" :key="field.label">
              <dt class="text-xs text-gray-400">{{ field.label }}</dt>
              <dd class="text-sm font-medium text-gray-900">{{ field.value }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  </div>
</template>
