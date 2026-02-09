# Explanation Service

Bun-based backend service for PCAP analysis and AI-powered chat.

## Development

```bash
bun install
bun run dev
```

## Production

```bash
bun run start
```

## Environment Variables

| Variable          | Description                | Default   |
| ----------------- | -------------------------- | --------- |
| `PORT`            | Server port                | `8787`    |
| `OPENAI_API_KEY`  | OpenAI API key for AI chat | -         |
| `TSHARK_PATH`     | Path to tshark executable  | `tshark`  |
| `KISAME_DATA_DIR` | Data storage directory     | `./.data` |

## API Endpoints

| Method | Path                 | Description              |
| ------ | -------------------- | ------------------------ |
| GET    | `/health`            | Health check             |
| POST   | `/pcap`              | Upload PCAP file         |
| GET    | `/pcap/:id`          | Get session info         |
| POST   | `/tools/analyzePcap` | Analyze PCAP with TShark |
| POST   | `/explain/session`   | Get session explanation  |
| POST   | `/chat`              | AI-powered chat          |
