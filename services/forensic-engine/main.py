from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional


SCHEMA_VERSION = 1


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_tshark(explicit_path: Optional[str]) -> str:
    if explicit_path:
        return explicit_path
    env_path = os.environ.get("TSHARK_PATH")
    if env_path:
        return env_path
    resolved = shutil.which("tshark")
    if not resolved:
        raise FileNotFoundError(
            "tshark not found on PATH. Install Wireshark/tshark or set TSHARK_PATH."
        )
    return resolved


def _tshark_version(tshark_path: str) -> Optional[str]:
    try:
        proc = subprocess.run(
            [tshark_path, "--version"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        first_line = (proc.stdout or "").splitlines()[0].strip()
        return first_line or None
    except Exception:
        return None


def _safe_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _safe_float(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _canonical_endpoint(
    ip: str, port: Optional[int]
) -> tuple[str, int]:
    return ip, -1 if port is None else port


def _canonical_pair(
    src_ip: str,
    src_port: Optional[int],
    dst_ip: str,
    dst_port: Optional[int],
) -> tuple[dict[str, Any], dict[str, Any]]:
    a = _canonical_endpoint(src_ip, src_port)
    b = _canonical_endpoint(dst_ip, dst_port)
    if a <= b:
        return (
            {"ip": src_ip, "port": src_port},
            {"ip": dst_ip, "port": dst_port},
        )
    return (
        {"ip": dst_ip, "port": dst_port},
        {"ip": src_ip, "port": src_port},
    )


@dataclass
class TimelineEvent:
    ts: float
    session_id: str
    kind: str
    summary: str
    evidence_frame: int


def analyze_pcap(
    pcap_path: str,
    *,
    tshark_path: Optional[str],
    max_packets: Optional[int],
    sample_frames_per_session: int,
    include_sha256: bool,
) -> dict[str, Any]:
    if not os.path.isfile(pcap_path):
        raise FileNotFoundError(f"PCAP not found: {pcap_path}")

    tshark_bin = _resolve_tshark(tshark_path)

    fields = [
        "frame.number",
        "frame.time_epoch",
        "frame.len",
        "ip.src",
        "ip.dst",
        "ipv6.src",
        "ipv6.dst",
        "tcp.srcport",
        "tcp.dstport",
        "udp.srcport",
        "udp.dstport",
        "frame.protocols",
        "dns.qry.name",
        "http.request.method",
        "http.host",
        "http.request.uri",
        "tls.handshake.extensions_server_name",
    ]

    cmd: list[str] = [
        tshark_bin,
        "-r",
        pcap_path,
        "-n",
        "-T",
        "fields",
        "-E",
        "header=y",
        "-E",
        "separator=\t",
        "-E",
        "quote=d",
        "-E",
        "occurrence=f",
    ]
    if max_packets is not None:
        cmd.extend(["-c", str(max_packets)])
    for f in fields:
        cmd.extend(["-e", f])

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    assert proc.stderr is not None

    sessions: dict[str, dict[str, Any]] = {}
    events: list[TimelineEvent] = []

    reader = csv.DictReader(proc.stdout, delimiter="\t", quotechar='"')

    packet_count = 0
    first_ts: Optional[float] = None
    last_ts: Optional[float] = None

    for row in reader:
        packet_count += 1

        frame_no = _safe_int(row.get("frame.number"))
        ts = _safe_float(row.get("frame.time_epoch"))
        frame_len = _safe_int(row.get("frame.len"))
        if frame_no is None or ts is None:
            continue

        first_ts = ts if first_ts is None else min(first_ts, ts)
        last_ts = ts if last_ts is None else max(last_ts, ts)

        src_ip = (row.get("ip.src") or row.get("ipv6.src") or "").strip()
        dst_ip = (row.get("ip.dst") or row.get("ipv6.dst") or "").strip()
        if not src_ip or not dst_ip:
            continue

        tcp_src = _safe_int(row.get("tcp.srcport"))
        tcp_dst = _safe_int(row.get("tcp.dstport"))
        udp_src = _safe_int(row.get("udp.srcport"))
        udp_dst = _safe_int(row.get("udp.dstport"))

        transport: str
        src_port: Optional[int]
        dst_port: Optional[int]
        if tcp_src is not None or tcp_dst is not None:
            transport = "tcp"
            src_port, dst_port = tcp_src, tcp_dst
        elif udp_src is not None or udp_dst is not None:
            transport = "udp"
            src_port, dst_port = udp_src, udp_dst
        else:
            transport = "other"
            src_port, dst_port = None, None

        a, b = _canonical_pair(src_ip, src_port, dst_ip, dst_port)
        session_key = f"{transport}:{a['ip']}:{a['port']}->{b['ip']}:{b['port']}"
        session_id = hashlib.sha1(session_key.encode("utf-8")).hexdigest()[:12]

        session = sessions.get(session_key)
        if session is None:
            session = {
                "id": session_id,
                "transport": transport,
                "endpoints": {"a": a, "b": b},
                "first_ts": ts,
                "last_ts": ts,
                "packet_count": 0,
                "byte_count": 0,
                "protocol_chains": {},
                "evidence": {
                    "first_frame": frame_no,
                    "last_frame": frame_no,
                    "sample_frames": [],
                },
                "observations": {
                    "dns_queries": [],
                    "http_requests": [],
                    "tls_sni": [],
                },
                "rule_flags": [],
            }
            sessions[session_key] = session

        session["packet_count"] += 1
        session["byte_count"] += 0 if frame_len is None else frame_len
        session["first_ts"] = min(session["first_ts"], ts)
        session["last_ts"] = max(session["last_ts"], ts)
        session["evidence"]["first_frame"] = min(session["evidence"]["first_frame"], frame_no)
        session["evidence"]["last_frame"] = max(session["evidence"]["last_frame"], frame_no)
        if len(session["evidence"]["sample_frames"]) < sample_frames_per_session:
            session["evidence"]["sample_frames"].append(frame_no)

        chain = (row.get("frame.protocols") or "").strip()
        if chain:
            session["protocol_chains"][chain] = session["protocol_chains"].get(chain, 0) + 1

        dns_qry = (row.get("dns.qry.name") or "").strip()
        if dns_qry:
            session["observations"]["dns_queries"].append(
                {"name": dns_qry, "ts": ts, "evidence_frame": frame_no}
            )
            events.append(
                TimelineEvent(
                    ts=ts,
                    session_id=session_id,
                    kind="dns_query",
                    summary=f"DNS query: {dns_qry}",
                    evidence_frame=frame_no,
                )
            )

        http_method = (row.get("http.request.method") or "").strip()
        http_host = (row.get("http.host") or "").strip()
        http_uri = (row.get("http.request.uri") or "").strip()
        if http_method and (http_host or http_uri):
            summary = f"HTTP request: {http_method} {http_host}{http_uri}"
            session["observations"]["http_requests"].append(
                {
                    "method": http_method,
                    "host": http_host or None,
                    "uri": http_uri or None,
                    "ts": ts,
                    "evidence_frame": frame_no,
                }
            )
            events.append(
                TimelineEvent(
                    ts=ts,
                    session_id=session_id,
                    kind="http_request",
                    summary=summary,
                    evidence_frame=frame_no,
                )
            )

        sni = (row.get("tls.handshake.extensions_server_name") or "").strip()
        if sni:
            session["observations"]["tls_sni"].append(
                {"server_name": sni, "ts": ts, "evidence_frame": frame_no}
            )
            events.append(
                TimelineEvent(
                    ts=ts,
                    session_id=session_id,
                    kind="tls_sni",
                    summary=f"TLS SNI: {sni}",
                    evidence_frame=frame_no,
                )
            )

    stderr = proc.stderr.read()
    rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"tshark failed (exit {rc}): {stderr.strip()}")

    session_list = list(sessions.values())
    for s in session_list:
        duration = float(s["last_ts"] - s["first_ts"])
        flags: list[str] = []
        if s["packet_count"] >= 1000:
            flags.append("many_packets")
        if duration >= 60:
            flags.append("long_duration")
        if s["byte_count"] >= 10 * 1024 * 1024:
            flags.append("large_bytes")
        if s["transport"] == "other":
            flags.append("non_tcp_udp")
        s["duration_seconds"] = duration
        s["rule_flags"] = flags

    timeline = sorted(events, key=lambda e: e.ts)

    pcap_stat = os.stat(pcap_path)
    artifact: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _utc_now_iso(),
        "pcap": {
            "path": os.path.abspath(pcap_path),
            "file_name": os.path.basename(pcap_path),
            "size_bytes": int(pcap_stat.st_size),
            "sha256": _sha256_file(pcap_path) if include_sha256 else None,
            "packets_analyzed": packet_count,
            "first_ts": first_ts,
            "last_ts": last_ts,
        },
        "tooling": {
            "tshark_path": tshark_bin,
            "tshark_version": _tshark_version(tshark_bin),
        },
        "sessions": sorted(session_list, key=lambda s: (s["first_ts"], s["id"])),
        "timeline": [
            {
                "ts": e.ts,
                "session_id": e.session_id,
                "kind": e.kind,
                "summary": e.summary,
                "evidence_frame": e.evidence_frame,
            }
            for e in timeline
        ],
    }
    return artifact


def _cmd_analyze(args: argparse.Namespace) -> int:
    artifact = analyze_pcap(
        args.pcap,
        tshark_path=args.tshark,
        max_packets=args.max_packets,
        sample_frames_per_session=args.sample_frames_per_session,
        include_sha256=not args.skip_hash,
    )
    encoded = json.dumps(artifact, indent=2, sort_keys=False)
    if args.output:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(encoded)
            f.write("\n")
    else:
        sys.stdout.write(encoded)
        sys.stdout.write("\n")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="kisame-forensic-engine",
        description="Offline PCAP → JSON artifact generator (ground truth layer for Kisame).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    analyze = sub.add_parser("analyze", help="Analyze a PCAP/PCAPNG into JSON artifacts")
    analyze.add_argument("pcap", help="Path to .pcap/.pcapng")
    analyze.add_argument(
        "-o",
        "--output",
        help="Write JSON to this path (defaults to stdout)",
    )
    analyze.add_argument(
        "--tshark",
        help="Path to tshark binary (or set TSHARK_PATH)",
        default=None,
    )
    analyze.add_argument(
        "--max-packets",
        type=int,
        default=None,
        help="Limit packets analyzed (for fast iteration)",
    )
    analyze.add_argument(
        "--sample-frames-per-session",
        type=int,
        default=8,
        help="How many frame numbers to keep as evidence samples per session",
    )
    analyze.add_argument(
        "--skip-hash",
        action="store_true",
        help="Skip SHA-256 (faster for very large captures)",
    )
    analyze.set_defaults(func=_cmd_analyze)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
