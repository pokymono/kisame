import './index.css';
import { createAppShell } from './ui/app-shell';
import { el } from './ui/dom';
import { ChatManager } from './ui/chat';
import type { AnalysisArtifact, ChatMessage, ToolCallLog } from './types';

function initApp() {
  const root = document.getElementById('root');
  if (!root) return;

  const ui = createAppShell(root);

  let analysis: AnalysisArtifact | null = null;
  let selectedSessionId: string | null = null;
  let liveCaptureId: string | null = null;
  let liveCaptureInterface: string | null = null;

  const explanationBaseUrl =
    ((import.meta as any).env?.VITE_EXPLANATION_URL as string | undefined) ??
    'http://localhost:8787';
  const explanationCache = new Map<string, string>();
  let explanationRequestSeq = 0;

  const chatManager = new ChatManager({
    container: ui.chatMessages,
    emptyState: ui.chatEmptyState,
    scrollThreshold: 80,
  });

  const formatTimestamp = (ts?: number | null) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toISOString().replace('T', ' ').replace('Z', 'Z');
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  function setWelcomeVisible(visible: boolean) {
    ui.welcomePanel.classList.toggle('hidden', !visible);
  }

  function setAnalysisDetail(text: string) {
    ui.analysisDetail.replaceChildren(
      el('pre', {
        className: 'whitespace-pre-wrap text-xs text-white/60 leading-relaxed',
        text,
      })
    );
  }

  async function updateExplanationFromService(sessionId: string) {
    if (!analysis) return;
    if (explanationCache.has(sessionId)) {
      setAnalysisDetail(explanationCache.get(sessionId)!);
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
      setAnalysisDetail(data.text);
    } catch {
      setAnalysisDetail('Explanation service unavailable.');
    }
  }

  function renderEmptyState() {
    ui.captureBadge.textContent = 'No capture loaded';
    ui.sessionIdLabel.textContent = 'Session: —';
    ui.selectedEvidenceLabel.textContent = 'Selected: —';
    ui.sessionsList.replaceChildren();
    ui.timelineList.replaceChildren();
    ui.analysisSummary.replaceChildren();
    setAnalysisDetail('');
    ui.evidenceList.replaceChildren();
    setWelcomeVisible(true);
  }

  async function startLiveCapture() {
    if (liveCaptureId) return;
    ui.liveCaptureButton.disabled = true;
    ui.openPcapButton.disabled = true;
    ui.liveCaptureButton.textContent = 'Starting…';

    try {
      const preferredInterface =
        ((import.meta as any).env?.VITE_CAPTURE_INTERFACE as string | undefined) ?? undefined;
      const res = await fetch(`${explanationBaseUrl}/capture/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          interface: preferredInterface,
        }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Live capture failed (${res.status}). ${msg}`);
      }
      const data = (await res.json()) as {
        capture_id: string;
        interface?: { id?: string; name?: string };
        file_name?: string;
      };
      liveCaptureId = data.capture_id;
      liveCaptureInterface = data.interface?.name ?? data.interface?.id ?? 'interface';
      ui.captureBadge.textContent = `Live: ${liveCaptureInterface}`;
      ui.liveCaptureButton.textContent = 'Stop Capture';
    } catch (err) {
      ui.liveCaptureButton.textContent = 'Live Capture';
      ui.openPcapButton.disabled = false;
      ui.liveCaptureButton.disabled = false;
      alert((err as Error).message ?? String(err));
      return;
    }

    ui.liveCaptureButton.disabled = false;
  }

  async function stopLiveCapture() {
    if (!liveCaptureId) return;
    const captureId = liveCaptureId;
    let stoppedOk = false;
    ui.liveCaptureButton.disabled = true;
    ui.liveCaptureButton.textContent = 'Stopping…';

    try {
      const stopRes = await fetch(`${explanationBaseUrl}/capture/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capture_id: captureId }),
      });
      if (!stopRes.ok) {
        const msg = await stopRes.text().catch(() => '');
        throw new Error(`Stop capture failed (${stopRes.status}). ${msg}`);
      }
      const stopData = (await stopRes.json()) as {
        session_id: string;
        file_name: string;
      };

      const analyzeRes = await fetch(`${explanationBaseUrl}/tools/analyzePcap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: stopData.session_id }),
      });
      if (!analyzeRes.ok) {
        const msg = await analyzeRes.text().catch(() => '');
        throw new Error(`Analyze failed (${analyzeRes.status}). ${msg}`);
      }
      analysis = (await analyzeRes.json()) as AnalysisArtifact;
      selectedSessionId = null;
      stoppedOk = true;
      render();
    } catch (err) {
      ui.captureBadge.textContent = liveCaptureInterface
        ? `Live: ${liveCaptureInterface}`
        : 'Live capture';
      alert((err as Error).message ?? String(err));
      liveCaptureId = null;
      liveCaptureInterface = null;
    } finally {
      ui.liveCaptureButton.textContent = 'Live Capture';
      ui.liveCaptureButton.disabled = false;
      ui.openPcapButton.disabled = false;
      if (stoppedOk) {
        liveCaptureId = null;
        liveCaptureInterface = null;
      }
    }
  }

  function renderSessions(sessions: AnalysisArtifact['sessions']) {
    ui.sessionsList.replaceChildren(
      ...sessions.map((session, index) => {
        const selected = session.id === selectedSessionId;
        const item = el('button', {
          className:
            'w-full rounded px-3 py-3 text-left transition-all data-card ' +
            (selected
              ? 'selected'
              : ''),
          attrs: { 'data-session-id': session.id, type: 'button', style: `animation-delay: ${index * 0.05}s` },
        });
        item.classList.add('animate-slide-in');

        // Protocol badge
        const header = el('div', { className: 'flex items-center justify-between' });
        const transport = el('div', {
          className:
            'px-2 py-0.5 rounded text-[9px] font-[var(--font-mono)] font-semibold tracking-[0.15em] uppercase border ' +
            (session.transport === 'tcp'
              ? 'badge-tcp'
              : session.transport === 'udp'
                ? 'badge-udp'
                : 'text-white/40 border-white/20 bg-white/5'),
          text: session.transport.toUpperCase(),
        });
        const time = el('div', {
          className: 'text-[10px] font-[var(--font-mono)] text-white/40',
          text: formatTimestamp(session.first_ts).slice(11, 19),
        });
        header.append(transport, time);

        // Endpoints with cyber styling
        const a = `${session.endpoints.a.ip}${session.endpoints.a.port ? `:${session.endpoints.a.port}` : ''}`;
        const b = `${session.endpoints.b.ip}${session.endpoints.b.port ? `:${session.endpoints.b.port}` : ''}`;
        const endpoints = el('div', {
          className: 'mt-2.5 flex items-center gap-2 text-[11px] font-[var(--font-mono)] text-white/80 overflow-hidden',
        });
        const endpointA = el('span', { text: a, className: 'truncate min-w-0' });
        const arrow = el('span', { className: 'text-[var(--accent-cyan)]/50 flex-shrink-0', text: '⟷' });
        const endpointB = el('span', { text: b, className: 'truncate min-w-0' });
        endpoints.append(endpointA, arrow, endpointB);

        // Stats row
        const meta = el('div', { className: 'mt-2 flex flex-wrap gap-3 text-[10px] font-[var(--font-mono)]' });
        meta.append(
          el('span', { className: 'text-white/40', text: `${session.packet_count} PKT` }),
          el('span', { className: 'text-white/40', text: formatBytes(session.byte_count) })
        );
        if (session.rule_flags && session.rule_flags.length) {
          const flagBadge = el('span', {
            className: 'px-1.5 py-0.5 rounded badge-alert text-[9px] font-semibold',
            text: session.rule_flags.slice(0, 2).join(', '),
          });
          meta.append(flagBadge);
        }

        item.append(header, endpoints, meta);
        return item;
      })
    );
  }

  function renderTimeline(timeline: AnalysisArtifact['timeline']) {
    if (!timeline.length) {
      ui.timelineList.replaceChildren(
        el('div', {
          className: 'flex flex-col items-center justify-center py-8 text-center',
          children: [
            el('div', { className: 'data-label mb-1', text: 'NO EVENTS' }),
            el('div', { className: 'text-[10px] text-white/30', text: 'No decoded events for this session' }),
          ],
        })
      );
      return;
    }

    ui.timelineList.replaceChildren(
      ...timeline.slice(0, 200).map((event, index) => {
        const row = el('div', { 
          className: 'group relative pl-4 pb-3 border-l border-[var(--app-line)] hover:border-[var(--accent-cyan)]/30 transition-colors animate-slide-in',
          attrs: { style: `animation-delay: ${index * 0.03}s` },
        });
        
        // Timeline dot
        const dot = el('div', {
          className: 'absolute left-0 top-0 -translate-x-1/2 size-2 rounded-full bg-[var(--app-surface)] border-2 border-[var(--accent-cyan)]/50 group-hover:border-[var(--accent-cyan)] group-hover:bg-[var(--accent-cyan)]/20 transition-colors',
        });
        
        // Timestamp
        const timestamp = el('div', {
          className: 'text-[9px] font-[var(--font-mono)] tracking-wider text-[var(--accent-cyan)]/60 mb-1',
          text: formatTimestamp(event.ts),
        });
        
        // Event summary
        const summary = el('div', { 
          className: 'text-sm text-white/80 leading-relaxed group-hover:text-white/95 transition-colors break-words overflow-hidden', 
          text: event.summary 
        });
        
        // Evidence reference
        const evidence = el('div', {
          className: 'mt-1 text-[9px] font-[var(--font-mono)] tracking-wider text-white/30',
          text: `FRAME #${event.evidence_frame}`,
        });
        
        row.append(dot, timestamp, summary, evidence);
        return row;
      })
    );
  }

  function renderEvidence(selectedSession: AnalysisArtifact['sessions'][number]) {
    const evidenceFrames = [
      selectedSession.evidence.first_frame,
      ...selectedSession.evidence.sample_frames,
      selectedSession.evidence.last_frame,
    ].filter((frame, index, arr) => arr.indexOf(frame) === index);

    ui.selectedEvidenceLabel.textContent = `FRAMES #${selectedSession.evidence.first_frame}–#${selectedSession.evidence.last_frame}`;

    if (!evidenceFrames.length) {
      ui.evidenceList.replaceChildren(
        el('div', {
          className: 'flex flex-col items-center justify-center py-6 text-center',
          children: [
            el('div', { className: 'data-label mb-1', text: 'NO FRAMES' }),
            el('div', { className: 'text-[10px] text-white/30', text: 'No evidence frames available' }),
          ],
        })
      );
      return;
    }

    const grid = el('div', { className: 'grid grid-cols-[100px_1fr] gap-x-4 gap-y-2' });
    for (const frame of evidenceFrames.slice(0, 200)) {
      grid.append(
        el('div', { 
          className: 'font-[var(--font-mono)] text-[11px] text-[var(--accent-amber)] tabular-nums', 
          text: `#${frame}` 
        }),
        el('div', { 
          className: 'text-[11px] text-white/40 font-[var(--font-mono)]', 
          text: 'Evidence reference' 
        })
      );
    }
    ui.evidenceList.replaceChildren(grid);
  }

  function renderAnalysisSummary(selectedSession: AnalysisArtifact['sessions'][number]) {
    const a = `${selectedSession.endpoints.a.ip}${selectedSession.endpoints.a.port ? `:${selectedSession.endpoints.a.port}` : ''}`;
    const b = `${selectedSession.endpoints.b.ip}${selectedSession.endpoints.b.port ? `:${selectedSession.endpoints.b.port}` : ''}`;

    ui.analysisSummary.replaceChildren(
      el('div', {
        className: 'space-y-3',
        children: [
          el('div', {
            className: 'text-sm text-white/85 leading-relaxed',
            children: [
              el('span', { className: 'text-[var(--accent-cyan)]', text: 'Session ' }),
              el('span', { className: 'font-[var(--font-mono)] text-white/60', text: selectedSession.id }),
              el('span', { text: ' observed between ' }),
              el('span', { className: 'font-[var(--font-mono)] text-[var(--accent-teal)]', text: a }),
              el('span', { text: ' and ' }),
              el('span', { className: 'font-[var(--font-mono)] text-[var(--accent-teal)]', text: b }),
            ],
          }),
          el('div', {
            className: 'flex flex-wrap gap-3 text-[10px] font-[var(--font-mono)] text-white/50',
            children: [
              el('span', { 
                className: 'px-2 py-0.5 rounded bg-white/5 border border-white/10',
                text: selectedSession.transport.toUpperCase() 
              }),
              el('span', { text: `${selectedSession.packet_count} packets` }),
              el('span', { text: formatBytes(selectedSession.byte_count) }),
            ],
          }),
          el('div', {
            className: 'text-[10px] font-[var(--font-mono)] text-white/40 tracking-wide',
            text: `${formatTimestamp(selectedSession.first_ts)} → ${formatTimestamp(selectedSession.last_ts)}`,
          }),
        ],
      })
    );
  }

  function render() {
    if (!analysis || !analysis.sessions.length) {
      renderEmptyState();
      return;
    }

    setWelcomeVisible(false);

    ui.captureBadge.textContent = analysis.pcap?.file_name
      ? `${analysis.pcap.file_name} (${analysis.pcap.packets_analyzed ?? 0} pkts)`
      : 'Capture loaded';

    const sessions = analysis.sessions;
    if (!selectedSessionId && sessions.length > 0) selectedSessionId = sessions[0].id;

    renderSessions(sessions);

    const selected = sessions.find((s) => s.id === selectedSessionId) ?? sessions[0];
    ui.sessionIdLabel.textContent = `Session: ${selected.id}`;

    const timeline = (analysis.timeline ?? []).filter((entry) => entry.session_id === selected.id);
    renderTimeline(timeline);
    renderEvidence(selected);
    renderAnalysisSummary(selected);
    setAnalysisDetail('Fetching explanation…');
    void updateExplanationFromService(selected.id);
  }

  ui.sessionsList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest('[data-session-id]') as HTMLElement | null;
    const id = row?.getAttribute('data-session-id');
    if (!id) return;
    selectedSessionId = id;
    render();
  });

  ui.openPcapButton.addEventListener('click', async () => {
    if (!window.electronAPI?.openPcapAndAnalyze) return;
    ui.openPcapButton.disabled = true;
    ui.openPcapButton.textContent = '◈ ANALYZING…';
    ui.openPcapButton.classList.add('opacity-60');
    try {
      const result = await window.electronAPI.openPcapAndAnalyze();
      if (result.canceled) return;
      analysis = result.analysis as AnalysisArtifact;
      selectedSessionId = null;
      render();
    } catch (err) {
      console.error(err);
      alert((err as Error).message ?? String(err));
    } finally {
      ui.openPcapButton.disabled = false;
      ui.openPcapButton.textContent = '◈ OPEN PCAP';
      ui.openPcapButton.classList.remove('opacity-60');
    }
  });

  ui.liveCaptureButton.addEventListener('click', async () => {
    if (liveCaptureId) {
      await stopLiveCapture();
      return;
    }
    await startLiveCapture();
  });

  async function sendChatQuery() {
    const query = ui.chatInput.value.trim();
    if (!query) return;

    // Add user message
    const userMessage: ChatMessage = { role: 'user', text: query };
    chatManager.addMessage(userMessage);
    
    // Clear input and force scroll to bottom
    ui.chatInput.value = '';
    chatManager.forceScrollToBottom();

    // Create AI message placeholder
    const aiMessage: ChatMessage = { 
      role: 'ai', 
      text: '', 
      status: 'Initializing…', 
      isStreaming: true, 
      toolCalls: [] 
    };
    chatManager.addMessage(aiMessage);

    const context =
      selectedSessionId && analysis ? { session_id: selectedSessionId, artifact: analysis } : undefined;

    try {
      const response = await fetch(`${explanationBaseUrl}/chat/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, context }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Chat stream failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleEvent = (eventName: string, data: any) => {
        if (eventName === 'status') {
          aiMessage.status = data.message ?? data.stage;
        } else if (eventName === 'text') {
          aiMessage.text += data.delta ?? '';
          if (aiMessage.status && aiMessage.status.toLowerCase().includes('starting')) {
            aiMessage.status = undefined;
          }
        } else if (eventName === 'tool_call') {
          const toolCall: ToolCallLog = {
            id: data.toolCallId ?? crypto.randomUUID(),
            name: data.toolName ?? 'unknown',
            input: data.input,
            status: 'running',
          };
          aiMessage.toolCalls = aiMessage.toolCalls ?? [];
          aiMessage.toolCalls.push(toolCall);
          aiMessage.status = undefined;
        } else if (eventName === 'tool_result') {
          const existing = aiMessage.toolCalls?.find(
            (t) => t.id === data.toolCallId || t.name === data.toolName
          );
          if (existing) {
            existing.output = data.output;
            existing.status = 'done';
          }
        } else if (eventName === 'tool_summary') {
          aiMessage.toolSummary = data.summary ?? '';
        } else if (eventName === 'done') {
          aiMessage.status = undefined;
          aiMessage.isStreaming = false;
          // Mark any pending tools as done
          for (const t of aiMessage.toolCalls ?? []) {
            if (t.status === 'running' || t.status === 'pending') {
              t.status = 'done';
            }
          }
        } else if (eventName === 'error') {
          aiMessage.status = undefined;
          aiMessage.isStreaming = false;
          aiMessage.text += `\n\nError: ${data.message ?? 'Unknown error'}`;
        }
        chatManager.updateMessage(aiMessage);
      };

      const parseChunk = (chunk: string) => {
        const lines = chunk.split(/\r?\n/);
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const line of lines) {
          if (!line || line.startsWith(':')) continue;
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (dataLines.length === 0) return;
        const dataText = dataLines.join('\n');
        try {
          const data = JSON.parse(dataText);
          handleEvent(eventName, data);
        } catch {
          handleEvent(eventName, { delta: dataText });
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (part.trim()) parseChunk(part);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) parseChunk(buffer);

      if (aiMessage.isStreaming) {
        aiMessage.isStreaming = false;
        aiMessage.status = undefined;
        chatManager.updateMessage(aiMessage);
      }
    } catch (err) {
      aiMessage.status = 'Error';
      aiMessage.isStreaming = false;
      aiMessage.text = `Error: ${(err as Error).message ?? String(err)}`;
      chatManager.updateMessage(aiMessage);
    }
  }

  ui.chatSendBtn.addEventListener('click', sendChatQuery);
  ui.chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendChatQuery();
    }
  });

  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
