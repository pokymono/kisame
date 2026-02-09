import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { ChatContext } from '../types';
import { logWarn, toErrorMeta } from '../utils/logger';
import { isDomainLike, isGlobalQuestion, normalizeSearchTerms } from './query-utils';

export type RouteName = 'overview' | 'session' | 'timeline' | 'domain' | 'stream' | 'summary';

export type RouteDecision = {
  route: RouteName;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
};

type RoutingSignals = {
  hasArtifact: boolean;
  selectedSessionId: string | null;
  selectedSessionHasTimeline: boolean;
  totalSessions: number;
  totalTimelineEvents: number;
  hasTcpSessions: boolean;
};

function getRoutingSignals(context?: ChatContext): RoutingSignals {
  const artifact = context?.artifact;
  const selectedSessionId = context?.session_id ?? null;
  const totalSessions = artifact?.sessions?.length ?? 0;
  const totalTimelineEvents = artifact?.timeline?.length ?? 0;
  const selectedSessionHasTimeline = Boolean(
    artifact && selectedSessionId
      ? artifact.timeline?.some((e) => e.session_id === selectedSessionId)
      : false
  );
  const hasTcpSessions = Boolean(artifact?.sessions?.some((s) => s.transport === 'tcp'));

  return {
    hasArtifact: Boolean(artifact),
    selectedSessionId,
    selectedSessionHasTimeline,
    totalSessions,
    totalTimelineEvents,
    hasTcpSessions,
  };
}

function streamIntent(query: string): boolean {
  return /\b(tcp stream|data stream|follow.+stream|payload|raw tcp|netcat|nc|shell|command|useradd|adduser|shadow|rogue|suspicious|malicious|backdoor)\b/i.test(
    query
  );
}

export async function routeQuery(query: string, context?: ChatContext): Promise<RouteDecision> {
  const modelName = process.env.OPENAI_ROUTER_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.2';
  const model = openai(modelName);
  const signals = getRoutingSignals(context);
  const tokens = normalizeSearchTerms([query]);
  const domainToken = tokens.find(isDomainLike) ?? null;
  const global = isGlobalQuestion(query);
  const streamy = streamIntent(query);

  if (!signals.hasArtifact) {
    return { route: 'summary', reason: 'No capture context available.', confidence: 'high' };
  }

  const schema = z.object({
    route: z.enum(['overview', 'session', 'timeline', 'domain', 'stream', 'summary']),
    reason: z.string(),
    confidence: z.enum(['low', 'medium', 'high']),
  });

  const prompt = `You are a router for a network forensics assistant.
Choose the best route for the user's query.

Routes:
- overview: capture-wide overview, listing sessions, top talkers, protocols, global filters.
- session: session metadata, evidence frames, per-session stats.
- timeline: timeline searches, time-windowed events, event kinds, decoded event review.
- domain: domain/DNS/SNI/HTTP host questions or domain reputation.
- stream: raw TCP payload reconstruction (Follow TCP Stream), commands, shell/netcat, user creation.
- summary: no tools available or purely narrative response.

Signals:
- hasArtifact: ${signals.hasArtifact}
- selectedSessionId: ${signals.selectedSessionId ?? 'none'}
- selectedSessionHasTimeline: ${signals.selectedSessionHasTimeline}
- totalSessions: ${signals.totalSessions}
- totalTimelineEvents: ${signals.totalTimelineEvents}
- hasTcpSessions: ${signals.hasTcpSessions}
- globalQuestion: ${global}
- domainToken: ${domainToken ?? 'none'}
- streamIntent: ${streamy}

Routing guidance:
- If domainToken is present, prefer domain.
- If streamIntent is true, prefer stream.
- If hasTcpSessions is false, avoid stream.
- If user asks about timeline/events/search/time range, prefer timeline.
- If user asks about specific session or evidence frames, prefer session.
- If user asks broad capture questions, prefer overview.
- If no artifact, use summary.

Return route, confidence, and a short reason.

User query:
${query}`;

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema }),
      prompt,
      temperature: 0,
      maxOutputTokens: 200,
    });

    if (!output?.route) {
      return { route: signals.hasArtifact ? 'overview' : 'summary', reason: 'Defaulted route.', confidence: 'low' };
    }
    return output;
  } catch (error) {
    logWarn('ai.route.error', { error: toErrorMeta(error) });
    return { route: signals.hasArtifact ? 'overview' : 'summary', reason: 'Routing failed.', confidence: 'low' };
  }
}

export function buildRoutedPrompt(query: string, route: RouteName, context?: ChatContext): string {
  const tokens = normalizeSearchTerms([query]);
  const domainToken = tokens.find(isDomainLike);
  const global = isGlobalQuestion(query);

  if (route === 'domain') {
    const preface = domainToken
      ? global
        ? `Before answering, use pcap_domain_sessions for domain "${domainToken}" to locate sessions across the capture.`
        : `Before answering, use pcap_session_domains or pcap_domain_sessions to ground domain "${domainToken}".`
      : 'Before answering, use pcap_domains to list capture domains, then drill into the relevant domain with pcap_domain_sessions.';
    return `${preface}\n\nUser question: ${query}`;
  }

  if (route === 'stream') {
    const preface =
      'Before answering, use pcap_tcp_streams to list TCP streams and pcap_follow_tcp_stream to reconstruct raw payloads (Follow TCP Stream).';
    return `${preface}\n\nUser question: ${query}`;
  }

  if (route === 'overview' && global && context?.artifact) {
    const preface =
      'Before answering, use pcap_search or pcap_domains to check the entire capture (not just one session).';
    return `${preface}\n\nUser question: ${query}`;
  }

  return query;
}
