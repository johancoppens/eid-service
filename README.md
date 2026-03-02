# eID Service

eID Service reads Belgian eID smart cards from a web browser. It consists of a lightweight local service that communicates with the card reader via PC/SC and exposes the data over a WebSocket. Any web application can connect to read identity, address, and photo data from the card.

```
eID Card → PC/SC → eid-service (ws://127.0.0.1:17365) → Web App
```

## Prerequisites

* A smart card reader.
* Linux users must install and run the `pcscd` daemon.

## Installation

### Linux / macOS

```sh
curl -sSL https://raw.githubusercontent.com/johancoppens/eid-service/main/install.sh | sh
```

To set an allowed origin during installation:

```sh
curl -sSL https://raw.githubusercontent.com/johancoppens/eid-service/main/install.sh | sh -s -- --origin https://your-app.com
```

### Windows

Run this in PowerShell:

```powershell
irm https://raw.githubusercontent.com/johancoppens/eid-service/main/install.ps1 | iex
```

To set an allowed origin during installation:

```powershell
.\install.ps1 -Origin "https://your-app.com"
```

### Install Layout

* `~/.eid-service/`: Contains the binary and addon files.
* `~/.config/eid-service/`: Contains the configuration file.

## Configuration

Run the interactive configuration wizard to set up the port and allowed origins:

```sh
eid-service config
```

The configuration file is located at `~/.config/eid-service/config.json`. The format looks like this:

```json
{
  "port": 17365,
  "allowedOrigins": ["https://example.com"]
}
```

## Usage

Start the service from your terminal:

```sh
eid-service
```

If the command is not in your PATH, you can start it directly:

```sh
~/.eid-service/eid-service
```

## Protocol Reference

* Default endpoint: `ws://127.0.0.1:17365`

### Client Actions

Clients can send JSON action objects to the server.

* `health`: Check service status.
* `read`: Read data from the inserted eID card.

### Server Events

The server broadcasts the following events to connected clients:

* `ready`
* `card-inserted`
* `card-removed`
* `reader-added`
* `reader-removed`

### Response Format

Success responses:

```json
{
  "id": "message-id",
  "success": true,
  "data": { ... }
}
```

Error responses:

```json
{
  "id": "message-id",
  "success": false,
  "error": "Error message description",
  "code": "ERROR_CODE"
}
```

### Error Codes

* `NO_READER`
* `NO_CARD`
* `CONNECT_FAILED`
* `READ_FAILED`
* `UNKNOWN_ACTION`

## Using from JavaScript (without Vue)

The service works with any framework. You can connect to it using standard WebSockets in any JavaScript environment (vanilla JS, React, Angular, etc.).

### Vanilla JS Example

```js
const ws = new WebSocket("ws://127.0.0.1:17365")

ws.onopen = () => {
  console.log("Connected to eID service")
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)

  // Server events
  if (msg.type === "event") {
    console.log("Event:", msg.event) // ready, card-inserted, card-removed, etc.
    return
  }

  // Response to our request
  if (msg.success) {
    console.log("Card data:", msg.data)
    // msg.data.identity, base64 TLV-encoded identity
    // msg.data.address, base64 TLV-encoded address
    // msg.data.photo, base64 JPEG photo
  }
}

// Read the card
ws.send(JSON.stringify({ action: "read", id: "1" }))
```

### The `beid.ts` Client Library

A TypeScript client library (`beid.ts`) wraps the WebSocket connection with auto-reconnect, request/response correlation, typed responses, and error handling. It has no framework dependencies and exports the following:

* `connect(onEvent?)`: Connect to the service.
* `disconnect()`: Disconnect from the service.
* `isConnected()`: Check connection status.
* `checkHealth()`: Get reader and card status.
* `readCard()`: Read identity, address, and photo from the card.
* `EidError`: Typed error class with codes.

### TLV Parsing

The card returns the identity and address as base64-encoded TLV (Tag-Length-Value) binary data. A parser (`tlv-parser.ts`) is available that exports `parseCardData(identity, address, photo)`. This function returns a typed `EidCardData` object with fields like `identity.surname`, `identity.firstNames`, `identity.nationalNumber`, `address.street`, `address.zipCode`, `address.municipality`, and a `photoUrl` (data URI).

## Vue Integration

These Vue-specific tools live outside the `eid-service` repository in a parent project. They provide a simple integration for Vue applications.

### `useEid()` Composable

The `useEid()` composable wraps `beid.ts` with Vue reactive state. It connects automatically on mount, disconnects on unmount, and polls health every 2 seconds.

It returns the following readonly reactive state:

