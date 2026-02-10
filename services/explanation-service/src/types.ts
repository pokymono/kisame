export type PcapSession = {
  id: string;
  fileName: string;
  filePath: string;
  createdAt: string;
  sizeBytes: number;
  ownerId?: string;
};

export type AnalysisArtifact = {
  schema_version: number;
  generated_at: string;
  pcap: {
    session_id: string;
    file_name: string;
    size_bytes: number;
    packets_analyzed: number;
    first_ts: number | null;
    last_ts: number | null;
  };
  tooling: { tshark_path: string; tshark_version: string | null };
  sessions: Array<{
    id: string;
    transport: 'tcp' | 'udp' | 'other';
    endpoints: { a: { ip: string; port: number | null }; b: { ip: string; port: number | null } };
    first_ts: number;
    last_ts: number;
    duration_seconds: number;
    packet_count: number;
    byte_count: number;
    evidence: { first_frame: number; last_frame: number; sample_frames: number[] };
    rule_flags: string[];
    protocols?: Array<{ chain: string; count: number }>;
  }>;
  timeline: Array<{
    ts: number;
    session_id: string;
    kind: string;
    summary: string;
    evidence_frame: number;
    meta?: {
      dns_name?: string;
      sni?: string;
      http?: { method?: string; host?: string | null; uri?: string | null };
    };
  }>;
};

export type ChatContext = {
  session_id?: string;
  artifact?: AnalysisArtifact;
};

export type ChatQueryRequest = {
  query: string;
  context?: ChatContext;
};

export type ChatQueryResponse = {
  query: string;
  response: string;
  timestamp: string;
  context_available: boolean;
};
