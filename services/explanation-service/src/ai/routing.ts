import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { ChatContext } from '../types';
import { logWarn, toErrorMeta } from '../utils/logger';
import { isDomainLike, isGlobalQuestion, normalizeSearchTerms } from './query-utils';

export type RouteName = 'overview' | 'session' | 'timeline' | 'domain' | 'stream' | 'summary';

export type RouterPlanAction =
  | 'overview'
  | 'list_sessions'
  | 'session_details'
  | 'evidence_frames'
  | 'search_capture'
  | 'timeline_search'
  | 'timeline_range'
  | 'event_kinds'
  | 'list_domains'
  | 'session_domains'
  | 'domain_sessions'
  | 'risk_assess'
  | 'list_streams'
  | 'follow_stream'
  | 'suggested_next_steps';

export type RouteDecision = {
  route: RouteName;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
  next_actions: RouterPlanAction[];
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

export async function routeQuery(query: string, context?: ChatContext): Promise<RouteDecision> {
  const modelName = process.env.OPENAI_ROUTER_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.2';
  const model = openai(modelName);
  const signals = getRoutingSignals(context);

  if (!signals.hasArtifact) {
    return { route: 'summary', reason: 'No capture context available.', confidence: 'high', next_actions: [] };
  }

  const actionSchema = z.enum([
    'overview',
    'list_sessions',
    'session_details',
    'evidence_frames',
    'search_capture',
    'timeline_search',
    'timeline_range',
    'event_kinds',
    'list_domains',
    'session_domains',
    'domain_sessions',
    'risk_assess',
    'list_streams',
    'follow_stream',
    'suggested_next_steps',
  ]);

  const schema = z.object({
    route: z.enum(['overview', 'session', 'timeline', 'domain', 'stream', 'summary']),
    reason: z.string(),
    confidence: z.enum(['low', 'medium', 'high']),
    next_actions: z.array(actionSchema),
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

Routing guidance:
- If the query is about domains/hosts/DNS/SNI/HTTP hosts, prefer domain.
- If the query is about raw TCP payloads, shell commands, or "follow stream", prefer stream.
- If user asks about timeline/events/search/time range, prefer timeline.
- If user asks about specific session or evidence frames, prefer session.
- If user asks broad capture questions, prefer overview.
- If no artifact, use summary.

Plan actions (choose 1-4, or [] for summary):
- overview (pcap_overview)
- list_sessions (list_sessions)
- session_details (get_session)
- evidence_frames (get_evidence_frames)
- search_capture (pcap_search)
- timeline_search (search_timeline)
- timeline_range (pcap_timeline_range)
- event_kinds (pcap_event_kinds)
- list_domains (pcap_domains)
- session_domains (pcap_session_domains)
- domain_sessions (pcap_domain_sessions)
- risk_assess (domain_risk_assess)
- list_streams (pcap_tcp_streams)
- follow_stream (pcap_follow_tcp_stream)
- suggested_next_steps (suggested_next_steps)

Choose actions that match the selected route (e.g., stream -> list_streams/follow_stream, domain -> list_domains/domain_sessions).
For "suspicious" or "analyze this PCAP" style requests:
- If hasTcpSessions and totalTimelineEvents is low/zero, include list_streams and follow_stream.
- If totalTimelineEvents is available, include timeline_search or timeline_range.
Return route, confidence, reason, and next_actions.

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
      return {
        route: signals.hasArtifact ? 'overview' : 'summary',
        reason: 'Defaulted route.',
        confidence: 'low',
        next_actions: [],
      };
    }
    return {
      route: output.route,
      reason: output.reason,
      confidence: output.confidence,
      next_actions: output.next_actions ?? [],
    };
  } catch (error) {
    logWarn('ai.route.error', { error: toErrorMeta(error) });
    return {
      route: signals.hasArtifact ? 'overview' : 'summary',
      reason: 'Routing failed.',
      confidence: 'low',
      next_actions: [],
    };
  }
}

export function buildRoutedPrompt(
  query: string,
  route: RouteName,
  context?: ChatContext,
  plan?: RouterPlanAction[]
): string {
  const tokens = normalizeSearchTerms([query]);
  const domainToken = tokens.find(isDomainLike);
  const global = isGlobalQuestion(query);
  const planLine = plan?.length
    ? `Tool plan: ${plan.join(' -> ')}. Use tools in this order before answering.`
    : '';

  if (route === 'domain') {
    const focus = domainToken
      ? global
        ? `Focus on domain "${domainToken}" across the capture.`
        : `Focus on domain "${domainToken}".`
      : 'Focus on the domain(s) implied by the query.';
    return [planLine, focus, `User question: ${query}`].filter(Boolean).join('\n\n');
  }

  if (route === 'stream') {
    const preface = 'Use raw TCP payload reconstruction (Follow TCP Stream) before answering.';
    return [planLine, preface, `User question: ${query}`].filter(Boolean).join('\n\n');
  }

  if (route === 'overview' && global && context?.artifact) {
    const preface =
      'Before answering, use pcap_search or pcap_domains to check the entire capture (not just one session).';
    return [planLine, preface, `User question: ${query}`].filter(Boolean).join('\n\n');
  }

  return [planLine, query].filter(Boolean).join('\n\n');
}
