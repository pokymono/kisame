# Kisame Services

This directory contains the backend services for Kisame.

## `explanation-service` (Bun)

- **Role**: The API layer that connects the Forensic Engine and the AI SDK.
- **Technology**: Bun, TypeScript.
- **Responsibilities**:
  - Serves data to the Electron UI.
  - Manages AI context and chat.
  - Stores uploaded PCAPs as sessions.
  - Runs `tshark` (AnalyzePCAP tool) to generate JSON artifacts.

Quick start:

```bash
cd services/explanation-service
bun install
bun run dev
```

API:

- `GET /health`
- `GET /tshark/version`
- `POST /pcap`
- `POST /tools/analyzePcap`
- `POST /explain/session`

## `forensic-engine` (Python)

- **Role**: The core analysis engine.
- **Technology**: Python + `tshark` (Wireshark CLI decoder).
- **Responsibilities**:
  - Parses PCAP files.
  - Reconstructs sessions.
  - Generates structured JSON output.

Quick start:

```bash
python3 services/forensic-engine/main.py analyze path/to/capture.pcapng -o out/analysis.json
```
