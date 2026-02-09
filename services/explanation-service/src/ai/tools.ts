import { tool } from 'ai';
import { z } from 'zod';
import type { ChatContext, AnalysisArtifact } from '../types';
import { getSession, listTcpStreams, followTcpStream } from '../pcap';
import { isDomainLike } from './query-utils';

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
const COMMON_TLDS = new Set([
  'com',
  'net',
  'org',
  'edu',
  'gov',
  'mil',
  'int',
  'io',
  'co',
  'ai',
  'app',
  'dev',
  'cloud',
  'xyz',
  'info',
  'biz',
  'me',
  'us',
  'uk',
  'ca',
  'au',
  'de',
  'fr',
  'jp',
  'nl',
  'se',
  'no',
  'fi',
  'it',
  'es',
  'in',
  'br',
  'ru',
  'cn',
  'kr',
  'sg',
  'hk',
  'ch',
  'pl',
  'tv',
  'gg',
  'name',
  'site',
  'online',
  'store',
  'tech',
  'systems',
  'security',
]);
function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  const len = value.length;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
function domainLabels(domain: string): { labels: string[]; tld: string; sld: string } {
  const labels = domain.split('.').filter(Boolean);
  const tld = labels.length ? (labels[labels.length - 1] ?? '') : '';
  const sld = labels.length >= 2 ? (labels[labels.length - 2] ?? '') : '';
  return { labels, tld, sld };
}
function matchDomainValue(value: string | undefined, domain: string): boolean {
  if (!value) return false;
  const normalized = normalizeDomain(value);
  if (!normalized) return false;
  if (normalized === domain) return true;
  return normalized.endsWith(`.${domain}`) || domain.endsWith(`.${normalized}`);
}
function resolvePcapSession(context?: ChatContext, overrideId?: string) {
  const contextId = (context?.artifact as { pcap?: { session_id?: string } } | undefined)?.pcap?.session_id;
  const resolve = (id?: string) => (id ? getSession(id) : undefined);

  if (overrideId) {
    const session = resolve(overrideId);
    if (session) return { session };
    if (contextId) {
      const fallback = resolve(contextId);
      if (fallback) return { session: fallback };
    }
    return { error: `Unknown pcap_session_id ${overrideId}.` };
  }

  if (!contextId) {
    return { error: 'No PCAP session id available. Re-open the capture or re-run analysis.' };
  }
  const session = resolve(contextId);
  if (!session) {
    return { error: `Unknown pcap session_id ${contextId}.` };
  }
  return { session };
}

