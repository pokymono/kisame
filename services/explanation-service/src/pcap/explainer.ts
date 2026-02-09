/**
 * Session explainer - generates human-readable explanations for sessions
 */
import type { AnalysisArtifact } from '../types';

export type SessionExplanation = {
  session_id: string;
  text: string;
  evidence_frames: number[];
};

/**
 * Generate an explanation for a specific session
 */
export function explainSession(artifact: AnalysisArtifact, sessionId: string): SessionExplanation {
  const session = artifact.sessions.find((s) => s.id === sessionId);
  if (!session) {
    return { session_id: sessionId, text: `Unknown session_id ${sessionId}.`, evidence_frames: [] };
  }

  const a = `${session.endpoints.a.ip}${session.endpoints.a.port ? `:${session.endpoints.a.port}` : ''}`;
  const b = `${session.endpoints.b.ip}${session.endpoints.b.port ? `:${session.endpoints.b.port}` : ''}`;
  const evidenceFrames = [session.evidence.first_frame, ...session.evidence.sample_frames, session.evidence.last_frame].filter(
    (n, i, arr) => arr.indexOf(n) === i
  );
  const timeline = artifact.timeline.filter((e) => e.session_id === sessionId).slice(0, 8);
  const preview = timeline.map((e) => `- ${new Date(e.ts * 1000).toISOString()} ${e.summary} (#${e.evidence_frame})`).join('\n');
  const flags = session.rule_flags.length ? `Rule flags: ${session.rule_flags.join(', ')}.` : '';

  const text = [
    `Session ${session.id} (${session.transport.toUpperCase()}) observed between ${a} and ${b}.`,
    `Time range: ${new Date(session.first_ts * 1000).toISOString()} → ${new Date(session.last_ts * 1000).toISOString()}.`,
    `Volume: ${session.packet_count} packets, ${session.byte_count} bytes.`,
    flags,
    `Evidence frames: first #${session.evidence.first_frame}, last #${session.evidence.last_frame}.`,
    timeline.length ? `Timeline (first ${timeline.length} events):\n${preview}` : `Timeline: no decoded events for this session.`,
  ]
    .filter(Boolean)
    .join('\n');

  return { session_id: sessionId, text, evidence_frames: evidenceFrames };
}
