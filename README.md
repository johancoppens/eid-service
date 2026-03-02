# eID Service

Local WebSocket service for reading Belgian eID smart cards via PC/SC.

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
  "fingerprint": "uuid",
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

## Security

* Loopback-only binding prevents external network access.
* Origin validation against the `allowedOrigins` list.
* Host header check to prevent DNS rebinding attacks.
* Fingerprint TOFU (Trust On First Use) device verification.

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

Lokale WebSocket service voor het uitlezen van Belgische eID smartcards via PC/SC.

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
  "fingerprint": "uuid",
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

### Beveiliging

* Alleen loopback netwerkbinding blokkeert externe toegang.
* Origin validatie controleert de `allowedOrigins` lijst.
* Host header controle voorkomt DNS rebinding aanvallen.
* Fingerprint TOFU (Trust On First Use) apparaatverificatie.

### Verwijderen

Linux / macOS:

```sh
curl -sSL https://raw.githubusercontent.com/johancoppens/eid-service/main/install.sh | sh -s -- --uninstall
```

Windows:

```powershell
.\install.ps1 -Uninstall
```