export function createTools(context?: ChatContext) {
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
    pcap_tcp_streams: tool({
      description: 'List TCP streams (tcp.stream) observed in the capture, with endpoints and counts.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional(),
        max_packets: z.number().int().min(1).max(500000).optional(),
        pcap_session_id: z.string().optional(),
      }),
      execute: async ({ limit, max_packets, pcap_session_id }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        const resolved = resolvePcapSession(context, pcap_session_id);
        if ('error' in resolved) {
          return { error: resolved.error };
        }
        return listTcpStreams(resolved.session, { limit, maxPackets: max_packets });
      },
    }),
    pcap_follow_tcp_stream: tool({
      description: 'Reconstruct raw TCP payload for a tcp.stream id (Follow TCP Stream).',
      inputSchema: z.object({
        stream_id: z.number().int().min(0),
        max_bytes_per_direction: z.number().int().min(200).max(50000).optional(),
        max_combined_bytes: z.number().int().min(200).max(80000).optional(),
        max_segments: z.number().int().min(1).max(200).optional(),
        max_bytes_per_segment: z.number().int().min(100).max(20000).optional(),
        max_output_segments: z.number().int().min(1).max(200).optional(),
        direction: z.enum(['a_to_b', 'b_to_a', 'both']).optional(),
        contains: z.string().min(1).optional(),
        match_mode: z.enum(['substring', 'regex']).optional(),
        case_sensitive: z.boolean().optional(),
        context_packets: z.number().int().min(0).max(20).optional(),
        start_frame: z.number().int().min(0).optional(),
        end_frame: z.number().int().min(0).optional(),
        start_ts: z.number().min(0).optional(),
        end_ts: z.number().min(0).optional(),
        pcap_session_id: z.string().optional(),
      }),
      execute: async ({
        stream_id,
        max_bytes_per_direction,
        max_combined_bytes,
        max_segments,
        max_bytes_per_segment,
        max_output_segments,
        direction,
        contains,
        match_mode,
        case_sensitive,
        context_packets,
        start_frame,
        end_frame,
        start_ts,
        end_ts,
        pcap_session_id,
      }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }
        const resolved = resolvePcapSession(context, pcap_session_id);
        if ('error' in resolved) {
          return { error: resolved.error };
        }
        return followTcpStream(resolved.session, stream_id, {
          maxBytesPerDirection: max_bytes_per_direction,
          maxCombinedBytes: max_combined_bytes,
          maxSegments: max_segments,
          maxBytesPerSegment: max_bytes_per_segment,
          maxOutputSegments: max_output_segments,
          direction,
          contains,
          matchMode: match_mode,
          caseSensitive: case_sensitive,
          contextPackets: context_packets,
          startFrame: start_frame,
          endFrame: end_frame,
          startTs: start_ts,
          endTs: end_ts,
        });
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
    domain_risk_assess: tool({
      description:
        'Heuristic domain risk assessment using only local PCAP evidence (no external reputation sources).',
      inputSchema: z.object({
        domain: z.string().min(1).describe('Domain name to assess.'),
        include_sessions: z.boolean().optional(),
      }),
      execute: async ({ domain, include_sessions }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }

        const normalized = normalizeDomain(domain);
        if (!normalized || !isDomainLike(normalized)) {
          return { error: `Invalid domain "${domain}".` };
        }

        ensureDomainIndex();
        ensureSessionDomainIndex();
        if (!domainIndex || !domainSessionIndex) {
          return { error: 'Domain indices unavailable.' };
        }

        const counts = domainIndex.get(normalized) ?? { dns: 0, sni: 0, http: 0 };
        const totalObservations = counts.dns + counts.sni + counts.http;
        const sessionMap = domainSessionIndex.get(normalized) ?? new Map<string, DomainCounts>();

        const sessionRows = Array.from(sessionMap.entries())
          .map(([session_id, sessionCounts]) => {
            const session = artifact.sessions.find((s) => s.id === session_id);
            return {
              session_id,
              transport: session?.transport,
              endpoints: session?.endpoints,
              packet_count: session?.packet_count,
              byte_count: session?.byte_count,
              first_ts: session?.first_ts,
              last_ts: session?.last_ts,
              rule_flags: session?.rule_flags ?? [],
              total: sessionCounts.dns + sessionCounts.sni + sessionCounts.http,
              dns: sessionCounts.dns,
              sni: sessionCounts.sni,
              http: sessionCounts.http,
            };
          })
          .filter((row) => row.session_id);

        const uniqueIps = new Set<string>();
        const uniquePorts = new Set<number>();
        const ruleFlags = new Set<string>();
        let firstSeen: number | null = null;
        let lastSeen: number | null = null;
        let totalBytes = 0;
        let totalPackets = 0;

        for (const row of sessionRows) {
          if (row.endpoints?.a?.ip) uniqueIps.add(row.endpoints.a.ip);
          if (row.endpoints?.b?.ip) uniqueIps.add(row.endpoints.b.ip);
          if (row.endpoints?.a?.port != null) uniquePorts.add(row.endpoints.a.port);
          if (row.endpoints?.b?.port != null) uniquePorts.add(row.endpoints.b.port);
          for (const flag of row.rule_flags ?? []) ruleFlags.add(flag);
          if (typeof row.first_ts === 'number') {
            firstSeen = firstSeen == null ? row.first_ts : Math.min(firstSeen, row.first_ts);
          }
          if (typeof row.last_ts === 'number') {
            lastSeen = lastSeen == null ? row.last_ts : Math.max(lastSeen, row.last_ts);
          }
          totalBytes += row.byte_count ?? 0;
          totalPackets += row.packet_count ?? 0;
        }

        const timelineEvents = artifact.timeline ?? [];
        for (const event of timelineEvents) {
          if (
            matchDomainValue(event.meta?.dns_name, normalized) ||
            matchDomainValue(event.meta?.sni, normalized) ||
            matchDomainValue(event.meta?.http?.host ?? undefined, normalized) ||
            event.summary.toLowerCase().includes(normalized)
          ) {
            firstSeen = firstSeen == null ? event.ts : Math.min(firstSeen, event.ts);
            lastSeen = lastSeen == null ? event.ts : Math.max(lastSeen, event.ts);
          }
        }

        const { labels, tld, sld } = domainLabels(normalized);
        const domainCore = sld || labels[0] || normalized;
        const digits = domainCore.replace(/\D/g, '').length;
        const letters = domainCore.replace(/[^a-z]/gi, '').length;
        const digitRatio = domainCore.length > 0 ? digits / domainCore.length : 0;
        const hyphenCount = (domainCore.match(/-/g) ?? []).length;
        const entropy = shannonEntropy(domainCore);
        const punycode = normalized.includes('xn--');
        const subdomainCount = Math.max(0, labels.length - 2);

        const signals: Array<{ signal: string; weight: number; detail: string }> = [];
        let score = 5;

        if (punycode) {
          score += 12;
          signals.push({ signal: 'punycode', weight: 12, detail: 'IDN/punycode label detected.' });
        }

        if (normalized.length > 30) {
          score += 5;
          signals.push({ signal: 'length', weight: 5, detail: 'Unusually long domain.' });
        }

        if (subdomainCount >= 4) {
          score += 3;
          signals.push({ signal: 'subdomains', weight: 3, detail: 'Many subdomain levels.' });
        }

        if (digitRatio > 0.4) {
          score += 6;
          signals.push({
            signal: 'digit_ratio',
            weight: 6,
            detail: `High digit ratio in label (${(digitRatio * 100).toFixed(0)}%).`,
          });
        }

        if (hyphenCount >= 3) {
          score += 3;
          signals.push({ signal: 'hyphens', weight: 3, detail: 'Multiple hyphens in label.' });
        }

        if (entropy >= 4.2) {
          score += 14;
          signals.push({ signal: 'entropy', weight: 14, detail: 'Very high label entropy.' });
        } else if (entropy >= 3.7) {
          score += 8;
          signals.push({ signal: 'entropy', weight: 8, detail: 'High label entropy.' });
        }

        if (tld && !COMMON_TLDS.has(tld)) {
          score += 6;
          signals.push({ signal: 'tld', weight: 6, detail: `Uncommon TLD .${tld}.` });
        }

        if (totalObservations <= 1) {
          score += 3;
          signals.push({ signal: 'rare_observation', weight: 3, detail: 'Observed only once.' });
        } else if (totalObservations >= 20) {
          score -= 6;
          signals.push({
            signal: 'common_observation',
            weight: -6,
            detail: 'Seen frequently in capture.',
          });
        } else if (totalObservations >= 10) {
          score -= 3;
          signals.push({
            signal: 'common_observation',
            weight: -3,
            detail: 'Seen repeatedly in capture.',
          });
        }

        if (counts.dns === 0 && counts.sni > 0) {
          score += 5;
          signals.push({
            signal: 'no_dns',
            weight: 5,
            detail: 'Seen via TLS SNI but no matching DNS query in capture.',
          });
        }

        if (ruleFlags.size > 0) {
          score += 10;
          signals.push({
            signal: 'rule_flags',
            weight: 10,
            detail: `Associated sessions flagged: ${Array.from(ruleFlags).join(', ')}.`,
          });
        }

        score = Math.max(0, Math.min(100, Math.round(score)));
        const verdict = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';
        const confidence =
          totalObservations >= 15 || sessionRows.length >= 4
            ? 'high'
            : totalObservations >= 5 || sessionRows.length >= 2
              ? 'medium'
              : 'low';

        return {
          domain: normalized,
          verdict,
          score,
          confidence,
          method: 'heuristic-local',
          signals,
          observed: {
            total: totalObservations,
            dns: counts.dns,
            sni: counts.sni,
            http: counts.http,
            sessions: sessionRows.length,
            ips: Array.from(uniqueIps),
            ports: Array.from(uniquePorts).sort((a, b) => a - b),
            total_packets: totalPackets,
            total_bytes: totalBytes,
            first_seen: firstSeen,
            last_seen: lastSeen,
          },
          sessions: include_sessions ? sessionRows.slice(0, 25) : undefined,
          limitations: [
            'Heuristic assessment only.',
            'No external reputation or threat-intel sources used.',
          ],
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
