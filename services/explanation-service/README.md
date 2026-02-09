# explanation-service

Kisame’s explanation layer. It turns forensic JSON artifacts into evidence-anchored explanations that the UI can display (and later, a constrained chat can build on).

This service does not parse PCAPs and does not need raw packets.

Update: it can also run `tshark` directly (Tool: `AnalyzePCAP`) on uploaded PCAPs to generate the artifact JSON, and then produce deterministic (non-AI) explanations from that artifact.

## Setup

To install dependencies:

```bash
bun install
```

## Run

Development (watch mode):

```bash
bun run dev
```

Or:

```bash
bun run start
```

Default port: `8787` (override with `PORT=...`).

## Requirements (for AnalyzePCAP)

- `tshark` installed and available to the Bun process
- Set `TSHARK_PATH` if it’s not on `PATH`
- Data directory defaults to `services/explanation-service/.data` (override with `KISAME_DATA_DIR`)

## API

- `GET /health`
- `GET /tshark/version`
- `POST /pcap` (raw bytes; header `x-filename`; returns `{ session_id }`)
- `GET /pcap/:session_id`
- `POST /tools/analyzePcap` body: `{ "session_id": "...", "max_packets"?: 5000 }`
- `POST /explain/session` body: `{ "artifact": <engine-json>, "session_id": "..." }`

See `services/explanation-service/example.http` for sample requests.

This project was created using `bun init`. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
