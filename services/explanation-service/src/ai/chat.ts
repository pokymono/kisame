import { ToolLoopAgent, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { ChatContext, ChatQueryResponse, AnalysisArtifact } from '../types';
import { utcNowIso } from '../utils/response';

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
        const matches = filtered.filter((e) => e.summary.toLowerCase().includes(query.toLowerCase()));
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
          const text = event.summary.toLowerCase();
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
  };
}

function createAnalysisAgent(context?: ChatContext) {
  const modelName = process.env.OPENAI_MODEL ?? 'gpt-5.2';
  const tools = createTools(context);
  const allToolNames = Object.keys(tools) as Array<keyof typeof tools>;

  return new ToolLoopAgent({
    id: 'kisame-analysis-agent',
    model: openai(modelName),
    instructions: buildSystemPrompt(context),
    tools,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 1024,
    prepareStep: async () => {
      if (!context?.artifact) {
        return { activeTools: [] };
      }
      if (!context.session_id) {
        return {
          activeTools: ['pcap_overview', 'list_sessions', 'search_timeline', 'pcap_search'] as Array<
            keyof typeof tools
          >,
        };
      }
      return { activeTools: allToolNames };
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
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

    return {
      query,
      response: responseText,
      timestamp,
      context_available: contextAvailable,
    };
  } catch (error) {
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

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const contextAvailable = !!(context?.session_id && context?.artifact);
      sendEvent(controller, {
        type: 'status',
        stage: 'start',
        message: contextAvailable ? `Context ready for ${context?.session_id}` : 'No session context',
      });

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
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
        const result = await agent.stream({
          prompt: query,
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
        if (toolResults.length > 0) {
          const summaries = summarizeToolResults(toolResults as any);
          const summaryText = summaries.map((s) => `- ${s.summary}`).join('\n');
          sendEvent(controller, { type: 'tool_summary', summary: summaryText });
        }

        const finishReason = await result.finishReason;
        sendEvent(controller, { type: 'done', finish_reason: finishReason });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        sendEvent(controller, { type: 'error', message: errorMessage });
      } finally {
        controller.close();
      }
    },
  });
}
