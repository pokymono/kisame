# Kisame

AI-assisted network forensics tool for PCAP analysis with session reconstruction, timelines, and evidence-anchored conversational analysis.

## Quick Start

```bash
# Start the backend
cd services/explanation-service
bun install && bun run dev

# Start the desktop app (in another terminal)
cd apps/desktop
npm install && npm run dev
```

## Architecture

```
kisame/
├── apps/
│   └── desktop/              # Electron desktop app
└── services/
    ├── explanation-service/  # Bun backend (AI + PCAP analysis)
    └── forensic-engine/      # Python fallback engine
```

## Requirements

- **Node.js** 18+
- **Bun** 1.0+
- **TShark** (for PCAP analysis)
- **OpenAI API key** (optional, for AI chat)

## Environment Variables

```bash
# services/explanation-service/.env
PORT=8787
OPENAI_API_KEY=sk-...
TSHARK_PATH=/usr/bin/tshark
```

## License

MIT
