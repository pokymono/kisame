import { corsHeaders, json } from '../utils/response';
import { generateForensicReport } from '../ai/report';
import type { AnalysisArtifact } from '../types';

export async function handleReport(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { artifact?: AnalysisArtifact } | null;

  if (!body?.artifact) {
    return json({ error: 'Expected JSON body: { artifact }' }, { status: 400 });
  }

  const report_markdown = await generateForensicReport(body.artifact);
  return json({ report_markdown }, { headers: corsHeaders() });
}
