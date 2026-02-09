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
| `OPENAI_MODEL`    | OpenAI model name          | `gpt-5.2` |
| `TSHARK_PATH`     | Path to tshark executable  | `tshark`  |
| `KISAME_DATA_DIR` | Data storage directory     | `./.data` |
| `CORS_ORIGIN`     | CORS allow origin          | `*`       |
| `IDLE_TIMEOUT`    | Bun idle timeout (seconds) | `120`     |

### macOS notes

If Wireshark is installed via the app bundle, `tshark` is usually here:

- `/Applications/Wireshark.app/Contents/MacOS/tshark`

The service will auto-detect common macOS and Homebrew paths, or you can set `TSHARK_PATH`.

## API Endpoints

| Method | Path                 | Description              |
| ------ | -------------------- | ------------------------ |
| GET    | `/health`            | Health check             |
| GET    | `/tshark/version`    | TShark version info      |
| POST   | `/pcap`              | Upload PCAP file         |
| GET    | `/pcap/:id`          | Get session info         |
| POST   | `/tools/analyzePcap` | Analyze PCAP with TShark |
| POST   | `/explain/session`   | Get session explanation  |
| POST   | `/chat`              | AI-powered chat          |
| POST   | `/chat/stream`       | Streaming chat (SSE)     |
