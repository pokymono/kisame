import './index.css';

// Initialize the app
function initApp() {
  const root = document.getElementById('root');
  if (!root) return;

  // Kisame UI Layout based on SYSTEM_CONTEXT.md
  // ---------------------------------------------------------
  // | Top Bar                                                |
  // |--------------------------------------------------------|
  // | Session List | Timeline / Details | Explanation + Chat |
  // |              |                    |                    |
  // |--------------------------------------------------------|
  // | Evidence / Packet References                           |
  // ---------------------------------------------------------

	  root.innerHTML = `
    <div class="h-screen flex flex-col bg-neutral-900 text-gray-200 font-sans overflow-hidden">
      
      <!-- 1. Top Bar -->
      <header class="h-14 border-b border-neutral-800 flex items-center justify-between px-4 bg-neutral-900 shrink-0">
        <div class="flex items-center gap-4">
          <h1 class="font-bold text-lg tracking-tight text-white">Kisame</h1>
          <span id="captureBadge" class="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">No Capture Loaded</span>
        </div>
        <div class="flex items-center gap-2">
           <button id="openPcapBtn" class="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">Open PCAP</button>
           <button class="p-1.5 hover:bg-neutral-800 rounded text-neutral-400">
             <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
           </button>
        </div>
      </header>

      <!-- Main Workspace Area -->
      <main class="flex-1 flex overflow-hidden">
        
        <!-- 2. Session List (Left Panel) -->
        <aside class="w-64 border-r border-neutral-800 flex flex-col bg-neutral-900/50">
          <div class="h-8 border-b border-neutral-800 flex items-center px-3 bg-neutral-900/80">
            <span class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Sessions</span>
          </div>
          <div id="sessionsList" class="flex-1 overflow-y-auto p-2 space-y-1">
            <div class="p-3 rounded border border-dashed border-neutral-800 text-sm text-neutral-500">
              Open a PCAP to view sessions.
            </div>
          </div>
        </aside>

        <!-- 3. Timeline & Details (Center Panel) -->
        <section class="flex-1 border-r border-neutral-800 flex flex-col min-w-0 bg-neutral-900">
           <div class="h-8 border-b border-neutral-800 flex items-center px-3 bg-neutral-900/80 justify-between">
            <span class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Timeline</span>
	            <span id="sessionIdLabel" class="text-[10px] text-neutral-500">Session ID: —</span>
          </div>
          <div id="timelineList" class="flex-1 overflow-y-auto p-4">
            <div class="text-sm text-neutral-500">Select a session to view fact-only timeline events.</div>
          </div>
        </section>

        <!-- 4. Explanation + Chat (Right Panel) -->
        <aside class="w-96 flex flex-col bg-neutral-900">
           <!-- Explanation Context -->
           <div class="flex-1 overflow-y-auto border-b border-neutral-800 p-4">
              <div class="h-6 flex items-center mb-2">
                 <span class="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1">
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                   Analysis
                 </span>
              </div>
              <div id="analysisText" class="text-sm text-neutral-300 leading-relaxed">
                Open a PCAP and select a session to see an evidence-anchored explanation.
              </div>
           </div>
           
           <!-- Chat Interface -->
           <div class="h-1/2 flex flex-col bg-neutral-900">
              <div class="h-8 border-b border-neutral-800 flex items-center px-3 bg-neutral-900/80">
                <span class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Chat</span>
              </div>
              <div class="flex-1 p-3 space-y-4 overflow-y-auto">
                 <div class="flex gap-3">
                    <div class="w-6 h-6 rounded bg-purple-600 flex items-center justify-center text-[10px] shrink-0">AI</div>
                    <div class="text-sm text-gray-300">How can I help you understand this session?</div>
                 </div>
              </div>
              <div class="p-3 border-t border-neutral-800">
                 <div class="bg-neutral-800 rounded p-2 flex gap-2 border border-neutral-700 focus-within:border-neutral-500 transition-colors">
                    <input type="text" placeholder="Ask about this traffic..." class="bg-transparent border-none outline-none text-sm text-white w-full placeholder-neutral-500"/>
                    <button class="text-neutral-400 hover:text-white">
                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                 </div>
              </div>
           </div>
        </aside>

      </main>

      <!-- 5. Evidence Panel (Bottom) -->
      <footer class="h-48 border-t border-neutral-800 bg-neutral-950 flex flex-col shrink-0">
          <div class="h-8 border-b border-neutral-800 flex items-center px-3 bg-neutral-900/50 justify-between">
            <span class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Packet Evidence</span>
            <div class="flex gap-2 text-[10px] text-neutral-500 font-mono">
	               <span id="selectedEvidenceLabel">Selected: —</span>
	               <span class="opacity-50">Evidence only</span>
            </div>
          </div>
          <div id="evidenceList" class="flex-1 overflow-auto font-mono text-xs p-2 text-neutral-400">
            <div class="text-neutral-600">Evidence frames will appear here.</div>
          </div>
      </footer>

	    </div>
	  `;

	  type AnalysisArtifact = {
	    pcap?: {
	      file_name?: string;
	      packets_analyzed?: number;
	      first_ts?: number;
	      last_ts?: number;
	    };
	    sessions?: Array<{
	      id: string;
	      transport: string;
	      endpoints: { a: { ip: string; port: number | null }; b: { ip: string; port: number | null } };
	      first_ts: number;
	      last_ts: number;
	      packet_count: number;
	      byte_count: number;
	      duration_seconds?: number;
	      evidence: { first_frame: number; last_frame: number; sample_frames: number[] };
	      rule_flags?: string[];
	    }>;
	    timeline?: Array<{ ts: number; session_id: string; kind: string; summary: string; evidence_frame: number }>;
	  };

	  const openBtn = document.getElementById('openPcapBtn') as HTMLButtonElement | null;
	  const captureBadge = document.getElementById('captureBadge');
	  const sessionIdLabel = document.getElementById('sessionIdLabel');
	  const selectedEvidenceLabel = document.getElementById('selectedEvidenceLabel');
	  const sessionsList = document.getElementById('sessionsList');
	  const timelineList = document.getElementById('timelineList');
	  const analysisText = document.getElementById('analysisText');
	  const evidenceList = document.getElementById('evidenceList');

	  let analysis: AnalysisArtifact | null = null;
	  let selectedSessionId: string | null = null;

	  function fmtTs(ts: number | undefined) {
	    if (!ts) return '';
	    return new Date(ts * 1000).toISOString().replace('T', ' ').replace('Z', 'Z');
	  }

	  function fmtBytes(bytes: number) {
	    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	    return `${bytes} B`;
	  }

	  const explanationBaseUrl =
	    ((import.meta as any).env?.VITE_EXPLANATION_URL as string | undefined) ??
	    'http://localhost:8787';
	  const explanationCache = new Map<string, string>();
	  let explanationRequestSeq = 0;

	  function escapeHtml(text: string) {
	    return text
	      .replaceAll('&', '&amp;')
	      .replaceAll('<', '&lt;')
	      .replaceAll('>', '&gt;')
	      .replaceAll('"', '&quot;')
	      .replaceAll("'", '&#039;');
	  }

	  async function updateExplanationFromService(sessionId: string) {
	    if (!analysisText || !analysis) return;
	    if (explanationCache.has(sessionId)) {
	      analysisText.innerHTML = `<pre class="whitespace-pre-wrap text-xs text-neutral-300 leading-relaxed">${escapeHtml(
	        explanationCache.get(sessionId)!
	      )}</pre>`;
	      return;
	    }

	    const requestId = ++explanationRequestSeq;
	    try {
	      const res = await fetch(`${explanationBaseUrl}/explain/session`, {
	        method: 'POST',
	        headers: { 'content-type': 'application/json' },
	        body: JSON.stringify({ artifact: analysis, session_id: sessionId }),
	      });
	      if (!res.ok) return;
	      const data = (await res.json()) as { text?: string };
	      if (!data.text) return;
	      explanationCache.set(sessionId, data.text);
	      if (requestId !== explanationRequestSeq) return;
	      analysisText.innerHTML = `<pre class="whitespace-pre-wrap text-xs text-neutral-300 leading-relaxed">${escapeHtml(
	        data.text
	      )}</pre>`;
	    } catch {
	      // Service is optional in early dev; keep local fallback.
	    }
	  }

	  function render() {
	    if (!captureBadge || !sessionsList || !timelineList || !analysisText || !evidenceList) return;

	    if (!analysis || !analysis.sessions) {
	      captureBadge.textContent = 'No Capture Loaded';
	      if (sessionIdLabel) sessionIdLabel.textContent = 'Session ID: —';
	      if (selectedEvidenceLabel) selectedEvidenceLabel.textContent = 'Selected: —';
	      sessionsList.innerHTML =
	        '<div class="p-3 rounded border border-dashed border-neutral-800 text-sm text-neutral-500">Open a PCAP to view sessions.</div>';
	      timelineList.innerHTML =
	        '<div class="text-sm text-neutral-500">Select a session to view fact-only timeline events.</div>';
	      analysisText.textContent =
	        'Open a PCAP and select a session to see an evidence-anchored explanation.';
	      evidenceList.innerHTML = '<div class="text-neutral-600">Evidence frames will appear here.</div>';
	      return;
	    }

	    captureBadge.textContent =
	      analysis.pcap?.file_name
	        ? `${analysis.pcap.file_name} (${analysis.pcap.packets_analyzed ?? 0} pkts)`
	        : 'Capture Loaded';

	    const sessions = analysis.sessions;
	    if (!selectedSessionId && sessions.length > 0) selectedSessionId = sessions[0].id;

	    sessionsList.innerHTML = sessions
	      .map((s) => {
	        const selected = s.id === selectedSessionId;
	        const a = `${s.endpoints.a.ip}${s.endpoints.a.port ? `:${s.endpoints.a.port}` : ''}`;
	        const b = `${s.endpoints.b.ip}${s.endpoints.b.port ? `:${s.endpoints.b.port}` : ''}`;
	        const flags = (s.rule_flags ?? []).slice(0, 2).join(', ');
	        return `
	          <div data-session-id="${s.id}" class="p-3 rounded border ${
	            selected ? 'border-blue-500/40 bg-blue-900/10' : 'border-transparent hover:bg-neutral-800'
	          } cursor-pointer transition-colors">
	            <div class="flex justify-between items-center mb-1">
	              <span class="text-xs font-mono ${
	                s.transport === 'tcp'
	                  ? 'text-emerald-400'
	                  : s.transport === 'udp'
	                    ? 'text-blue-400'
	                    : 'text-neutral-400'
	              }">${s.transport.toUpperCase()}</span>
	              <span class="text-[10px] text-neutral-500">${fmtTs(s.first_ts).slice(11, 19)}</span>
	            </div>
	            <div class="text-sm font-medium ${selected ? 'text-gray-200' : 'text-gray-400'}">${a} <span class="text-neutral-600">↔</span> ${b}</div>
	            <div class="mt-1 text-[10px] text-neutral-500 flex gap-2">
	              <span>${s.packet_count} pkts</span>
	              <span>${fmtBytes(s.byte_count)}</span>
	              ${flags ? `<span class="text-amber-300">${flags}</span>` : ''}
	            </div>
	          </div>
	        `;
	      })
	      .join('');

	    const selected = sessions.find((s) => s.id === selectedSessionId) ?? sessions[0];
	    if (sessionIdLabel) sessionIdLabel.textContent = `Session ID: ${selected.id}`;

	    const timeline = (analysis.timeline ?? []).filter((e) => e.session_id === selected.id);
	    timelineList.innerHTML =
	      timeline.length === 0
	        ? '<div class="text-sm text-neutral-500">No decoded events for this session (yet).</div>'
	        : `<div class="flex flex-col gap-2">
	            ${timeline
	              .slice(0, 200)
	              .map(
	                (e) => `
	                  <div class="flex items-start justify-between gap-4 border-b border-neutral-800/50 pb-2">
	                    <div class="min-w-0">
	                      <div class="text-[10px] text-neutral-500 font-mono">${fmtTs(e.ts)}</div>
	                      <div class="text-sm text-gray-300 truncate">${e.summary}</div>
	                    </div>
	                    <div class="text-[10px] text-neutral-500 font-mono shrink-0">#${e.evidence_frame}</div>
	                  </div>
	                `
	              )
	              .join('')}
	          </div>`;

	    const evidenceFrames = [
	      selected.evidence.first_frame,
	      ...selected.evidence.sample_frames,
	      selected.evidence.last_frame,
	    ].filter((n, i, arr) => arr.indexOf(n) === i);

	    if (selectedEvidenceLabel) {
	      selectedEvidenceLabel.textContent = `Selected: frames #${selected.evidence.first_frame}…#${selected.evidence.last_frame}`;
	    }

	    analysisText.innerHTML = `
	      <div class="space-y-2">
	        <div class="text-sm text-neutral-200">
	          Session <span class="font-mono text-neutral-300">${selected.id}</span> observed between
	          <span class="font-mono text-neutral-300">${selected.endpoints.a.ip}${selected.endpoints.a.port ? `:${selected.endpoints.a.port}` : ''}</span>
	          and
	          <span class="font-mono text-neutral-300">${selected.endpoints.b.ip}${selected.endpoints.b.port ? `:${selected.endpoints.b.port}` : ''}</span>.
	        </div>
	        <div class="text-xs text-neutral-400">
	          ${selected.transport.toUpperCase()} • ${selected.packet_count} packets • ${fmtBytes(selected.byte_count)} • ${fmtTs(selected.first_ts)} → ${fmtTs(selected.last_ts)}
	        </div>
	        <div class="text-xs text-neutral-400">
	          Evidence frames: first <span class="font-mono">#${selected.evidence.first_frame}</span>, last <span class="font-mono">#${selected.evidence.last_frame}</span>.
	        </div>
	      </div>
	    `;
	    void updateExplanationFromService(selected.id);

	    evidenceList.innerHTML =
	      evidenceFrames.length === 0
	        ? '<div class="text-neutral-600">No evidence frames.</div>'
	        : `<div class="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1">
	            ${evidenceFrames
	              .slice(0, 200)
	              .map(
	                (n) =>
	                  `<div class="text-neutral-500 font-mono">#${n}</div><div class="text-neutral-600">Evidence reference</div>`
	              )
	              .join('')}
	          </div>`;
	  }

	  sessionsList?.addEventListener('click', (ev) => {
	    const el = (ev.target as HTMLElement | null)?.closest?.('[data-session-id]') as
	      | HTMLElement
	      | null;
	    const id = el?.getAttribute?.('data-session-id');
	    if (!id) return;
	    selectedSessionId = id;
	    render();
	  });

	  openBtn?.addEventListener('click', async () => {
	    if (!window.electronAPI?.openPcapAndAnalyze) return;
	    openBtn.disabled = true;
	    openBtn.textContent = 'Analyzing…';
	    try {
	      const result = await window.electronAPI.openPcapAndAnalyze();
	      if (result.canceled) return;
	      analysis = result.analysis as AnalysisArtifact;
	      selectedSessionId = null;
	      render();
	    } catch (e) {
	      console.error(e);
	      alert((e as Error).message ?? String(e));
	    } finally {
	      openBtn.disabled = false;
	      openBtn.textContent = 'Open PCAP';
	    }
	  });

	  render();
	}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
