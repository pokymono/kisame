import { ToolLoopAgent, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { ChatContext, ChatQueryResponse, AnalysisArtifact } from '../types';
import { utcNowIso } from '../utils/response';
import { logInfo, logWarn, logError, toErrorMeta } from '../utils/logger';

export type ChatStreamEvent =
  | { type: 'status'; stage: string; message?: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; toolName: string; output: unknown }
  | { type: 'tool_summary'; summary: string }
  | { type: 'done'; finish_reason?: string }
  | { type: 'error'; message: string };

type ToolResultSummary = {
  toolCallId: string;
  toolName: string;
  summary: string;
};

type DomainCounts = { dns: number; sni: number; http: number };

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, '').replace(/\.$/, '');
}

function timelineSearchText(event: AnalysisArtifact['timeline'][number]): string {
  const parts = [
    event.summary,
    event.meta?.dns_name,
    event.meta?.sni,
    event.meta?.http?.method,
    event.meta?.http?.host,
    event.meta?.http?.uri,
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function isGlobalQuestion(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes('entire') ||
    lower.includes('whole') ||
    lower.includes('overall') ||
    lower.includes('pcap') ||
    lower.includes('capture') ||
    lower.includes('all sessions')
  );
}

function isDomainLike(term: string): boolean {
  const cleaned = term.toLowerCase().trim();
  return cleaned.includes('.') && !cleaned.includes(' ');
}

function normalizeSearchTerms(terms: string[]): string[] {
  return terms
    .flatMap((term) => term.split(/\s+/))
    .map((term) => term.trim())
    .filter(Boolean);
}

function buildSystemPrompt(context?: ChatContext): string {
  const basePrompt = `You are Kisame, an AI assistant specialized in network traffic analysis and cybersecurity forensics.
You help users understand packet captures (PCAPs) by correlating sessions, timelines, and evidence frames.

Primary goals:
1) Produce accurate, evidence-anchored explanations of network behavior.
2) Identify suspicious or noteworthy patterns without speculation.
3) Clearly distinguish observed facts from interpretation.
4) Suggest next investigative steps when appropriate.

Evidence policy:
- Always anchor claims to concrete evidence (frame numbers, timestamps, IPs, ports, protocols).
- If evidence is missing or incomplete, explicitly say so.
- Do not fabricate packet contents or protocol details.

Tool usage policy:
- Use tools to fetch session details, timelines, and evidence instead of guessing.
- If the user asks about a specific session and none is selected, request a session id or use tools to list sessions.
- Prefer concise tool queries and summarize tool outputs in plain language.
- When context is available, start with 'pcap_overview' or 'list_sessions' to ground the response before interpreting activity.
- If the question is about the entire capture (e.g., "was YouTube opened", "any vtop traffic"), use 'pcap_search' across all sessions. Do not limit to the selected session unless explicitly asked.
- Use 'pcap_domains' for capture-wide domain questions, 'pcap_top_talkers' for top IP/traffic questions, and 'pcap_protocols' for protocol stack questions.
- Use 'pcap_domain_sessions' to connect a domain to its sessions and 'pcap_session_domains' to list domains inside a session.
- Use 'pcap_sessions_query' to filter sessions by IP/port/domain/flags and 'pcap_timeline_range' for time-windowed analysis.

Response format:
- Start with a short 2–4 sentence summary.
- Provide a compact evidence section with bullet points.
- Add interpretation/risks only if supported by evidence.
- End with suggested next steps (if the user asked for guidance).

Tone:
- Precise, technical, and calm. Avoid filler or speculation.`;

  if (!context?.artifact || !context?.session_id) {
    return basePrompt;
  }

  const session = context.artifact.sessions?.find((s) => s.id === context.session_id);
  if (!session) {
    return basePrompt;
  }

  const durationSeconds =
    typeof session.duration_seconds === 'number'
      ? session.duration_seconds
      : Math.max(0, session.last_ts - session.first_ts);
  const ruleFlags = session.rule_flags ?? [];

  const sessionContext = `

Current Session Context:
- Session ID: ${session.id}
- Transport: ${session.transport.toUpperCase()}
- Endpoints: ${session.endpoints.a.ip}:${session.endpoints.a.port ?? '?'} ↔ ${session.endpoints.b.ip}:${session.endpoints.b.port ?? '?'}
- Duration: ${durationSeconds.toFixed(2)}s
- Volume: ${session.packet_count} packets, ${session.byte_count} bytes
- Evidence frames: #${session.evidence.first_frame} to #${session.evidence.last_frame}
- Rule flags: ${ruleFlags.length > 0 ? ruleFlags.join(', ') : 'none'}

Timeline preview:
${getTimelinePreview(context.artifact, context.session_id)}`;

  return basePrompt + sessionContext;
}

function getTimelinePreview(artifact: AnalysisArtifact, sessionId: string): string {
  const events = artifact.timeline?.filter((e) => e.session_id === sessionId) ?? [];
  if (events.length === 0) {
    return 'No decoded events available for this session.';
  }

  return events
    .slice(0, 10)
    .map(
      (e) =>
        `- ${new Date(e.ts * 1000).toISOString().slice(11, 19)} ${e.summary} (frame #${e.evidence_frame})`
    )
    .join('\n');
}

function createTools(context?: ChatContext) {
  const artifact = context?.artifact;
  const domainIndex: Map<string, DomainCounts> | null = artifact ? new Map() : null;
  let domainIndexBuilt = false;
  let talkerIndex: Map<string, { bytes: number; packets: number }> | null = artifact ? new Map() : null;
  let talkerIndexBuilt = false;
  let protocolIndex: Map<string, number> | null = artifact ? new Map() : null;
  let protocolIndexBuilt = false;
  const sessionDomainIndex: Map<string, Map<string, DomainCounts>> | null = artifact ? new Map() : null;
  const domainSessionIndex: Map<string, Map<string, DomainCounts>> | null = artifact ? new Map() : null;
  let sessionDomainIndexBuilt = false;

  const ensureDomainIndex = () => {
    if (!artifact || !domainIndex || domainIndexBuilt) return;
    domainIndexBuilt = true;

    const add = (domain: string, type: 'dns' | 'sni' | 'http') => {
      const key = normalizeDomain(domain);
      if (!key) return;
      const entry = domainIndex.get(key) ?? { dns: 0, sni: 0, http: 0 };
      entry[type] += 1;
      domainIndex.set(key, entry);
    };

    for (const event of artifact.timeline ?? []) {
      if (event.kind === 'dns_query') {
        const name = event.meta?.dns_name ?? event.summary.replace(/^DNS query:\s*/i, '').trim();
        if (name) add(name, 'dns');
      } else if (event.kind === 'tls_sni') {
        const sni = event.meta?.sni ?? event.summary.replace(/^TLS SNI:\s*/i, '').trim();
        if (sni) add(sni, 'sni');
      } else if (event.kind === 'http_request') {
        const host =
          event.meta?.http?.host ??
          (() => {
            const cleaned = event.summary.replace(/^HTTP request:\s*/i, '').trim();
            const parts = cleaned.split(' ');
            if (parts.length < 2) return '';
            const hostAndPath = parts.slice(1).join(' ');
            return hostAndPath.split('/')[0] ?? '';
          })();
        if (host) add(host, 'http');
      }
    }
  };

  const ensureSessionDomainIndex = () => {
    if (!artifact || !sessionDomainIndex || !domainSessionIndex || sessionDomainIndexBuilt) return;
    sessionDomainIndexBuilt = true;

    const add = (sessionId: string, domain: string, type: 'dns' | 'sni' | 'http') => {
      const key = normalizeDomain(domain);
      if (!key) return;
      const sessionEntry = sessionDomainIndex.get(sessionId) ?? new Map<string, DomainCounts>();
      const sessionCounts = sessionEntry.get(key) ?? { dns: 0, sni: 0, http: 0 };
      sessionCounts[type] += 1;
      sessionEntry.set(key, sessionCounts);
      sessionDomainIndex.set(sessionId, sessionEntry);

      const domainEntry = domainSessionIndex.get(key) ?? new Map<string, DomainCounts>();
      const domainCounts = domainEntry.get(sessionId) ?? { dns: 0, sni: 0, http: 0 };
      domainCounts[type] += 1;
      domainEntry.set(sessionId, domainCounts);
      domainSessionIndex.set(key, domainEntry);
    };

    for (const event of artifact.timeline ?? []) {
      if (event.kind === 'dns_query') {
        const name = event.meta?.dns_name ?? event.summary.replace(/^DNS query:\s*/i, '').trim();
        if (name) add(event.session_id, name, 'dns');
      } else if (event.kind === 'tls_sni') {
        const sni = event.meta?.sni ?? event.summary.replace(/^TLS SNI:\s*/i, '').trim();
        if (sni) add(event.session_id, sni, 'sni');
      } else if (event.kind === 'http_request') {
        const host =
          event.meta?.http?.host ??
          (() => {
            const cleaned = event.summary.replace(/^HTTP request:\s*/i, '').trim();
            const parts = cleaned.split(' ');
            if (parts.length < 2) return '';
            const hostAndPath = parts.slice(1).join(' ');
            return hostAndPath.split('/')[0] ?? '';
          })();
        if (host) add(event.session_id, host, 'http');
      }
    }
  };


  const ensureTalkerIndex = () => {
    if (!artifact || !talkerIndex || talkerIndexBuilt) return;
    talkerIndexBuilt = true;

    for (const session of artifact.sessions ?? []) {
      const add = (ip: string) => {
        const entry = talkerIndex.get(ip) ?? { bytes: 0, packets: 0 };
        entry.bytes += session.byte_count;
        entry.packets += session.packet_count;
        talkerIndex.set(ip, entry);
      };
      add(session.endpoints.a.ip);
      add(session.endpoints.b.ip);
    }
  };

  const ensureProtocolIndex = () => {
    if (!artifact || !protocolIndex || protocolIndexBuilt) return;
    protocolIndexBuilt = true;

    for (const session of artifact.sessions ?? []) {
      if (session.protocols && session.protocols.length) {
        for (const proto of session.protocols) {
          protocolIndex.set(proto.chain, (protocolIndex.get(proto.chain) ?? 0) + proto.count);
        }
      } else {
        protocolIndex.set(
          session.transport,
          (protocolIndex.get(session.transport) ?? 0) + session.packet_count
        );
      }
    }
  };

  return {
    pcap_overview: tool({
      description: 'Get overall PCAP metadata and session counts.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        return {
          file_name: artifact.pcap.file_name,
          packets_analyzed: artifact.pcap.packets_analyzed,
          first_ts: artifact.pcap.first_ts,
          last_ts: artifact.pcap.last_ts,
          session_count: artifact.sessions.length,
        };
      },
    }),
    list_sessions: tool({
      description: 'List sessions with compact metadata.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        const sessions = artifact.sessions ?? [];
        const max = limit ?? 10;
        return {
          total: sessions.length,
          sessions: sessions.slice(0, max).map((session) => ({
            id: session.id,
            transport: session.transport,
            a: session.endpoints.a,
            b: session.endpoints.b,
            packet_count: session.packet_count,
            byte_count: session.byte_count,
            first_ts: session.first_ts,
            last_ts: session.last_ts,
            rule_flags: session.rule_flags ?? [],
          })),
        };
      },
    }),
    get_session: tool({
      description: 'Get detailed session metadata for a specific session id.',
      inputSchema: z.object({
        session_id: z.string().describe('Session id to retrieve.'),
      }),
      execute: async ({ session_id }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        const session = artifact.sessions.find((s) => s.id === session_id);
        if (!session) {
          return { error: `Unknown session_id ${session_id}.` };
        }
        return {
          id: session.id,
          transport: session.transport,
          endpoints: session.endpoints,
          first_ts: session.first_ts,
          last_ts: session.last_ts,
          duration_seconds:
            typeof session.duration_seconds === 'number'
              ? session.duration_seconds
              : Math.max(0, session.last_ts - session.first_ts),
          packet_count: session.packet_count,
          byte_count: session.byte_count,
          evidence: session.evidence,
          rule_flags: session.rule_flags ?? [],
        };
      },
    }),
    get_timeline: tool({
      description: 'Fetch timeline events for a session.',
      inputSchema: z.object({
        session_id: z.string().describe('Session id to retrieve timeline events for.'),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ session_id, limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        const events = (artifact.timeline ?? []).filter((e) => e.session_id === session_id);
        const max = limit ?? 50;
        return {
          total: events.length,
          events: events.slice(0, max).map((event) => ({
            ts: event.ts,
            kind: event.kind,
            summary: event.summary,
            evidence_frame: event.evidence_frame,
          })),
        };
      },
    }),
    search_timeline: tool({
      description: 'Search timeline events by keyword for a session.',
      inputSchema: z.object({
        session_id: z.string().optional(),
        query: z.string().describe('Keyword to search in timeline summaries.'),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ session_id, query, limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        const events = artifact.timeline ?? [];
        const filtered = session_id ? events.filter((e) => e.session_id === session_id) : events;
        const needle = query.toLowerCase();
        const matches = filtered.filter((e) => timelineSearchText(e).includes(needle));
        const max = limit ?? 50;
        return {
          total: matches.length,
          events: matches.slice(0, max).map((event) => ({
            ts: event.ts,
            session_id: event.session_id,
            summary: event.summary,
            evidence_frame: event.evidence_frame,
          })),
        };
      },
    }),
    pcap_domains: tool({
      description:
        'Aggregate domains observed across DNS, TLS SNI, and HTTP host in the PCAP.',
      inputSchema: z.object({
        sources: z.array(z.enum(['dns', 'sni', 'http'])).optional(),
        contains: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ sources, contains, limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        ensureDomainIndex();
        if (!domainIndex) {
          return { error: 'Domain index unavailable.' };
        }

        const filter = contains?.toLowerCase().trim();
        const allowedSources = sources && sources.length ? new Set(sources) : null;

        const entries = Array.from(domainIndex.entries())
          .filter(([domain]) => (filter ? domain.includes(filter) : true))
          .map(([domain, counts]) => {
            const includeAll = !allowedSources;
            const total =
              (includeAll || allowedSources.has('dns') ? counts.dns : 0) +
              (includeAll || allowedSources.has('sni') ? counts.sni : 0) +
              (includeAll || allowedSources.has('http') ? counts.http : 0);
            return {
              domain,
              total,
              dns: counts.dns,
              sni: counts.sni,
              http: counts.http,
            };
          })
          .filter((entry) => entry.total > 0)
          .sort((a, b) => b.total - a.total);

        const max = limit ?? 50;
        return {
          total: entries.length,
          domains: entries.slice(0, max),
        };
      },
    }),
    pcap_top_talkers: tool({
      description: 'Return top IPs by bytes/packets across all sessions.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        ensureTalkerIndex();
        if (!talkerIndex) {
          return { error: 'Talker index unavailable.' };
        }
        const entries = Array.from(talkerIndex.entries())
          .map(([ip, stats]) => ({ ip, bytes: stats.bytes, packets: stats.packets }))
          .sort((a, b) => b.bytes - a.bytes);
        const max = limit ?? 20;
        return { total: entries.length, talkers: entries.slice(0, max) };
      },
    }),
    pcap_protocols: tool({
      description: 'Aggregate protocol stacks across the PCAP.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        ensureProtocolIndex();
        if (!protocolIndex) {
          return { error: 'Protocol index unavailable.' };
        }
        const entries = Array.from(protocolIndex.entries())
          .map(([protocol, count]) => ({ protocol, count }))
          .sort((a, b) => b.count - a.count);
        const max = limit ?? 30;
        return { total: entries.length, protocols: entries.slice(0, max) };
      },
    }),
    pcap_search: tool({
      description:
        'Search across all sessions in the PCAP timeline for one or more terms. Use for capture-wide questions.',
      inputSchema: z.object({
        terms: z.array(z.string().min(1)).min(1).describe('Search terms (e.g., ["youtube", "vtop"])'),
        mode: z.enum(['any', 'all']).optional().describe('Match any or all terms. Default: any.'),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ terms, mode, limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        const normalized = terms.map((term) => term.trim().toLowerCase()).filter(Boolean);
        if (normalized.length === 0) {
          return { error: 'No valid search terms provided.' };
        }
        const events = artifact.timeline ?? [];
        const matches = events.filter((event) => {
          const text = timelineSearchText(event);
          if (mode === 'all') {
            return normalized.every((term) => text.includes(term));
          }
          return normalized.some((term) => text.includes(term));
        });

        const sessionCounts = new Map<string, number>();
        for (const match of matches) {
          sessionCounts.set(match.session_id, (sessionCounts.get(match.session_id) ?? 0) + 1);
        }

        const max = limit ?? 50;
        return {
          total: matches.length,
          mode: mode ?? 'any',
          terms,
          session_hits: Array.from(sessionCounts.entries()).map(([session_id, count]) => ({
            session_id,
            count,
          })),
          events: matches.slice(0, max).map((event) => ({
            ts: event.ts,
            session_id: event.session_id,
            summary: event.summary,
            evidence_frame: event.evidence_frame,
          })),
        };
      },
    }),
    get_evidence_frames: tool({
      description: 'Get evidence frame numbers for a session.',
      inputSchema: z.object({
        session_id: z.string().describe('Session id to retrieve evidence frames for.'),
      }),
      execute: async ({ session_id }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        const session = artifact.sessions.find((s) => s.id === session_id);
        if (!session) {
          return { error: `Unknown session_id ${session_id}.` };
        }
        const frames = [
          session.evidence.first_frame,
          ...session.evidence.sample_frames,
          session.evidence.last_frame,
        ].filter((frame, index, arr) => arr.indexOf(frame) === index);
        return {
          first: session.evidence.first_frame,
          last: session.evidence.last_frame,
          samples: session.evidence.sample_frames,
          unique_count: frames.length,
        };
      },
    }),
    pcap_session_domains: tool({
      description: 'List domains observed in a specific session (DNS, TLS SNI, HTTP host).',
      inputSchema: z.object({
        session_id: z.string(),
        contains: z.string().optional(),
        sources: z.array(z.enum(['dns', 'sni', 'http'])).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ session_id, contains, sources, limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        ensureSessionDomainIndex();
        if (!sessionDomainIndex) {
          return { error: 'Session domain index unavailable.' };
        }

        const entry = sessionDomainIndex.get(session_id);
        if (!entry) {
          return { error: `No domains recorded for session ${session_id}.` };
        }

        const filter = contains?.toLowerCase().trim();
        const allowedSources = sources && sources.length ? new Set(sources) : null;
        const rows = Array.from(entry.entries())
          .filter(([domain]) => (filter ? domain.includes(filter) : true))
          .map(([domain, counts]) => {
            const includeAll = !allowedSources;
            const total =
              (includeAll || allowedSources.has('dns') ? counts.dns : 0) +
              (includeAll || allowedSources.has('sni') ? counts.sni : 0) +
              (includeAll || allowedSources.has('http') ? counts.http : 0);
            return { domain, total, dns: counts.dns, sni: counts.sni, http: counts.http };
          })
          .filter((row) => row.total > 0)
          .sort((a, b) => b.total - a.total);

        const max = limit ?? 50;
        return {
          session_id,
          total: rows.length,
          domains: rows.slice(0, max),
        };
      },
    }),
    pcap_domain_sessions: tool({
      description: 'Find sessions associated with a given domain (DNS, TLS SNI, HTTP host).',
      inputSchema: z.object({
        domain: z.string().min(1),
        match: z.enum(['contains', 'exact', 'suffix']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ domain, match, limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        ensureSessionDomainIndex();
        if (!domainSessionIndex) {
          return { error: 'Domain session index unavailable.' };
        }

        const query = normalizeDomain(domain);
        const mode = match ?? 'contains';
        const matches = Array.from(domainSessionIndex.entries()).filter(([key]) => {
          if (mode === 'exact') return key === query;
          if (mode === 'suffix') return key.endsWith(query);
          return key.includes(query);
        });

        const sessionAgg = new Map<string, DomainCounts>();
        const matchedDomains = matches.map(([key]) => key);
        for (const [, sessionMap] of matches) {
          for (const [sessionId, counts] of sessionMap.entries()) {
            const entry = sessionAgg.get(sessionId) ?? { dns: 0, sni: 0, http: 0 };
            entry.dns += counts.dns;
            entry.sni += counts.sni;
            entry.http += counts.http;
            sessionAgg.set(sessionId, entry);
          }
        }

        const rows = Array.from(sessionAgg.entries())
          .map(([session_id, counts]) => {
            const session = artifact.sessions.find((s) => s.id === session_id);
            return {
              session_id,
              transport: session?.transport,
              endpoints: session?.endpoints,
              packet_count: session?.packet_count,
              byte_count: session?.byte_count,
              first_ts: session?.first_ts,
              last_ts: session?.last_ts,
              total: counts.dns + counts.sni + counts.http,
              dns: counts.dns,
              sni: counts.sni,
              http: counts.http,
            };
          })
          .sort((a, b) => (b.total ?? 0) - (a.total ?? 0));

        const max = limit ?? 50;
        return {
          query: domain,
          match: mode,
          matched_domains: matchedDomains,
          total_sessions: rows.length,
          sessions: rows.slice(0, max),
        };
      },
    }),
    pcap_sessions_query: tool({
      description:
        'Filter and sort sessions by endpoints, ports, transport, domain, rule flags, or size. Use for targeted session discovery.',
      inputSchema: z.object({
        ip: z.string().optional(),
        port: z.number().int().optional(),
        transport: z.enum(['tcp', 'udp', 'other']).optional(),
        domain: z.string().optional(),
        rule_flags: z.array(z.string()).optional(),
        require_all_flags: z.boolean().optional(),
        min_packets: z.number().int().min(0).optional(),
        min_bytes: z.number().int().min(0).optional(),
        min_duration_seconds: z.number().min(0).optional(),
        sort_by: z.enum(['packets', 'bytes', 'duration', 'first_ts']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({
        ip,
        port,
        transport,
        domain,
        rule_flags,
        require_all_flags,
        min_packets,
        min_bytes,
        min_duration_seconds,
        sort_by,
        limit,
      }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }

        let sessions = artifact.sessions ?? [];

        if (ip) {
          sessions = sessions.filter(
            (s) => s.endpoints.a.ip === ip || s.endpoints.b.ip === ip
          );
        }

        if (port != null) {
          sessions = sessions.filter(
            (s) => s.endpoints.a.port === port || s.endpoints.b.port === port
          );
        }

        if (transport) {
          sessions = sessions.filter((s) => s.transport === transport);
        }

        if (domain) {
          ensureSessionDomainIndex();
          const needle = normalizeDomain(domain);
          sessions = sessions.filter((s) => {
            const domainMap = sessionDomainIndex?.get(s.id);
            if (!domainMap) return false;
            return Array.from(domainMap.keys()).some((key) => key.includes(needle));
          });
        }

        if (rule_flags && rule_flags.length) {
          const required = new Set(rule_flags);
          sessions = sessions.filter((s) => {
            const flags = new Set(s.rule_flags ?? []);
            if (require_all_flags) {
              for (const flag of required) {
                if (!flags.has(flag)) return false;
              }
              return true;
            }
            for (const flag of required) {
              if (flags.has(flag)) return true;
            }
            return false;
          });
        }

        if (min_packets != null) {
          sessions = sessions.filter((s) => s.packet_count >= min_packets);
        }

        if (min_bytes != null) {
          sessions = sessions.filter((s) => s.byte_count >= min_bytes);
        }

        if (min_duration_seconds != null) {
          sessions = sessions.filter((s) => s.duration_seconds >= min_duration_seconds);
        }

        const sortKey = sort_by ?? 'bytes';
        sessions = [...sessions].sort((a, b) => {
          if (sortKey === 'packets') return b.packet_count - a.packet_count;
          if (sortKey === 'duration') return (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0);
          if (sortKey === 'first_ts') return a.first_ts - b.first_ts;
          return b.byte_count - a.byte_count;
        });

        const max = limit ?? 50;
        return {
          total: sessions.length,
          sessions: sessions.slice(0, max).map((session) => ({
            id: session.id,
            transport: session.transport,
            endpoints: session.endpoints,
            packet_count: session.packet_count,
            byte_count: session.byte_count,
            duration_seconds: session.duration_seconds,
            first_ts: session.first_ts,
            last_ts: session.last_ts,
            rule_flags: session.rule_flags ?? [],
          })),
        };
      },
    }),
    pcap_timeline_range: tool({
      description: 'Fetch timeline events for a time range, optionally filtered by session and kind.',
      inputSchema: z.object({
        start_ts: z.number().optional(),
        end_ts: z.number().optional(),
        session_id: z.string().optional(),
        kinds: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ start_ts, end_ts, session_id, kinds, limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        const minTs = start_ts ?? Number.NEGATIVE_INFINITY;
        const maxTs = end_ts ?? Number.POSITIVE_INFINITY;
        const kindSet = kinds && kinds.length ? new Set(kinds) : null;
        const events = (artifact.timeline ?? []).filter((event) => {
          if (event.ts < minTs || event.ts > maxTs) return false;
          if (session_id && event.session_id !== session_id) return false;
          if (kindSet && !kindSet.has(event.kind)) return false;
          return true;
        });
        const max = limit ?? 50;
        return {
          total: events.length,
          events: events.slice(0, max).map((event) => ({
            ts: event.ts,
            session_id: event.session_id,
            kind: event.kind,
            summary: event.summary,
            evidence_frame: event.evidence_frame,
          })),
        };
      },
    }),
    pcap_event_kinds: tool({
      description: 'List timeline event kinds and counts, optionally for a single session.',
      inputSchema: z.object({
        session_id: z.string().optional(),
      }),
      execute: async ({ session_id }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        const events = session_id
          ? (artifact.timeline ?? []).filter((event) => event.session_id === session_id)
          : artifact.timeline ?? [];
        const counts = new Map<string, number>();
        for (const event of events) {
          counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
        }
        const entries = Array.from(counts.entries())
          .map(([kind, count]) => ({ kind, count }))
          .sort((a, b) => b.count - a.count);
        return { total: entries.length, kinds: entries };
      },
    }),
  };
}

function createAnalysisAgent(context?: ChatContext) {
  const modelName = process.env.OPENAI_MODEL ?? 'gpt-5.2';
  const tools = createTools(context);
  const allToolNames = Object.keys(tools) as Array<keyof typeof tools>;
  const globalToolNames = [
    'pcap_overview',
    'list_sessions',
    'search_timeline',
    'pcap_search',
    'pcap_domains',
    'pcap_domain_sessions',
    'pcap_session_domains',
    'pcap_sessions_query',
    'pcap_top_talkers',
    'pcap_protocols',
    'pcap_event_kinds',
  ] as Array<keyof typeof tools>;

  return new ToolLoopAgent({
    id: 'kisame-analysis-agent',
    model: openai(modelName),
    instructions: buildSystemPrompt(context),
    tools,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 1024,
    prepareStep: async ({ stepNumber, steps }) => {
      if (!context?.artifact) {
        return { activeTools: [] };
      }
      if (!context.session_id) {
        return {
          activeTools: globalToolNames,
          toolChoice: stepNumber === 0 && steps.length === 0 ? 'required' : 'auto',
        };
      }
      return {
        activeTools: allToolNames,
        toolChoice: stepNumber === 0 && steps.length === 0 ? 'required' : 'auto',
      };
    },
  });
}

function summarizeToolResults(results: Array<{ toolCallId: string; toolName: string; output: any }>): ToolResultSummary[] {
  return results.map((result) => {
    const { toolCallId, toolName, output } = result;
    if (output?.error) {
      return { toolCallId, toolName, summary: `${toolName}: ${output.error}` };
    }

    switch (toolName) {
      case 'pcap_overview':
        return {
          toolCallId,
          toolName,
          summary: `pcap_overview: ${output.file_name ?? 'unknown'} • ${output.packets_analyzed ?? 0} packets • ${output.session_count ?? 0} sessions`,
        };
      case 'list_sessions':
        return {
          toolCallId,
          toolName,
          summary: `list_sessions: ${output.total ?? 0} sessions (showing ${output.sessions?.length ?? 0})`,
        };
      case 'get_session':
        return {
          toolCallId,
          toolName,
          summary: output?.id
            ? `get_session: ${output.id} • ${output.packet_count ?? 0} packets • ${output.byte_count ?? 0} bytes`
            : `get_session: no session found`,
        };
      case 'get_timeline':
        return {
          toolCallId,
          toolName,
          summary: `get_timeline: ${output.total ?? 0} events (showing ${output.events?.length ?? 0})`,
        };
      case 'search_timeline':
        return {
          toolCallId,
          toolName,
          summary: `search_timeline: ${output.total ?? 0} matches (showing ${output.events?.length ?? 0})`,
        };
      case 'pcap_search':
        return {
          toolCallId,
          toolName,
          summary: `pcap_search: ${output.total ?? 0} matches for ${Array.isArray(output.terms) ? output.terms.join(', ') : 'terms'}`,
        };
      case 'pcap_domains':
        return {
          toolCallId,
          toolName,
          summary: `pcap_domains: ${output.total ?? 0} domains`,
        };
      case 'pcap_session_domains':
        return {
          toolCallId,
          toolName,
          summary: `pcap_session_domains: ${output.total ?? 0} domains`,
        };
      case 'pcap_domain_sessions':
        return {
          toolCallId,
          toolName,
          summary: `pcap_domain_sessions: ${output.total_sessions ?? 0} sessions`,
        };
      case 'pcap_sessions_query':
        return {
          toolCallId,
          toolName,
          summary: `pcap_sessions_query: ${output.total ?? 0} sessions`,
        };
      case 'pcap_top_talkers':
        return {
          toolCallId,
          toolName,
          summary: `pcap_top_talkers: ${output.total ?? 0} IPs`,
        };
      case 'pcap_protocols':
        return {
          toolCallId,
          toolName,
          summary: `pcap_protocols: ${output.total ?? 0} protocols`,
        };
      case 'pcap_timeline_range':
        return {
          toolCallId,
          toolName,
          summary: `pcap_timeline_range: ${output.total ?? 0} events`,
        };
      case 'pcap_event_kinds':
        return {
          toolCallId,
          toolName,
          summary: `pcap_event_kinds: ${output.total ?? 0} kinds`,
        };
      case 'get_evidence_frames':
        return {
          toolCallId,
          toolName,
          summary: `get_evidence_frames: first #${output.first ?? '?'} • last #${output.last ?? '?'}`,
        };
      default:
        return { toolCallId, toolName, summary: `${toolName}: completed` };
    }
  });
}

export async function processChat(
  query: string,
  context?: ChatContext
): Promise<ChatQueryResponse> {
  const timestamp = utcNowIso();
  const contextAvailable = !!(context?.session_id && context?.artifact);
  const logQuery = process.env.LOG_QUERIES === '1' || process.env.LOG_QUERIES === 'true';
  logInfo('ai.chat.start', {
    session_id: context?.session_id ?? null,
    context_available: contextAvailable,
    query_length: query.length,
    query: logQuery ? query : undefined,
  });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logWarn('ai.chat.missing_api_key');
    return {
      query,
      response: `I received your query: "${query}". ${
        contextAvailable
          ? `Context is available for session ${context?.session_id}.`
          : 'No session context available.'
      } To enable AI responses, please set the OPENAI_API_KEY environment variable.`,
      timestamp,
      context_available: contextAvailable,
    };
  }

  try {
    const agent = createAnalysisAgent(context);
    const result = await agent.generate({
      prompt: query,
    });

    const responseText = result.text;
    const toolCalls = result.steps.reduce((sum, step) => sum + (step.toolCalls?.length ?? 0), 0);
    logInfo('ai.chat.complete', {
      session_id: context?.session_id ?? null,
      finish_reason: result.finishReason,
      steps: result.steps.length,
      tool_calls: toolCalls,
      total_tokens: result.totalUsage?.totalTokens,
    });

    return {
      query,
      response: responseText,
      timestamp,
      context_available: contextAvailable,
    };
  } catch (error) {
    logError('ai.chat.error', { error: toErrorMeta(error) });
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      query,
      response: `Error processing your query: ${errorMessage}`,
      timestamp,
      context_available: contextAvailable,
    };
  }
}

export function streamChat(query: string, context?: ChatContext): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const sendEvent = (controller: ReadableStreamDefaultController, event: ChatStreamEvent) => {
    controller.enqueue(encoder.encode(`event: ${event.type}\n`));
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  };

  const emitToolSummary = (
    controller: ReadableStreamDefaultController,
    toolResults: Array<{ toolCallId: string; toolName: string; output: any }>
  ) => {
    if (!toolResults.length) return;
    const summaries = summarizeToolResults(toolResults as any);
    if (!summaries.length) return;
    const summaryText = summaries.map((s) => `- ${s.summary}`).join('\n');
    sendEvent(controller, { type: 'tool_summary', summary: summaryText });
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const contextAvailable = !!(context?.session_id && context?.artifact);
      logInfo('ai.stream.start', {
        session_id: context?.session_id ?? null,
        context_available: contextAvailable,
        query_length: query.length,
      });
      sendEvent(controller, {
        type: 'status',
        stage: 'start',
        message: contextAvailable ? `Context ready for ${context?.session_id}` : 'No session context',
      });

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        logWarn('ai.stream.missing_api_key');
        sendEvent(controller, {
          type: 'text',
          delta:
            `I received your query: "${query}". ` +
            (contextAvailable
              ? `Context is available for session ${context?.session_id}. `
              : 'No session context available. ') +
            'To enable AI responses, please set the OPENAI_API_KEY environment variable.',
        });
        sendEvent(controller, { type: 'done', finish_reason: 'missing_api_key' });
        controller.close();
        return;
      }

      try {
        const agent = createAnalysisAgent(context);
        let stepCount = 0;
        let promptToSend = query;

        if (context?.artifact) {
          const global = !context.session_id && isGlobalQuestion(query);
          const tokens = normalizeSearchTerms([query]);
          const domainToken = tokens.find(isDomainLike);

          if (domainToken) {
            const preface = global
              ? `Before answering, use pcap_domain_sessions for domain "${domainToken}" to locate sessions across the capture.`
              : `Before answering, use pcap_session_domains or pcap_domain_sessions to ground domain "${domainToken}".`;
            promptToSend = `${preface}\n\nUser question: ${query}`;
          } else if (global) {
            const preface =
              'Before answering, use pcap_search or pcap_domains to check the entire capture (not just one session).';
            promptToSend = `${preface}\n\nUser question: ${query}`;
          }
        }

        const result = await agent.stream({
          prompt: promptToSend,
          onStepFinish: (step) => {
            stepCount += 1;
            const toolCalls = step.toolCalls?.length ?? 0;
            const totalTokens = step.usage?.totalTokens;
            const tokenLabel = totalTokens ? ` • ${totalTokens} tokens` : '';
            const toolLabel = toolCalls ? ` • ${toolCalls} tool call${toolCalls === 1 ? '' : 's'}` : '';
            sendEvent(controller, {
              type: 'status',
              stage: 'step',
              message: `Step ${stepCount}${toolLabel}${tokenLabel}`,
            });

            if (step.warnings && step.warnings.length) {
              for (const warning of step.warnings) {
                const msg = warning.type === 'other' 
                  ? (warning as any).message 
                  : `${warning.type}: ${(warning as any).feature || (warning as any).details || 'unknown'}`;
                sendEvent(controller, {
                  type: 'status',
                  stage: 'warning',
                  message: msg,
                });
              }
            }

            if (step.toolResults && step.toolResults.length) {
              emitToolSummary(controller, step.toolResults as any);
            }
          },
        });

        let receivedText = false;

        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            const delta = (part as { textDelta?: string }).textDelta ?? '';
            if (delta) {
              sendEvent(controller, { type: 'text', delta });
              receivedText = true;
            }
          } else if (part.type === 'tool-call') {
            sendEvent(controller, {
              type: 'tool_call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            });
            sendEvent(controller, {
              type: 'status',
              stage: 'tool_call',
              message: `Calling tool: ${part.toolName}`,
            });
          } else if (part.type === 'tool-result') {
            sendEvent(controller, {
              type: 'tool_result',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: part.output,
            });
            sendEvent(controller, {
              type: 'status',
              stage: 'tool_result',
              message: `Tool completed: ${part.toolName}`,
            });
          } else if (part.type === 'reasoning-start' || part.type === 'reasoning-end') {
            sendEvent(controller, {
              type: 'status',
              stage: 'reasoning',
              message: 'Reasoning…',
            });
          }
        }

        if (!receivedText) {
          const fallbackText = (await result.text).trim();
          if (fallbackText) {
            sendEvent(controller, { type: 'text', delta: fallbackText });
          }
        }

        const toolResults = await result.toolResults;
        emitToolSummary(controller, toolResults as any);

        const finishReason = await result.finishReason;
        logInfo('ai.stream.complete', {
          session_id: context?.session_id ?? null,
          finish_reason: finishReason,
        });
        sendEvent(controller, { type: 'done', finish_reason: finishReason });
      } catch (error) {
        logError('ai.stream.error', { error: toErrorMeta(error) });
        const errorMessage = error instanceof Error ? error.message : String(error);
        sendEvent(controller, { type: 'error', message: errorMessage });
      } finally {
        controller.close();
      }
    },
  });
}
