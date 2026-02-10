import type { ChatContext, ChatQueryResponse } from '../types';
import { buildRoutedPrompt, routeQuery, type RouteName } from './routing';
import { createSpecialistAgents } from './agents';
import { utcNowIso } from '../utils/response';
import { logInfo, logWarn, logError, toErrorMeta } from '../utils/logger';

export type ChatStreamEvent =
  | { type: 'status'; stage: string; message?: string }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
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
      case 'pcap_tcp_streams':
        return {
          toolCallId,
          toolName,
          summary: `pcap_tcp_streams: ${output.total ?? 0} streams (showing ${output.streams?.length ?? 0})`,
        };
      case 'pcap_follow_tcp_stream':
        return {
          toolCallId,
          toolName,
          summary: output?.stream_id != null
            ? `pcap_follow_tcp_stream: stream ${output.stream_id} • ${output.payload_frames ?? 0} payload frames • ${output.payload_bytes ?? 0} bytes` +
              (output.segments ? ` • ${output.segments.length} matched segment${output.segments.length === 1 ? '' : 's'}` : '')
            : 'pcap_follow_tcp_stream: no stream data',
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
      case 'suggested_next_steps':
        return {
          toolCallId,
          toolName,
          summary: `suggested_next_steps: ${output?.suggestions?.length ?? 0} options`,
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
    const decision = context?.artifact
      ? await routeQuery(query, context)
      : { route: 'summary' as RouteName, reason: 'No artifact.', confidence: 'low' as const, next_actions: [] };
    const { agents } = createSpecialistAgents(context, { [decision.route]: decision.next_actions });
    const agent = agents[decision.route] ?? agents.overview;
    const promptToSend = buildRoutedPrompt(query, decision.route, context, decision.next_actions);

    logInfo('ai.chat.route', {
      session_id: context?.session_id ?? null,
      route: decision.route,
      confidence: decision.confidence,
      reason: decision.reason,
      next_actions: decision.next_actions,
    });

    const result = await agent.generate({
      prompt: promptToSend,
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
        const decision = context?.artifact
          ? await routeQuery(query, context)
          : { route: 'summary' as RouteName, reason: 'No artifact.', confidence: 'low' as const, next_actions: [] };
        const { agents } = createSpecialistAgents(context, { [decision.route]: decision.next_actions });
        const agent = agents[decision.route] ?? agents.overview;
        const promptToSend = buildRoutedPrompt(query, decision.route, context, decision.next_actions);
        let stepCount = 0;

        logInfo('ai.stream.route', {
          session_id: context?.session_id ?? null,
          route: decision.route,
          confidence: decision.confidence,
          reason: decision.reason,
          next_actions: decision.next_actions,
        });

        sendEvent(controller, {
          type: 'status',
          stage: 'route',
          message: `Routing to ${decision.route} (${decision.confidence})`,
        });
        if (decision.next_actions.length) {
          sendEvent(controller, {
            type: 'status',
            stage: 'plan',
            message: `Plan: ${decision.next_actions.join(' -> ')}`,
          });
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
        let reasoningBuffer = '';

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
          } else if (part.type === 'reasoning-delta') {
            const delta = (part as { textDelta?: string }).textDelta ?? '';
            if (delta) {
              reasoningBuffer += delta;
              sendEvent(controller, { type: 'reasoning', delta });
            }
          } else if ((part as any).type === 'reasoning') {
            const delta = (part as { textDelta?: string; text?: string }).textDelta ?? (part as any).text ?? '';
            if (delta) {
              reasoningBuffer += delta;
              sendEvent(controller, { type: 'reasoning', delta });
            }
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
          } else if (part.type === 'reasoning-start') {
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

        if (!reasoningBuffer) {
          const reasoningText = (await (result as any).reasoningText) as string | undefined;
          if (reasoningText) {
            sendEvent(controller, { type: 'reasoning', delta: reasoningText });
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
