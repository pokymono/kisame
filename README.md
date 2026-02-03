# Kisame

**Kisame is an AI-assisted network forensics tool that helps analysts reconstruct, explore, and explain network activity from PCAP files using session reconstruction, timelines, and evidence-anchored conversational analysis.**

## System Context & Specification

This repo is intentionally documented as context + specification (not marketing copy). Start with `SYSTEM_CONTEXT.md`:

- `SYSTEM_CONTEXT.md` — canonical product intent, boundaries, and UI/architecture mental model

> "Kisame feels like using Cursor, but instead of explaining code, it helps you reason about network traffic — calmly, transparently, and with evidence."

## Non-Goals (Hard Boundaries)

Kisame is not:

- an IDS/IPS
- a malware detector
- a live network monitor / packet capture tool
- an automated incident response system
- a replacement for Wireshark/tshark

Kisame assists human reasoning over PCAP evidence.

## Architecture (3 Strict Layers)

```
PCAP File
  ↓
Python Forensic Engine
  ↓ (JSON artifacts: sessions/timeline/evidence IDs)
Bun + AI SDK (Explanation Layer)
  ↓
Electron UI (Cursor-style workspace)
```

## Repository Layout

```
kisame/
├── apps/
│   ├── desktop/                # Electron workspace (Cursor-style UI)
│   └── website/                # Future web UI (placeholder)
├── services/
│   ├── forensic-engine/        # Python PCAP → JSON (ground truth)
│   └── explanation-service/    # Bun service: JSON → explanations/chat
├── SYSTEM_CONTEXT.md           # Full system description/spec
└── README.md                   # Setup + navigation
```

## Local Setup (Developer)

Kisame is designed to run locally. You’ll need:

- `tshark` (Wireshark CLI) available on `PATH`
- Python `3.11+` (for `services/forensic-engine`)
- Bun `1.3+` (for `services/explanation-service`)
- Node `20.17+` (for `apps/desktop`)

Notes:

- On Windows, Kisame development typically works well via WSL; ensure `tshark` is installed in the same environment you run the engine from.
- The AI layer can be run fully offline (deterministic templates) or configured to call an AI SDK; it must remain evidence-anchored either way.

## Quick Start (3 Terminals)

### 1) Forensic Engine (Python)

```bash
python3 services/forensic-engine/main.py --help
python3 services/forensic-engine/main.py analyze path/to/capture.pcapng -o out/analysis.json
```

### 2) Explanation Service (Bun)

```bash
cd services/explanation-service
bun install
bun run dev
```

### 3) Desktop UI (Electron)

```bash
cd apps/desktop
npm install
npm run dev
```

Desktop PCAP analysis env vars:

- `KISAME_PYTHON` (python executable for the engine)
- `KISAME_MAX_PACKETS` (faster iteration limit)
- `KISAME_SKIP_HASH=0` to include SHA-256 (default skips for speed)
- `VITE_EXPLANATION_URL` (optional; defaults to `http://localhost:8787`)
- `KISAME_BUN_URL` (desktop → Bun service URL; defaults to `http://localhost:8787`)

## Where To Read Next

- `SYSTEM_CONTEXT.md` — full intent/spec and LLM interpretation rules
- `services/README.md` — service roles and boundaries
- `apps/desktop/README.md` — Electron/Vite/Tailwind workspace details
- `apps/desktop/HOW_TO_RUN.md` — how to run the desktop app + local PCAP analysis prerequisites
- `services/forensic-engine/README.md` — engine CLI and JSON output overview
- `services/explanation-service/README.md` — explanation service API and run commands

## Troubleshooting

- `tshark not found`: install Wireshark/tshark or set `TSHARK_PATH`
- Bun `AnalyzePCAP` fails: check `GET /tshark/version` on the Bun service
- Desktop “Analyze” fails: set `KISAME_PYTHON` and verify Python can run `services/forensic-engine/main.py`
- Bun service port conflict: set `PORT=...` when running `services/explanation-service`
