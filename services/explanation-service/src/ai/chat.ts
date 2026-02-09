/**
 * AI Chat module using Vercel AI SDK
 * 
 * This module handles chat interactions with AI models for explaining
 * network traffic sessions and answering questions about PCAP analysis.
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { ChatContext, ChatQueryResponse, AnalysisArtifact } from '../types';
import { utcNowIso } from '../utils/response';

/**
 * Build a system prompt for the chat based on available context
 */
function buildSystemPrompt(context?: ChatContext): string {
  const basePrompt = `You are Kisame, an AI assistant specialized in network traffic analysis and cybersecurity forensics. 
You help users understand network packet captures (PCAPs), identify suspicious patterns, and explain network behavior.
You provide clear, evidence-based explanations anchored to specific packet frames when available.

Key capabilities:
- Explain network sessions and their characteristics
- Identify potential security issues in traffic patterns
- Describe protocol behaviors (TCP, UDP, HTTP, DNS, TLS, etc.)
- Suggest investigation steps for suspicious activity

Always be precise and reference specific evidence (frame numbers, timestamps, IP addresses) when available.`;

  if (!context?.artifact || !context?.session_id) {
    return basePrompt;
  }

  // Enrich with session context
  const session = context.artifact.sessions?.find(s => s.id === context.session_id);
  if (!session) {
    return basePrompt;
  }

  const sessionContext = `

Current Session Context:
- Session ID: ${session.id}
- Transport: ${session.transport.toUpperCase()}
- Endpoints: ${session.endpoints.a.ip}:${session.endpoints.a.port ?? '?'} ↔ ${session.endpoints.b.ip}:${session.endpoints.b.port ?? '?'}
- Duration: ${session.duration_seconds.toFixed(2)}s
- Volume: ${session.packet_count} packets, ${session.byte_count} bytes
- Evidence frames: #${session.evidence.first_frame} to #${session.evidence.last_frame}
- Rule flags: ${session.rule_flags.length > 0 ? session.rule_flags.join(', ') : 'none'}

Timeline events for this session:
${getTimelinePreview(context.artifact, context.session_id)}`;

  return basePrompt + sessionContext;
}

/**
 * Get a preview of timeline events for a session
 */
function getTimelinePreview(artifact: AnalysisArtifact, sessionId: string): string {
  const events = artifact.timeline?.filter(e => e.session_id === sessionId) ?? [];
  if (events.length === 0) {
    return 'No decoded events available for this session.';
  }

  return events
    .slice(0, 10)
    .map(e => `- ${new Date(e.ts * 1000).toISOString().slice(11, 19)} ${e.summary} (frame #${e.evidence_frame})`)
    .join('\n');
}

/**
 * Process a chat query using the AI SDK
 */
export async function processChat(
  query: string,
  context?: ChatContext
): Promise<ChatQueryResponse> {
  const timestamp = utcNowIso();
  const contextAvailable = !!(context?.session_id && context?.artifact);

  // Check if OpenAI API key is configured
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback to placeholder response when no API key
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
    const systemPrompt = buildSystemPrompt(context);

    const result = await generateText({
      model: openai('gpt-4o-mini'),
      system: systemPrompt,
      prompt: query,
      maxTokens: 1024,
    });

    return {
      query,
      response: result.text,
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
