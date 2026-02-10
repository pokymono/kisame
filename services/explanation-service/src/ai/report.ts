import { ToolLoopAgent } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { AnalysisArtifact } from '../types';

const REPORT_SYSTEM_PROMPT = [
  'You are a senior incident responder writing a forensics report for a technical audience.',
  'Use only the provided analysis artifact. Do not invent evidence.',
  'Cite evidence frames when referencing specific events (use format: #<frame>).',
  'Structure the report with clear sections and concise bullet points.',
  'If data is missing, state it explicitly.',
].join(' ');

export async function generateForensicReport(
  artifact: AnalysisArtifact
): Promise<string> {
  const modelName = process.env.OPENAI_REPORT_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.2-codex';
  const reasoningSummary = process.env.KISAME_REASONING_SUMMARY ?? 'detailed';
  const reasoningEffort = process.env.KISAME_REASONING_EFFORT ?? 'high';
  const serviceTier = process.env.KISAME_SERVICE_TIER === 'flex' ? 'flex' : undefined;

  const agent = new ToolLoopAgent({
    id: 'kisame-report-agent',
    model: openai(modelName),
    instructions: REPORT_SYSTEM_PROMPT,
    tools: {},
    providerOptions: {
      openai: {
        ...(serviceTier ? { serviceTier } : {}),
        ...(reasoningSummary ? { reasoningSummary } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
    },
  });

  const prompt = [
    '# Report Request',
    'Generate a Markdown report with these sections:',
    '1) Executive Summary',
    '2) Capture Overview (file, time range, packets, sessions)',
    '3) Key Findings (bullets with evidence frames)',
    '4) Session Summary (top 10 by bytes, include endpoints)',
    '5) Timeline Highlights (top 15 events, include evidence frames)',
    '6) Indicators (IPs, DNS, SNI, HTTP hosts)',
    '7) Notes / Limitations',
    '',
    '## Analysis Artifact (JSON)',
    JSON.stringify(artifact),
  ].join('\n');

  const result = await agent.generate({ prompt });

  return result.text;
}
