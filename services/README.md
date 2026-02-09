# Kisame Services

This directory contains the backend services for Kisame.

## `explanation-service` (Bun)

- **Role**: The API layer that connects the Forensic Engine and the AI SDK.
- **Technology**: Bun, TypeScript.
- **Responsibilities**:
  - Serves data to the Electron UI.
  - Manages AI context and chat.
  - Reads JSON artifacts from the Forensic Engine.

## `forensic-engine` (Python)

- **Role**: The core analysis engine.
- **Technology**: Python (tshark/pyshark).
- **Responsibilities**:
  - Parses PCAP files.
  - Reconstructs sessions.
  - Generates structured JSON output.
