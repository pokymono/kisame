import './index.css';
import { createAppShell } from './ui/app-shell';
import { el } from './ui/dom';
import { ChatManager } from './ui/chat';
import { createDefaultOnboarding } from './ui/onboarding';
import type { AnalysisArtifact, ChatMessage, ToolCallLog } from './types';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

type CaptureInterface = {
  id: string;
  name: string;
  description?: string;
};

const ONBOARDING_COMPLETE_KEY = 'kisame.onboarding.complete';

function hasCompletedOnboarding(): boolean {
  return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === 'true';
}

function markOnboardingComplete(): void {
  localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
}

async function initApp() {
  const root = document.getElementById('root');
  if (!root) return;

  const ui = createAppShell(root);

  if (!hasCompletedOnboarding()) {
    const onboarding = createDefaultOnboarding({
      onComplete: () => {
        markOnboardingComplete();
        console.log('[Kisame] Onboarding completed');
      },
      onSkip: () => {
        markOnboardingComplete();
        console.log('[Kisame] Onboarding skipped');
      },
    });
    onboarding.show();
  }

  let analysis: AnalysisArtifact | null = null;
  let selectedSessionId: string | null = null;
  let liveCaptureId: string | null = null;
  let liveCaptureInterface: string | null = null;
  let liveCaptureStartTime: number | null = null;
  let liveCaptureTimer: number | null = null;
  let selectedInterfaceId: string | null = null;
  let selectedInterfaceName: string | null = null;
  let availableInterfaces: CaptureInterface[] = [];
  let lastAnalysisRef: AnalysisArtifact | null = null;
  let captureSessionId: string | null = null;
  type TimelineScope = 'session' | 'all';
  let timelineScope: TimelineScope = 'session';
  let timelineSearchQuery = '';
  let timelineKindFilter = 'all';
  type AnalyzeScreen = 'overview' | 'sessions' | 'timeline' | 'terminal' | 'insights' | 'workflows';
  let analyzeScreen: AnalyzeScreen = 'overview';
  const analysisCache = new Map<string, AnalysisArtifact>();

  type WorkflowContextMode = 'capture' | 'session';
  type Workflow = {
    id: string;
    name: string;
    prompts: string[];
    contextMode: WorkflowContextMode;
    autoRun?: boolean;
    createdAt: string;
    updatedAt: string;
  };

  const WORKFLOWS_STORAGE_KEY = 'kisame.workflows.v1';
  let workflows: Workflow[] = [];
  let selectedWorkflowId: string | null = null;
  let isWorkflowRunning = false;
  let workflowPromptTimer: number | null = null;

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
    
    const panels = [
      { el: ui.analysisMain, show: showAnalysis },
      { el: ui.chatColumn, show: showAnalysis },
      { el: ui.capturePanel, show: tab === 'capture' },
      { el: ui.exportPanel, show: tab === 'export' },
    ];
    
    for (const panel of panels) {
      if (!panel.show) {
        panel.el.classList.add('hidden');
      }
    }
    
    requestAnimationFrame(() => {
      for (const panel of panels) {
        if (panel.show) {
          panel.el.classList.remove('hidden');
          panel.el.classList.add('animate-fade-in');
          setTimeout(() => {
            panel.el.classList.remove('animate-fade-in');
          }, 200);
        }
      }
    });
    
    if (tab === 'export') {
      updateExportSummary();
    }
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
      ui.overviewLayout.replaceChildren(ui.overviewTopLayout, ui.terminalPanel, ui.overviewEvidenceHandle);
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

    if (screen === 'terminal') {
      ui.analyzeScreenHost.replaceChildren(ui.terminalPanel, ui.welcomePanel);
      return;
    }

    if (screen === 'insights') {
      ui.analyzeScreenHost.replaceChildren(ui.insightsPanel, ui.welcomePanel);
      return;
    }

    ui.analyzeScreenHost.replaceChildren(ui.workflowsPanel, ui.welcomePanel);
  }

  function setAnalyzeScreen(screen: AnalyzeScreen) {
    analyzeScreen = screen;
    setAnalyzeScreenButtonState(ui.analyzeScreenOverviewButton, screen === 'overview');
    setAnalyzeScreenButtonState(ui.analyzeScreenSessionsButton, screen === 'sessions');
    setAnalyzeScreenButtonState(ui.analyzeScreenTimelineButton, screen === 'timeline');
    setAnalyzeScreenButtonState(ui.analyzeScreenTerminalButton, screen === 'terminal');
    setAnalyzeScreenButtonState(ui.analyzeScreenInsightsButton, screen === 'insights');
    setAnalyzeScreenButtonState(ui.analyzeScreenWorkflowsButton, screen === 'workflows');
    ui.analyzeScreenLabel.textContent = screen.toUpperCase();
    
    ui.analyzeScreenHost.classList.add('screen-transition', 'transitioning');
    
    requestAnimationFrame(() => {
      mountAnalyzeScreen(screen);
      requestAnimationFrame(() => {
        ui.analyzeScreenHost.classList.remove('transitioning');
        setTimeout(() => {
          ui.analyzeScreenHost.classList.remove('screen-transition');
        }, 200);
      });
    });
    
    updateTimelineUI();
    if (analysis) {
      renderInsights();
      renderSessionKey();
    }
    syncNoCaptureUi();
  }

  let explanationBaseUrl =
    ((import.meta as any).env?.VITE_EXPLANATION_URL as string | undefined) ??
    'http://localhost:8787';

  if (window.electronAPI?.getBackendUrl) {
    try {
      const backendUrl = await window.electronAPI.getBackendUrl();
      if (backendUrl) explanationBaseUrl = backendUrl;
    } catch {
    }
  }
  const explanationCache = new Map<string, string>();
  let explanationRequestSeq = 0;

  const chatManager = new ChatManager({
    container: ui.chatMessages,
    emptyState: ui.chatEmptyState,
    scrollThreshold: 80,
  });

  ui.chatMessages.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest('[data-next-step="true"]') as HTMLElement | null;
    if (!button) return;
    const query = button.getAttribute('data-next-step-query') ?? '';
    if (!query) return;
    const label = button.textContent?.trim();
    const contextMode = button.getAttribute('data-next-step-context');
    void sendChatQueryText(query, {
      displayText: label ?? query,
      contextMode: contextMode === 'session' || contextMode === 'capture' ? contextMode : undefined,
    });
  });

  const chatHistory: string[] = [];
  let chatHistoryIndex = -1;
  let chatCurrentDraft = '';
  let chatAbortController: AbortController | null = null;
  const defaultChatPlaceholder = ui.chatInput.placeholder || 'Press / to focus...';
  let noCaptureHintShown = false;

  const hasCaptureContext = () => Boolean(analysis && analysis.sessions.length > 0);

  function syncNoCaptureUi() {
    const hasCapture = hasCaptureContext();
    const showWelcome = !hasCapture && analyzeScreen !== 'terminal';
    setWelcomeVisible(showWelcome);
    ui.chatInput.placeholder = hasCapture
      ? defaultChatPlaceholder
      : 'Ask anything. Import a PCAP for capture-specific analysis.';
  }

  type Workspace = { id: string; name: string };
  type CaseFile = { id: string; name: string; workspaceId: string; createdAt: string };

  const workspaceStorageKey = 'kisame.workspaces';
  const workspaceSelectedKey = 'kisame.workspace.selected';
  const workspaceAssignmentKey = 'kisame.workspace.assignments';
  const caseStorageKey = 'kisame.cases';
  const caseSelectedKey = 'kisame.case.selected';
  const caseAssignmentKey = 'kisame.case.assignments';
  const workspaceExpandedKey = 'kisame.workspace.expanded';
  const caseExpandedKey = 'kisame.case.expanded';
  const clientIdKey = 'kisame.client.id';

  const resolveClientId = (): string => {
    const stored = window.localStorage.getItem(clientIdKey);
    if (stored) return stored;
    const generated =
      globalThis.crypto?.randomUUID?.() ??
      `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(clientIdKey, generated);
    return generated;
  };

  const clientId = resolveClientId();
  const withClientHeaders = (headers: HeadersInit = {}) => {
    const next = new Headers(headers);
    next.set('x-client-id', clientId);
    return next;
  };

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

  const loadCases = (): CaseFile[] => {
    const raw = window.localStorage.getItem(caseStorageKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as CaseFile[];
      return Array.isArray(parsed)
        ? parsed.filter((c) => c && c.id && c.name && c.workspaceId)
        : [];
    } catch {
      return [];
    }
  };

  const saveCases = (cases: CaseFile[]) => {
    window.localStorage.setItem(caseStorageKey, JSON.stringify(cases));
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

  const loadCaseAssignments = (): Record<string, string> => {
    const raw = window.localStorage.getItem(caseAssignmentKey);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };

  const saveCaseAssignments = (assignments: Record<string, string>) => {
    window.localStorage.setItem(caseAssignmentKey, JSON.stringify(assignments));
  };

  const loadExpandedSet = (key: string): Set<string> => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    try {
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === 'string')) : new Set();
    } catch {
      return new Set();
    }
  };

  const saveExpandedSet = (key: string, value: Set<string>) => {
    window.localStorage.setItem(key, JSON.stringify(Array.from(value)));
  };

  let workspaces: Workspace[] = loadWorkspaces();
  if (!workspaces.find((w) => w.id === 'default')) {
    workspaces = [{ id: 'default', name: 'Default Workspace' }, ...workspaces];
  }
  saveWorkspaces(workspaces);

  let cases: CaseFile[] = loadCases();

  const ensureDefaultCaseForWorkspace = (workspaceId: string) => {
    if (cases.some((c) => c.workspaceId === workspaceId)) return;
    const newCase: CaseFile = {
      id: crypto.randomUUID(),
      name: 'General',
      workspaceId,
      createdAt: new Date().toISOString(),
    };
    cases = [...cases, newCase];
    saveCases(cases);
  };

  for (const workspace of workspaces) {
    ensureDefaultCaseForWorkspace(workspace.id);
  }

  let selectedWorkspaceId =
    window.localStorage.getItem(workspaceSelectedKey) ?? workspaces[0]?.id ?? 'default';
  if (selectedWorkspaceId !== 'all' && !workspaces.find((w) => w.id === selectedWorkspaceId)) {
    selectedWorkspaceId = 'default';
  }
  let workspaceAssignments = loadWorkspaceAssignments();
  let caseAssignments = loadCaseAssignments();
  let lastWorkspaceId = selectedWorkspaceId === 'all' ? 'default' : selectedWorkspaceId;
  let selectedCaseId = window.localStorage.getItem(caseSelectedKey);
  let uploadWorkspacePrompt = false;
  let pendingUploadAfterWorkspaceSelect = false;

  let expandedWorkspaceIds = loadExpandedSet(workspaceExpandedKey);
  let expandedCaseIds = loadExpandedSet(caseExpandedKey);
  if (!expandedWorkspaceIds.size) {
    expandedWorkspaceIds = new Set(workspaces.map((w) => w.id));
    saveExpandedSet(workspaceExpandedKey, expandedWorkspaceIds);
  }

  const getCasesForWorkspace = (workspaceId: string) =>
    cases
      .filter((c) => c.workspaceId === workspaceId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const getDefaultCaseId = (workspaceId: string) => {
    ensureDefaultCaseForWorkspace(workspaceId);
    return getCasesForWorkspace(workspaceId)[0]?.id ?? '';
  };

  const normalizeSelectedCase = () => {
    if (selectedCaseId && cases.some((c) => c.id === selectedCaseId)) {
      if (selectedWorkspaceId === 'all') {
        window.localStorage.setItem(caseSelectedKey, selectedCaseId);
        return;
      }
      const selectedCase = cases.find((c) => c.id === selectedCaseId);
      if (selectedCase?.workspaceId === selectedWorkspaceId) {
        window.localStorage.setItem(caseSelectedKey, selectedCaseId);
        return;
      }
    }
    const workspaceId = selectedWorkspaceId === 'all' ? lastWorkspaceId : selectedWorkspaceId;
    selectedCaseId = getDefaultCaseId(workspaceId);
    window.localStorage.setItem(caseSelectedKey, selectedCaseId);
  };

  normalizeSelectedCase();

  let caseDraftWorkspaceId: string | null = null;
  let caseDraftNeedsFocus = false;

  const clearCaseDraft = () => {
    caseDraftWorkspaceId = null;
    caseDraftNeedsFocus = false;
  };

  const updateWorkspaceAttention = () => {
    ui.workspaceSelectButton.classList.toggle(
      'workspace-attention',
      uploadWorkspacePrompt || pendingUploadAfterWorkspaceSelect
    );
  };

  const createCaseForWorkspace = (name: string, workspaceId: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      clearCaseDraft();
      renderExplorerCaptures();
      return;
    }
    const newCase: CaseFile = {
      id: crypto.randomUUID(),
      name: trimmed,
      workspaceId,
      createdAt: new Date().toISOString(),
    };
    cases = [...cases, newCase];
    saveCases(cases);
    selectedCaseId = newCase.id;
    window.localStorage.setItem(caseSelectedKey, selectedCaseId);
    expandedWorkspaceIds.add(workspaceId);
    expandedCaseIds.add(newCase.id);
    saveExpandedSet(workspaceExpandedKey, expandedWorkspaceIds);
    saveExpandedSet(caseExpandedKey, expandedCaseIds);
    clearCaseDraft();
    renderExplorerCaptures();
  };

  const setWorkspaceExpanded = (workspaceId: string, expanded: boolean) => {
    if (expanded) {
      expandedWorkspaceIds.add(workspaceId);
    } else {
      expandedWorkspaceIds.delete(workspaceId);
    }
    saveExpandedSet(workspaceExpandedKey, expandedWorkspaceIds);
  };

  const setCaseExpanded = (caseId: string, expanded: boolean) => {
    if (expanded) {
      expandedCaseIds.add(caseId);
    } else {
      expandedCaseIds.delete(caseId);
    }
    saveExpandedSet(caseExpandedKey, expandedCaseIds);
  };

  let workspaceMenuOpen = false;
  const setWorkspaceMenuOpen = (open: boolean) => {
    workspaceMenuOpen = open;
    ui.workspaceSelectMenu.classList.toggle('hidden', !open);
    ui.workspaceSelectButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const renderWorkspaceOptions = () => {
    ui.workspaceSelectMenu.replaceChildren();

    const addOption = (label: string, value: string) => {
      const option = el('button', {
        className:
          'workspace-option w-full text-left px-2.5 py-2 rounded text-[10px] font-[var(--font-mono)] tracking-wider transition-all',
        text: label,
        attrs: { type: 'button', 'data-workspace-value': value },
      });
      if (value === selectedWorkspaceId) option.classList.add('active');
      ui.workspaceSelectMenu.append(option);
    };

    addOption('ALL WORKSPACES', 'all');
    for (const workspace of workspaces) {
      addOption(workspace.name.toUpperCase(), workspace.id);
    }
    addOption('ADD WORKSPACE…', '__add__');

    const selectedLabel =
      selectedWorkspaceId === 'all'
        ? 'ALL WORKSPACES'
        : (workspaces.find((w) => w.id === selectedWorkspaceId)?.name ?? 'DEFAULT WORKSPACE').toUpperCase();
    ui.workspaceSelectButton.textContent = selectedLabel;
  };

  const assignWorkspaceIfMissing = (sessionId: string) => {
    if (!workspaceAssignments[sessionId]) {
      workspaceAssignments[sessionId] =
        selectedWorkspaceId === 'all' ? 'default' : selectedWorkspaceId;
    }
  };

  const assignCaseIfMissing = (sessionId: string, workspaceId: string) => {
    if (caseAssignments[sessionId]) return;
    const selectedCase = selectedCaseId ? cases.find((c) => c.id === selectedCaseId) : null;
    if (selectedCase && selectedCase.workspaceId === workspaceId) {
      caseAssignments[sessionId] = selectedCase.id;
    } else {
      caseAssignments[sessionId] = getDefaultCaseId(workspaceId);
    }
  };

  const getVisibleWorkspaces = () => {
    if (selectedWorkspaceId === 'all') return workspaces;
    return workspaces.filter((w) => w.id === selectedWorkspaceId);
  };

  renderWorkspaceOptions();

  ui.workspaceSelectButton.addEventListener('click', (event) => {
    event.stopPropagation();
    setWorkspaceMenuOpen(!workspaceMenuOpen);
  });


  ui.workspaceSelectMenu.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest('[data-workspace-value]') as HTMLElement | null;
    const value = button?.getAttribute('data-workspace-value');
    if (!value) return;

    if (value === '__add__') {
      setWorkspaceMenuOpen(false);
      ui.workspaceForm.classList.remove('hidden');
      ui.workspaceForm.classList.add('flex');
      ui.workspaceInput.value = '';
      ui.workspaceInput.focus();
      return;
    }

    lastWorkspaceId = value === 'all' ? lastWorkspaceId : value;
    selectedWorkspaceId = value;
    window.localStorage.setItem(workspaceSelectedKey, selectedWorkspaceId);
    normalizeSelectedCase();
    if (value !== 'all') {
      uploadWorkspacePrompt = false;
      updateWorkspaceAttention();
    }
    clearCaseDraft();
    ui.workspaceForm.classList.add('hidden');
    ui.workspaceForm.classList.remove('flex');
    renderWorkspaceOptions();
    renderExplorerCaptures();
    setWorkspaceMenuOpen(false);

    if (value !== 'all' && pendingUploadAfterWorkspaceSelect) {
      pendingUploadAfterWorkspaceSelect = false;
      updateWorkspaceAttention();
      queueMicrotask(() => ui.openPcapButton.click());
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!workspaceMenuOpen) return;
    if (ui.workspaceSelectButton.contains(target) || ui.workspaceSelectMenu.contains(target)) return;
    setWorkspaceMenuOpen(false);
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
    ensureDefaultCaseForWorkspace(id);
    selectedWorkspaceId = id;
    lastWorkspaceId = id;
    window.localStorage.setItem(workspaceSelectedKey, selectedWorkspaceId);
    normalizeSelectedCase();
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
  });
  ui.workspaceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitWorkspace();
    } else if (event.key === 'Escape') {
      ui.workspaceForm.classList.add('hidden');
      ui.workspaceForm.classList.remove('flex');
      ui.workspaceInput.value = '';
    }
  });

  ui.caseTriggerButton.addEventListener('click', () => {
    const workspaceId = selectedWorkspaceId === 'all' ? lastWorkspaceId : selectedWorkspaceId;
    if (!workspaceId) return;
    caseDraftWorkspaceId = workspaceId;
    caseDraftNeedsFocus = true;
    expandedWorkspaceIds.add(workspaceId);
    saveExpandedSet(workspaceExpandedKey, expandedWorkspaceIds);
    renderExplorerCaptures();
  });

  const sessionElements = new Map<string, HTMLElement>();
  const explorerElements = new Map<string, HTMLElement>();
  let draggingCaptureId: string | null = null;
  let dropTargetCaseEl: HTMLElement | null = null;

  type ExplorerCapture = {
    session_id: string;
    file_name: string;
    size_bytes: number;
    created_at: string;
  };

  let explorerCaptures: ExplorerCapture[] = [];
  let explorerForceEmptyState = false;
  let uploadIndicatorTimer: number | null = null;

  void refreshExplorerCaptures();

  workflows = loadWorkflows();
  if (!workflows.length) {
    workflows = defaultWorkflows();
  }
  const firstAuto = workflows.find((w) => w.autoRun);
  if (firstAuto) {
    for (const w of workflows) {
      if (w.id !== firstAuto.id) w.autoRun = false;
    }
  }
  saveWorkflows(workflows);
  setSelectedWorkflow(firstAuto?.id ?? workflows[0]?.id ?? null);

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

  const formatPacketCount = (count: number) => count.toLocaleString();

  const EXPORT_SETTINGS_KEY = 'kisame.export.settings';
  type ExportSettings = {
    report: boolean;
    pdf: boolean;
    json: boolean;
    timeline: boolean;
    sessions: boolean;
    ioc: boolean;
  };

  const loadExportSettings = (): ExportSettings => {
    try {
      const raw = window.localStorage.getItem(EXPORT_SETTINGS_KEY);
      if (!raw) throw new Error('missing');
      const parsed = JSON.parse(raw) as Partial<ExportSettings>;
      return {
        report: parsed.report ?? true,
        pdf: parsed.pdf ?? false,
        json: parsed.json ?? true,
        timeline: parsed.timeline ?? true,
        sessions: parsed.sessions ?? true,
        ioc: parsed.ioc ?? true,
      };
    } catch {
      return { report: true, pdf: false, json: true, timeline: true, sessions: true, ioc: true };
    }
  };

  const saveExportSettings = (settings: ExportSettings) => {
    window.localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(settings));
  };

  const exportInputs = {
    report: ui.exportReportCheckbox,
    pdf: ui.exportPdfCheckbox,
    json: ui.exportJsonCheckbox,
    timeline: ui.exportTimelineCheckbox,
    sessions: ui.exportSessionsCheckbox,
    ioc: ui.exportIocCheckbox,
  };

  const applyExportSettings = (settings: ExportSettings) => {
    exportInputs.report.checked = settings.report;
    exportInputs.json.checked = settings.json;
    exportInputs.timeline.checked = settings.timeline;
    exportInputs.sessions.checked = settings.sessions;
    exportInputs.ioc.checked = settings.ioc;
  };

  const collectExportSettings = (): ExportSettings => ({
    report: exportInputs.report.checked,
    pdf: exportInputs.pdf.checked,
    json: exportInputs.json.checked,
    timeline: exportInputs.timeline.checked,
    sessions: exportInputs.sessions.checked,
    ioc: exportInputs.ioc.checked,
  });

  applyExportSettings(loadExportSettings());
  Object.values(exportInputs).forEach((input) => {
    input.addEventListener('change', () => saveExportSettings(collectExportSettings()));
  });

  const formatIso = (ts?: number | null) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toISOString();
  };

  const csvEscape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const buildEndpoint = (ep: { ip: string; port: number | null }) =>
    `${ep.ip}${ep.port ? `:${ep.port}` : ''}`;

  const extractIocs = (artifact: AnalysisArtifact) => {
    const dns = new Set<string>();
    const sni = new Set<string>();
    const hosts = new Set<string>();
    const ips = new Set<string>();
    for (const session of artifact.sessions) {
      ips.add(session.endpoints.a.ip);
      ips.add(session.endpoints.b.ip);
    }
    for (const event of artifact.timeline) {
      if (event.meta?.dns_name) dns.add(event.meta.dns_name);
      if (event.meta?.sni) sni.add(event.meta.sni);
      if (event.meta?.http?.host) hosts.add(event.meta.http.host);
    }
    return {
      dns: Array.from(dns).sort(),
      sni: Array.from(sni).sort(),
      hosts: Array.from(hosts).sort(),
      ips: Array.from(ips).sort(),
    };
  };

  const buildMarkdownReport = (artifact: AnalysisArtifact) => {
    const lines: string[] = [];
    const iocs = extractIocs(artifact);

    lines.push(`# Kisame Forensics Report`);
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Capture Summary');
    lines.push('');
    lines.push(`- File: \`${artifact.pcap.file_name}\``);
    lines.push(`- Session ID: \`${artifact.pcap.session_id}\``);
    lines.push(`- Packets analyzed: ${artifact.pcap.packets_analyzed}`);
    lines.push(`- Time range: ${formatIso(artifact.pcap.first_ts)} → ${formatIso(artifact.pcap.last_ts)}`);
    lines.push(`- Sessions: ${artifact.sessions.length}`);
    lines.push(`- Timeline events: ${artifact.timeline.length}`);
    if (artifact.tooling?.tshark_path) {
      lines.push(`- TShark: \`${artifact.tooling.tshark_path}\` (${artifact.tooling.tshark_version ?? 'unknown'})`);
    }

    lines.push('');
    lines.push('## Session Summary');
    lines.push('');
    lines.push('| Session | Transport | Endpoints | Packets | Bytes | Flags |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const session of artifact.sessions) {
      const flags = session.rule_flags?.join(', ') ?? '';
      lines.push(
        `| ${session.id} | ${session.transport} | ${buildEndpoint(session.endpoints.a)} ↔ ${buildEndpoint(
          session.endpoints.b
        )} | ${session.packet_count} | ${formatBytes(session.byte_count)} | ${flags} |`
      );
    }

    lines.push('');
    lines.push('## Timeline');
    lines.push('');
    lines.push('| Timestamp | Kind | Summary | Evidence |');
    lines.push('| --- | --- | --- | --- |');
    for (const event of artifact.timeline) {
      lines.push(
        `| ${formatIso(event.ts)} | ${event.kind} | ${event.summary.replace(/\|/g, '\\|')} | #${event.evidence_frame} |`
      );
    }

    lines.push('');
    lines.push('## Indicators');
    lines.push('');
    lines.push(`- IPs: ${iocs.ips.join(', ') || '—'}`);
    lines.push(`- DNS: ${iocs.dns.join(', ') || '—'}`);
    lines.push(`- SNI: ${iocs.sni.join(', ') || '—'}`);
    lines.push(`- HTTP Hosts: ${iocs.hosts.join(', ') || '—'}`);

    return lines.join('\n');
  };

  const buildReportHtml = (markdown: string) => {
    const escapeHtml = (input: string) =>
      input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const lines = markdown.split('\n');
    const html: string[] = [];
    let inList = false;
    let inTable = false;
    let tableBuffer: string[] = [];

    const flushList = () => {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
    };

    const flushTable = () => {
      if (!inTable) return;
      const rows = tableBuffer.map((row) =>
        row
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim())
      );
      if (rows.length >= 2) {
        const header = rows[0];
        const body = rows.slice(2);
        html.push('<table>');
        html.push('<thead><tr>');
        for (const cell of header) {
          html.push(`<th>${escapeHtml(cell)}</th>`);
        }
        html.push('</tr></thead>');
        html.push('<tbody>');
        for (const row of body) {
          html.push('<tr>');
          for (const cell of row) {
            html.push(`<td>${escapeHtml(cell)}</td>`);
          }
          html.push('</tr>');
        }
        html.push('</tbody></table>');
      }
      tableBuffer = [];
      inTable = false;
    };

    const isTableSeparator = (line: string) => /^\|\s*-{3,}/.test(line);

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i] ?? '';
      const line = raw.trimEnd();
      if (!line) {
        flushList();
        flushTable();
        continue;
      }

      if (line.startsWith('|') && line.endsWith('|')) {
        inTable = true;
        tableBuffer.push(line);
        continue;
      }

      if (inTable && isTableSeparator(line)) {
        tableBuffer.push(line);
        continue;
      }

      flushTable();

      if (line.startsWith('### ')) {
        flushList();
        html.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
        continue;
      }
      if (line.startsWith('## ')) {
        flushList();
        html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
        continue;
      }
      if (line.startsWith('# ')) {
        flushList();
        html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
        continue;
      }
      if (line.startsWith('- ')) {
        if (!inList) {
          html.push('<ul>');
          inList = true;
        }
        html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
        continue;
      }

      flushList();
      html.push(`<p>${escapeHtml(line)}</p>`);
    }

    flushList();
    flushTable();

    const bodyHtml = html.join('\n');

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Kisame Report</title>
    <style>
      :root {
        --ink: #0c0f12;
        --muted: #60666f;
        --line: #d5dae0;
        --panel: #f6f7f9;
        --accent: #3c7f7f;
      }
      body {
        font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif;
        margin: 40px 48px;
        color: var(--ink);
        background: white;
        line-height: 1.55;
      }
      h1 {
        font-size: 26px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        margin: 0 0 18px;
      }
      h2 {
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--accent);
        margin: 28px 0 8px;
      }
      h3 {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        margin: 20px 0 6px;
      }
      p {
        margin: 6px 0 10px;
        color: var(--muted);
        font-size: 12px;
      }
      ul {
        margin: 6px 0 12px 16px;
        padding: 0;
        font-size: 12px;
        color: var(--muted);
      }
      li { margin: 4px 0; }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 10px 0 16px;
        font-size: 11px;
        background: var(--panel);
      }
      th, td {
        border: 1px solid var(--line);
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
      }
      th {
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 10px;
        color: var(--ink);
        background: #eef1f5;
      }
      @page {
        margin: 18mm;
      }
      .footer {
        margin-top: 36px;
        font-size: 10px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    ${bodyHtml}
    <div class="footer">Generated by Kisame • Forensic export</div>
  </body>
</html>`;
  };

  const fetchReportMarkdown = async (artifact: AnalysisArtifact) => {
    try {
      const res = await fetch(`${explanationBaseUrl}/report`, {
        method: 'POST',
        headers: withClientHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ artifact }),
      });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as { report_markdown?: string };
      if (!data?.report_markdown) return null;
      return data.report_markdown;
    } catch {
      return null;
    }
  };

  const buildTimelineCsv = (artifact: AnalysisArtifact) => {
    const rows = [
      ['timestamp', 'session_id', 'kind', 'summary', 'evidence_frame', 'dns', 'sni', 'http_method', 'http_host', 'http_uri'],
    ];
    for (const event of artifact.timeline) {
      rows.push([
        formatIso(event.ts),
        event.session_id,
        event.kind,
        event.summary,
        String(event.evidence_frame),
        event.meta?.dns_name ?? '',
        event.meta?.sni ?? '',
        event.meta?.http?.method ?? '',
        event.meta?.http?.host ?? '',
        event.meta?.http?.uri ?? '',
      ]);
    }
    return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  };

  const buildSessionsCsv = (artifact: AnalysisArtifact) => {
    const rows = [
      ['session_id', 'transport', 'endpoint_a', 'endpoint_b', 'first_ts', 'last_ts', 'duration_seconds', 'packets', 'bytes', 'flags'],
    ];
    for (const session of artifact.sessions) {
      rows.push([
        session.id,
        session.transport,
        buildEndpoint(session.endpoints.a),
        buildEndpoint(session.endpoints.b),
        formatIso(session.first_ts),
        formatIso(session.last_ts),
        session.duration_seconds?.toFixed(2) ?? '',
        String(session.packet_count),
        String(session.byte_count),
        session.rule_flags?.join(';') ?? '',
      ]);
    }
    return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  };

  const buildIocTxt = (artifact: AnalysisArtifact) => {
    const iocs = extractIocs(artifact);
    return [
      '# Kisame IOC Summary',
      '',
      '[IP]',
      ...iocs.ips,
      '',
      '[DNS]',
      ...iocs.dns,
      '',
      '[SNI]',
      ...iocs.sni,
      '',
      '[HTTP_HOST]',
      ...iocs.hosts,
      '',
    ].join('\n');
  };

  const updateExportSummary = () => {
    if (!analysis) {
      ui.exportSummary.textContent = 'Load a capture to see export coverage.';
      ui.exportStatus.textContent = 'Ready to export.';
      ui.exportButton.disabled = true;
      ui.exportBundleButton.disabled = true;
      ui.exportButton.classList.add('opacity-50');
      ui.exportBundleButton.classList.add('opacity-50');
      return;
    }
    ui.exportButton.disabled = false;
    ui.exportBundleButton.disabled = false;
    ui.exportButton.classList.remove('opacity-50');
    ui.exportBundleButton.classList.remove('opacity-50');
    const summaryLines = [
      `File: ${analysis.pcap.file_name}`,
      `Sessions: ${analysis.sessions.length}`,
      `Timeline events: ${analysis.timeline.length}`,
      `Packets analyzed: ${analysis.pcap.packets_analyzed}`,
      `Time range: ${formatIso(analysis.pcap.first_ts)} → ${formatIso(analysis.pcap.last_ts)}`,
    ];
    ui.exportSummary.textContent = summaryLines.join('\n');
    ui.exportStatus.textContent = 'Ready to export.';
  };

  type ExportFile = { name: string; content: string; mime: string };

  const buildExportFiles = (artifact: AnalysisArtifact, settings: ExportSettings): ExportFile[] => {
    const files: ExportFile[] = [];
    const baseName = artifact.pcap.file_name.replace(/\.(pcap|pcapng)$/i, '') || 'capture';

    if (settings.report) {
      files.push({
        name: `${baseName}.report.md`,
        content: buildMarkdownReport(artifact),
        mime: 'text/markdown',
      });
    }
    if (settings.json) {
      files.push({
        name: `${baseName}.analysis.json`,
        content: JSON.stringify(artifact, null, 2),
        mime: 'application/json',
      });
    }
    if (settings.timeline) {
      files.push({
        name: `${baseName}.timeline.csv`,
        content: buildTimelineCsv(artifact),
        mime: 'text/csv',
      });
    }
    if (settings.sessions) {
      files.push({
        name: `${baseName}.sessions.csv`,
        content: buildSessionsCsv(artifact),
        mime: 'text/csv',
      });
    }
    if (settings.ioc) {
      files.push({
        name: `${baseName}.ioc.txt`,
        content: buildIocTxt(artifact),
        mime: 'text/plain',
      });
    }
    return files;
  };

  const performExport = async (bundle: boolean) => {
    if (!analysis) {
      ui.exportStatus.textContent = 'No capture loaded.';
      return;
    }
    const settings = collectExportSettings();
    const files = buildExportFiles(analysis, settings);
    if (!files.length && !settings.pdf) {
      ui.exportStatus.textContent = 'Select at least one export format.';
      return;
    }

    ui.exportStatus.textContent = bundle ? 'Preparing bundle…' : 'Preparing export…';

    let reportMarkdown: string | null = null;
    if (settings.report || settings.pdf) {
      reportMarkdown = (await fetchReportMarkdown(analysis)) ?? buildMarkdownReport(analysis);
      if (settings.report) {
        const reportFile = files.find((f) => f.name.endsWith('.report.md'));
        if (reportFile && reportMarkdown) {
          reportFile.content = reportMarkdown;
        }
      }
    }

    if (bundle || files.length > 1) {
      const res = await window.electronAPI?.saveExportBundle?.({
        folderName: analysis.pcap.file_name.replace(/\.(pcap|pcapng)$/i, '') || 'kisame-export',
        files: files.map((f) => ({ name: f.name, content: f.content })),
      });
      if (!res || res.canceled) {
        ui.exportStatus.textContent = 'Export canceled.';
        return;
      }
      if (settings.pdf && reportMarkdown) {
        await window.electronAPI?.saveExportPdf?.({
          html: buildReportHtml(reportMarkdown),
          fileName: `${analysis.pcap.file_name.replace(/\.(pcap|pcapng)$/i, '') || 'capture'}.report.pdf`,
          folderPath: res.folderPath,
        });
      }
      ui.exportStatus.textContent = `Exported ${files.length + (settings.pdf ? 1 : 0)} files.`;
      return;
    }

    if (files.length) {
      const file = files[0];
      const res = await window.electronAPI?.saveExportFile?.({
        suggestedName: file.name,
        content: file.content,
        filters: [{ name: 'Export', extensions: [file.name.split('.').pop() ?? 'txt'] }],
      });
      if (!res || res.canceled) {
        ui.exportStatus.textContent = 'Export canceled.';
        return;
      }
    }
    if (settings.pdf && reportMarkdown) {
      const pdfRes = await window.electronAPI?.saveExportPdf?.({
        html: buildReportHtml(reportMarkdown),
        suggestedName: `${analysis.pcap.file_name.replace(/\.(pcap|pcapng)$/i, '') || 'capture'}.report.pdf`,
      });
      if (!pdfRes || pdfRes.canceled) {
        ui.exportStatus.textContent = 'Export canceled.';
        return;
      }
    }
    ui.exportStatus.textContent = 'Export complete.';
  };

  function loadWorkflows(): Workflow[] {
    try {
      const raw = window.localStorage.getItem(WORKFLOWS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { workflows?: Workflow[] } | Workflow[];
      const list = Array.isArray(parsed) ? parsed : parsed.workflows ?? [];
      return list
        .filter((w): w is Workflow => Boolean(w && typeof (w as any).id === 'string'))
        .map((w) => ({
          id: String(w.id),
          name: typeof w.name === 'string' && w.name.trim() ? w.name.trim() : 'Untitled Workflow',
          prompts: Array.isArray(w.prompts) ? w.prompts.filter((p) => typeof p === 'string' && p.trim()) : [],
          contextMode: w.contextMode === 'session' ? 'session' : 'capture',
          autoRun: Boolean(w.autoRun),
          createdAt: typeof w.createdAt === 'string' ? w.createdAt : new Date().toISOString(),
          updatedAt: typeof w.updatedAt === 'string' ? w.updatedAt : new Date().toISOString(),
        }));
    } catch {
      return [];
    }
  }

  function saveWorkflows(list: Workflow[]) {
    workflows = list;
    try {
      window.localStorage.setItem(WORKFLOWS_STORAGE_KEY, JSON.stringify({ workflows: list }));
    } catch {
      // Ignore persistence errors.
    }
  }

  function defaultWorkflows(): Workflow[] {
    const now = new Date().toISOString();
    return [
      {
        id: crypto.randomUUID(),
        name: 'Forensics Triage (Top IPs/Ports/Protocols)',
        contextMode: 'capture',
        autoRun: true,
        prompts: [
          'Show the most used IP addresses (top talkers) and explain why they stand out. Include evidence frames where possible.',
          'Show the most used ports and the protocol distribution. Call out anything unusual for typical enterprise traffic.',
          'List suspicious or flagged sessions and summarize what each might indicate.',
          'Give a high-level timeline summary of key events (DNS/TLS/HTTP) and point to evidence frames.',
        ],
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  function normalizePromptsFromText(text: string): string[] {
    return text
      .split('\n')
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean);
  }

  type WorkflowModalIntent = 'primary' | 'danger' | 'neutral';
  type WorkflowModalResult = { action: 'confirm'; selectedId?: string | null } | { action: 'cancel' };
  type WorkflowModalConfig = {
    title: string;
    subtitle?: string;
    body?: string;
    workflows?: Workflow[];
    defaultId?: string | null;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmIntent?: WorkflowModalIntent;
    showCancel?: boolean;
  };

  const workflowModalConfirmBase =
    'cyber-btn px-3 py-2 text-[10px] font-[var(--font-display)] tracking-[0.2em] uppercase';
  const workflowModalCancelClass =
    'cyber-btn px-3 py-2 text-[10px] font-[var(--font-display)] tracking-[0.2em] text-white/60 uppercase';
  const workflowModalIntentClass: Record<WorkflowModalIntent, string> = {
    primary: 'text-[var(--accent-teal)]',
    danger: 'text-[var(--accent-red)]',
    neutral: 'text-white/70',
  };

  let workflowModalResolve: ((result: WorkflowModalResult) => void) | null = null;
  let workflowModalCleanup: (() => void) | null = null;
  let workflowModalSelectedId: string | null = null;

  function setWorkflowModalOpen(open: boolean) {
    ui.workflowModalOverlay.classList.toggle('hidden', !open);
    ui.workflowModalOverlay.classList.toggle('flex', open);
    ui.workflowModalOverlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function closeWorkflowModal(result: WorkflowModalResult) {
    if (!workflowModalResolve) return;
    setWorkflowModalOpen(false);
    ui.workflowModalList.replaceChildren();
    ui.workflowModalError.textContent = '';
    ui.workflowModalError.classList.add('hidden');
    workflowModalCleanup?.();
    workflowModalCleanup = null;
    const resolve = workflowModalResolve;
    workflowModalResolve = null;
    workflowModalSelectedId = null;
    resolve(result);
  }

  function openWorkflowModal(config: WorkflowModalConfig): Promise<WorkflowModalResult> {
    if (workflowModalResolve) {
      closeWorkflowModal({ action: 'cancel' });
    }

    const showCancel = config.showCancel !== false;
    const hasWorkflows = Boolean(config.workflows && config.workflows.length);
    workflowModalSelectedId = config.defaultId ?? config.workflows?.[0]?.id ?? null;

    ui.workflowModalTitle.textContent = config.title;
    ui.workflowModalSubtitle.textContent = config.subtitle ?? '';
    ui.workflowModalSubtitle.classList.toggle('hidden', !config.subtitle);
    ui.workflowModalBody.textContent = config.body ?? '';
    ui.workflowModalBody.classList.toggle('hidden', !config.body);

    ui.workflowModalList.replaceChildren();
    ui.workflowModalList.classList.toggle('hidden', !hasWorkflows);

    if (hasWorkflows) {
      const rows = config.workflows!.map((wf) => {
        const defaultTag =
          config.defaultId && config.defaultId === wf.id
            ? el('div', {
                className: 'mt-2 text-[9px] font-[var(--font-mono)] text-[var(--accent-teal)]/70 uppercase tracking-wider',
                text: 'DEFAULT ON LOAD',
              })
            : el('div', { className: 'mt-2 text-[9px] font-[var(--font-mono)] text-white/10', text: ' ' });

        const row = el('button', {
          className: 'w-full rounded px-3 py-3 text-left transition-all data-card',
          attrs: { type: 'button', 'data-workflow-id': wf.id, 'aria-pressed': 'false' },
          children: [
            el('div', {
              className: 'flex items-center justify-between gap-2',
              children: [
                el('div', { className: 'text-[11px] font-[var(--font-mono)] text-white/80 truncate', text: wf.name }),
                el('div', { className: 'text-[9px] font-[var(--font-mono)] text-white/35', text: `${wf.prompts.length} steps` }),
              ],
            }),
            el('div', {
              className: 'mt-1 text-[9px] font-[var(--font-mono)] text-white/30 uppercase tracking-wider',
              text: wf.contextMode === 'session' ? 'SESSION CONTEXT' : 'CAPTURE CONTEXT',
            }),
            defaultTag,
          ],
        }) as HTMLButtonElement;

        if (wf.id === workflowModalSelectedId) {
          row.classList.add('selected');
          row.setAttribute('aria-pressed', 'true');
        }

        row.addEventListener('click', () => {
          workflowModalSelectedId = wf.id;
          const children = Array.from(ui.workflowModalList.children) as HTMLElement[];
          for (const child of children) {
            const isSelected = child.getAttribute('data-workflow-id') === wf.id;
            child.classList.toggle('selected', isSelected);
            child.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
          }
          ui.workflowModalConfirmButton.disabled = false;
          ui.workflowModalConfirmButton.classList.remove('opacity-60');
        });

        row.addEventListener('dblclick', () => {
          closeWorkflowModal({ action: 'confirm', selectedId: wf.id });
        });

        return row;
      });

      ui.workflowModalList.replaceChildren(...rows);
    }

    ui.workflowModalError.textContent = '';
    ui.workflowModalError.classList.add('hidden');

    const confirmIntent = config.confirmIntent ?? 'primary';
    ui.workflowModalConfirmButton.textContent = config.confirmLabel ?? (hasWorkflows ? 'RUN' : 'OK');
    ui.workflowModalConfirmButton.className = `${workflowModalConfirmBase} ${workflowModalIntentClass[confirmIntent]}`;
    const confirmDisabled = hasWorkflows && !workflowModalSelectedId;
    ui.workflowModalConfirmButton.disabled = confirmDisabled;
    ui.workflowModalConfirmButton.classList.toggle('opacity-60', confirmDisabled);

    ui.workflowModalCancelButton.textContent = config.cancelLabel ?? 'CANCEL';
    ui.workflowModalCancelButton.className = workflowModalCancelClass;
    ui.workflowModalCancelButton.classList.toggle('hidden', !showCancel);

    const onCancel = () => {
      if (showCancel) {
        closeWorkflowModal({ action: 'cancel' });
      } else {
        closeWorkflowModal({ action: 'confirm' });
      }
    };

    const onConfirm = () => {
      if (hasWorkflows && !workflowModalSelectedId) {
        ui.workflowModalError.textContent = 'Select a workflow to continue.';
        ui.workflowModalError.classList.remove('hidden');
        return;
      }
      closeWorkflowModal({ action: 'confirm', selectedId: workflowModalSelectedId });
    };

    const onOverlayClick = (event: MouseEvent) => {
      if (event.target === ui.workflowModalOverlay) {
        onCancel();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
      if (event.key === 'Enter' && !ui.workflowModalConfirmButton.disabled) {
        event.preventDefault();
        onConfirm();
      }
    };

    ui.workflowModalCancelButton.addEventListener('click', onCancel);
    ui.workflowModalConfirmButton.addEventListener('click', onConfirm);
    ui.workflowModalOverlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeyDown);

    workflowModalCleanup = () => {
      ui.workflowModalCancelButton.removeEventListener('click', onCancel);
      ui.workflowModalConfirmButton.removeEventListener('click', onConfirm);
      ui.workflowModalOverlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeyDown);
    };

    setWorkflowModalOpen(true);
    requestAnimationFrame(() => {
      if (hasWorkflows) {
        const selected = ui.workflowModalList.querySelector('[aria-pressed="true"]') as HTMLElement | null;
        selected?.focus();
      } else {
        ui.workflowModalConfirmButton.focus();
      }
    });

    return new Promise((resolve) => {
      workflowModalResolve = resolve;
    });
  }

  function renderWorkflowsUI() {
    if (!workflows.length) {
      ui.workflowList.replaceChildren(
        el('div', {
          className: 'flex flex-col items-center justify-center py-8 text-center',
          children: [
            el('div', { className: 'data-label mb-1', text: 'NO WORKFLOWS' }),
            el('div', {
              className: 'text-[10px] text-white/30',
              text: 'Create a workflow to automate your starting prompts.',
            }),
          ],
        })
      );
      return;
    }

    const rows = workflows.map((wf) => {
      const row = el('button', {
        className: 'w-full rounded px-3 py-3 text-left transition-all data-card workflow-card',
        attrs: { type: 'button', 'data-workflow-id': wf.id },
        children: [
          el('div', {
            className: 'flex items-center justify-between gap-2',
            children: [
              el('div', { className: 'text-[11px] font-[var(--font-mono)] text-white/80 truncate', text: wf.name }),
              el('div', { className: 'text-[9px] font-[var(--font-mono)] text-white/35', text: `${wf.prompts.length} steps` }),
            ],
          }),
          el('div', {
            className: 'mt-1 text-[9px] font-[var(--font-mono)] text-white/30 uppercase tracking-wider',
            text: wf.contextMode === 'session' ? 'SESSION CONTEXT' : 'CAPTURE CONTEXT',
          }),
          wf.autoRun
            ? el('div', {
                className: 'mt-2 text-[9px] font-[var(--font-mono)] text-[var(--accent-teal)]/70 uppercase tracking-wider',
                text: 'DEFAULT ON LOAD',
              })
            : el('div', { className: 'mt-2 text-[9px] font-[var(--font-mono)] text-white/10', text: ' ' }),
        ],
      }) as HTMLButtonElement;

      row.classList.toggle('selected', wf.id === selectedWorkflowId);
      return row;
    });

    ui.workflowList.replaceChildren(...rows);
  }

  function setSelectedWorkflow(id: string | null) {
    selectedWorkflowId = id;
    renderWorkflowsUI();

    const wf = workflows.find((w) => w.id === id) ?? null;
    ui.workflowNameInput.value = wf?.name ?? '';
    ui.workflowScopeSelect.value = wf?.contextMode ?? 'capture';
    ui.workflowPromptsInput.value = (wf?.prompts ?? []).join('\n');
    ui.workflowAutoRunCheckbox.checked = Boolean(wf?.autoRun);
  }

  function readWorkflowFromEditor(): {
    name: string;
    prompts: string[];
    contextMode: WorkflowContextMode;
    autoRun: boolean;
  } {
    const name = ui.workflowNameInput.value.trim() || 'Untitled Workflow';
    const contextMode = ui.workflowScopeSelect.value === 'session' ? 'session' : 'capture';
    const prompts = normalizePromptsFromText(ui.workflowPromptsInput.value);
    const autoRun = ui.workflowAutoRunCheckbox.checked;
    return { name, prompts, contextMode, autoRun };
  }

  function upsertWorkflowFromEditor(existingId?: string | null) {
    const now = new Date().toISOString();
    const { name, prompts, contextMode, autoRun } = readWorkflowFromEditor();

    const id = existingId ?? crypto.randomUUID();
    const prev = workflows.find((w) => w.id === id);
    const next: Workflow = {
      id,
      name,
      prompts,
      contextMode,
      autoRun,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };

    const merged = workflows.map((w) => (w.id === id ? next : { ...w, autoRun: autoRun ? false : w.autoRun }));
    const exists = merged.some((w) => w.id === id);
    const finalList = exists ? merged : [next, ...merged];

    if (autoRun) {
      for (const w of finalList) {
        if (w.id !== id) w.autoRun = false;
      }
    }

    saveWorkflows(finalList);
    setSelectedWorkflow(id);
  }

  async function deleteSelectedWorkflow() {
    if (!selectedWorkflowId) return;
    const wf = workflows.find((w) => w.id === selectedWorkflowId);
    if (!wf) return;
    const result = await openWorkflowModal({
      title: 'Delete workflow?',
      subtitle: 'WORKFLOWS',
      body: `This will permanently remove "${wf.name}".`,
      confirmLabel: 'DELETE',
      cancelLabel: 'CANCEL',
      confirmIntent: 'danger',
    });
    if (result.action !== 'confirm') return;
    const next = workflows.filter((w) => w.id !== selectedWorkflowId);
    saveWorkflows(next);
    setSelectedWorkflow(next[0]?.id ?? null);
  }

  function setWorkflowControlsDisabled(disabled: boolean) {
    ui.workflowNewButton.disabled = disabled;
    ui.workflowSaveButton.disabled = disabled;
    ui.workflowRunButton.disabled = disabled;
    ui.workflowDeleteButton.disabled = disabled;
    ui.workflowNameInput.disabled = disabled;
    ui.workflowScopeSelect.disabled = disabled;
    ui.workflowPromptsInput.disabled = disabled;
    ui.workflowAutoRunCheckbox.disabled = disabled;
    ui.workflowRunButton.classList.toggle('opacity-60', disabled);
  }

  function getAutoRunWorkflow(): Workflow | null {
    return workflows.find((w) => w.autoRun && w.prompts.length > 0) ?? null;
  }

  async function runWorkflow(workflow: Workflow): Promise<void> {
    if (isWorkflowRunning) return;
    if (!analysis) {
      await openWorkflowModal({
        title: 'Workflow unavailable',
        subtitle: 'WORKFLOWS',
        body: 'Load a capture first.',
        confirmLabel: 'OK',
        confirmIntent: 'neutral',
        showCancel: false,
      });
      return;
    }
    if (!workflow.prompts.length) return;

    isWorkflowRunning = true;
    setWorkflowControlsDisabled(true);
    ui.workflowRunButton.classList.add('btn-loading');
    
    const workflowRow = ui.workflowList.querySelector(`[data-workflow-id="${workflow.id}"]`);
    if (workflowRow) {
      workflowRow.classList.add('pulse-attention');
    }

    try {
      for (let i = 0; i < workflow.prompts.length; i++) {
        const prompt = workflow.prompts[i];
        const display = `[Workflow: ${workflow.name} ${i + 1}/${workflow.prompts.length}] ${prompt}`;
        await sendChatQueryText(prompt, { displayText: display, contextMode: workflow.contextMode });
      }
    } finally {
      isWorkflowRunning = false;
      setWorkflowControlsDisabled(false);
      ui.workflowRunButton.classList.remove('btn-loading');
      ui.workflowRunButton.textContent = 'RUN';
      if (workflowRow) {
        workflowRow.classList.remove('pulse-attention');
      }
    }
  }

  async function maybeRunAutoWorkflowAfterCaptureLoad(): Promise<void> {
    if (isWorkflowRunning) return;
    if (!analysis) return;
    const wf = getAutoRunWorkflow();
    if (!wf) return;
    await runWorkflow(wf);
  }

  function schedulePromptRunWorkflowAfterCaptureLoad(): void {
    if (workflowPromptTimer) {
      window.clearTimeout(workflowPromptTimer);
      workflowPromptTimer = null;
    }
    workflowPromptTimer = window.setTimeout(() => {
      workflowPromptTimer = null;
      void maybeRunAutoWorkflowAfterCaptureLoad();
    }, 0);
  }

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

  const clearDropTarget = () => {
    if (!dropTargetCaseEl) return;
    dropTargetCaseEl.classList.remove('is-drop-target');
    dropTargetCaseEl = null;
  };

  const setDropTarget = (target: HTMLElement | null) => {
    if (dropTargetCaseEl === target) return;
    clearDropTarget();
    if (target) {
      target.classList.add('is-drop-target');
      dropTargetCaseEl = target;
    }
  };

  const setExplorerPromptVisible = (visible: boolean) => {
    ui.explorerPrompt.classList.toggle('hidden', !visible);
  };

  function renderExplorerCaptures() {
    explorerElements.clear();
    setExplorerPromptVisible(uploadWorkspacePrompt);
    if (explorerForceEmptyState) {
      ui.explorerList.replaceChildren(ui.explorerEmptyState);
      return;
    }

    const visibleWorkspaces = getVisibleWorkspaces();
    const captureBuckets = new Map<string, ExplorerCapture[]>();
    for (const capture of explorerCaptures) {
      const workspaceId = workspaceAssignments[capture.session_id] ?? 'default';
      const bucket = captureBuckets.get(workspaceId);
      if (bucket) {
        bucket.push(capture);
      } else {
        captureBuckets.set(workspaceId, [capture]);
      }
    }

    const rows: HTMLElement[] = [];

    for (const workspace of visibleWorkspaces) {
      const workspaceId = workspace.id;
      const workspaceCaptures = captureBuckets.get(workspaceId) ?? [];
      const workspaceExpanded = expandedWorkspaceIds.has(workspaceId);

      const workspaceRow = el('button', {
        className:
          'explorer-node explorer-node--workspace w-full rounded px-3 py-2 text-left transition-all',
        attrs: {
          type: 'button',
          'data-node-kind': 'workspace',
          'data-workspace-id': workspaceId,
          'data-expanded': workspaceExpanded ? 'true' : 'false',
        },
      });
      if (selectedWorkspaceId !== 'all' && selectedWorkspaceId === workspaceId) {
        workspaceRow.classList.add('is-selected');
      }

      const workspaceLeft = el('div', { className: 'flex items-center gap-2 min-w-0' });
      const workspaceToggle = el('span', {
        className: 'explorer-toggle text-white/40',
        text: workspaceExpanded ? '▾' : '▸',
      });
      const workspaceLabel = el('span', {
        className: 'text-[10px] font-[var(--font-mono)] tracking-wider text-white/70 uppercase truncate',
        text: workspace.name,
      });
      workspaceLeft.append(workspaceToggle, workspaceLabel);

      const workspaceCount = el('span', {
        className: 'text-[9px] font-[var(--font-mono)] text-white/35',
        text: `${workspaceCaptures.length}`,
      });

      const workspaceRowInner = el('div', {
        className: 'flex items-center justify-between w-full',
        children: [workspaceLeft, workspaceCount],
      });
      workspaceRow.append(workspaceRowInner);
      rows.push(workspaceRow);

      if (!workspaceExpanded) continue;

      const workspaceCases = getCasesForWorkspace(workspaceId);
      const caseBuckets = new Map<string, ExplorerCapture[]>();
      for (const capture of workspaceCaptures) {
        const assignedCaseId = caseAssignments[capture.session_id] ?? getDefaultCaseId(workspaceId);
        const bucket = caseBuckets.get(assignedCaseId);
        if (bucket) bucket.push(capture);
        else caseBuckets.set(assignedCaseId, [capture]);
      }

      if (caseDraftWorkspaceId === workspaceId) {
        const draftRow = el('div', {
          className:
            'explorer-node explorer-node--case explorer-node--draft w-full rounded px-3 py-2 text-left transition-all',
          attrs: { 'data-case-draft': 'true' },
        });
        const draftInner = el('div', { className: 'pl-4' });
        const draftInput = el('input', {
          className:
            'explorer-inline-input w-full bg-transparent text-[11px] font-[var(--font-mono)] tracking-wider text-white/80 focus:outline-none',
          attrs: { type: 'text', placeholder: 'New case name' },
        }) as HTMLInputElement;
        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          createCaseForWorkspace(draftInput.value, workspaceId);
        };
        draftInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            clearCaseDraft();
            renderExplorerCaptures();
          }
        });
        draftInput.addEventListener('blur', () => {
          commit();
        });
        draftInner.append(draftInput);
        draftRow.append(draftInner);
        rows.push(draftRow);
        if (caseDraftNeedsFocus) {
          caseDraftNeedsFocus = false;
          requestAnimationFrame(() => {
            draftInput.focus();
            draftInput.select();
          });
        }
      }

      for (const caseFile of workspaceCases) {
        const caseId = caseFile.id;
        const caseCaptures = caseBuckets.get(caseId) ?? [];
        const caseExpanded = expandedCaseIds.has(caseId);
        const caseRow = el('button', {
          className:
            'explorer-node explorer-node--case w-full rounded px-3 py-2 text-left transition-all',
          attrs: {
            type: 'button',
            'data-node-kind': 'case',
            'data-case-id': caseId,
            'data-workspace-id': workspaceId,
            'data-expanded': caseExpanded ? 'true' : 'false',
          },
        });
        if (selectedCaseId === caseId) {
          caseRow.classList.add('is-selected');
        }

        const caseLeft = el('div', { className: 'flex items-center gap-2 min-w-0' });
        const caseToggle = el('span', {
          className: 'explorer-toggle text-white/30',
          text: caseExpanded ? '▾' : '▸',
        });
        const caseLabel = el('span', {
          className: 'text-[10px] font-[var(--font-mono)] tracking-wider text-white/60 uppercase truncate',
          text: caseFile.name,
        });
        caseLeft.append(caseToggle, caseLabel);

        const caseCount = el('span', {
          className: 'text-[9px] font-[var(--font-mono)] text-white/30',
          text: `${caseCaptures.length}`,
        });

        const caseRowInner = el('div', {
          className: 'flex items-center justify-between w-full pl-4',
          children: [caseLeft, caseCount],
        });
        caseRow.append(caseRowInner);
        rows.push(caseRow);

        if (!caseExpanded) continue;

        if (!caseCaptures.length) {
          const emptyRow = el('div', {
            className: 'pl-8 py-1 text-[9px] font-[var(--font-mono)] text-white/20 uppercase tracking-wider',
            text: 'No captures yet',
          });
          rows.push(emptyRow);
          continue;
        }

        for (const capture of caseCaptures) {
          const row = el('button', {
            className:
              'w-full rounded px-3 py-2 text-left transition-all data-card pl-10',
            attrs: {
              type: 'button',
              draggable: 'true',
              'data-capture-id': capture.session_id,
            },
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
          rows.push(row);
        }
      }
    }

    ui.explorerList.replaceChildren(...rows);
    updateExplorerSelection();
  }

  async function refreshExplorerCaptures() {
    try {
      const res = await fetch(`${explanationBaseUrl}/pcap/list`, {
        headers: withClientHeaders(),
      });
      if (!res.ok) {
        if (res.status === 404) {
          explorerCaptures = [];
          explorerForceEmptyState = true;
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
        const workspaceId = workspaceAssignments[capture.session_id] ?? 'default';
        assignCaseIfMissing(capture.session_id, workspaceId);
      }
      saveWorkspaceAssignments(workspaceAssignments);
      saveCaseAssignments(caseAssignments);
      explorerForceEmptyState = false;
      setExplorerEmptyState(
        'NO FILES',
        'Open a PCAP file to begin forensic analysis'
      );
      renderExplorerCaptures();
    } catch {
      explorerCaptures = [];
      explorerForceEmptyState = true;
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
      updateExportSummary();
      render();
      setActiveTab('analyze');
      return;
    }
    await ensureBackendTsharkAvailable();
    const res = await fetch(`${explanationBaseUrl}/tools/analyzePcap`, {
      method: 'POST',
      headers: withClientHeaders({ 'content-type': 'application/json' }),
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
    updateExportSummary();
    setAnalyzeScreen('overview');
    render();
    setActiveTab('analyze');
  }

  function setWelcomeVisible(visible: boolean) {
    ui.welcomePanel.classList.toggle('hidden', !visible);
    document.body.classList.toggle('welcome-visible', visible);
  }

  function setAnalysisDetail(text: string) {
    ui.analysisDetail.replaceChildren(
      el('pre', {
        className: 'whitespace-pre-wrap text-xs text-white/60 leading-relaxed animate-fade-in',
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

    ui.analysisDetail.replaceChildren(
      el('div', {
        className: 'flex items-center gap-2 text-xs text-white/40 animate-fade-in',
        children: [
          el('div', { className: 'loading-spinner loading-spinner-sm' }),
          el('span', { text: 'Fetching explanation…' }),
        ],
      })
    );

    const requestId = ++explanationRequestSeq;
    try {
      const res = await fetch(`${explanationBaseUrl}/explain/session`, {
        method: 'POST',
        headers: withClientHeaders({ 'content-type': 'application/json' }),
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
    ui.sessionsList.replaceChildren();
    ui.timelineList.replaceChildren();
    ui.sessionsCount.textContent = '0';
    ui.timelineCount.textContent = '0';
    ui.analysisSummary.replaceChildren();
    setAnalysisDetail('');
    ui.sessionKeyBody.replaceChildren();
    ui.insightsBody.replaceChildren();
    sessionElements.clear();
    lastAnalysisRef = null;
    captureSessionId = null;
    updateExplorerSelection();
    syncNoCaptureUi();

    if (!ui.welcomePanel.classList.contains('hidden')) {
      // Add entrance animation to welcome panel
      ui.welcomePanel.classList.add('animate-fade-in-up');
      setTimeout(() => {
        ui.welcomePanel.classList.remove('animate-fade-in-up');
      }, 300);
    }
  }
  
  function showInterfaceModal() {
    ui.interfaceModalOverlay.classList.remove('hidden');
    ui.interfaceModalOverlay.classList.add('animate-fade-in');
    ui.interfaceModalPanel.classList.add('animate-scale-in');
    void loadInterfaces();
  }
  
  function hideInterfaceModal() {
    ui.interfaceModalOverlay.classList.add('hidden');
    ui.interfaceModalOverlay.classList.remove('animate-fade-in');
    ui.interfaceModalPanel.classList.remove('animate-scale-in');
  }
  
  async function loadInterfaces() {
    ui.interfaceModalList.classList.add('hidden');
    ui.interfaceModalError.classList.add('hidden');
    ui.interfaceModalLoading.classList.remove('hidden');
    
    try {
      const res = await fetch(`${explanationBaseUrl}/capture/interfaces`, {
        method: 'GET',
        headers: withClientHeaders({}),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Failed to load interfaces (${res.status}). ${msg}`);
      }
      const data = (await res.json()) as { interfaces: CaptureInterface[] };
      availableInterfaces = data.interfaces;
      renderInterfaceList();
    } catch (err) {
      ui.interfaceModalLoading.classList.add('hidden');
      ui.interfaceModalError.classList.remove('hidden');
      const errorMsg = ui.interfaceModalError.querySelector('[data-error-message]');
      if (errorMsg) {
        errorMsg.textContent = (err as Error).message ?? 'Unable to enumerate network interfaces.';
      }
    }
  }
  
  function renderInterfaceList() {
    ui.interfaceModalLoading.classList.add('hidden');
    ui.interfaceModalList.classList.remove('hidden');
    ui.interfaceModalList.replaceChildren();
    
    if (availableInterfaces.length === 0) {
      const emptyState = el('div', {
        className: 'text-center py-8 text-[11px] font-[var(--font-mono)] text-white/40',
        text: 'No network interfaces found.',
      });
      ui.interfaceModalList.append(emptyState);
      return;
    }
    
    const primary: CaptureInterface[] = [];
    const secondary: CaptureInterface[] = [];
    const virtual: CaptureInterface[] = [];
    
    for (const iface of availableInterfaces) {
      const name = iface.name.toLowerCase();
      const desc = (iface.description ?? '').toLowerCase();
      
      if (/^en\d+$/i.test(iface.name) || /^eth\d+$/i.test(iface.name) || 
          /ethernet/i.test(desc) || /wi-?fi/i.test(desc) || /wireless/i.test(desc) ||
          /^bridge\d+$/i.test(iface.name)) {
        primary.push(iface);
      }
      else if (/^lo\d*$/i.test(name) || /loopback/i.test(desc) || 
               /^utun\d+$/i.test(name) || /^awdl\d+$/i.test(name) ||
               /^llw\d+$/i.test(name) || /virtual/i.test(desc)) {
        virtual.push(iface);
      }
      else {
        secondary.push(iface);
      }
    }
    
    const renderSection = (title: string, interfaces: CaptureInterface[], isPrimary = false) => {
      if (interfaces.length === 0) return;
      
      const sectionLabel = el('div', {
        className: 'text-[9px] font-[var(--font-mono)] tracking-[0.15em] text-white/30 uppercase mb-2 mt-4 first:mt-0',
        text: title,
      });
      ui.interfaceModalList.append(sectionLabel);
      
      for (const iface of interfaces) {
        const isSelected = selectedInterfaceId === iface.id;
        const item = el('button', {
          className: `interface-item w-full flex items-center gap-4 p-4 rounded-lg border transition-all text-left group/item ${
            isSelected 
              ? 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/10' 
              : 'border-[var(--app-line)] bg-[var(--app-bg)] hover:border-[var(--accent-teal)]/40 hover:bg-[var(--app-bg-deep)]'
          }`,
          attrs: { type: 'button', 'data-interface-id': iface.id },
        });
        
        const iconType = isPrimary ? 'wifi' : /^lo/i.test(iface.name) ? 'loop' : 'network';
        const iconSvg = iconType === 'wifi' 
          ? `<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/></svg>`
          : iconType === 'loop'
          ? `<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>`
          : `<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"/></svg>`;
        
        const iconWrap = el('div', {
          className: `interface-icon flex items-center justify-center size-10 rounded-lg border transition-colors ${
            isSelected 
              ? 'border-[var(--accent-teal)]/40 bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]' 
              : 'border-[var(--app-line)] bg-[var(--app-surface)] text-white/40 group-hover/item:text-[var(--accent-teal)] group-hover/item:border-[var(--accent-teal)]/30'
          }`,
        });
        iconWrap.innerHTML = iconSvg;
        
        const textGroup = el('div', { className: 'flex-1 min-w-0' });
        const ifaceName = el('div', {
          className: `text-[12px] font-[var(--font-mono)] font-medium truncate ${isSelected ? 'text-[var(--accent-teal)]' : 'text-white/80'}`,
          text: iface.name,
        });
        const ifaceDesc = el('div', {
          className: 'text-[10px] font-[var(--font-mono)] text-white/35 truncate mt-0.5',
          text: iface.description || `Interface ${iface.id}`,
        });
        textGroup.append(ifaceName, ifaceDesc);
        
        const idBadge = el('div', {
          className: 'px-2 py-1 rounded text-[9px] font-[var(--font-mono)] tracking-wider text-white/25 bg-white/5 border border-white/10',
          text: `#${iface.id}`,
        });
        
        const checkmark = el('div', {
          className: `transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`,
        });
        checkmark.innerHTML = `<svg class="size-5 text-[var(--accent-teal)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>`;
        
        item.append(iconWrap, textGroup, idBadge, checkmark);
        
        item.addEventListener('click', () => {
          selectedInterfaceId = iface.id;
          selectedInterfaceName = iface.name;
          updateSelectedInterfaceDisplay(iface);
          hideInterfaceModal();
        });
        
        ui.interfaceModalList.append(item);
      }
    };
    
    renderSection('PRIMARY INTERFACES', primary, true);
    renderSection('OTHER INTERFACES', secondary);
    renderSection('VIRTUAL / LOOPBACK', virtual);
  }
  
  function updateSelectedInterfaceDisplay(iface: CaptureInterface | null) {
    const nameEl = ui.selectedInterfaceDisplay.querySelector('[data-iface-name]');
    const descEl = ui.selectedInterfaceDisplay.querySelector('[data-iface-desc]');
    
    if (iface) {
      if (nameEl) nameEl.textContent = iface.name;
      if (descEl) descEl.textContent = iface.description || `Interface ${iface.id}`;
      ui.interfaceSelectButton.classList.add('interface-selected');
    } else {
      if (nameEl) nameEl.textContent = 'Select interface…';
      if (descEl) descEl.textContent = 'Click to choose';
      ui.interfaceSelectButton.classList.remove('interface-selected');
    }
  }
  
  ui.interfaceSelectButton.addEventListener('click', showInterfaceModal);
  ui.interfaceModalCancelButton.addEventListener('click', hideInterfaceModal);
  ui.interfaceModalRefreshButton.addEventListener('click', () => void loadInterfaces());
  
  ui.interfaceModalOverlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).hasAttribute('data-modal-backdrop')) {
      hideInterfaceModal();
    }
  });
  
  // Close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ui.interfaceModalOverlay.classList.contains('hidden')) {
      hideInterfaceModal();
    }
  });

  function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  
  async function pollCaptureStats() {
    if (!liveCaptureId) return;
    try {
      const res = await fetch(`${explanationBaseUrl}/capture/${liveCaptureId}`, {
        method: 'GET',
        headers: withClientHeaders({}),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          size_bytes?: number;
          packet_count?: number;
          status?: string;
          error?: string;
        };
        if (typeof data.packet_count === 'number') {
          ui.livePacketCount.textContent = formatPacketCount(data.packet_count);
        } else if (data.size_bytes !== undefined && data.size_bytes > 0) {
          // Fallback: display file size as a proxy for captured data
          ui.livePacketCount.textContent = formatBytes(data.size_bytes);
        }

        if (data.status && data.status !== 'running') {
          stopCaptureTimer();
          liveCaptureId = null;
          liveCaptureInterface = null;
          ui.liveCaptureButton.textContent = 'Live Capture';
          ui.liveCaptureButton.classList.remove('btn-loading');
          ui.liveCaptureButton.disabled = false;
          ui.openPcapButton.disabled = false;
          ui.interfaceSelectButton.disabled = false;
          ui.captureFilterInput.disabled = false;
          ui.liveCaptureStatus.textContent = data.status === 'error' ? 'ERROR' : 'READY';
          ui.liveCaptureStatus.classList.remove('pulse-attention', 'status-shimmer');
          if (data.status === 'error' && data.error) {
            alert(data.error);
          }
        }
      }
    } catch {
      // Ignore polling errors
    }
  }
  
  function startCaptureTimer() {
    liveCaptureStartTime = Date.now();
    ui.liveDuration.textContent = '00:00';
    ui.livePacketCount.textContent = '0';
    ui.liveStatsContainer.classList.remove('hidden');
    ui.liveStatsContainer.classList.add('animate-fade-in');
    
    liveCaptureTimer = window.setInterval(() => {
      if (liveCaptureStartTime) {
        const elapsed = Date.now() - liveCaptureStartTime;
        ui.liveDuration.textContent = formatDuration(elapsed);
        // Poll for capture stats every second
        void pollCaptureStats();
      }
    }, 1000);
  }
  
  function stopCaptureTimer() {
    if (liveCaptureTimer) {
      clearInterval(liveCaptureTimer);
      liveCaptureTimer = null;
    }
    liveCaptureStartTime = null;
    ui.liveStatsContainer.classList.add('hidden');
    ui.liveStatsContainer.classList.remove('animate-fade-in');
  }

  async function startLiveCapture() {
    if (liveCaptureId) return;
    
    if (!selectedInterfaceId) {
      showInterfaceModal();
      return;
    }
    
    ui.liveCaptureButton.disabled = true;
    ui.openPcapButton.disabled = true;
    ui.interfaceSelectButton.disabled = true;
    ui.captureFilterInput.disabled = true;
    ui.liveCaptureButton.classList.add('btn-loading');
    ui.liveCaptureStatus.textContent = 'STARTING…';
    ui.liveCaptureStatus.classList.add('status-shimmer');

    try {
      const captureFilter = ui.captureFilterInput.value.trim() || undefined;
      const res = await fetch(`${explanationBaseUrl}/capture/start`, {
        method: 'POST',
        headers: withClientHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          interface: selectedInterfaceId,
          capture_filter: captureFilter,
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
      ui.captureBadge.classList.add('animate-fade-in');
      ui.liveCaptureButton.textContent = 'Stop Capture';
      ui.liveCaptureButton.classList.remove('btn-loading');
      ui.liveCaptureStatus.textContent = `CAPTURING ON ${liveCaptureInterface.toUpperCase()}`;
      ui.liveCaptureStatus.classList.remove('status-shimmer');
      ui.liveCaptureStatus.classList.add('pulse-attention');
      
      startCaptureTimer();
    } catch (err) {
      ui.liveCaptureButton.textContent = 'Live Capture';
      ui.liveCaptureButton.classList.remove('btn-loading');
      ui.openPcapButton.disabled = false;
      ui.liveCaptureButton.disabled = false;
      ui.interfaceSelectButton.disabled = false;
      ui.captureFilterInput.disabled = false;
      ui.liveCaptureStatus.textContent = 'READY';
      ui.liveCaptureStatus.classList.remove('status-shimmer');
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
    ui.liveCaptureButton.classList.add('btn-loading');
    ui.liveCaptureStatus.textContent = 'STOPPING…';
    ui.liveCaptureStatus.classList.remove('pulse-attention');
    ui.liveCaptureStatus.classList.add('status-shimmer');
    
    // Stop the timer
    stopCaptureTimer();

    try {
      const stopRes = await fetch(`${explanationBaseUrl}/capture/stop`, {
        method: 'POST',
        headers: withClientHeaders({ 'content-type': 'application/json' }),
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

      ui.liveCaptureStatus.textContent = 'ANALYZING…';
      
      const analyzeRes = await fetch(`${explanationBaseUrl}/tools/analyzePcap`, {
        method: 'POST',
        headers: withClientHeaders({ 'content-type': 'application/json' }),
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
      updateExportSummary();
      stoppedOk = true;
      setAnalyzeScreen('overview');
      render();
      setActiveTab('analyze');
      void refreshExplorerCaptures();
    } catch (err) {
      ui.captureBadge.textContent = liveCaptureInterface
        ? `Live: ${liveCaptureInterface}`
        : 'Live capture';
      ui.liveCaptureStatus.textContent = 'READY';
      ui.liveCaptureStatus.classList.remove('status-shimmer');
      alert((err as Error).message ?? String(err));
      liveCaptureId = null;
      liveCaptureInterface = null;
    } finally {
      ui.liveCaptureButton.textContent = 'Live Capture';
      ui.liveCaptureButton.classList.remove('btn-loading');
      ui.liveCaptureButton.disabled = false;
      ui.openPcapButton.disabled = false;
      ui.interfaceSelectButton.disabled = false;
      ui.captureFilterInput.disabled = false;
      if (stoppedOk) {
        liveCaptureId = null;
        liveCaptureInterface = null;
        ui.liveCaptureStatus.textContent = 'READY';
        ui.liveCaptureStatus.classList.remove('status-shimmer');
      }
    }
  }

  function renderSessions(sessions: AnalysisArtifact['sessions']) {
    sessionElements.clear();
    ui.sessionsCount.textContent = String(sessions.length);
    
    if (sessions.length > 10) {
      const skeletons = Array.from({ length: 5 }, (_, i) =>
        el('div', {
          className: 'skeleton skeleton-card animate-fade-in',
          attrs: { style: `animation-delay: ${i * 0.05}s` },
        })
      );
      ui.sessionsList.replaceChildren(...skeletons);
    }
    
    requestAnimationFrame(() => {
      ui.sessionsList.replaceChildren(
        ...sessions.map((session, index) => {
          const item = el('button', {
            className: 'w-full rounded px-3 py-3 text-left transition-all data-card hover-lift',
            attrs: { 
              'data-session-id': session.id, 
              type: 'button', 
              style: `animation-delay: ${Math.min(index * 0.03, 0.5)}s; opacity: 0;` 
            },
          });
          item.classList.add('animate-slide-in');

          const header = el('div', { className: 'flex items-center justify-between' });
          const transport = el('div', {
            className:
              'px-2 py-0.5 rounded text-[9px] font-[var(--font-mono)] font-semibold tracking-[0.15em] uppercase border smooth-colors ' +
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

          const a = `${session.endpoints.a.ip}${session.endpoints.a.port ? `:${session.endpoints.a.port}` : ''}`;
          const b = `${session.endpoints.b.ip}${session.endpoints.b.port ? `:${session.endpoints.b.port}` : ''}`;
          const endpoints = el('div', {
            className: 'mt-2.5 flex items-center gap-2 text-[11px] font-[var(--font-mono)] text-white/80 overflow-hidden',
          });
          const endpointA = el('span', { text: a, className: 'truncate min-w-0' });
          const arrow = el('span', { className: 'text-[var(--accent-cyan)]/50 flex-shrink-0 transition-colors', text: '⟷' });
          const endpointB = el('span', { text: b, className: 'truncate min-w-0' });
          endpoints.append(endpointA, arrow, endpointB);

          const meta = el('div', { className: 'mt-2 flex flex-wrap gap-3 text-[10px] font-[var(--font-mono)]' });
          meta.append(
            el('span', { className: 'text-white/40 smooth-colors', text: `${session.packet_count} PKT` }),
            el('span', { className: 'text-white/40 smooth-colors', text: formatBytes(session.byte_count) })
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
    });
  }

  function updateSessionSelection() {
    for (const [id, element] of sessionElements) {
      const isSelected = id === selectedSessionId;
      const wasSelected = element.classList.contains('selected');
      
      if (isSelected !== wasSelected) {
        element.classList.toggle('selected', isSelected);
        if (isSelected) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }

  function renderTimeline(
    timeline: AnalysisArtifact['timeline'],
    options?: { showSessionId?: boolean }
  ) {
    const showSessionId = options?.showSessionId ?? false;
    if (!timeline.length) {
      const emptyEl = el('div', {
        className: 'flex flex-col items-center justify-center py-8 text-center empty-state',
        children: [
          el('div', { className: 'data-label mb-1', text: 'NO EVENTS' }),
          el('div', { className: 'text-[10px] text-white/30', text: 'No decoded events for this session' }),
        ],
      });
      ui.timelineList.replaceChildren(emptyEl);
      requestAnimationFrame(() => emptyEl.classList.add('visible'));
      return;
    }

    const sorted = [...timeline].sort((a, b) =>
      a.ts !== b.ts ? a.ts - b.ts : a.evidence_frame - b.evidence_frame
    );

    if (sorted.length > 50) {
      const skeletons = Array.from({ length: 8 }, (_, i) =>
        el('div', {
          className: 'skeleton h-16 rounded animate-fade-in',
          attrs: { style: `animation-delay: ${i * 0.03}s` },
        })
      );
      ui.timelineList.replaceChildren(...skeletons);
    }

    requestAnimationFrame(() => {
      ui.timelineList.replaceChildren(
        ...sorted.slice(0, 200).map((event, index) => {
          const row = el('button', {
            className:
              'group relative w-full text-left pl-4 pb-3 border-l border-[var(--app-line)] ' +
              'hover:border-[var(--accent-cyan)]/30 transition-all animate-slide-in',
            attrs: {
              type: 'button',
              style: `animation-delay: ${Math.min(index * 0.02, 0.4)}s; opacity: 0;`,
              'data-timeline-session-id': event.session_id,
            },
          });

          const metaRow = el('div', { className: 'mt-1 flex items-center gap-2 flex-wrap' });
          const kindBadge = el('span', {
            className: 'px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] font-[var(--font-mono)] text-white/45 uppercase tracking-wider smooth-colors',
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
          return row;
        })
      );
    });
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

    noCaptureHintShown = false;
    syncNoCaptureUi();

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
  ui.analyzeScreenTerminalButton.addEventListener('click', () => setAnalyzeScreen('terminal'));
  ui.analyzeScreenInsightsButton.addEventListener('click', () => setAnalyzeScreen('insights'));
  ui.analyzeScreenWorkflowsButton.addEventListener('click', () => setAnalyzeScreen('workflows'));

  setAnalyzeScreen('overview');

  ui.workflowList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest('[data-workflow-id]') as HTMLElement | null;
    const id = row?.getAttribute('data-workflow-id');
    if (!id) return;
    setSelectedWorkflow(id);
  });

  ui.workflowNewButton.addEventListener('click', () => {
    selectedWorkflowId = null;
    renderWorkflowsUI();
    ui.workflowNameInput.value = '';
    ui.workflowScopeSelect.value = 'capture';
    ui.workflowPromptsInput.value = '';
    ui.workflowAutoRunCheckbox.checked = false;
  });

  ui.workflowSaveButton.addEventListener('click', () => {
    upsertWorkflowFromEditor(selectedWorkflowId);
  });

  ui.workflowDeleteButton.addEventListener('click', async () => {
    await deleteSelectedWorkflow();
  });

  ui.workflowRunButton.addEventListener('click', async () => {
    const wf =
      selectedWorkflowId && workflows.find((w) => w.id === selectedWorkflowId)
        ? workflows.find((w) => w.id === selectedWorkflowId)!
        : (() => {
            const now = new Date().toISOString();
            const draft = readWorkflowFromEditor();
            return {
              id: crypto.randomUUID(),
              name: draft.name,
              prompts: draft.prompts,
              contextMode: draft.contextMode,
              autoRun: false,
              createdAt: now,
              updatedAt: now,
            } satisfies Workflow;
          })();

    await runWorkflow(wf);
  });

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

  ui.explorerList.addEventListener('dragstart', (event) => {
    const target = event.target as HTMLElement | null;
    const captureRow = target?.closest('[data-capture-id]') as HTMLElement | null;
    if (!captureRow) return;
    const id = captureRow.getAttribute('data-capture-id');
    if (!id) return;
    draggingCaptureId = id;
    if (event.dataTransfer) {
      event.dataTransfer.setData('application/x-kisame-capture', id);
      event.dataTransfer.setData('text/plain', id);
      event.dataTransfer.effectAllowed = 'move';
    }
  });

  ui.explorerList.addEventListener('dragover', (event) => {
    if (!draggingCaptureId) return;
    const target = event.target as HTMLElement | null;
    const caseRow = target?.closest('[data-node-kind="case"]') as HTMLElement | null;
    if (!caseRow) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setDropTarget(caseRow);
  });

  ui.explorerList.addEventListener('drop', (event) => {
    if (!draggingCaptureId) return;
    const target = event.target as HTMLElement | null;
    const caseRow = target?.closest('[data-node-kind="case"]') as HTMLElement | null;
    event.preventDefault();
    setDropTarget(null);
    const captureId =
      draggingCaptureId ??
      event.dataTransfer?.getData('application/x-kisame-capture') ??
      event.dataTransfer?.getData('text/plain');
    if (!caseRow || !captureId) return;
    const caseId = caseRow.getAttribute('data-case-id');
    if (!caseId) return;
    const targetCase = cases.find((c) => c.id === caseId);
    const targetWorkspaceId =
      targetCase?.workspaceId ?? caseRow.getAttribute('data-workspace-id') ?? 'default';
    const currentWorkspaceId = workspaceAssignments[captureId] ?? 'default';
    const currentCaseId = caseAssignments[captureId];
    if (currentCaseId === caseId && currentWorkspaceId === targetWorkspaceId) return;
    workspaceAssignments[captureId] = targetWorkspaceId;
    caseAssignments[captureId] = caseId;
    saveWorkspaceAssignments(workspaceAssignments);
    saveCaseAssignments(caseAssignments);
    renderExplorerCaptures();
  });

  ui.explorerList.addEventListener('dragend', () => {
    draggingCaptureId = null;
    clearDropTarget();
  });

  ui.explorerList.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement | null;
    const captureRow = target?.closest('[data-capture-id]') as HTMLElement | null;
    if (captureRow) {
      const id = captureRow.getAttribute('data-capture-id');
      if (!id) return;
      if (id === captureSessionId && analysis) {
        setActiveTab('analyze');
        return;
      }
      try {
        captureRow.classList.add('opacity-60');
        // Add loading indicator to the row
        const loadingIndicator = el('div', {
          className: 'absolute inset-0 flex items-center justify-center bg-[var(--app-bg)]/80 rounded animate-fade-in',
          children: [el('div', { className: 'loading-spinner loading-spinner-sm' })],
        });
        captureRow.style.position = 'relative';
        captureRow.appendChild(loadingIndicator);
        
        await analyzeExplorerCapture(id);
      } catch (err) {
        alert((err as Error).message ?? String(err));
      } finally {
        captureRow.classList.remove('opacity-60');
        const loader = captureRow.querySelector('.loading-spinner')?.parentElement;
        if (loader) loader.remove();
      }
      return;
    }

    const caseRow = target?.closest('[data-node-kind="case"]') as HTMLElement | null;
    if (caseRow) {
      const caseId = caseRow.getAttribute('data-case-id');
      if (!caseId) return;
      const workspaceId = caseRow.getAttribute('data-workspace-id') ?? '';
      selectedCaseId = caseId;
      window.localStorage.setItem(caseSelectedKey, selectedCaseId);
      const isExpanded = expandedCaseIds.has(caseId);
      setCaseExpanded(caseId, !isExpanded);
      if (workspaceId) {
        expandedWorkspaceIds.add(workspaceId);
        saveExpandedSet(workspaceExpandedKey, expandedWorkspaceIds);
      }
      renderExplorerCaptures();
      return;
    }

    const workspaceRow = target?.closest('[data-node-kind="workspace"]') as HTMLElement | null;
    if (workspaceRow) {
      const workspaceId = workspaceRow.getAttribute('data-workspace-id');
      if (!workspaceId) return;
      const isExpanded = expandedWorkspaceIds.has(workspaceId);
      setWorkspaceExpanded(workspaceId, !isExpanded);
      renderExplorerCaptures();
    }
  });

  ui.explorerAddButton.addEventListener('click', () => {
    if (selectedWorkspaceId === 'all') {
      uploadWorkspacePrompt = true;
      pendingUploadAfterWorkspaceSelect = true;
      updateWorkspaceAttention();
      setWorkspaceMenuOpen(true);
      renderExplorerCaptures();
      return;
    }
    ui.openPcapButton.click();
  });

  ui.explorerRefreshButton.addEventListener('click', () => {
    void refreshExplorerCaptures();
  });

  ui.openPcapButton.addEventListener('click', async () => {
    if (!window.electronAPI?.openPcapAndAnalyze) return;
    ui.openPcapButton.disabled = true;
    ui.openPcapButton.classList.add('btn-loading');
    
    const originalBadge = ui.captureBadge.textContent;
    ui.captureBadge.innerHTML = '<div class="flex items-center gap-2"><div class="loading-spinner loading-spinner-sm"></div><span class="status-shimmer">ANALYZING…</span></div>';
    
    try {
      const result = await window.electronAPI.openPcapAndAnalyze(clientId);
      if (result.canceled) {
        ui.captureBadge.textContent = originalBadge ?? 'NO CAPTURE';
        return;
      }
      analysis = result.analysis as AnalysisArtifact;
      captureSessionId = analysis.pcap?.session_id ?? null;
      if (captureSessionId) {
        analysisCache.set(captureSessionId, analysis);
      }
      selectedSessionId = null;
      updateExportSummary();
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
      ui.captureBadge.textContent = originalBadge ?? 'NO CAPTURE';
      alert((err as Error).message ?? String(err));
    } finally {
      ui.openPcapButton.disabled = false;
      ui.openPcapButton.classList.remove('btn-loading');
    }
  });

  ui.liveCaptureButton.addEventListener('click', async () => {
    if (liveCaptureId) {
      await stopLiveCapture();
      return;
    }
    await startLiveCapture();
  });

  async function sendChatQueryText(query: string, options?: { displayText?: string; contextMode?: WorkflowContextMode }) {
    if (!query) return;

    if (!hasCaptureContext() && !noCaptureHintShown) {
      noCaptureHintShown = true;
      chatManager.addMessage({
        role: 'ai',
        text: 'No PCAP is loaded yet. I can still answer general questions, but capture-specific analysis needs an imported PCAP.',
      });
    }

    // History push
    chatHistory.push(query);
    chatHistoryIndex = -1;
    chatCurrentDraft = '';

    // Add user message
    const userMessage: ChatMessage = { role: 'user', text: options?.displayText ?? query };
    chatManager.addMessage(userMessage);
    
    // Clear input and force scroll to bottom
    chatManager.forceScrollToBottom();

    const aiMessage: ChatMessage = {
      role: 'ai',
      text: '',
      status: 'Initializing…',
      isStreaming: true,
      toolCalls: [],
    };
    chatManager.addMessage(aiMessage);

    // Swap Send -> Stop
    ui.chatSendBtn.classList.add('hidden');
    ui.chatStopBtn.classList.remove('hidden');

    if (chatAbortController) chatAbortController.abort();
    chatAbortController = new AbortController();

    const contextMode = options?.contextMode;
    const context = analysis
      ? contextMode === 'capture'
        ? { artifact: analysis }
        : contextMode === 'session'
          ? selectedSessionId
            ? { session_id: selectedSessionId, artifact: analysis }
            : { artifact: analysis }
          : selectedSessionId
            ? { session_id: selectedSessionId, artifact: analysis }
            : { artifact: analysis }
      : undefined;

    try {
      const response = await fetch(`${explanationBaseUrl}/chat/stream`, {
        method: 'POST',
        headers: withClientHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ query: query, context }),
        signal: chatAbortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Chat stream failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleEvent = (eventName: string, data: any) => {
        if (eventName === 'status') {
          const stage = (data.stage ?? '').toLowerCase();
          const msg = (data.message ?? '').toLowerCase();
          if (
            stage.includes('step') || 
            msg.includes('token') || 
            stage === 'warning' || 
            stage === 'reasoning' ||
            stage === 'tool_call' ||
            stage === 'tool_result'
          ) {
            return;
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
        } else if (eventName === 'reasoning') {
          const delta = data.delta ?? '';
          if (delta) {
            aiMessage.reasoningSummary = `${aiMessage.reasoningSummary ?? ''}${delta}`;
          }
        } else if (eventName === 'tool_result') {
          const existing = aiMessage.toolCalls?.find(
            (t) => t.id === data.toolCallId || t.name === data.toolName
          );
          if (existing) {
            existing.output = data.output;
            existing.status = 'done';
          }
          if (data.toolName === 'suggested_next_steps') {
            const suggestions = data.output?.suggestions ?? data.output?.steps ?? [];
            if (Array.isArray(suggestions)) {
              aiMessage.suggestedNextSteps = suggestions;
            }
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
      if ((err as Error).name === 'AbortError') {
        aiMessage.status = 'Cancelled';
        aiMessage.text += '\n\n\n_Analysis stopped by user._';
      } else {
        aiMessage.text = `Error: ${(err as Error).message ?? String(err)}`;
      }
      chatManager.updateMessage(aiMessage);
    } finally {
      // Restore buttons
      ui.chatSendBtn.classList.remove('hidden');
      ui.chatStopBtn.classList.add('hidden');
      chatAbortController = null;
    }
  }

  ui.chatStopBtn.addEventListener('click', () => {
    if (chatAbortController) {
      chatAbortController.abort();
      chatAbortController = null;
    }
  });

  async function sendChatQuery() {
    const query = ui.chatInput.value.trim();
    if (!query) return;
    ui.chatInput.value = '';
    await sendChatQueryText(query);
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

  ui.exportButton.addEventListener('click', () => {
    void performExport(false);
  });
  ui.exportBundleButton.addEventListener('click', () => {
    void performExport(true);
  });

  // ============ Multi-Terminal System ============
  interface TerminalInstance {
    id: string;
    name: string;
    terminal: Terminal;
    fitAddon: FitAddon;
    container: HTMLElement;
    tab: HTMLElement;
  }
  
  const terminals: Map<string, TerminalInstance> = new Map();
  let activeTerminalId: string | null = null;
  let activeSplitTerminalId: string | null = null;
  let terminalCounter = 0;

  function createTerminalTab(instance: TerminalInstance): HTMLElement {
    const tab = document.createElement('div');
    tab.className = 'flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors group';
    tab.dataset.terminalId = instance.id;
    
    // Terminal icon
    const icon = document.createElement('span');
    icon.innerHTML = `<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
    
    // Name
    const name = document.createElement('span');
    name.className = 'truncate max-w-[80px]';
    name.textContent = instance.name;
    
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'size-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-white/20 text-white/40 hover:text-white transition-all';
    closeBtn.innerHTML = `<svg class="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeTerminal(instance.id);
    };
    
    tab.append(icon, name, closeBtn);
    
    tab.onclick = () => switchToTerminal(instance.id);
    
    return tab;
  }

  function updateTabStyles() {
    for (const [id, instance] of terminals) {
      if (id === activeTerminalId) {
        instance.tab.className = 'flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors group bg-[var(--accent-teal)]/20 text-[var(--accent-teal)] border border-[var(--accent-teal)]/30';
      } else {
        instance.tab.className = 'flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors group text-white/50 hover:text-white/70 hover:bg-white/5 border border-transparent';
      }
    }
  }

  function switchToTerminal(id: string) {
    const instance = terminals.get(id);
    if (!instance) return;

    if (activeSplitTerminalId && !terminals.has(activeSplitTerminalId)) {
      activeSplitTerminalId = null;
    }

    // In split mode, clicking the right pane tab swaps pane focus.
    if (activeSplitTerminalId && id === activeSplitTerminalId) {
      const previousActiveId = activeTerminalId;
      activeTerminalId = id;
      if (previousActiveId && previousActiveId !== id && terminals.has(previousActiveId)) {
        activeSplitTerminalId = previousActiveId;
      } else {
        activeSplitTerminalId = null;
      }
    } else {
      activeTerminalId = id;
    }

    if (!activeSplitTerminalId) {
      ui.terminalContainer.style.display = 'block';
      ui.terminalContainer.style.gridTemplateColumns = '';

      for (const t of terminals.values()) {
        t.container.classList.add('hidden');
        t.container.style.position = 'absolute';
        t.container.style.inset = '0';
      }

      instance.container.classList.remove('hidden');
    } else {
      ui.terminalContainer.style.display = 'grid';
      ui.terminalContainer.style.gridTemplateColumns = '1fr 1fr';

      for (const [tid, t] of terminals) {
        if (tid === activeTerminalId || tid === activeSplitTerminalId) {
          t.container.classList.remove('hidden');
          t.container.style.position = 'relative';
          t.container.style.inset = '';
        } else {
          t.container.classList.add('hidden');
        }
      }
    }
    updateTabStyles();

    setTimeout(() => {
      instance.fitAddon.fit();
      instance.terminal.focus();
    }, 10);
  }

  async function createNewTerminal(isSplitCreation = false): Promise<string | null> {
    if (!window.electronAPI?.terminal) return null;
    
    terminalCounter++;
    // Fallback name logic if needed, but default shell is automatic
    const name = `term ${terminalCounter}`;
    
    // Create container for this terminal
    const container = document.createElement('div');
    if (activeSplitTerminalId || isSplitCreation) {
       container.className = 'relative min-h-0 min-w-0 bg-[#2c2f33]';
       container.style.position = 'relative';
    } else {
       container.className = 'absolute inset-0';
    }
    ui.terminalContainer.appendChild(container);
    
    // Create xterm instance
    const terminal = new Terminal({
      theme: {
        background: '#2c2f33',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#2c2f33',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
    });
    
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    
    // Create PTY process
    const cols = Math.max(terminal.cols || 0, 80);
    const rows = Math.max(terminal.rows || 0, 24);
    const result = await window.electronAPI.terminal.create(cols, rows);
    if (!result.success) {
      const message = result.error ? `Terminal error: ${result.error}` : 'Terminal error: failed to start PTY';
      terminal.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
      console.error(message);
      terminal.dispose();
      container.remove();
      return null;
    }
    const id = result.id;
    
    const instance: TerminalInstance = {
      id,
      name,
      terminal,
      fitAddon,
      container,
      tab: document.createElement('div'),
    };
    
    instance.tab = createTerminalTab(instance);
    ui.terminalTabsContainer.appendChild(instance.tab);
    
    terminals.set(id, instance);
    
    // Send input to PTY
    terminal.onData((data) => {
      window.electronAPI.terminal.write(id, data);
    });
    
    // Handle resize
    terminal.onResize(({ cols, rows }) => {
      window.electronAPI.terminal.resize(id, cols, rows);
    });
    
    // Fit on container resize
    const resizeObserver = new ResizeObserver(() => {
      if (!container.classList.contains('hidden')) {
        fitAddon.fit();
      }
    });
    resizeObserver.observe(container);
    
    if (!isSplitCreation) {
      switchToTerminal(id);
    } else {
      setTimeout(() => fitAddon.fit(), 50);
    }
    
    return id;
  }

  function closeTerminal(id: string) {
    const instance = terminals.get(id);
    if (!instance) return;
    
    // Kill PTY
    window.electronAPI.terminal.kill(id);
    
    // Dispose xterm
    instance.terminal.dispose();
    
    // Remove DOM elements
    instance.container.remove();
    instance.tab.remove();
    
    // Remove from map
    terminals.delete(id);
    
    if (activeSplitTerminalId === id) {
      activeSplitTerminalId = null;
    }
    if (activeTerminalId === id) {
      activeTerminalId = null;
    }

    if (activeSplitTerminalId && !activeTerminalId) {
      activeTerminalId = activeSplitTerminalId;
      activeSplitTerminalId = null;
    }

    if (activeSplitTerminalId && activeSplitTerminalId === activeTerminalId) {
      activeSplitTerminalId = null;
    }

    const remaining = Array.from(terminals.keys());
    if (remaining.length > 0) {
      if (!activeTerminalId || !terminals.has(activeTerminalId)) {
        activeTerminalId = remaining[remaining.length - 1];
      }
      switchToTerminal(activeTerminalId);
    } else {
      activeTerminalId = null;
      activeSplitTerminalId = null;
      void createNewTerminal();
    }
  }

  // Handle data from all PTY processes
  window.electronAPI?.terminal.onData((id, data) => {
    const instance = terminals.get(id);
    if (instance) {
      instance.terminal.write(data);
    }
  });

  // Handle PTY exit
  window.electronAPI?.terminal.onExit((id, exitCode) => {
    const instance = terminals.get(id);
    if (instance) {
      instance.terminal.write(`\r\n\x1b[33mProcess exited with code ${exitCode}\x1b[0m\r\n`);
      // Remove the tab after a delay
      setTimeout(() => closeTerminal(id), 2000);
    }
  });

  // Add button creates new terminal
  ui.terminalAddButton.addEventListener('click', () => {
    void createNewTerminal();
  });

  // Nav terminal button focuses current terminal
  ui.navTerminalButton.addEventListener('click', () => {
    if (activeTerminalId) {
      const instance = terminals.get(activeTerminalId);
      instance?.terminal.focus();
    }
    // Highlight button briefly
    const terminalIcon = ui.navTerminalButton.querySelector('svg');
    ui.navTerminalButton.classList.add('bg-[var(--accent-teal)]/10', 'border-[var(--accent-teal)]/40');
    ui.navTerminalButton.classList.remove('border-transparent');
    terminalIcon?.classList.remove('text-white/40');
    terminalIcon?.classList.add('text-[var(--accent-teal)]');
  });

  // Make terminal container relative/grid
  ui.terminalContainer.style.position = 'relative';

  // Initialize first terminal on load
  void createNewTerminal();

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Ctrl + Shift + ` (Backtick)
    if (e.ctrlKey && e.shiftKey && e.code === 'Backquote') {
      e.preventDefault();
      void createNewTerminal();
    }
  });

  // Toggle Maximize
  let isMaximized = false;
  ui.terminalMaximizeButton.addEventListener('click', () => {
    isMaximized = !isMaximized;
    if (isMaximized) {
      ui.terminalPanel.classList.add('fixed', 'inset-0', 'z-[100]', 'bg-[#0d1117]');
      ui.terminalPanel.classList.remove('h-full', 'min-w-0', 'border-t');
      // Keep flex layout
    } else {
      ui.terminalPanel.classList.remove('fixed', 'inset-0', 'z-[100]', 'bg-[#0d1117]');
      ui.terminalPanel.classList.add('h-full', 'min-w-0', 'border-t');
    }
    // Refit terminals
    if (activeTerminalId) {
      setTimeout(() => terminals.get(activeTerminalId!)?.fitAddon.fit(), 50);
    }
    if (activeSplitTerminalId) {
      setTimeout(() => terminals.get(activeSplitTerminalId!)?.fitAddon.fit(), 50);
    }
  });

  // Split View Logic
  async function toggleSplit() {
    if (activeSplitTerminalId) {
      // Close split
      closeTerminal(activeSplitTerminalId);
      return;
    }
    
    // Open split
    terminals.forEach(t => t.container.classList.add('hidden')); // temp hide
    ui.terminalContainer.style.display = 'grid';
    ui.terminalContainer.style.gridTemplateColumns = '1fr 1fr';
    
    // Left is current active
    if (activeTerminalId) {
       const t1 = terminals.get(activeTerminalId);
       if (t1) {
         t1.container.style.position = 'relative';
         t1.container.classList.remove('hidden');
         t1.fitAddon.fit();
       }
    }
    
    // Create new right terminal
    const newId = await createNewTerminal(true); // true = automated/split creation
    if (newId) {
      activeSplitTerminalId = newId;
      const t2 = terminals.get(newId);
      if (t2) {
        t2.container.style.position = 'relative';
        t2.container.classList.remove('hidden');
        // Fit happens in create
      }
    } else if (activeTerminalId) {
      // Restore single terminal layout if split creation fails.
      activeSplitTerminalId = null;
      switchToTerminal(activeTerminalId);
    }
  }

  ui.terminalSplitButton.addEventListener('click', () => {
    void toggleSplit();
  });

  setActiveTab(activeTab);
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
