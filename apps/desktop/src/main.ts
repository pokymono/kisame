import './index.css';
import { createAppShell } from './ui/app-shell';
import { el } from './ui/dom';
import { ChatManager } from './ui/chat';
import type { AnalysisArtifact, ChatMessage, ToolCallLog } from './types';

async function initApp() {
  const root = document.getElementById('root');
  if (!root) return;

  const ui = createAppShell(root);

  let analysis: AnalysisArtifact | null = null;
  let selectedSessionId: string | null = null;
  let liveCaptureId: string | null = null;
  let liveCaptureInterface: string | null = null;
  let lastAnalysisRef: AnalysisArtifact | null = null;
  let captureSessionId: string | null = null;
  type TimelineScope = 'session' | 'all';
  let timelineScope: TimelineScope = 'session';
  let timelineSearchQuery = '';
  let timelineKindFilter = 'all';
  type AnalyzeScreen = 'overview' | 'sessions' | 'timeline' | 'evidence' | 'insights';
  let analyzeScreen: AnalyzeScreen = 'overview';
  const analysisCache = new Map<string, AnalysisArtifact>();

  type AppTab = 'capture' | 'analyze' | 'export';
  let activeTab: AppTab = 'analyze';

  const tabButtonBase =
    'px-3 py-1 text-[10px] font-[var(--font-display)] tracking-[0.2em] transition-all rounded';
  const tabActiveClass =
    `${tabButtonBase} text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 border border-[var(--accent-cyan)]/30`;
  const tabInactiveClass = `${tabButtonBase} text-white/50 hover:text-white/80`;

  function setTabButtonState(button: HTMLButtonElement, isActive: boolean) {
    button.className = isActive ? tabActiveClass : tabInactiveClass;
  }

  function setActiveTab(tab: AppTab) {
    activeTab = tab;
    setTabButtonState(ui.navCaptureButton, tab === 'capture');
    setTabButtonState(ui.navAnalyzeButton, tab === 'analyze');
    setTabButtonState(ui.navExportButton, tab === 'export');

    const showAnalysis = tab === 'analyze';
    ui.analysisMain.classList.toggle('hidden', !showAnalysis);
    ui.chatColumn.classList.toggle('hidden', !showAnalysis);
    ui.capturePanel.classList.toggle('hidden', tab !== 'capture');
    ui.exportPanel.classList.toggle('hidden', tab !== 'export');
  }

  const screenBtnBase =
    'px-2.5 py-1 text-[9px] font-[var(--font-display)] tracking-[0.22em] uppercase rounded transition-all';
  const screenBtnActive =
    `${screenBtnBase} text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 border border-[var(--accent-cyan)]/30`;
  const screenBtnInactive = `${screenBtnBase} text-white/40 hover:text-white/70 border border-transparent`;

  function setAnalyzeScreenButtonState(button: HTMLButtonElement, isActive: boolean) {
    button.className = isActive ? screenBtnActive : screenBtnInactive;
  }

  function mountAnalyzeScreen(screen: AnalyzeScreen) {
    if (screen === 'overview') {
      ui.overviewTopLayout.replaceChildren(ui.sessionsPanel, ui.timelinePanel, ui.sessionsSplitHandle);
      ui.overviewLayout.replaceChildren(ui.overviewTopLayout, ui.evidencePanel, ui.overviewEvidenceHandle);
      ui.analyzeScreenHost.replaceChildren(ui.overviewLayout, ui.welcomePanel);
      return;
    }

    if (screen === 'sessions') {
      ui.sessionsLayout.replaceChildren(ui.sessionsPanel, ui.sessionKeyPanel, ui.sessionsSplitHandle);
      ui.analyzeScreenHost.replaceChildren(ui.sessionsLayout, ui.welcomePanel);
      return;
    }

    if (screen === 'timeline') {
      ui.analyzeScreenHost.replaceChildren(ui.timelinePanel, ui.welcomePanel);
      return;
    }

    if (screen === 'evidence') {
      ui.analyzeScreenHost.replaceChildren(ui.evidencePanel, ui.welcomePanel);
      return;
    }

    ui.analyzeScreenHost.replaceChildren(ui.insightsPanel, ui.welcomePanel);
  }

  function setAnalyzeScreen(screen: AnalyzeScreen) {
    analyzeScreen = screen;
    setAnalyzeScreenButtonState(ui.analyzeScreenOverviewButton, screen === 'overview');
    setAnalyzeScreenButtonState(ui.analyzeScreenSessionsButton, screen === 'sessions');
    setAnalyzeScreenButtonState(ui.analyzeScreenTimelineButton, screen === 'timeline');
    setAnalyzeScreenButtonState(ui.analyzeScreenEvidenceButton, screen === 'evidence');
    setAnalyzeScreenButtonState(ui.analyzeScreenInsightsButton, screen === 'insights');
    ui.analyzeScreenLabel.textContent = screen.toUpperCase();
    mountAnalyzeScreen(screen);
    updateTimelineUI();
    if (analysis) {
      renderInsights();
      renderSessionKey();
    }
  }

  let explanationBaseUrl =
    ((import.meta as any).env?.VITE_EXPLANATION_URL as string | undefined) ??
    'http://localhost:8787';

  if (window.electronAPI?.getBackendUrl) {
    try {
      const backendUrl = await window.electronAPI.getBackendUrl();
      if (backendUrl) explanationBaseUrl = backendUrl;
    } catch {
      // Keep default.
    }
  }
  const explanationCache = new Map<string, string>();
  let explanationRequestSeq = 0;

  const chatManager = new ChatManager({
    container: ui.chatMessages,
    emptyState: ui.chatEmptyState,
    scrollThreshold: 80,
  });

  // Chat history buffer
  const chatHistory: string[] = [];
  let chatHistoryIndex = -1;
  let chatCurrentDraft = '';

  type Workspace = { id: string; name: string };
  const workspaceStorageKey = 'kisame.workspaces';
  const workspaceSelectedKey = 'kisame.workspace.selected';
  const workspaceAssignmentKey = 'kisame.workspace.assignments';

  const loadWorkspaces = (): Workspace[] => {
    const raw = window.localStorage.getItem(workspaceStorageKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Workspace[];
      return Array.isArray(parsed) ? parsed.filter((w) => w && w.id && w.name) : [];
    } catch {
      return [];
    }
  };

  const saveWorkspaces = (workspaces: Workspace[]) => {
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(workspaces));
  };

  const loadWorkspaceAssignments = (): Record<string, string> => {
    const raw = window.localStorage.getItem(workspaceAssignmentKey);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };

  const saveWorkspaceAssignments = (assignments: Record<string, string>) => {
    window.localStorage.setItem(workspaceAssignmentKey, JSON.stringify(assignments));
  };

  let workspaces: Workspace[] = loadWorkspaces();
  if (!workspaces.find((w) => w.id === 'default')) {
    workspaces = [{ id: 'default', name: 'Default Workspace' }, ...workspaces];
  }
  saveWorkspaces(workspaces);

  let selectedWorkspaceId =
    window.localStorage.getItem(workspaceSelectedKey) ?? workspaces[0]?.id ?? 'default';
  if (selectedWorkspaceId !== 'all' && !workspaces.find((w) => w.id === selectedWorkspaceId)) {
    selectedWorkspaceId = 'default';
  }
  let workspaceAssignments = loadWorkspaceAssignments();
  let lastWorkspaceId = selectedWorkspaceId;

  const renderWorkspaceOptions = () => {
    ui.workspaceSelect.replaceChildren();
    ui.workspaceSelect.add(new Option('ALL WORKSPACES', 'all'));
    for (const workspace of workspaces) {
      const option = new Option(workspace.name.toUpperCase(), workspace.id);
      ui.workspaceSelect.add(option);
    }
    ui.workspaceSelect.add(new Option('ADD WORKSPACE…', '__add__'));
    ui.workspaceSelect.value = selectedWorkspaceId;
  };

  const assignWorkspaceIfMissing = (sessionId: string) => {
    if (!workspaceAssignments[sessionId]) {
      workspaceAssignments[sessionId] = selectedWorkspaceId === 'all' ? 'default' : selectedWorkspaceId;
    }
  };

  const filterByWorkspace = (captures: ExplorerCapture[]) => {
    if (selectedWorkspaceId === 'all') return captures;
    return captures.filter((capture) => {
      const workspaceId = workspaceAssignments[capture.session_id] ?? 'default';
      return workspaceId === selectedWorkspaceId;
    });
  };

  renderWorkspaceOptions();

  ui.workspaceSelect.addEventListener('change', () => {
    const value = ui.workspaceSelect.value;
    if (value === '__add__') {
      ui.workspaceSelect.value = lastWorkspaceId;
      ui.workspaceForm.classList.remove('hidden');
      ui.workspaceForm.classList.add('flex');
      ui.workspaceInput.value = '';
      ui.workspaceInput.focus();
      return;
    }

    lastWorkspaceId = value;
    selectedWorkspaceId = value;
    window.localStorage.setItem(workspaceSelectedKey, selectedWorkspaceId);
    ui.workspaceForm.classList.add('hidden');
    ui.workspaceForm.classList.remove('flex');
    renderExplorerCaptures();
  });

  const submitWorkspace = () => {
    const name = ui.workspaceInput.value.trim();
    if (!name) {
      ui.workspaceInput.focus();
      return;
    }
    const id = crypto.randomUUID();
    workspaces = [...workspaces, { id, name }];
    saveWorkspaces(workspaces);
    selectedWorkspaceId = id;
    lastWorkspaceId = id;
    window.localStorage.setItem(workspaceSelectedKey, selectedWorkspaceId);
    ui.workspaceForm.classList.add('hidden');
    ui.workspaceForm.classList.remove('flex');
    renderWorkspaceOptions();
    renderExplorerCaptures();
  };

  ui.workspaceAddButton.addEventListener('click', submitWorkspace);
  ui.workspaceCancelButton.addEventListener('click', () => {
    ui.workspaceForm.classList.add('hidden');
    ui.workspaceForm.classList.remove('flex');
    ui.workspaceInput.value = '';
    ui.workspaceSelect.value = selectedWorkspaceId;
  });
  ui.workspaceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitWorkspace();
    } else if (event.key === 'Escape') {
      ui.workspaceForm.classList.add('hidden');
      ui.workspaceForm.classList.remove('flex');
      ui.workspaceInput.value = '';
      ui.workspaceSelect.value = selectedWorkspaceId;
    }
  });

  const sessionElements = new Map<string, HTMLElement>();
  const explorerElements = new Map<string, HTMLElement>();

  type ExplorerCapture = {
    session_id: string;
    file_name: string;
    size_bytes: number;
    created_at: string;
  };

  let explorerCaptures: ExplorerCapture[] = [];
  let uploadIndicatorTimer: number | null = null;

  void refreshExplorerCaptures();

  if (window.electronAPI?.onUploadProgress) {
    window.electronAPI.onUploadProgress((event) => {
      renderUploadIndicator(event);
    });
  }

  const formatTimestamp = (ts?: number | null) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toISOString().replace('T', ' ').replace('Z', 'Z');
  };

  function timelineSearchText(event: AnalysisArtifact['timeline'][number]): string {
    const http = event.meta?.http;
    const parts = [
      event.kind,
      event.session_id,
      event.summary,
      event.meta?.dns_name,
      event.meta?.sni,
      http?.method,
      http?.host ?? undefined,
      http?.uri ?? undefined,
      `#${event.evidence_frame}`,
    ].filter(Boolean) as string[];
    return parts.join(' ').toLowerCase();
  }

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  function renderUploadIndicator(event: {
    stage: 'idle' | 'upload' | 'analyze' | 'done' | 'error';
    loaded?: number;
    total?: number;
    percent?: number;
    message?: string;
  }) {
    if (uploadIndicatorTimer) {
      window.clearTimeout(uploadIndicatorTimer);
      uploadIndicatorTimer = null;
    }

    if (event.stage === 'idle' || event.stage === 'done') {
      ui.uploadIndicator.classList.add('hidden');
      ui.uploadIndicator.classList.remove('active');
      ui.uploadIndicator.textContent = '';
      return;
    }

    ui.uploadIndicator.classList.remove('hidden');
    ui.uploadIndicator.classList.add('active');

    if (event.stage === 'upload') {
      let percent: number | null = null;
      if (typeof event.percent === 'number' && Number.isFinite(event.percent)) {
        percent = event.percent;
      } else if (event.total && event.total > 0) {
        percent = Math.round(((event.loaded ?? 0) / event.total) * 100);
      }
      if (percent == null || !Number.isFinite(percent)) {
        percent = 0;
      }
      percent = Math.max(0, Math.min(100, percent));
      const blocks = 10;
      const filled = Math.min(blocks, Math.max(0, Math.round((percent / 100) * blocks)));
      const bar = `█`.repeat(filled) + `░`.repeat(blocks - filled);
      ui.uploadIndicator.textContent = `UPLOAD [${bar}] ${percent}%`;
      return;
    }

    if (event.stage === 'analyze') {
      ui.uploadIndicator.textContent = 'ANALYZE █░█░█░';
      return;
    }

    if (event.stage === 'error') {
      ui.uploadIndicator.textContent = 'ERROR █░█░█░';
      uploadIndicatorTimer = window.setTimeout(() => {
        ui.uploadIndicator.classList.add('hidden');
        ui.uploadIndicator.classList.remove('active');
        ui.uploadIndicator.textContent = '';
      }, 3000);
      return;
    }

    ui.uploadIndicator.textContent = event.message ?? 'WORKING █░█░█░';
  }

  function setExplorerEmptyState(title: string, subtitle: string) {
    const titleEl = ui.explorerEmptyState.querySelector('[data-explorer-empty-title]') as HTMLElement | null;
    const subtitleEl = ui.explorerEmptyState.querySelector('[data-explorer-empty-subtitle]') as HTMLElement | null;
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;
  }

  function updateExplorerSelection() {
    for (const [id, element] of explorerElements) {
      element.classList.toggle('selected', id === captureSessionId);
    }
  }

  function renderExplorerCaptures() {
    explorerElements.clear();

    const visibleCaptures = filterByWorkspace(explorerCaptures);

    if (!visibleCaptures.length) {
      ui.explorerList.replaceChildren(ui.explorerEmptyState);
      return;
    }

    const rows = visibleCaptures.map((capture) => {
      const row = el('button', {
        className: 'w-full rounded px-3 py-2 text-left transition-all data-card',
        attrs: { type: 'button', 'data-capture-id': capture.session_id },
      });

      const header = el('div', { className: 'flex items-center justify-between' });
      const name = el('div', {
        className: 'text-[11px] font-[var(--font-mono)] text-white/80 truncate',
        text: capture.file_name,
      });
      const size = el('div', {
        className: 'text-[9px] font-[var(--font-mono)] text-white/35',
        text: formatBytes(capture.size_bytes ?? 0),
      });
      header.append(name, size);

      const meta = el('div', {
        className: 'mt-1 text-[9px] font-[var(--font-mono)] text-white/30',
        text: new Date(capture.created_at).toISOString().replace('T', ' ').replace('Z', 'Z'),
      });

      row.append(header, meta);
      explorerElements.set(capture.session_id, row);
      return row;
    });

    ui.explorerList.replaceChildren(...rows);
    updateExplorerSelection();
  }

  async function refreshExplorerCaptures() {
    try {
      const res = await fetch(`${explanationBaseUrl}/pcap/list`);
      if (!res.ok) {
        if (res.status === 404) {
          explorerCaptures = [];
          setExplorerEmptyState(
            'EXPLORER UNAVAILABLE',
            'Update the backend service.'
          );
          renderExplorerCaptures();
          return;
        }
        const msg = await res.text().catch(() => '');
        throw new Error(`Explorer refresh failed (${res.status}). ${msg}`);
      }
      const data = (await res.json()) as { sessions?: ExplorerCapture[] };
      explorerCaptures = Array.isArray(data.sessions) ? data.sessions : [];
      explorerCaptures.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      for (const capture of explorerCaptures) {
        assignWorkspaceIfMissing(capture.session_id);
      }
      saveWorkspaceAssignments(workspaceAssignments);
      setExplorerEmptyState(
        'NO FILES',
        'Open a PCAP file to begin forensic analysis'
      );
      renderExplorerCaptures();
    } catch {
      explorerCaptures = [];
      setExplorerEmptyState(
        'EXPLORER UNAVAILABLE',
        'Unable to fetch captures from the analysis service'
      );
      renderExplorerCaptures();
    }
  }

  async function ensureBackendTsharkAvailable() {
    const res = await fetch(`${explanationBaseUrl}/tshark/version`);
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(`Backend tshark check failed (${res.status}). ${msg}`);
    }
    const data = (await res.json()) as { resolved?: boolean };
    if (!data?.resolved) {
      throw new Error(
        `Backend at ${explanationBaseUrl} is missing tshark. Install Wireshark/tshark on the backend VM or set TSHARK_PATH. You can run scripts/setup-backend.sh on the VM.`
      );
    }
  }

  async function analyzeExplorerCapture(sessionId: string) {
    const cached = analysisCache.get(sessionId);
    if (cached) {
      analysis = cached;
      captureSessionId = cached.pcap?.session_id ?? sessionId;
      selectedSessionId = null;
      render();
      setActiveTab('analyze');
      return;
    }
    await ensureBackendTsharkAvailable();
    const res = await fetch(`${explanationBaseUrl}/tools/analyzePcap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(`Analyze failed (${res.status}). ${msg}`);
    }
    analysis = (await res.json()) as AnalysisArtifact;
    const cacheKey = analysis.pcap?.session_id ?? sessionId;
    analysisCache.set(cacheKey, analysis);
    captureSessionId = cacheKey;
    selectedSessionId = null;
    setAnalyzeScreen('overview');
    render();
    setActiveTab('analyze');
  }

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
    ui.sessionsCount.textContent = '0';
    ui.timelineCount.textContent = '0';
    ui.analysisSummary.replaceChildren();
    setAnalysisDetail('');
    ui.evidenceList.replaceChildren();
    ui.sessionKeyBody.replaceChildren();
    ui.insightsBody.replaceChildren();
    sessionElements.clear();
    lastAnalysisRef = null;
    captureSessionId = null;
    updateExplorerSelection();
    setWelcomeVisible(true);
  }

  async function startLiveCapture() {
    if (liveCaptureId) return;
    ui.liveCaptureButton.disabled = true;
    ui.openPcapButton.disabled = true;
    ui.liveCaptureButton.textContent = 'Starting…';
    ui.liveCaptureStatus.textContent = 'STARTING…';

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
      ui.liveCaptureStatus.textContent = `CAPTURING ON ${liveCaptureInterface.toUpperCase()}`;
    } catch (err) {
      ui.liveCaptureButton.textContent = 'Live Capture';
      ui.openPcapButton.disabled = false;
      ui.liveCaptureButton.disabled = false;
      ui.liveCaptureStatus.textContent = 'READY';
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
    ui.liveCaptureStatus.textContent = 'STOPPING…';

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
      captureSessionId = analysis.pcap?.session_id ?? stopData.session_id;
      analysisCache.set(captureSessionId, analysis);
      selectedSessionId = null;
      stoppedOk = true;
      render();
      setActiveTab('analyze');
      void refreshExplorerCaptures();
    } catch (err) {
      ui.captureBadge.textContent = liveCaptureInterface
        ? `Live: ${liveCaptureInterface}`
        : 'Live capture';
      ui.liveCaptureStatus.textContent = 'READY';
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
        ui.liveCaptureStatus.textContent = 'READY';
      }
    }
  }

  function renderSessions(sessions: AnalysisArtifact['sessions']) {
    sessionElements.clear();
    ui.sessionsCount.textContent = String(sessions.length);
    ui.sessionsList.replaceChildren(
      ...sessions.map((session, index) => {
        const item = el('button', {
          className: 'w-full rounded px-3 py-3 text-left transition-all data-card',
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
        sessionElements.set(session.id, item);
        return item;
      })
    );
  }

  function updateSessionSelection() {
    for (const [id, element] of sessionElements) {
      element.classList.toggle('selected', id === selectedSessionId);
    }
  }

  function renderTimeline(
    timeline: AnalysisArtifact['timeline'],
    options?: { showSessionId?: boolean }
  ) {
    const showSessionId = options?.showSessionId ?? false;
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

    const sorted = [...timeline].sort((a, b) =>
      a.ts !== b.ts ? a.ts - b.ts : a.evidence_frame - b.evidence_frame
    );

    ui.timelineList.replaceChildren(
      ...sorted.slice(0, 200).map((event, index) => {
        const row = el('button', {
          className:
            'group relative w-full text-left pl-4 pb-3 border-l border-[var(--app-line)] ' +
            'hover:border-[var(--accent-cyan)]/30 transition-colors animate-slide-in',
          attrs: {
            type: 'button',
            style: `animation-delay: ${index * 0.03}s`,
            'data-timeline-session-id': event.session_id,
          },
        });

        const metaRow = el('div', { className: 'mt-1 flex items-center gap-2 flex-wrap' });
        const kindBadge = el('span', {
          className: 'px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] font-[var(--font-mono)] text-white/45 uppercase tracking-wider',
          text: event.kind,
        });
        metaRow.append(kindBadge);
        if (showSessionId) {
          metaRow.append(
            el('span', {
              className: 'px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] font-[var(--font-mono)] text-white/35 truncate max-w-[140px]',
              text: event.session_id,
            })
          );
        }
        metaRow.append(
          el('span', {
            className: 'text-[9px] font-[var(--font-mono)] tracking-wider text-white/30',
            text: `FRAME #${event.evidence_frame}`,
          })
        );

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

        row.append(dot, timestamp, summary, metaRow);
        return row as unknown as HTMLElement;
      })
    );
  }

  function updateTimelineControlsForScope() {
    const base = 'px-2 py-1 text-[9px] font-[var(--font-mono)] tracking-wider transition-colors';
    ui.timelineScopeSessionButton.className =
      `${base} ` +
      (timelineScope === 'session'
        ? 'text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10'
        : 'text-white/40 hover:text-white/70');
    ui.timelineScopeAllButton.className =
      `${base} ` +
      (timelineScope === 'all'
        ? 'text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10'
        : 'text-white/40 hover:text-white/70');
  }

  function populateTimelineKinds() {
    if (!analysis) return;
    const counts = new Map<string, number>();
    for (const event of analysis.timeline ?? []) {
      counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
    }
    const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    const current = timelineKindFilter;
    ui.timelineKindSelect.replaceChildren(new Option('ALL', 'all'));
    for (const [kind, count] of kinds) {
      ui.timelineKindSelect.append(new Option(`${kind.toUpperCase()} (${count})`, kind));
    }

    if (current !== 'all' && !counts.has(current)) {
      timelineKindFilter = 'all';
    }
    ui.timelineKindSelect.value = timelineKindFilter;
  }

  function updateTimelineUI() {
    if (!analysis || !analysis.sessions.length) return;

    const selected = selectedSessionId
      ? analysis.sessions.find((s) => s.id === selectedSessionId) ?? analysis.sessions[0]
      : analysis.sessions[0];

    const needle = timelineSearchQuery.trim().toLowerCase();
    const events = (analysis.timeline ?? []).filter((event) => {
      if (timelineScope === 'session' && event.session_id !== selected.id) return false;
      if (timelineKindFilter !== 'all' && event.kind !== timelineKindFilter) return false;
      if (needle && !timelineSearchText(event).includes(needle)) return false;
      return true;
    });

    ui.sessionIdLabel.textContent = timelineScope === 'all' ? 'SCOPE: ALL' : `Session: ${selected.id}`;
    ui.timelineCount.textContent = events.length > 200 ? '200+' : String(events.length);
    renderTimeline(events, { showSessionId: timelineScope === 'all' });
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

  function renderSessionKey(selectedSession?: AnalysisArtifact['sessions'][number]) {
    if (!analysis || !analysis.sessions.length) {
      ui.sessionKeyBody.replaceChildren(
        el('div', {
          className: 'flex flex-col items-center justify-center py-8 text-center',
          children: [
            el('div', { className: 'data-label mb-1', text: 'NO SESSION' }),
            el('div', { className: 'text-[10px] text-white/30', text: 'Select a session to view details' }),
          ],
        })
      );
      return;
    }

    const session =
      selectedSession ??
      (selectedSessionId
        ? analysis.sessions.find((s) => s.id === selectedSessionId) ?? analysis.sessions[0]
        : analysis.sessions[0]);

    const a = `${session.endpoints.a.ip}${session.endpoints.a.port ? `:${session.endpoints.a.port}` : ''}`;
    const b = `${session.endpoints.b.ip}${session.endpoints.b.port ? `:${session.endpoints.b.port}` : ''}`;
    const duration =
      typeof session.duration_seconds === 'number' && Number.isFinite(session.duration_seconds)
        ? `${session.duration_seconds.toFixed(2)}s`
        : '—';

    const flags = (session.rule_flags ?? []).slice(0, 12);
    const protocols = (session.protocols ?? []).slice().sort((x, y) => y.count - x.count).slice(0, 10);

    const card = (label: string, value: string) =>
      el('div', {
        className: 'data-card rounded p-3',
        children: [
          el('div', { className: 'data-label mb-1', text: label }),
          el('div', { className: 'text-[12px] font-[var(--font-mono)] text-white/75 break-words', text: value }),
        ],
      });

    const flagsEl =
      flags.length > 0
        ? el('div', {
            className: 'flex flex-wrap gap-2',
            children: flags.map((flag) =>
              el('span', {
                className: 'px-2 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] font-[var(--font-mono)] text-white/45 uppercase tracking-wider',
                text: flag,
              })
            ),
          })
        : el('div', { className: 'text-[10px] text-white/30', text: 'No flags' });

    const protocolsEl =
      protocols.length > 0
        ? el('div', {
            className: 'space-y-2',
            children: protocols.map((p) =>
              el('div', {
                className: 'flex items-center justify-between gap-3',
                children: [
                  el('div', { className: 'text-[11px] font-[var(--font-mono)] text-white/60 truncate', text: p.chain }),
                  el('div', { className: 'text-[10px] font-[var(--font-mono)] text-white/35 tabular-nums', text: String(p.count) }),
                ],
              })
            ),
          })
        : el('div', { className: 'text-[10px] text-white/30', text: 'No protocol breakdown' });

    ui.sessionKeyBody.replaceChildren(
      el('div', {
        className: 'space-y-4',
        children: [
          el('div', { className: 'data-label', text: `SESSION ${session.id}` }),
          el('div', {
            className: 'grid grid-cols-1 sm:grid-cols-2 gap-3',
            children: [
              card('Transport', session.transport.toUpperCase()),
              card('Duration', duration),
              card('Packets', String(session.packet_count)),
              card('Bytes', formatBytes(session.byte_count)),
              card('Endpoint A', a),
              card('Endpoint B', b),
              card('First Seen', formatTimestamp(session.first_ts)),
              card('Last Seen', formatTimestamp(session.last_ts)),
            ],
          }),
          el('div', {
            className: 'data-card rounded p-3',
            children: [el('div', { className: 'data-label mb-2', text: 'Flags' }), flagsEl],
          }),
          el('div', {
            className: 'data-card rounded p-3',
            children: [el('div', { className: 'data-label mb-2', text: 'Top Protocol Chains' }), protocolsEl],
          }),
        ],
      })
    );
  }

  function renderInsights() {
    if (!analysis || !analysis.sessions.length) {
      ui.insightsBody.replaceChildren(
        el('div', {
          className: 'flex flex-col items-center justify-center py-8 text-center',
          children: [
            el('div', { className: 'data-label mb-1', text: 'NO DATA' }),
            el('div', { className: 'text-[10px] text-white/30', text: 'Load a capture to generate insights' }),
          ],
        })
      );
      return;
    }

    const sessions = analysis.sessions;
    const totalPackets = sessions.reduce((sum, s) => sum + (s.packet_count ?? 0), 0);
    const totalBytes = sessions.reduce((sum, s) => sum + (s.byte_count ?? 0), 0);

    const transportCounts = sessions.reduce(
      (acc, s) => {
        acc[s.transport] = (acc[s.transport] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const flagCounts = new Map<string, number>();
    for (const s of sessions) {
      for (const f of s.rule_flags ?? []) {
        flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
      }
    }
    const topFlags = [...flagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

    const kinds = new Map<string, number>();
    for (const e of analysis.timeline ?? []) {
      kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    }
    const topKinds = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    const topSessions = [...sessions].sort((a, b) => b.byte_count - a.byte_count).slice(0, 8);

    const stat = (label: string, value: string) =>
      el('div', {
        className: 'data-card rounded p-3',
        children: [
          el('div', { className: 'data-label mb-1', text: label }),
          el('div', { className: 'text-[13px] font-[var(--font-mono)] text-white/75', text: value }),
        ],
      });

    ui.insightsBody.replaceChildren(
      el('div', {
        className: 'space-y-4',
        children: [
          el('div', {
            className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3',
            children: [
              stat('Sessions', String(sessions.length)),
              stat('Packets', String(totalPackets)),
              stat('Bytes', formatBytes(totalBytes)),
              stat('Timeline Events', String((analysis.timeline ?? []).length)),
            ],
          }),
          el('div', {
            className: 'data-card rounded p-3',
            children: [
              el('div', { className: 'data-label mb-2', text: 'Transport Mix' }),
              el('div', {
                className: 'flex flex-wrap gap-2',
                children: Object.entries(transportCounts).map(([k, v]) =>
                  el('span', {
                    className: 'px-2 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] font-[var(--font-mono)] text-white/45 uppercase tracking-wider',
                    text: `${k.toUpperCase()}: ${v}`,
                  })
                ),
              }),
            ],
          }),
          el('div', {
            className: 'grid grid-cols-1 lg:grid-cols-2 gap-3',
            children: [
              el('div', {
                className: 'data-card rounded p-3',
                children: [
                  el('div', { className: 'data-label mb-2', text: 'Top Sessions (Bytes)' }),
                  el('div', {
                    className: 'space-y-2',
                    children: topSessions.map((s) =>
                      el('div', {
                        className: 'flex items-center justify-between gap-3',
                        children: [
                          el('div', { className: 'text-[11px] font-[var(--font-mono)] text-white/60 truncate', text: s.id }),
                          el('div', { className: 'text-[10px] font-[var(--font-mono)] text-white/35 tabular-nums', text: formatBytes(s.byte_count) }),
                        ],
                      })
                    ),
                  }),
                ],
              }),
              el('div', {
                className: 'data-card rounded p-3',
                children: [
                  el('div', { className: 'data-label mb-2', text: 'Timeline Kinds' }),
                  topKinds.length
                    ? el('div', {
                        className: 'space-y-2',
                        children: topKinds.map(([kind, count]) =>
                          el('div', {
                            className: 'flex items-center justify-between gap-3',
                            children: [
                              el('div', { className: 'text-[11px] font-[var(--font-mono)] text-white/60 truncate', text: kind }),
                              el('div', { className: 'text-[10px] font-[var(--font-mono)] text-white/35 tabular-nums', text: String(count) }),
                            ],
                          })
                        ),
                      })
                    : el('div', { className: 'text-[10px] text-white/30', text: 'No timeline events' }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'data-card rounded p-3',
            children: [
              el('div', { className: 'data-label mb-2', text: 'Top Flags' }),
              topFlags.length
                ? el('div', {
                    className: 'flex flex-wrap gap-2',
                    children: topFlags.map(([flag, count]) =>
                      el('span', {
                        className: 'px-2 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] font-[var(--font-mono)] text-white/45 uppercase tracking-wider',
                        text: `${flag} (${count})`,
                      })
                    ),
                  })
                : el('div', { className: 'text-[10px] text-white/30', text: 'No flags' }),
            ],
          }),
        ],
      })
    );
  }

  function updateSelectedSessionUI() {
    if (!analysis || !analysis.sessions.length) return;

    const sessions = analysis.sessions;
    if (!selectedSessionId) selectedSessionId = sessions[0].id;

    updateSessionSelection();

    const selected = sessions.find((s) => s.id === selectedSessionId) ?? sessions[0];
    selectedSessionId = selected.id;
    updateTimelineUI();
    renderEvidence(selected);
    renderAnalysisSummary(selected);
    renderSessionKey(selected);
    setAnalysisDetail('Fetching explanation…');
    void updateExplanationFromService(selected.id);
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
    captureSessionId = analysis.pcap?.session_id ?? captureSessionId;
    updateExplorerSelection();

    if (analysis !== lastAnalysisRef) {
      renderSessions(analysis.sessions);
      populateTimelineKinds();
      renderInsights();
      lastAnalysisRef = analysis;
    }

    updateSelectedSessionUI();
  }

  ui.analyzeScreenOverviewButton.addEventListener('click', () => setAnalyzeScreen('overview'));
  ui.analyzeScreenSessionsButton.addEventListener('click', () => setAnalyzeScreen('sessions'));
  ui.analyzeScreenTimelineButton.addEventListener('click', () => setAnalyzeScreen('timeline'));
  ui.analyzeScreenEvidenceButton.addEventListener('click', () => setAnalyzeScreen('evidence'));
  ui.analyzeScreenInsightsButton.addEventListener('click', () => setAnalyzeScreen('insights'));

  setAnalyzeScreen('overview');

  ui.sessionsList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest('[data-session-id]') as HTMLElement | null;
    const id = row?.getAttribute('data-session-id');
    if (!id) return;
    if (id === selectedSessionId) return;
    selectedSessionId = id;
    updateSelectedSessionUI();
  });

  ui.timelineList.addEventListener('click', (event) => {
    if (!analysis) return;
    const target = event.target as HTMLElement | null;
    const row = target?.closest('[data-timeline-session-id]') as HTMLElement | null;
    const sessionId = row?.getAttribute('data-timeline-session-id');
    if (!sessionId) return;
    if (sessionId === selectedSessionId) return;
    selectedSessionId = sessionId;
    updateSelectedSessionUI();
  });

  ui.timelineScopeSessionButton.addEventListener('click', () => {
    timelineScope = 'session';
    updateTimelineControlsForScope();
    updateTimelineUI();
  });

  ui.timelineScopeAllButton.addEventListener('click', () => {
    timelineScope = 'all';
    updateTimelineControlsForScope();
    updateTimelineUI();
  });

  ui.timelineKindSelect.addEventListener('change', () => {
    timelineKindFilter = ui.timelineKindSelect.value || 'all';
    updateTimelineUI();
  });

  ui.timelineSearchInput.addEventListener('input', () => {
    timelineSearchQuery = ui.timelineSearchInput.value;
    updateTimelineUI();
  });

  ui.timelineSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      timelineSearchQuery = '';
      ui.timelineSearchInput.value = '';
      updateTimelineUI();
    }
  });

  updateTimelineControlsForScope();

  ui.explorerList.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest('[data-capture-id]') as HTMLElement | null;
    const id = row?.getAttribute('data-capture-id');
    if (!id) return;
    if (id === captureSessionId && analysis) {
      setActiveTab('analyze');
      return;
    }
    try {
      row?.classList.add('opacity-60');
      await analyzeExplorerCapture(id);
    } catch (err) {
      alert((err as Error).message ?? String(err));
    } finally {
      row?.classList.remove('opacity-60');
    }
  });

  ui.explorerAddButton.addEventListener('click', () => {
    ui.openPcapButton.click();
  });

  ui.explorerRefreshButton.addEventListener('click', () => {
    void refreshExplorerCaptures();
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
      captureSessionId = analysis.pcap?.session_id ?? null;
      if (captureSessionId) {
        analysisCache.set(captureSessionId, analysis);
      }
      selectedSessionId = null;
      timelineScope = 'session';
      timelineSearchQuery = '';
      timelineKindFilter = 'all';
      ui.timelineSearchInput.value = '';
      populateTimelineKinds();
      updateTimelineControlsForScope();
      setAnalyzeScreen('overview');
      render();
      setActiveTab('analyze');
      void refreshExplorerCaptures();
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

    // History push
    chatHistory.push(query);
    chatHistoryIndex = -1;
    chatCurrentDraft = '';

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
          // Filter out token/step messages - only show meaningful status
          const stage = (data.stage ?? '').toLowerCase();
          const msg = (data.message ?? '').toLowerCase();
          if (stage.includes('step') || msg.includes('token') || stage === 'warning' || stage === 'reasoning') {
            return; // Skip these status updates
          }
          aiMessage.status = data.message ?? data.stage;
        } else if (eventName === 'text') {
          aiMessage.text += data.delta ?? '';
          if (aiMessage.status) {
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
    } else if (event.key === 'ArrowUp') {
      if (chatHistoryIndex === -1 && ui.chatInput.value && ui.chatInput.selectionStart !== 0) {
        return; // Allow normal navigation if typing and not at start
      }
      if (chatHistoryIndex === -1 && chatHistory.length > 0) {
        chatCurrentDraft = ui.chatInput.value;
        chatHistoryIndex = chatHistory.length - 1;
        ui.chatInput.value = chatHistory[chatHistoryIndex];
        event.preventDefault();
        // Move cursor to end
        setTimeout(() => {
          ui.chatInput.selectionStart = ui.chatInput.selectionEnd = ui.chatInput.value.length;
        }, 0);
      } else if (chatHistoryIndex > 0) {
        chatHistoryIndex--;
        ui.chatInput.value = chatHistory[chatHistoryIndex];
        event.preventDefault();
        setTimeout(() => {
          ui.chatInput.selectionStart = ui.chatInput.selectionEnd = ui.chatInput.value.length;
        }, 0);
      }
    } else if (event.key === 'ArrowDown') {
      if (chatHistoryIndex !== -1) {
        if (chatHistoryIndex < chatHistory.length - 1) {
          chatHistoryIndex++;
          ui.chatInput.value = chatHistory[chatHistoryIndex];
        } else {
          chatHistoryIndex = -1;
          ui.chatInput.value = chatCurrentDraft;
        }
        event.preventDefault();
        setTimeout(() => {
            ui.chatInput.selectionStart = ui.chatInput.selectionEnd = ui.chatInput.value.length;
        }, 0);
      }
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === '/' && 
        document.activeElement?.tagName !== 'INPUT' && 
        document.activeElement?.tagName !== 'TEXTAREA') {
      event.preventDefault();
      ui.chatInput.focus();
    }
  });

  ui.navCaptureButton.addEventListener('click', () => setActiveTab('capture'));
  ui.navAnalyzeButton.addEventListener('click', () => setActiveTab('analyze'));
  ui.navExportButton.addEventListener('click', () => setActiveTab('export'));

  setActiveTab(activeTab);
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