* `status`: `"idle" | "connecting" | "checking" | "ready" | "reading" | "success" | "error"`
* `serviceConnected`: Boolean indicating whether the WebSocket is connected.
* `readerConnected`: Boolean indicating if a reader is connected.
* `readerName`: String with the reader name.
* `cardPresent`: Boolean indicating if a card is present.
* `cardData`: `EidCardData | null`
* `errorMessage`: String containing the error message.
* `errorCode`: String containing the error code.

It exposes these methods:

* `read()`: Read the card.
* `connectToService()`: Manually reconnect.
* `checkBackend()`: Manually check service health.

### Vue Example

```vue
<script setup>
import { useEid } from "./composables/useEid"
import EidCard from "./components/EidCard.vue"

const {
  status, serviceConnected, readerConnected, cardPresent,
  cardData, read
} = useEid()
</script>

<template>
  <div>
    <p>Service: {{ serviceConnected ? 'Connected' : 'Disconnected' }}</p>
    <p>Reader: {{ readerConnected ? 'Ready' : 'No reader' }}</p>
    <p>Card: {{ cardPresent ? 'Inserted' : 'No card' }}</p>

    <button v-if="cardPresent" @click="read">Read Card</button>

    <EidCard v-if="cardData" :data="cardData" />
  </div>
</template>
```

### `EidCard` Component

The `EidCard` component displays the card data in a styled card layout with a Belgian flag header, photo, identity fields, address fields, and card info. It takes a single prop: `data: EidCardData`.

## Security

* Loopback-only binding prevents external network access.
* Origin validation against the `allowedOrigins` list.
* Host header check to prevent DNS rebinding attacks.

## Uninstallation

Linux / macOS:

```sh
curl -sSL https://raw.githubusercontent.com/johancoppens/eid-service/main/install.sh | sh -s -- --uninstall
```

Windows:

```powershell
.\install.ps1 -Uninstall
```

## Nederlands

eID Service leest Belgische eID smartcards uit via de webbrowser. Het bestaat uit een lichtgewicht lokale service die via PC/SC met de kaartlezer communiceert en de data beschikbaar stelt via een WebSocket. Elke webapplicatie kan hiermee verbinden om identiteitsgegevens, adresgegevens en de pasfoto van de kaart te lezen.

```
eID Kaart → PC/SC → eid-service (ws://127.0.0.1:17365) → Web App
```

### Vereisten

* Een smartcardlezer.
* Linux gebruikers moeten de `pcscd` daemon installeren en draaien.

### Installatie

#### Linux / macOS

```sh
curl -sSL https://raw.githubusercontent.com/johancoppens/eid-service/main/install.sh | sh
```

Om een toegestane origin in te stellen tijdens de installatie:

```sh
curl -sSL https://raw.githubusercontent.com/johancoppens/eid-service/main/install.sh | sh -s -- --origin https://your-app.com
```

#### Windows

Voer dit uit in PowerShell:

```powershell
irm https://raw.githubusercontent.com/johancoppens/eid-service/main/install.ps1 | iex
```

Om een toegestane origin in te stellen tijdens de installatie:

```powershell
.\install.ps1 -Origin "https://your-app.com"
```

#### Installatie Mappen

* `~/.eid-service/`: Bevat de binary en addon bestanden.
* `~/.config/eid-service/`: Bevat het configuratiebestand.

### Configuratie

Start de interactieve configuratie om de poort en toegestane origins in te stellen:

```sh
eid-service config
```

Het configuratiebestand bevindt zich in `~/.config/eid-service/config.json`. Het formaat ziet er zo uit:

```json
{
  "port": 17365,
  "allowedOrigins": ["https://example.com"]
}
```

### Gebruik

Start de service via de terminal:

```sh
eid-service
```

Als het commando niet in je PATH staat, kan je het direct starten:

```sh
~/.eid-service/eid-service
```

### Protocol Referentie

* Standaard endpoint: `ws://127.0.0.1:17365`

#### Client Acties

Clients sturen JSON actie objecten naar de server.

* `health`: Controleer de status van de service.
* `read`: Lees data van de geplaatste eID kaart.

#### Server Events

De server verstuurt de volgende events naar verbonden clients:

* `ready`
* `card-inserted`
* `card-removed`
* `reader-added`
* `reader-removed`

#### Antwoord Formaat

Succes antwoorden:

```json
{
  "id": "message-id",
  "success": true,
  "data": { ... }
}
```

Fout antwoorden:

```json
{
  "id": "message-id",
  "success": false,
  "error": "Beschrijving van de fout",
  "code": "FOUTCODE"
}
```

#### Foutcodes

* `NO_READER`
* `NO_CARD`
* `CONNECT_FAILED`
* `READ_FAILED`
* `UNKNOWN_ACTION`

### Gebruik vanuit JavaScript (zonder Vue)

