# Kisame Forensic Engine (Python)

This service is Kisame’s ground-truth layer: it runs fully offline on a PCAP/PCAPNG and produces structured JSON artifacts (sessions, timeline events, and evidence identifiers).

## Requirements

- Python 3.11+
- `tshark` installed and on `PATH` (or set `TSHARK_PATH`)

## Run

```bash
python3 main.py --help
python3 main.py analyze path/to/capture.pcapng -o out/analysis.json
```

### Useful options

- `--max-packets 5000` for faster iteration on large captures
- `--skip-hash` to avoid computing a SHA-256 for the capture
- `--tshark /path/to/tshark` (or `TSHARK_PATH=/path/to/tshark`)

## Output contract (high level)

The JSON output is designed to be consumed by the Explanation Layer and UI:

- `pcap.*` — capture metadata (including optional hash)
- `sessions[]` — reconstructed 5-tuple buckets (transport + endpoints + counts + evidence frames)
- `timeline[]` — chronological, fact-only events with `evidence_frame`

The engine contains no AI logic.
