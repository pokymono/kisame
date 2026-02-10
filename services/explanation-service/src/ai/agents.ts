import { ToolLoopAgent, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { ChatContext } from '../types';
import { buildSystemPrompt } from './prompt';
import { createTools } from './tools';
import type { RouteName, RouterPlanAction } from './routing';

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

const DEFAULT_ROUTE_PLANS: Record<RouteName, RouterPlanAction[]> = {
  overview: ['overview', 'list_sessions'],
  session: ['session_details', 'evidence_frames'],
  timeline: ['timeline_search'],
  domain: ['list_domains', 'domain_sessions'],
  stream: ['list_streams', 'follow_stream'],
  summary: [],
};

const ACTION_TOOLS: Record<RouterPlanAction, readonly ToolName[]> = {
  overview: ['pcap_overview'],
  list_sessions: ['list_sessions'],
  session_details: ['get_session'],
  evidence_frames: ['get_evidence_frames'],
  search_capture: ['pcap_search'],
  timeline_search: ['search_timeline'],
  timeline_range: ['pcap_timeline_range'],
  event_kinds: ['pcap_event_kinds'],
  list_domains: ['pcap_domains'],
  session_domains: ['pcap_session_domains'],
  domain_sessions: ['pcap_domain_sessions'],
  risk_assess: ['domain_risk_assess'],
  list_streams: ['pcap_tcp_streams'],
  follow_stream: ['pcap_follow_tcp_stream'],
  suggested_next_steps: ['suggested_next_steps'],
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
  baseToolNames: readonly ToolName[],
  planActions?: RouterPlanAction[]
): ToolLoopAgent {
  const modelName = process.env.OPENAI_MODEL ?? 'gpt-5.2-codex';
  const minToolCalls =
    route === 'summary' ? 0 : Number(process.env.KISAME_MIN_TOOL_CALLS ?? '0');
  const maxSteps = Math.max(18, Number.isFinite(minToolCalls) ? minToolCalls + 6 : 18);
  const reasoningSummary = process.env.KISAME_REASONING_SUMMARY ?? 'auto';
  const reasoningEffort = process.env.KISAME_REASONING_EFFORT ?? 'high';
  const forceReasoning =
    process.env.KISAME_FORCE_REASONING === 'false'
      ? false
      : process.env.KISAME_FORCE_REASONING
        ? process.env.KISAME_FORCE_REASONING === 'true'
        : true;
  const requestedPlan = (planActions && planActions.length ? planActions : DEFAULT_ROUTE_PLANS[route]).filter(
    (action): action is RouterPlanAction => Boolean(action)
  );
  const filteredPlan = requestedPlan.filter((action) =>
    ACTION_TOOLS[action].some((tool) => tool in tools)
  );
  const resolvedPlan = filteredPlan.length ? filteredPlan : DEFAULT_ROUTE_PLANS[route];

  const planToolNames = new Set<ToolName>();
  for (const action of resolvedPlan) {
    for (const tool of ACTION_TOOLS[action]) {
      if (tool in tools) {
        planToolNames.add(tool);
      }
    }
  }

  const mergedToolNames = Array.from(
    new Set([
      ...baseToolNames,
      ...planToolNames,
      ...(route !== 'summary' && 'suggested_next_steps' in tools ? (['suggested_next_steps'] as ToolName[]) : []),
    ])
  );
  const scopedTools = pickTools(tools, mergedToolNames);
  const activeToolNames = Object.keys(scopedTools).filter((name): name is ToolName => name in tools);
  const forceToolFirstStep = Boolean(context?.artifact && activeToolNames.length > 0);
  const hasSuggestedTool = 'suggested_next_steps' in scopedTools;

  return new ToolLoopAgent({
    id: `kisame-${route}-agent`,
    model: openai(modelName),
    instructions: buildSystemPrompt(context, ROUTE_SCOPES[route]),
    tools: scopedTools,
    providerOptions: {
      openai: {
        ...(reasoningSummary ? { reasoningSummary } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(forceReasoning ? { forceReasoning: true } : {}),
      },
    },
    stopWhen: stepCountIs(maxSteps),
    prepareStep: async ({ stepNumber, steps }) => {
      if (!context?.artifact || activeToolNames.length === 0) {
        return { activeTools: [] as ToolName[] };
      }
      const totalToolCalls = steps.reduce((sum, step) => sum + (step.toolCalls?.length ?? 0), 0);
      const suggestedCalled = steps.some((step) =>
        (step.toolCalls ?? []).some((call) => call?.toolName === 'suggested_next_steps')
      );
      const minToolTarget = Number.isFinite(minToolCalls) && minToolCalls > 0 ? minToolCalls : 0;
      const needsMoreBeforeSuggested =
        minToolTarget > 0 && totalToolCalls < Math.max(0, minToolTarget - 1);

      let planIndex = 0;
      for (const step of steps) {
        for (const call of step.toolCalls ?? []) {
          if (!call) continue;
          if (planIndex >= resolvedPlan.length) break;
          const expectedAction = resolvedPlan[planIndex];
          if (!expectedAction) break;
          if (ACTION_TOOLS[expectedAction].includes(call.toolName as ToolName)) {
            planIndex += 1;
          }
        }
        if (planIndex >= resolvedPlan.length) break;
      }

      const plannedAction = resolvedPlan[planIndex];
      if (plannedAction) {
        const plannedTools = ACTION_TOOLS[plannedAction].filter((tool): tool is ToolName => tool in scopedTools);
        if (plannedTools.length) {
          return {
            activeTools: plannedTools,
            toolChoice: 'required',
          };
        }
      }

      if (hasSuggestedTool && !suggestedCalled && !needsMoreBeforeSuggested) {
        return {
          activeTools: ['suggested_next_steps'] as ToolName[],
          toolChoice: 'required',
        };
      }

      if (needsMoreBeforeSuggested) {
        const toolsWithoutSuggested = activeToolNames.filter((tool) => tool !== 'suggested_next_steps');
        if (toolsWithoutSuggested.length) {
          return {
            activeTools: toolsWithoutSuggested,
            toolChoice: 'required',
          };
        }
      }

      return {
        activeTools: activeToolNames,
        toolChoice:
          needsMoreBeforeSuggested || (stepNumber === 0 && steps.length === 0 && forceToolFirstStep)
            ? 'required'
            : 'auto',
      };
    },
  });
}

export function createSpecialistAgents(
  context?: ChatContext,
  plans?: Partial<Record<RouteName, RouterPlanAction[]>>
): {
  tools: ToolSet;
  agents: Record<RouteName, ToolLoopAgent>;
} {
  const tools = createTools(context);

  return {
    tools,
    agents: {
      overview: createSpecialistAgent('overview', context, tools, TOOL_GROUPS.overview, plans?.overview),
      session: createSpecialistAgent('session', context, tools, TOOL_GROUPS.session, plans?.session),
      timeline: createSpecialistAgent('timeline', context, tools, TOOL_GROUPS.timeline, plans?.timeline),
      domain: createSpecialistAgent('domain', context, tools, TOOL_GROUPS.domain, plans?.domain),
      stream: createSpecialistAgent('stream', context, tools, TOOL_GROUPS.stream, plans?.stream),
      summary: createSpecialistAgent('summary', context, tools, TOOL_GROUPS.summary, plans?.summary),
    },
  };
}