De service werkt onafhankelijk van enig framework. Je kan verbinden via standaard WebSockets in elke JavaScript omgeving (vanilla JS, React, Angular, etc.).

#### Vanilla JS Voorbeeld

```js
const ws = new WebSocket("ws://127.0.0.1:17365")

ws.onopen = () => {
  console.log("Connected to eID service")
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)

  // Server events
  if (msg.type === "event") {
    console.log("Event:", msg.event) // ready, card-inserted, card-removed, etc.
    return
  }

  // Response to our request
  if (msg.success) {
    console.log("Card data:", msg.data)
    // msg.data.identity, base64 TLV-encoded identity
    // msg.data.address, base64 TLV-encoded address
    // msg.data.photo, base64 JPEG photo
  }
}

// Read the card
ws.send(JSON.stringify({ action: "read", id: "1" }))
```

#### De `beid.ts` Client Library

Een TypeScript client library (`beid.ts`) wikkelt de WebSocket verbinding in met automatische herverbinding, verzoek/antwoord correlatie, getypeerde antwoorden en foutafhandeling. Deze library heeft geen framework afhankelijkheden en exporteert het volgende:

* `connect(onEvent?)`: Verbind met de service.
* `disconnect()`: Verbreek de verbinding met de service.
* `isConnected()`: Controleer de verbindingsstatus.
* `checkHealth()`: Haal de status van de lezer en kaart op.
* `readCard()`: Lees de identiteit, het adres en de pasfoto van de kaart.
* `EidError`: Getypeerde foutenklasse met codes.

#### TLV Parsen

De kaart retourneert de identiteit en het adres als base64-gecodeerde TLV (Tag-Length-Value) binaire data. Een parser (`tlv-parser.ts`) is beschikbaar en exporteert de `parseCardData(identity, address, photo)` functie. Deze retourneert een getypeerd `EidCardData` object met velden zoals `identity.surname`, `identity.firstNames`, `identity.nationalNumber`, `address.street`, `address.zipCode`, `address.municipality` en een `photoUrl` (data URI).

### Vue Integratie

Deze Vue-specifieke tools bevinden zich buiten de `eid-service` repository in een bovenliggend project. Ze bieden een eenvoudige integratie voor Vue applicaties.

#### `useEid()` Composable

De `useEid()` composable wikkelt `beid.ts` in met Vue reactieve status. Het verbindt automatisch bij het monteren, verbreekt de verbinding bij ontmonteren en controleert de status elke 2 seconden.

Het retourneert de volgende alleen-lezen reactieve status:

* `status`: `"idle" | "connecting" | "checking" | "ready" | "reading" | "success" | "error"`
* `serviceConnected`: Boolean die aangeeft of de WebSocket verbonden is.
* `readerConnected`: Boolean die aangeeft of een lezer is aangesloten.
* `readerName`: String met de naam van de lezer.
* `cardPresent`: Boolean die aangeeft of er een kaart aanwezig is.
* `cardData`: `EidCardData | null`
* `errorMessage`: String met de foutmelding.
* `errorCode`: String met de foutcode.

Het stelt deze methoden beschikbaar:

* `read()`: Lees de kaart.
* `connectToService()`: Handmatig opnieuw verbinden.
* `checkBackend()`: Handmatig de service status controleren.

#### Vue Voorbeeld

```vue
<script setup>
import { useEid } from "./composables/useEid"
import EidCard from "./components/EidCard.vue"

const {
  status, serviceConnected, readerConnected, cardPresent,
  cardData, read
} = useEid()
</script>

<template>
  <div>
    <p>Service: {{ serviceConnected ? 'Connected' : 'Disconnected' }}</p>
    <p>Reader: {{ readerConnected ? 'Ready' : 'No reader' }}</p>
    <p>Card: {{ cardPresent ? 'Inserted' : 'No card' }}</p>

    <button v-if="cardPresent" @click="read">Read Card</button>

    <EidCard v-if="cardData" :data="cardData" />
  </div>
</template>
```

#### `EidCard` Component

De `EidCard` component toont de kaartgegevens in een vormgegeven kaart lay-out met een Belgische vlag hoofding, pasfoto, identiteitsvelden, adresvelden en kaartinformatie. Het neemt een enkele prop aan: `data: EidCardData`.

### Beveiliging

* Alleen loopback netwerkbinding blokkeert externe toegang.
* Origin validatie controleert de `allowedOrigins` lijst.
* Host header controle voorkomt DNS rebinding aanvallen.

### Verwijderen

Linux / macOS:

```sh
curl -sSL https://raw.githubusercontent.com/johancoppens/eid-service/main/install.sh | sh -s -- --uninstall
```

Windows:

```powershell
.\install.ps1 -Uninstall
```