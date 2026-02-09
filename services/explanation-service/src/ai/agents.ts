import { ToolLoopAgent, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { ChatContext } from '../types';
import { buildSystemPrompt } from './prompt';
import { createTools } from './tools';
import type { RouteName } from './routing';

type ToolSet = ReturnType<typeof createTools>;
type ToolName = keyof ToolSet;

const TOOL_GROUPS = {
  overview: [
    'pcap_overview',
    'list_sessions',
    'pcap_sessions_query',
    'pcap_top_talkers',
    'pcap_protocols',
    'pcap_search',
  ],
  session: ['get_session', 'get_evidence_frames', 'pcap_sessions_query'],
  timeline: ['get_timeline', 'search_timeline', 'pcap_timeline_range', 'pcap_event_kinds', 'pcap_search'],
  domain: ['pcap_domains', 'pcap_session_domains', 'pcap_domain_sessions', 'domain_risk_assess'],
  stream: ['pcap_tcp_streams', 'pcap_follow_tcp_stream', 'get_session', 'get_evidence_frames'],
  summary: [],
} as const satisfies Record<RouteName, readonly ToolName[]>;

const ROUTE_SCOPES: Record<RouteName, string> = {
  overview: 'Scope: Capture-wide overview and session discovery. Focus on top-level patterns.',
  session: 'Scope: Session metadata and evidence frames. Do not invent payload details.',
  timeline: 'Scope: Timeline/event-based analysis and searches.',
  domain: 'Scope: Domain-centric analysis (DNS/SNI/HTTP host) and local risk assessment.',
  stream: 'Scope: Raw TCP payload reconstruction (Follow TCP Stream) and command extraction.',
  summary: 'Scope: Narrative summary without tool usage.',
};

function pickTools<T extends Record<string, any>>(tools: T, names: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const name of names) {
    if (name in tools) {
      out[name] = tools[name];
    }
  }
  return out;
}

function createSpecialistAgent(
  route: RouteName,
  context: ChatContext | undefined,
  tools: ToolSet,
  toolNames: readonly ToolName[]
): ToolLoopAgent {
  const modelName = process.env.OPENAI_MODEL ?? 'gpt-5.2';
  const scopedTools = pickTools(tools, toolNames);
  const activeToolNames = Object.keys(scopedTools) as Array<keyof typeof scopedTools>;
  const forceToolFirstStep = Boolean(context?.artifact && activeToolNames.length > 0);

  return new ToolLoopAgent({
    id: `kisame-${route}-agent`,
    model: openai(modelName),
    instructions: buildSystemPrompt(context, ROUTE_SCOPES[route]),
    tools: scopedTools,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 1024,
    prepareStep: async ({ stepNumber, steps }) => {
      if (!context?.artifact || activeToolNames.length === 0) {
        return { activeTools: [] };
      }
      return {
        activeTools: activeToolNames,
        toolChoice: stepNumber === 0 && steps.length === 0 && forceToolFirstStep ? 'required' : 'auto',
      };
    },
  });
}

export function createSpecialistAgents(context?: ChatContext): {
  tools: ToolSet;
  agents: Record<RouteName, ToolLoopAgent>;
} {
  const tools = createTools(context);

  return {
    tools,
    agents: {
      overview: createSpecialistAgent('overview', context, tools, TOOL_GROUPS.overview),
      session: createSpecialistAgent('session', context, tools, TOOL_GROUPS.session),
      timeline: createSpecialistAgent('timeline', context, tools, TOOL_GROUPS.timeline),
      domain: createSpecialistAgent('domain', context, tools, TOOL_GROUPS.domain),
      stream: createSpecialistAgent('stream', context, tools, TOOL_GROUPS.stream),
      summary: createSpecialistAgent('summary', context, tools, TOOL_GROUPS.summary),
    },
  };
}
