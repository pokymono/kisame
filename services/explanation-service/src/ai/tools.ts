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

type SuspiciousFeatureMatch = {
  id: string;
  title: string;
  severity: 'low' | 'medium' | 'high';
  confidence: 'low' | 'medium' | 'high';
  scope: 'session' | 'capture';
  session_id?: string;
  evidence_frames: number[];
  indicators: string[];
  rationale: string;
};

type CommandSignature = {
  id: string;
  label: string;
  category: 'user_creation' | 'privilege_change' | 'credential_access' | 'recon' | 'shell';
  severity: 'low' | 'medium' | 'high';
  confidence: 'low' | 'medium' | 'high';
  regex: RegExp;
  extract?: (match: RegExpMatchArray) => { username?: string; group?: string } | null;
};

type DomainStat = {
  domain: string;
  counts: DomainCounts;
  frames: number[];
  first_ts: number | null;
  last_ts: number | null;
};

function uniqueNumbers(values: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sessionEvidenceFrames(session: AnalysisArtifact['sessions'][number]): number[] {
  return uniqueNumbers([
    session.evidence.first_frame,
    ...session.evidence.sample_frames,
    session.evidence.last_frame,
  ]);
}

function sessionPorts(session: AnalysisArtifact['sessions'][number]): number[] {
  return [session.endpoints.a.port, session.endpoints.b.port].filter(
    (p): p is number => typeof p === 'number' && Number.isFinite(p)
  );
}

function protocolTokensForSession(session: AnalysisArtifact['sessions'][number]): Set<string> {
  const tokens = new Set<string>();
  for (const entry of session.protocols ?? []) {
    for (const token of entry.chain.split(':')) {
      const normalized = token.trim().toLowerCase();
      if (normalized) tokens.add(normalized);
    }
  }
  return tokens;
}

function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  if (ip.includes(':')) {
    const normalized = ip.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80');
  }
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const a = parts[0];
  const b = parts[1];
  if (a == null || b == null) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function timelineBySession(artifact: AnalysisArtifact): Map<string, AnalysisArtifact['timeline']> {
  const map = new Map<string, AnalysisArtifact['timeline']>();
  for (const event of artifact.timeline ?? []) {
    const entry = map.get(event.session_id);
    if (entry) {
      entry.push(event);
    } else {
      map.set(event.session_id, [event]);
    }
  }
  return map;
}

function extractDomainFromEvent(event: AnalysisArtifact['timeline'][number]): { domain: string; type: 'dns' | 'sni' | 'http' } | null {
  if (event.kind === 'dns_query') {
    const name = event.meta?.dns_name ?? event.summary.replace(/^DNS query:\s*/i, '').trim();
    const domain = normalizeDomain(name);
    return domain ? { domain, type: 'dns' } : null;
  }
  if (event.kind === 'tls_sni') {
    const sni = event.meta?.sni ?? event.summary.replace(/^TLS SNI:\s*/i, '').trim();
    const domain = normalizeDomain(sni);
    return domain ? { domain, type: 'sni' } : null;
  }
  if (event.kind === 'http_request') {
    const host =
      event.meta?.http?.host ??
      (() => {
        const cleaned = event.summary.replace(/^HTTP request:\s*/i, '').trim();
        const parts = cleaned.split(' ');
        if (parts.length < 2) return '';
        const hostAndPath = parts.slice(1).join(' ');
        return hostAndPath.split('/')[0] ?? '';
      })();
    const domain = normalizeDomain(host || '');
    return domain ? { domain, type: 'http' } : null;
  }
  return null;
}

function buildDomainStats(artifact: AnalysisArtifact): Map<string, DomainStat> {
  const stats = new Map<string, DomainStat>();
  for (const event of artifact.timeline ?? []) {
    const extracted = extractDomainFromEvent(event);
    if (!extracted) continue;
    const { domain, type } = extracted;
    const entry = stats.get(domain) ?? {
      domain,
      counts: { dns: 0, sni: 0, http: 0 },
      frames: [],
      first_ts: null,
      last_ts: null,
    };
    entry.counts[type] += 1;
    entry.frames.push(event.evidence_frame);
    entry.first_ts = entry.first_ts == null ? event.ts : Math.min(entry.first_ts, event.ts);
    entry.last_ts = entry.last_ts == null ? event.ts : Math.max(entry.last_ts, event.ts);
    stats.set(domain, entry);
  }
  return stats;
}

function domainSuspicionScore(domain: string, counts: DomainCounts): { score: number; reasons: string[] } {
  const normalized = normalizeDomain(domain);
  const { labels, tld, sld } = domainLabels(normalized);
  const domainCore = sld || labels[0] || normalized;
  const digits = domainCore.replace(/\D/g, '').length;
  const digitRatio = domainCore.length > 0 ? digits / domainCore.length : 0;
  const hyphenCount = (domainCore.match(/-/g) ?? []).length;
  const entropy = shannonEntropy(domainCore);
  const punycode = normalized.includes('xn--');
  const subdomainCount = Math.max(0, labels.length - 2);

  let score = 0;
  const reasons: string[] = [];

  if (punycode) {
    score += 2;
    reasons.push('punycode label');
  }
  if (normalized.length > 30) {
    score += 2;
    reasons.push('long domain');
  }
  if (subdomainCount >= 4) {
    score += 1;
    reasons.push('many subdomains');
  }
  if (digitRatio > 0.4) {
    score += 2;
    reasons.push(`high digit ratio (${(digitRatio * 100).toFixed(0)}%)`);
  } else if (digitRatio > 0.3) {
    score += 1;
    reasons.push(`elevated digit ratio (${(digitRatio * 100).toFixed(0)}%)`);
  }
  if (hyphenCount >= 3) {
    score += 1;
    reasons.push('multiple hyphens');
  }
  if (entropy >= 4.1) {
    score += 2;
    reasons.push('very high label entropy');
  } else if (entropy >= 3.7) {
    score += 1;
    reasons.push('high label entropy');
  }
  if (tld && !COMMON_TLDS.has(tld)) {
    score += 1;
    reasons.push(`uncommon TLD .${tld}`);
  }
  if (counts.dns === 0 && counts.sni > 0) {
    score += 1;
    reasons.push('SNI without DNS');
  }

  return { score, reasons };
}

const COMMAND_SIGNATURES: CommandSignature[] = [
  {
    id: 'linux_adduser',
    label: 'Linux adduser/useradd',
    category: 'user_creation',
    severity: 'high',
    confidence: 'medium',
    regex: /\b(adduser|useradd)\s+([^\s;]+)/i,
    extract: (match) => ({ username: match[2] }),
  },
  {
    id: 'windows_net_user_add',
    label: 'Windows net user /add',
    category: 'user_creation',
    severity: 'high',
    confidence: 'medium',
    regex: /\bnet\s+user\s+([^\s]+)\s+\/add\b/i,
    extract: (match) => ({ username: match[1] }),
  },
  {
    id: 'powershell_new_localuser',
    label: 'PowerShell New-LocalUser',
    category: 'user_creation',
    severity: 'high',
    confidence: 'medium',
    regex: /\bNew-LocalUser\b[^;\n\r]*?\s-Name\s+([^\s]+)/i,
    extract: (match) => ({ username: match[1] }),
  },
  {
    id: 'powershell_new_aduser',
    label: 'PowerShell New-ADUser',
    category: 'user_creation',
    severity: 'high',
    confidence: 'medium',
    regex: /\bNew-ADUser\b[^;\n\r]*?\s-Name\s+([^\s]+)/i,
    extract: (match) => ({ username: match[1] }),
  },
  {
    id: 'net_localgroup_admin',
    label: 'Add to local administrators group',
    category: 'privilege_change',
    severity: 'high',
    confidence: 'medium',
    regex: /\bnet\s+localgroup\s+administrators\s+([^\s]+)\s+\/add\b/i,
    extract: (match) => ({ username: match[1], group: 'administrators' }),
  },
  {
    id: 'etc_shadow_access',
    label: 'Access /etc/shadow',
    category: 'credential_access',
    severity: 'high',
    confidence: 'medium',
    regex: /\/etc\/shadow/i,
  },
  {
    id: 'etc_passwd_access',
    label: 'Access /etc/passwd',
    category: 'credential_access',
    severity: 'medium',
    confidence: 'medium',
    regex: /\/etc\/passwd/i,
  },
  {
    id: 'whoami',
    label: 'whoami',
    category: 'recon',
    severity: 'low',
    confidence: 'low',
    regex: /\bwhoami\b/i,
  },
  {
    id: 'finger',
    label: 'finger',
    category: 'recon',
    severity: 'low',
    confidence: 'low',
    regex: /\bfinger\b/i,
  },
  {
    id: 'shell_spawn',
    label: 'Shell spawn',
    category: 'shell',
    severity: 'medium',
    confidence: 'low',
    regex: /\b(bash|sh|cmd|powershell)\b/i,
  },
  {
    id: 'netcat',
    label: 'Netcat usage',
    category: 'shell',
    severity: 'medium',
    confidence: 'low',
    regex: /\b(nc|netcat)\b/i,
  },
];

const COMMAND_PREFILTER_REGEX = COMMAND_SIGNATURES.map((sig) => `(?:${sig.regex.source})`).join('|');
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
        const normalizeRange = (value?: number) => (typeof value === 'number' && value > 0 ? value : undefined);
        const normalizedContains = typeof contains === 'string' ? contains.trim() : undefined;
        return followTcpStream(resolved.session, stream_id, {
          maxBytesPerDirection: max_bytes_per_direction,
          maxCombinedBytes: max_combined_bytes,
          maxSegments: max_segments,
          maxBytesPerSegment: max_bytes_per_segment,
          maxOutputSegments: max_output_segments,
          direction,
          contains: normalizedContains || undefined,
          matchMode: match_mode,
          caseSensitive: case_sensitive,
          contextPackets: context_packets,
          startFrame: normalizeRange(start_frame),
          endFrame: normalizeRange(end_frame),
          startTs: normalizeRange(start_ts),
          endTs: normalizeRange(end_ts),
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
    suspicious_feature_check: tool({
      description:
        'Check the capture or a single session against a library of suspicious indicators (no external intel).',
      inputSchema: z.object({
        scope: z.enum(['capture', 'session']).optional(),
        session_id: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ scope, session_id, limit }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }

        const resolvedSessionId = session_id ?? context?.session_id ?? null;
        const targetScope = scope ?? (resolvedSessionId ? 'session' : 'capture');
        const sessionIndex = new Map(artifact.sessions.map((s) => [s.id, s] as const));
        const sessionTimeline = timelineBySession(artifact);
        const domainStats = buildDomainStats(artifact);

        const matches: SuspiciousFeatureMatch[] = [];
        const addMatch = (match: SuspiciousFeatureMatch) => {
          matches.push(match);
        };

        const evidenceFromSessions = (sessionIds: string[], maxFrames = 12) => {
          const frames: number[] = [];
          const seen = new Set<number>();
          for (const id of sessionIds) {
            const session = sessionIndex.get(id);
            if (!session) continue;
            for (const frame of sessionEvidenceFrames(session)) {
              if (seen.has(frame)) continue;
              seen.add(frame);
              frames.push(frame);
              if (frames.length >= maxFrames) return frames;
            }
          }
          return frames;
        };

        const evidenceFromDomains = (domains: DomainStat[], maxFrames = 12) => {
          const frames: number[] = [];
          const seen = new Set<number>();
          for (const stat of domains) {
            for (const frame of stat.frames) {
              if (seen.has(frame)) continue;
              seen.add(frame);
              frames.push(frame);
              if (frames.length >= maxFrames) return frames;
            }
          }
          return frames;
        };

        const evaluateSession = (session: AnalysisArtifact['sessions'][number]) => {
          const tokens = protocolTokensForSession(session);
          const flags = new Set(session.rule_flags ?? []);
          const ports = sessionPorts(session);
          const portSet = new Set(ports);
          const hasPort = (port: number) => portSet.has(port);
          const hasAnyPort = (list: number[]) => list.some((port) => portSet.has(port));
          const hasToken = (token: string) => tokens.has(token) || flags.has(token);
          const hasSmb = hasToken('smb') || hasToken('smb2');
          const hasNtlm = tokens.has('ntlmssp') || flags.has('ntlm');
          const hasDcerpc = hasToken('dcerpc');
          const hasSamr = hasToken('samr');
          const hasLsarpc = hasToken('lsarpc');
          const hasSrvsvc = hasToken('srvsvc');
          const hasKerberos = hasToken('kerberos') || hasAnyPort([88, 464]);
          const hasLdap = hasToken('ldap') || hasAnyPort([389, 636, 3268, 3269]);
          const hasRdp = hasToken('rdp') || hasPort(3389);
          const hasWinrm = hasToken('winrm') || hasAnyPort([5985, 5986]);
          const hasVnc = hasToken('vnc') || hasAnyPort([5900, 5901, 5902, 5903]);
          const hasTelnet = hasToken('telnet') || hasPort(23);
          const hasFtp = hasToken('ftp') || hasPort(21);
          const hasTftp = hasToken('tftp') || hasPort(69);
          const hasSsh = hasToken('ssh') || hasPort(22);
          const hasSnmp = hasToken('snmp') || hasPort(161);
          const hasTls = hasToken('tls') || hasToken('ssl') || hasPort(443);
          const hasIcmp = hasToken('icmp');

          const evidenceFrames = sessionEvidenceFrames(session);
          const events = sessionTimeline.get(session.id) ?? [];
          const hasSni = events.some((e) => e.kind === 'tls_sni');
          const duration = session.duration_seconds ?? Math.max(0, session.last_ts - session.first_ts);

          if (hasSmb && hasNtlm) {
            addMatch({
              id: 'smb_ntlm_auth',
              title: 'SMB with NTLM authentication',
              severity: 'medium',
              confidence: tokens.has('ntlmssp') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['SMB/SMB2 observed', 'NTLMSSP observed'],
              rationale: 'SMB + NTLM authentication is often used in lateral movement and credential access workflows.',
            });
          }

          if (hasSmb && hasDcerpc) {
            addMatch({
              id: 'smb_dcerpc',
              title: 'SMB with RPC over IPC$',
              severity: 'medium',
              confidence: hasDcerpc ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['SMB/SMB2 observed', 'DCERPC observed'],
              rationale: 'SMB transport carrying RPC traffic is commonly used for remote service control and enumeration.',
            });
          }

          if (hasSamr) {
            addMatch({
              id: 'rpc_samr',
              title: 'SAMR RPC interface access',
              severity: 'medium',
              confidence: 'medium',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['SAMR protocol observed'],
              rationale: 'SAMR access can indicate account enumeration or password policy queries.',
            });
          }

          if (hasLsarpc) {
            addMatch({
              id: 'rpc_lsarpc',
              title: 'LSARPC interface access',
              severity: 'medium',
              confidence: 'medium',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['LSARPC protocol observed'],
              rationale: 'LSARPC is used for policy and account queries; often seen in enumeration workflows.',
            });
          }

          if (hasSrvsvc) {
            addMatch({
              id: 'rpc_srvsvc',
              title: 'SRVSVC interface access',
              severity: 'low',
              confidence: 'medium',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['SRVSVC protocol observed'],
              rationale: 'SRVSVC calls can enumerate shares or server info.',
            });
          }

          if (hasSmb && ports.length && !ports.some((p) => p === 445 || p === 139)) {
            addMatch({
              id: 'smb_nonstandard_port',
              title: 'SMB over non-standard port',
              severity: 'medium',
              confidence: 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: [`Ports: ${ports.join(', ')}`],
              rationale: 'SMB on non-standard ports can indicate tunneling or evasive configuration.',
            });
          }

          if (hasRdp) {
            addMatch({
              id: 'rdp_remote_desktop',
              title: 'RDP remote desktop access',
              severity: 'medium',
              confidence: hasToken('rdp') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['RDP/3389 observed'],
              rationale: 'RDP usage is sensitive and often leveraged for lateral movement.',
            });
          }

          if (hasWinrm) {
            addMatch({
              id: 'winrm_remote_management',
              title: 'WinRM remote management',
              severity: 'medium',
              confidence: hasToken('winrm') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['WinRM ports observed'],
              rationale: 'WinRM can be used for remote command execution.',
            });
          }

          if (hasVnc) {
            addMatch({
              id: 'vnc_remote_desktop',
              title: 'VNC remote desktop access',
              severity: 'medium',
              confidence: hasToken('vnc') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['VNC ports observed'],
              rationale: 'VNC access provides interactive remote control and is sensitive.',
            });
          }

          if (hasTelnet) {
            addMatch({
              id: 'telnet_cleartext',
              title: 'Telnet (cleartext) session',
              severity: 'high',
              confidence: hasToken('telnet') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['Telnet/23 observed'],
              rationale: 'Telnet is unencrypted and often associated with insecure or legacy access.',
            });
          }

          if (hasFtp) {
            addMatch({
              id: 'ftp_cleartext',
              title: 'FTP (cleartext) session',
              severity: 'medium',
              confidence: hasToken('ftp') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['FTP/21 observed'],
              rationale: 'FTP transmits credentials in cleartext and is frequently restricted.',
            });
          }

          if (hasTftp) {
            addMatch({
              id: 'tftp_transfer',
              title: 'TFTP transfer',
              severity: 'medium',
              confidence: hasToken('tftp') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['TFTP/69 observed'],
              rationale: 'TFTP is commonly abused for malware staging and device config exfiltration.',
            });
          }

          if (hasSsh) {
            addMatch({
              id: 'ssh_remote_admin',
              title: 'SSH remote administration',
              severity: 'low',
              confidence: hasToken('ssh') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['SSH/22 observed'],
              rationale: 'SSH provides remote access; verify against expected admin activity.',
            });
          }

          if (hasKerberos) {
            addMatch({
              id: 'kerberos_auth',
              title: 'Kerberos authentication traffic',
              severity: 'low',
              confidence: hasToken('kerberos') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['Kerberos ports observed'],
              rationale: 'Kerberos is normal in AD environments but should align with expected hosts.',
            });
          }

          if (hasLdap) {
            addMatch({
              id: 'ldap_directory',
              title: 'LDAP directory access',
              severity: 'low',
              confidence: hasToken('ldap') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['LDAP ports observed'],
              rationale: 'LDAP queries may indicate directory enumeration or normal auth traffic.',
            });
          }

          if (hasSnmp) {
            addMatch({
              id: 'snmp_query',
              title: 'SNMP activity',
              severity: 'medium',
              confidence: hasToken('snmp') ? 'medium' : 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['SNMP/161 observed'],
              rationale: 'SNMP queries can expose device details or indicate network discovery.',
            });
          }

          if (hasTls && !hasSni) {
            addMatch({
              id: 'tls_no_sni',
              title: 'TLS without SNI',
              severity: 'low',
              confidence: 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['TLS observed', 'No SNI decoded'],
              rationale: 'Missing SNI can be benign but is also used to reduce visibility.',
            });
          }

          if (hasIcmp) {
            addMatch({
              id: 'icmp_activity',
              title: 'ICMP activity',
              severity: 'low',
              confidence: 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['ICMP observed'],
              rationale: 'ICMP can indicate scanning or diagnostics; validate against expected use.',
            });
          }

          if (session.byte_count >= 5 * 1024 * 1024 && duration <= 2) {
            addMatch({
              id: 'high_volume_short',
              title: 'High-volume burst in short duration',
              severity: 'medium',
              confidence: 'medium',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: [`${(session.byte_count / (1024 * 1024)).toFixed(1)} MB in ${duration.toFixed(2)}s`],
              rationale: 'Large transfers over very short sessions can indicate staging or exfiltration bursts.',
            });
          }

          if (session.byte_count >= 10 * 1024 * 1024) {
            addMatch({
              id: 'large_transfer',
              title: 'Large data transfer',
              severity: 'low',
              confidence: 'medium',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: [`${(session.byte_count / (1024 * 1024)).toFixed(1)} MB total`],
              rationale: 'Large transfers warrant verification against expected data movement.',
            });
          }

          if (session.packet_count >= 1000) {
            addMatch({
              id: 'many_packets',
              title: 'High packet volume',
              severity: 'low',
              confidence: 'medium',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: [`${session.packet_count} packets`],
              rationale: 'High packet counts can indicate long-lived or chatty sessions.',
            });
          }

          if (duration >= 3600) {
            addMatch({
              id: 'long_duration',
              title: 'Long-duration session',
              severity: 'low',
              confidence: 'medium',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: [`${duration.toFixed(1)}s duration`],
              rationale: 'Extended sessions can be legitimate but warrant review if unexpected.',
            });
          }

          if (flags.has('non_tcp_udp')) {
            addMatch({
              id: 'non_tcp_udp',
              title: 'Non-TCP/UDP transport',
              severity: 'low',
              confidence: 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: ['Non-TCP/UDP transport'],
              rationale: 'Less common protocols can be misused for covert channels.',
            });
          }

          const aPrivate = isPrivateIp(session.endpoints.a.ip);
          const bPrivate = isPrivateIp(session.endpoints.b.ip);
          if (aPrivate !== bPrivate) {
            addMatch({
              id: 'external_communication',
              title: 'Internal to external communication',
              severity: 'low',
              confidence: 'low',
              scope: 'session',
              session_id: session.id,
              evidence_frames: evidenceFrames,
              indicators: [`${session.endpoints.a.ip} ↔ ${session.endpoints.b.ip}`],
              rationale: 'Crossing the internal/external boundary should be validated for expected services.',
            });
          }
        };

        const evaluateCapture = () => {
          const portUsage = new Map<string, Set<number>>();
          const peerUsage = new Map<string, Set<string>>();

          for (const session of artifact.sessions ?? []) {
            const ports = sessionPorts(session).filter((p) => p <= 49151);
            const a = session.endpoints.a.ip;
            const b = session.endpoints.b.ip;
            const portSetA = portUsage.get(a) ?? new Set<number>();
            const portSetB = portUsage.get(b) ?? new Set<number>();
            for (const port of ports) {
              portSetA.add(port);
              portSetB.add(port);
            }
            portUsage.set(a, portSetA);
            portUsage.set(b, portSetB);

            const peersA = peerUsage.get(a) ?? new Set<string>();
            const peersB = peerUsage.get(b) ?? new Set<string>();
            peersA.add(b);
            peersB.add(a);
            peerUsage.set(a, peersA);
            peerUsage.set(b, peersB);
          }

          let maxPortIp: string | null = null;
          let maxPortCount = 0;
          for (const [ip, ports] of portUsage.entries()) {
            if (ports.size > maxPortCount) {
              maxPortCount = ports.size;
              maxPortIp = ip;
            }
          }

          if (maxPortIp && maxPortCount >= 20) {
            addMatch({
              id: 'multi_port_activity',
              title: 'Single host touched many service ports',
              severity: 'medium',
              confidence: 'low',
              scope: 'capture',
              evidence_frames: evidenceFromSessions(
                artifact.sessions
                  .filter((s) => s.endpoints.a.ip === maxPortIp || s.endpoints.b.ip === maxPortIp)
                  .map((s) => s.id)
              ),
              indicators: [`${maxPortIp} interacted with ${maxPortCount} service ports`],
              rationale: 'Broad service coverage can indicate scanning or extensive admin activity.',
            });
          }

          let maxPeerIp: string | null = null;
          let maxPeerCount = 0;
          for (const [ip, peers] of peerUsage.entries()) {
            if (peers.size > maxPeerCount) {
              maxPeerCount = peers.size;
              maxPeerIp = ip;
            }
          }

          if (maxPeerIp && maxPeerCount >= 20) {
            addMatch({
              id: 'multi_host_activity',
              title: 'Single host talked to many peers',
              severity: 'medium',
              confidence: 'low',
              scope: 'capture',
              evidence_frames: evidenceFromSessions(
                artifact.sessions
                  .filter((s) => s.endpoints.a.ip === maxPeerIp || s.endpoints.b.ip === maxPeerIp)
                  .map((s) => s.id)
              ),
              indicators: [`${maxPeerIp} communicated with ${maxPeerCount} hosts`],
              rationale: 'High fan-out can indicate scanning, discovery, or central services.',
            });
          }

          const domainEntries = Array.from(domainStats.values());
          const longDns = domainEntries.filter((d) => d.counts.dns > 0 && d.domain.length >= 50);
          if (longDns.length) {
            addMatch({
              id: 'dns_long_queries',
              title: 'Unusually long DNS queries',
              severity: 'medium',
              confidence: 'low',
              scope: 'capture',
              evidence_frames: evidenceFromDomains(longDns),
              indicators: longDns.slice(0, 5).map((d) => d.domain),
              rationale: 'Long DNS names can indicate tunneling or encoded data.',
            });
          }

          const highEntropy = domainEntries.filter((d) => {
            const { score } = domainSuspicionScore(d.domain, d.counts);
            return score >= 4;
          });
          if (highEntropy.length) {
            addMatch({
              id: 'suspicious_domains',
              title: 'Domains with suspicious lexical patterns',
              severity: 'medium',
              confidence: 'low',
              scope: 'capture',
              evidence_frames: evidenceFromDomains(highEntropy),
              indicators: highEntropy.slice(0, 5).map((d) => d.domain),
              rationale: 'High-entropy or digit-heavy domains can indicate DGA or obfuscation.',
            });
          }

          const sniWithoutDns = domainEntries.filter((d) => d.counts.sni > 0 && d.counts.dns === 0);
          if (sniWithoutDns.length >= 2) {
            addMatch({
              id: 'sni_without_dns',
              title: 'TLS SNI without DNS lookups',
              severity: 'low',
              confidence: 'low',
              scope: 'capture',
              evidence_frames: evidenceFromDomains(sniWithoutDns),
              indicators: sniWithoutDns.slice(0, 5).map((d) => d.domain),
              rationale: 'SNI without DNS can indicate hardcoded endpoints or bypassed resolution.',
            });
          }
        };

        if (targetScope === 'session') {
          const session = resolvedSessionId ? sessionIndex.get(resolvedSessionId) : undefined;
          if (!session) {
            return { error: `Unknown session_id ${resolvedSessionId ?? 'unknown'}.` };
          }
          evaluateSession(session);
        } else {
          for (const session of artifact.sessions ?? []) {
            evaluateSession(session);
          }
          evaluateCapture();
        }

        const severityRank = { high: 3, medium: 2, low: 1 };
        const confidenceRank = { high: 3, medium: 2, low: 1 };
        matches.sort((a, b) => {
          const severityDelta = severityRank[b.severity] - severityRank[a.severity];
          if (severityDelta !== 0) return severityDelta;
          const confidenceDelta = confidenceRank[b.confidence] - confidenceRank[a.confidence];
          if (confidenceDelta !== 0) return confidenceDelta;
          return a.id.localeCompare(b.id);
        });

        const max = limit ?? 50;
        return { total: matches.length, matches: matches.slice(0, max) };
      },
    }),
    pcap_command_hunt: tool({
      description:
        'Scan TCP streams for shell commands and user/account creation activity (no external intel).',
      inputSchema: z.object({
        scope: z.enum(['capture', 'session']).optional(),
        session_id: z.string().optional(),
        max_streams: z.number().int().min(1).max(200).optional(),
        max_matches: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ scope, session_id, max_streams, max_matches }) => {
        if (!artifact) {
          return { error: 'No PCAP artifact available.' };
        }

        const targetScope = scope ?? (session_id || context?.session_id ? 'session' : 'capture');
        const targetSessionId = session_id ?? context?.session_id ?? null;
        const targetSession =
          targetScope === 'session' && targetSessionId
            ? artifact.sessions.find((s) => s.id === targetSessionId)
            : undefined;

        const resolved = resolvePcapSession(context, undefined);
        if ('error' in resolved) {
          return { error: resolved.error };
        }

        const streamList = await listTcpStreams(resolved.session, {
          limit: max_streams ?? 60,
        });

        const filteredStreams = targetSession
          ? streamList.streams.filter((stream) => {
              const a = stream.endpoints.a;
              const b = stream.endpoints.b;
              const sa = targetSession.endpoints.a;
              const sb = targetSession.endpoints.b;
              const matchAB =
                a.ip === sa.ip &&
                b.ip === sb.ip &&
                (sa.port == null || a.port === sa.port) &&
                (sb.port == null || b.port === sb.port);
              const matchBA =
                a.ip === sb.ip &&
                b.ip === sa.ip &&
                (sb.port == null || a.port === sb.port) &&
                (sa.port == null || b.port === sa.port);
              return matchAB || matchBA;
            })
          : streamList.streams;

        const matches: Array<{
          stream_id: number;
          endpoints: { a: { ip: string; port: number | null }; b: { ip: string; port: number | null } };
          frame: number;
          ts: number;
          category: CommandSignature['category'];
          indicator: string;
          severity: CommandSignature['severity'];
          confidence: CommandSignature['confidence'];
          command: string;
          extracted?: { username?: string; group?: string };
        }> = [];

        const userCandidates: Array<{
          username: string;
          stream_id: number;
          frame: number;
          command: string;
        }> = [];

        const seen = new Set<string>();
        const totalLimit = max_matches ?? 80;

        for (const stream of filteredStreams) {
          if (matches.length >= totalLimit) break;
          const result = await followTcpStream(resolved.session, stream.stream_id, {
            contains: COMMAND_PREFILTER_REGEX,
            matchMode: 'regex',
            caseSensitive: false,
            contextPackets: 1,
            maxOutputSegments: 20,
            maxBytesPerSegment: 2000,
          });

          if (!result.segments || result.segments.length === 0) continue;

          for (const segment of result.segments) {
            if (matches.length >= totalLimit) break;
            const lines = segment.text
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            for (const line of lines) {
              if (matches.length >= totalLimit) break;
              for (const signature of COMMAND_SIGNATURES) {
                const match = line.match(signature.regex);
                if (!match) continue;
                const key = `${stream.stream_id}:${segment.frame}:${signature.id}:${line}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const extracted = signature.extract ? signature.extract(match) ?? undefined : undefined;
                matches.push({
                  stream_id: stream.stream_id,
                  endpoints: stream.endpoints,
                  frame: segment.frame,
                  ts: segment.ts,
                  category: signature.category,
                  indicator: signature.label,
                  severity: signature.severity,
                  confidence: signature.confidence,
                  command: line.slice(0, 200),
                  extracted,
                });
                if (extracted?.username) {
                  userCandidates.push({
                    username: extracted.username,
                    stream_id: stream.stream_id,
                    frame: segment.frame,
                    command: line.slice(0, 200),
                  });
                }
                break;
              }
            }
          }
        }

        return {
          scope: targetScope,
          total_streams: streamList.total,
          scanned_streams: filteredStreams.length,
          total_matches: matches.length,
          matches,
          user_candidates: userCandidates,
          notes: [
            'Matches are based on ASCII payload reconstruction and may be truncated.',
            'No external reputation or host telemetry is used.',
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
    suggested_next_steps: tool({
      description:
        'Provide suggested follow-up actions as clickable buttons for the user.',
      inputSchema: z.object({
        suggestions: z
          .array(
            z.object({
              label: z.string().min(1).max(80),
              query: z.string().min(1).max(400),
              context_mode: z.enum(['session', 'capture']).optional(),
              note: z.string().max(160).optional(),
            })
          )
          .min(1)
          .max(6),
      }),
      execute: async ({ suggestions }) => {
        const normalized = (suggestions ?? [])
          .map((item) => ({
            label: item.label.trim().slice(0, 80),
            query: item.query.trim().slice(0, 400),
            contextMode: item.context_mode,
            note: item.note?.trim().slice(0, 160),
          }))
          .filter((item) => item.label && item.query);
        if (normalized.length === 0) {
          return { error: 'No valid suggested steps provided.' };
        }
        return { suggestions: normalized };
      },
    }),
  };
}
