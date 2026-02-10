import { el } from './dom';
import { iconArrowRight, iconFolder, iconSessions, iconTimeline, iconRadar, iconTerminal, iconWave, iconHex, iconShield } from './icons';

export type AppShellRefs = {
  root: HTMLElement;
  mainGrid: HTMLElement;
  analysisMain: HTMLElement;
  analyzeScreenHost: HTMLElement;
  analyzeScreenOverviewButton: HTMLButtonElement;
  analyzeScreenSessionsButton: HTMLButtonElement;
  analyzeScreenTimelineButton: HTMLButtonElement;
  analyzeScreenTerminalButton: HTMLButtonElement;
  analyzeScreenInsightsButton: HTMLButtonElement;
  analyzeScreenWorkflowsButton: HTMLButtonElement;
  analyzeScreenLabel: HTMLElement;
  navCaptureButton: HTMLButtonElement;
  navAnalyzeButton: HTMLButtonElement;
  navExportButton: HTMLButtonElement;
  navTerminalButton: HTMLButtonElement;
  openPcapButton: HTMLButtonElement;
  liveCaptureButton: HTMLButtonElement;
  liveCaptureStatus: HTMLElement;
  captureBadge: HTMLElement;
  capturePanel: HTMLElement;
  exportPanel: HTMLElement;
  chatColumn: HTMLElement;
  sessionsList: HTMLElement;
  timelineList: HTMLElement;
  timelineCount: HTMLElement;
  timelineScopeSessionButton: HTMLButtonElement;
  timelineScopeAllButton: HTMLButtonElement;
  timelineKindSelect: HTMLSelectElement;
  timelineSearchInput: HTMLInputElement;
  sessionsCount: HTMLElement;
  sessionKeyBody: HTMLElement;
  insightsBody: HTMLElement;
  analysisSummary: HTMLElement;
  analysisDetail: HTMLElement;
  explorerList: HTMLElement;
  explorerEmptyState: HTMLElement;
  explorerAddButton: HTMLButtonElement;
  explorerRefreshButton: HTMLButtonElement;
  workspaceSelect: HTMLSelectElement;
  workspaceForm: HTMLElement;
  workspaceInput: HTMLInputElement;
  workspaceAddButton: HTMLButtonElement;
  workspaceCancelButton: HTMLButtonElement;
  uploadIndicator: HTMLElement;
  chatMessages: HTMLElement;
  chatEmptyState: HTMLElement;
  chatInput: HTMLInputElement;
  chatSendBtn: HTMLButtonElement;
  chatStopBtn: HTMLButtonElement;
  sessionIdLabel: HTMLElement;
  welcomePanel: HTMLElement;
  overviewLayout: HTMLElement;
  overviewTopLayout: HTMLElement;
  sessionsLayout: HTMLElement;
  sessionsSplitHandle: HTMLElement;
  overviewEvidenceHandle: HTMLElement;
  sessionsPanel: HTMLElement;
  timelinePanel: HTMLElement;
  terminalPanel: HTMLElement;
  terminalTabsContainer: HTMLElement;
  terminalAddButton: HTMLButtonElement;
  terminalContainer: HTMLElement;
  sessionKeyPanel: HTMLElement;
  insightsPanel: HTMLElement;
  workflowsPanel: HTMLElement;
  workflowList: HTMLElement;
  workflowNameInput: HTMLInputElement;
  workflowScopeSelect: HTMLSelectElement;
  workflowPromptsInput: HTMLTextAreaElement;
  workflowAutoRunCheckbox: HTMLInputElement;
  workflowNewButton: HTMLButtonElement;
  workflowSaveButton: HTMLButtonElement;
  workflowRunButton: HTMLButtonElement;
  workflowDeleteButton: HTMLButtonElement;
  workflowModalOverlay: HTMLElement;
  workflowModalTitle: HTMLElement;
  workflowModalSubtitle: HTMLElement;
  workflowModalBody: HTMLElement;
  workflowModalList: HTMLElement;
  workflowModalError: HTMLElement;
  workflowModalCancelButton: HTMLButtonElement;
  workflowModalConfirmButton: HTMLButtonElement;
};

export function createAppShell(root: HTMLElement): AppShellRefs {
  const app = el('div', {
    className: 'relative h-screen w-screen overflow-hidden app-surface',
  });

  const bgEffects = el('div', {
    className: 'pointer-events-none absolute inset-0',
  });
  
  const gridBg = el('div', {
    className: 'absolute inset-0 app-grid-bg opacity-30',
  });

  const noise = el('div', {
    className: 'absolute inset-0 app-noise',
  });

  const scanlines = el('div', {
    className: 'absolute inset-0 app-scanlines opacity-20',
  });

  const glowOrb1 = el('div', {
    className: 'absolute -top-40 -left-40 w-96 h-96 rounded-full blur-3xl opacity-10',
    attrs: { style: 'background: radial-gradient(circle, var(--accent-cyan) 0%, transparent 70%);' }
  });

  const glowOrb2 = el('div', {
    className: 'absolute -bottom-40 -right-40 w-80 h-80 rounded-full blur-3xl opacity-8',
    attrs: { style: 'background: radial-gradient(circle, var(--accent-teal) 0%, transparent 70%);' }
  });

  bgEffects.append(gridBg, noise, scanlines, glowOrb1, glowOrb2);

  const topBar = el('div', {
    className: 'relative z-10 h-9 flex items-center justify-between px-4 border-b border-[var(--app-line-strong)] bg-gradient-to-r from-[var(--app-surface)] via-[var(--app-bg)] to-[var(--app-surface)] overflow-hidden',
  });

  const topLeft = el('div', { className: 'flex items-center gap-4 min-w-0 flex-shrink-0' });
  
  const brandGroup = el('div', { className: 'flex items-center gap-2' });
  const logo = el('img', {
    className: 'h-5 w-auto opacity-90',
    attrs: {
      src: '/kisame-logo.png',
      alt: 'Kisame',
      draggable: 'false',
      style: 'filter: invert(1) drop-shadow(0 0 10px rgba(110,181,181,0.10));',
    },
  });
  
  const brand = el('div', {
    className: 'font-[var(--font-display)] text-sm font-bold tracking-[0.25em] text-[var(--accent-cyan)] glow-text-cyan uppercase',
    text: 'KISAME',
  });
  
  const versionBadge = el('div', {
    className: 'ml-2 px-1.5 py-0.5 text-[8px] font-[var(--font-mono)] tracking-wider text-[var(--accent-teal)] border border-[var(--accent-teal)]/30 rounded',
    text: 'v1.0',
  });
  
  brandGroup.append(logo, brand, versionBadge);

  const navItems = el('div', { className: 'flex items-center gap-1' });
  const tabButtonBase =
    'px-3 py-1 text-[10px] font-[var(--font-display)] tracking-[0.2em] transition-all rounded';
  const tabActiveClass =
    `${tabButtonBase} text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 border border-[var(--accent-cyan)]/30`;
  const tabInactiveClass = `${tabButtonBase} text-white/50 hover:text-white/80`;

  const navCaptureButton = el('button', {
    className: tabInactiveClass,
    text: 'CAPTURE',
    attrs: { type: 'button', 'data-tab': 'capture' },
  }) as HTMLButtonElement;
  const navAnalyzeButton = el('button', {
    className: tabActiveClass,
    text: 'ANALYZE',
    attrs: { type: 'button', 'data-tab': 'analyze' },
  }) as HTMLButtonElement;
  const navExportButton = el('button', {
    className: tabInactiveClass,
    text: 'EXPORT',
    attrs: { type: 'button', 'data-tab': 'export' },
  }) as HTMLButtonElement;

  navItems.append(navCaptureButton, navAnalyzeButton, navExportButton);

  topLeft.append(brandGroup, navItems);

  const topRight = el('div', { className: 'flex items-center gap-3 min-w-0 flex-shrink-0' });

  const statusDot = el('div', {
    className: 'flex items-center gap-2',
  });
  const dot = el('div', {
    className: 'size-2 rounded-full bg-[var(--accent-teal)] pulse-dot',
  });
  const statusText = el('span', {
    className: 'text-[9px] font-[var(--font-mono)] tracking-wider text-white/40 uppercase',
    text: 'SYSTEM READY',
  });
  statusDot.append(dot, statusText);

  const captureBadge = el('div', {
    className: 'flex items-center gap-2 px-3 py-1 text-[10px] font-[var(--font-mono)] tracking-[0.15em] text-white/50 border border-[var(--app-line)] rounded bg-[var(--app-surface)] max-w-[180px] overflow-hidden',
  });
  const badgeIcon = iconHex();
  badgeIcon.classList.add('size-3', 'text-white/30', 'flex-shrink-0');
  const badgeText = el('span', { text: 'NO CAPTURE', className: 'truncate' });
  captureBadge.append(badgeIcon, badgeText);

  const uploadIndicator = el('div', {
    className: 'upload-indicator hidden',
    text: '',
  });

  const openPcapButton = el('button', {
    className: 'cyber-btn px-4 py-1.5 text-[10px] font-[var(--font-display)] font-semibold tracking-[0.2em] text-[var(--accent-cyan)] uppercase',
    text: '◈ OPEN PCAP',
  }) as HTMLButtonElement;

  const liveCaptureButton = el('button', {
    className: 'cyber-btn px-4 py-1.5 text-[10px] font-[var(--font-display)] font-semibold tracking-[0.2em] text-[var(--accent-teal)] uppercase',
    text: '◈ LIVE CAPTURE',
  }) as HTMLButtonElement;

  topRight.append(statusDot, uploadIndicator, captureBadge);
  topBar.append(topLeft, topRight);

  // Main content grid - responsive with proper overflow
  const body = el('div', {
    className: 'relative z-10 grid h-[calc(100%-2.25rem)] overflow-hidden main-grid-responsive',
  });

  function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  function readStoredNumber(key: string): number | null {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const num = Number.parseFloat(raw);
      return Number.isFinite(num) ? num : null;
    } catch {
      return null;
    }
  }

  function writeStoredNumber(key: string, value: number) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Ignore persistence errors.
    }
  }

  function getCssVarPx(element: HTMLElement, name: string, fallbackPx: number): number {
    const raw = getComputedStyle(element).getPropertyValue(name).trim();
    const num = Number.parseFloat(raw);
    return Number.isFinite(num) ? num : fallbackPx;
  }

  const persistedExplorerW = readStoredNumber('kisame.ui.explorerWidth');
  const persistedChatW = readStoredNumber('kisame.ui.chatWidth');
  const persistedEvidenceH = readStoredNumber('kisame.ui.evidenceHeight');

  if (persistedExplorerW) body.style.setProperty('--explorer-w', `${persistedExplorerW}px`);
  if (persistedChatW) body.style.setProperty('--chat-w', `${persistedChatW}px`);
  if (persistedEvidenceH) body.style.setProperty('--evidence-h', `${persistedEvidenceH}px`);

  // Left navigation rail
  const navRail = el('div', {
    className: 'col-start-1 row-start-1 flex flex-col items-center justify-between py-4 border-r border-[var(--app-line)] bg-[var(--app-surface)]/50',
  });

  const navRailTop = el('div', { className: 'flex flex-col items-center gap-3' });
  
  // Analysis button (active by default)
  const navAnalysisRailBtn = el('button', {
    className: 'group relative size-9 rounded flex items-center justify-center transition-all bg-[var(--accent-cyan)]/10 border border-[var(--accent-cyan)]/40',
  }) as HTMLButtonElement;
  const analysisIcon = iconRadar();
  analysisIcon.classList.add('size-4', 'text-[var(--accent-cyan)]', 'group-hover:text-white/70', 'transition-colors');
  navAnalysisRailBtn.append(analysisIcon);
  
  // Terminal button
  const navTerminalButton = el('button', {
    className: 'group relative size-9 rounded flex items-center justify-center transition-all hover:bg-white/5 border border-transparent',
    attrs: { title: 'Terminal' },
  }) as HTMLButtonElement;
  const terminalIcon = iconTerminal();
  terminalIcon.classList.add('size-4', 'text-white/40', 'group-hover:text-white/70', 'transition-colors');
  navTerminalButton.append(terminalIcon);
  
  // Waveform button
  const navWaveformBtn = el('button', {
    className: 'group relative size-9 rounded flex items-center justify-center transition-all hover:bg-white/5 border border-transparent',
  }) as HTMLButtonElement;
  const waveIcon = iconWave();
  waveIcon.classList.add('size-4', 'text-white/40', 'group-hover:text-white/70', 'transition-colors');
  navWaveformBtn.append(waveIcon);

  navRailTop.append(navAnalysisRailBtn, navTerminalButton, navWaveformBtn);

  const navRailBottom = el('div', { className: 'flex flex-col items-center gap-3' });
  
  const userAvatar = el('div', {
    className: 'size-8 rounded-full bg-gradient-to-br from-[var(--accent-cyan)]/20 to-[var(--accent-teal)]/20 border border-[var(--app-line-strong)] flex items-center justify-center',
  });
  const userInitial = el('span', {
    className: 'text-[10px] font-[var(--font-display)] font-bold text-white/60',
    text: 'K',
  });
  userAvatar.append(userInitial);
  
  navRailBottom.append(userAvatar);
  navRail.append(navRailTop, navRailBottom);

  const sidebar = el('aside', {
    className: 'col-start-2 row-start-1 flex flex-col border-r border-[var(--app-line)] bg-gradient-to-b from-[var(--app-surface)]/80 to-transparent overflow-hidden min-w-0',
  });

  const sidebarHeader = el('div', {
    className: 'flex items-center justify-between px-4 py-3 border-b border-[var(--app-line)]',
  });
  
  const explorerTitle = el('div', { className: 'flex items-center gap-2' });
  const folderIcon = iconFolder();
  folderIcon.classList.add('size-4', 'text-[var(--accent-cyan)]');
  const explorerLabel = el('span', {
    className: 'section-label',
    text: 'EXPLORER',
  });
  explorerTitle.append(folderIcon, explorerLabel);

  const explorerActions = el('div', { className: 'flex items-center gap-1' });
  const explorerAddButton = el('button', {
    className:
      'size-6 flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/5 rounded transition-all text-xs',
    text: '+',
    attrs: { type: 'button', 'aria-label': 'Add capture' },
  }) as HTMLButtonElement;
  const explorerRefreshButton = el('button', {
    className:
      'size-6 flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/5 rounded transition-all text-xs',
    text: '↻',
    attrs: { type: 'button', 'aria-label': 'Refresh captures' },
  }) as HTMLButtonElement;
  explorerActions.append(explorerAddButton, explorerRefreshButton);

  sidebarHeader.append(explorerTitle, explorerActions);

  const folderRow = el('div', {
    className: 'mx-3 mt-3 flex items-center gap-2 rounded px-3 py-2 bg-[var(--app-surface)] border border-[var(--app-line)] hover:border-[var(--app-line-strong)] transition-colors',
  });
  
  const folderIconSmall = iconFolder();
  folderIconSmall.classList.add('size-3.5', 'text-[var(--accent-cyan)]/70');
  
  const folderSelect = el('select', {
    className: 'flex-1 bg-transparent text-[11px] font-[var(--font-mono)] tracking-wider text-white/70 focus:outline-none cursor-pointer',
  }) as HTMLSelectElement;
  folderSelect.append(new Option('DEFAULT WORKSPACE', 'default'));
  
  folderRow.append(folderIconSmall, folderSelect);

  const workspaceForm = el('div', {
    className: 'mx-3 mt-2 hidden items-center gap-2 rounded px-2 py-2 bg-[var(--app-surface)] border border-[var(--app-line)]',
  });
  const workspaceInput = el('input', {
    className: 'flex-1 bg-transparent text-[11px] font-[var(--font-mono)] tracking-wider text-white/70 focus:outline-none',
    attrs: { type: 'text', placeholder: 'Workspace name' },
  }) as HTMLInputElement;
  const workspaceAddButton = el('button', {
    className:
      'px-2 py-1 text-[9px] font-[var(--font-display)] tracking-[0.18em] text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/30 rounded hover:bg-[var(--accent-cyan)]/10 transition-all',
    text: 'ADD',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  const workspaceCancelButton = el('button', {
    className:
      'px-2 py-1 text-[9px] font-[var(--font-display)] tracking-[0.18em] text-white/50 border border-white/10 rounded hover:bg-white/5 transition-all',
    text: 'CANCEL',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  workspaceForm.append(workspaceInput, workspaceAddButton, workspaceCancelButton);

  const fileList = el('div', {
    className: 'flex-1 px-3 py-3 text-xs space-y-1 overflow-y-auto',
  });

  const emptyState = el('div', {
    className: 'flex flex-col items-center justify-center py-8 text-center',
  });
  const emptyIcon = iconHex();
  emptyIcon.classList.add('size-8', 'text-white/10', 'mb-3');
  const emptyTitle = el('div', {
    className: 'data-label mb-1',
    text: 'NO FILES',
    attrs: { 'data-explorer-empty-title': 'true' },
  });
  const emptySubtitle = el('div', {
    className: 'text-[10px] text-white/30 leading-relaxed',
    text: 'Open a PCAP file to begin forensic analysis',
    attrs: { 'data-explorer-empty-subtitle': 'true' },
  });
  emptyState.append(emptyIcon, emptyTitle, emptySubtitle);
  fileList.append(emptyState);

  sidebar.append(sidebarHeader, folderRow, workspaceForm, fileList);

  const analysisMain = el('section', {
    className:
      'col-start-3 col-span-2 row-start-1 flex min-w-0 flex-col overflow-hidden border-r border-[var(--app-line)]/0',
  });

  const analysisHeader = el('div', {
    className:
      'analysis-header flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--app-line)] bg-[var(--app-surface)]/30',
  });

  const screenTabs = el('div', { className: 'flex items-center gap-1 flex-wrap min-w-0' });
  const screenBtnBase =
    'px-2.5 py-1 text-[9px] font-[var(--font-display)] tracking-[0.22em] uppercase rounded transition-all';
  const screenBtnActive =
    `${screenBtnBase} text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 border border-[var(--accent-cyan)]/30`;
  const screenBtnInactive = `${screenBtnBase} text-white/40 hover:text-white/70 border border-transparent`;

  const analyzeScreenOverviewButton = el('button', {
    className: screenBtnActive,
    text: 'OVERVIEW',
    attrs: { type: 'button', 'data-analyze-screen': 'overview' },
  }) as HTMLButtonElement;
  const analyzeScreenSessionsButton = el('button', {
    className: screenBtnInactive,
    text: 'SESSIONS',
    attrs: { type: 'button', 'data-analyze-screen': 'sessions' },
  }) as HTMLButtonElement;
  const analyzeScreenTimelineButton = el('button', {
    className: screenBtnInactive,
    text: 'TIMELINE',
    attrs: { type: 'button', 'data-analyze-screen': 'timeline' },
  }) as HTMLButtonElement;
  const analyzeScreenTerminalButton = el('button', {
    className: screenBtnInactive,
    text: 'TERMINAL',
    attrs: { type: 'button', 'data-analyze-screen': 'terminal' },
  }) as HTMLButtonElement;
  const analyzeScreenInsightsButton = el('button', {
    className: screenBtnInactive,
    text: 'INSIGHTS',
    attrs: { type: 'button', 'data-analyze-screen': 'insights' },
  }) as HTMLButtonElement;
  const analyzeScreenWorkflowsButton = el('button', {
    className: screenBtnInactive,
    text: 'WORKFLOWS',
    attrs: { type: 'button', 'data-analyze-screen': 'workflows' },
  }) as HTMLButtonElement;

  screenTabs.append(
    analyzeScreenOverviewButton,
    analyzeScreenSessionsButton,
    analyzeScreenTimelineButton,
    analyzeScreenTerminalButton,
    analyzeScreenInsightsButton,
    analyzeScreenWorkflowsButton
  );

  const analyzeScreenLabel = el('div', {
    className: 'data-label truncate max-w-[220px]',
    text: 'OVERVIEW',
  });

  analysisHeader.append(screenTabs, analyzeScreenLabel);

  const analyzeScreenHost = el('div', {
    className: 'relative flex-1 min-h-0 overflow-hidden',
  });

  analysisMain.append(analysisHeader, analyzeScreenHost);

  const persistedSessionsW = readStoredNumber('kisame.ui.sessionsWidth');
  if (persistedSessionsW) analysisMain.style.setProperty('--sessions-w', `${persistedSessionsW}px`);

  const sessionsPanel = el('section', {
    className: 'h-full flex min-w-0 flex-col overflow-hidden border-r border-[var(--app-line)]',
  });

  const sessionsHeader = el('div', {
    className: 'flex items-center justify-between px-4 py-2.5 border-b border-[var(--app-line)] bg-[var(--app-surface)]/30',
  });

  const sessionsTitle = el('div', { className: 'flex items-center gap-2' });
  const sessionsIcon = iconSessions();
  sessionsIcon.classList.add('size-4', 'text-[var(--accent-cyan)]');
  sessionsTitle.append(sessionsIcon, el('span', { className: 'section-label', text: 'SESSIONS' }));

  const sessionsCount = el('div', {
    className: 'px-2 py-0.5 text-[9px] font-[var(--font-mono)] text-white/30 bg-white/5 rounded',
    text: '0',
  });

  sessionsHeader.append(sessionsTitle, sessionsCount);

  const sessionsList = el('div', {
    className: 'flex-1 overflow-y-auto px-3 py-3 space-y-2',
  });

  sessionsPanel.append(sessionsHeader, sessionsList);

  const timelinePanel = el('section', {
    className: 'h-full flex min-w-0 flex-col overflow-hidden',
  });

  const timelineHeader = el('div', {
    className: 'flex items-center justify-between px-4 py-2.5 border-b border-[var(--app-line)] bg-[var(--app-surface)]/30',
  });

  const timelineTitle = el('div', { className: 'flex items-center gap-2' });
  const timelineIcon = iconTimeline();
  timelineIcon.classList.add('size-4', 'text-[var(--accent-teal)]');
  timelineTitle.append(timelineIcon, el('span', { className: 'section-label', text: 'TIMELINE' }));

  const sessionIdLabel = el('div', {
    className: 'data-label truncate max-w-[150px]',
    text: 'SESSION: —',
  });

  const timelineCount = el('div', {
    className: 'px-2 py-0.5 text-[9px] font-[var(--font-mono)] text-white/30 bg-white/5 rounded',
    text: '0',
  });

  const timelineHeaderRight = el('div', { className: 'flex items-center gap-2 min-w-0' });
  timelineHeaderRight.append(sessionIdLabel, timelineCount);
  timelineHeader.append(timelineTitle, timelineHeaderRight);

  const timelineControls = el('div', {
    className: 'flex items-center gap-2 px-4 py-2 border-b border-[var(--app-line)] bg-[var(--app-surface)]/10',
  });

  const timelineScope = el('div', {
    className: 'flex items-center rounded overflow-hidden border border-white/10 bg-white/5',
  });
  const timelineScopeSessionButton = el('button', {
    className:
      'px-2 py-1 text-[9px] font-[var(--font-mono)] tracking-wider text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10',
    text: 'SESSION',
    attrs: { type: 'button', 'data-timeline-scope': 'session' },
  }) as HTMLButtonElement;
  const timelineScopeAllButton = el('button', {
    className:
      'px-2 py-1 text-[9px] font-[var(--font-mono)] tracking-wider text-white/40 hover:text-white/70 transition-colors',
    text: 'ALL',
    attrs: { type: 'button', 'data-timeline-scope': 'all' },
  }) as HTMLButtonElement;
  timelineScope.append(timelineScopeSessionButton, timelineScopeAllButton);

  const timelineKindSelect = el('select', {
    className:
      'bg-white/5 border border-white/10 rounded px-2 py-1 text-[9px] font-[var(--font-mono)] tracking-wider text-white/60 focus:outline-none',
  }) as HTMLSelectElement;
  timelineKindSelect.append(new Option('ALL', 'all'));

  const timelineSearchInput = el('input', {
    className:
      'flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] font-[var(--font-mono)] text-white/70 placeholder:text-white/25 focus:outline-none',
    attrs: { type: 'search', placeholder: 'Search timeline…' },
  }) as HTMLInputElement;

  timelineControls.append(timelineScope, timelineKindSelect, timelineSearchInput);

  const timelineList = el('div', {
    className: 'flex-1 overflow-y-auto px-3 py-3 space-y-2',
  });

  timelinePanel.append(timelineHeader, timelineControls, timelineList);

  function bindVerticalResize(handle: HTMLElement, readPx: () => number, onUpdate: (nextPx: number) => void) {
    let startX = 0;
    let startPx = 0;

    const onPointerMove = (event: PointerEvent) => {
      const delta = event.clientX - startX;
      onUpdate(startPx + delta);
    };

    const onPointerUp = (event: PointerEvent) => {
      handle.releasePointerCapture(event.pointerId);
      document.body.style.userSelect = '';
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
    };

    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      startX = event.clientX;
      startPx = readPx();
      document.body.style.userSelect = 'none';
      handle.setPointerCapture(event.pointerId);
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    });
  }

  function bindHorizontalResize(handle: HTMLElement, readPx: () => number, onUpdate: (nextPx: number) => void) {
    let startY = 0;
    let startPx = 0;

    const onPointerMove = (event: PointerEvent) => {
      const delta = event.clientY - startY;
      onUpdate(startPx - delta);
    };

    const onPointerUp = (event: PointerEvent) => {
      handle.releasePointerCapture(event.pointerId);
      document.body.style.userSelect = '';
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
    };

    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      startY = event.clientY;
      startPx = readPx();
      document.body.style.userSelect = 'none';
      handle.setPointerCapture(event.pointerId);
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    });
  }

  // Resize handles (overlay)
  const explorerResizeHandle = el('div', {
    className: 'resize-handle absolute inset-y-0 w-2 -ml-1 cursor-col-resize z-30',
    attrs: { style: 'left: calc(var(--nav-w) + var(--explorer-w));' },
  });
  explorerResizeHandle.append(
    el('div', { className: 'absolute inset-y-0 left-1/2 w-px bg-white/10' })
  );
  bindVerticalResize(
    explorerResizeHandle,
    () => getCssVarPx(body, '--explorer-w', 280),
    (nextPx) => {
      const clamped = clamp(nextPx, 180, 520);
      body.style.setProperty('--explorer-w', `${clamped}px`);
      writeStoredNumber('kisame.ui.explorerWidth', clamped);
    }
  );

  const chatResizeHandle = el('div', {
    className: 'resize-handle absolute inset-y-0 w-2 -mr-1 cursor-col-resize z-30',
    attrs: { style: 'right: var(--chat-w);' },
  });
  chatResizeHandle.append(
    el('div', { className: 'absolute inset-y-0 left-1/2 w-px bg-white/10' })
  );
  bindVerticalResize(
    chatResizeHandle,
    () => -getCssVarPx(body, '--chat-w', 380),
    (negNextPx) => {
      const nextPx = -negNextPx;
      const clamped = clamp(nextPx, 260, 620);
      body.style.setProperty('--chat-w', `${clamped}px`);
      writeStoredNumber('kisame.ui.chatWidth', clamped);
    }
  );

  const sessionsSplitHandle = el('div', {
    className: 'resize-handle absolute inset-y-0 w-2 -ml-1 cursor-col-resize z-20',
    attrs: { style: 'left: var(--sessions-w);' },
  });
  sessionsSplitHandle.append(el('div', { className: 'absolute inset-y-0 left-1/2 w-px bg-white/10' }));
  bindVerticalResize(
    sessionsSplitHandle,
    () => getCssVarPx(analysisMain, '--sessions-w', 340),
    (nextPx) => {
      const clamped = clamp(nextPx, 220, 720);
      analysisMain.style.setProperty('--sessions-w', `${clamped}px`);
      writeStoredNumber('kisame.ui.sessionsWidth', clamped);
    }
  );

  const overviewEvidenceHandle = el('div', {
    className: 'resize-handle absolute h-2 -mb-1 cursor-row-resize z-20',
    attrs: { style: 'left: 0; right: 0; bottom: var(--evidence-h);' },
  });
  overviewEvidenceHandle.append(el('div', { className: 'absolute inset-x-0 top-1/2 h-px bg-white/10' }));
  bindHorizontalResize(
    overviewEvidenceHandle,
    () => getCssVarPx(body, '--evidence-h', 220),
    (nextPx) => {
      const clamped = clamp(nextPx, 140, 520);
      body.style.setProperty('--evidence-h', `${clamped}px`);
      writeStoredNumber('kisame.ui.evidenceHeight', clamped);
    }
  );

  // Welcome panel overlay
  const welcomePanel = el('div', {
    className: 'absolute inset-0 flex items-center justify-center app-welcome-bg pointer-events-none z-10',
  });

  const welcomeContent = el('div', {
    className: 'relative max-w-2xl text-center px-8',
  });

  // Decorative hex grid behind welcome
  const hexGrid = el('div', {
    className: 'absolute inset-0 flex items-center justify-center opacity-5',
  });
  for (let i = 0; i < 6; i++) {
    const hex = el('div', {
      className: 'absolute w-32 h-32 border border-[var(--accent-cyan)] rotate-45',
      attrs: { style: `transform: rotate(${i * 15}deg) scale(${1 + i * 0.3});` }
    });
    hexGrid.append(hex);
  }

  const welcomeLogo = el('div', {
    className: 'flex items-center justify-center gap-4 mb-8',
  });
  const bigLogo = el('img', {
    className: 'h-16 w-auto opacity-90',
    attrs: {
      src: '/kisame-logo.png',
      alt: 'Kisame',
      draggable: 'false',
      style: 'filter: invert(1) drop-shadow(0 0 18px rgba(110,181,181,0.10));',
    },
  });
  welcomeLogo.append(bigLogo);

  const welcomeTitle = el('div', {
    className: 'font-[var(--font-display)] text-5xl font-black tracking-[0.35em] text-white/90 mb-4 glow-text-cyan',
    text: 'KISAME',
  });

  const welcomeSubtitle = el('div', {
    className: 'font-[var(--font-display)] text-sm font-medium tracking-[0.4em] text-[var(--accent-cyan)] mb-8 uppercase',
    text: 'NETWORK FORENSICS ENGINE',
  });

  const welcomeBody = el('div', {
    className: 'text-base leading-relaxed text-white/50 max-w-md mx-auto mb-10',
    text: 'Load a PCAP capture to begin deep packet inspection, session correlation, and AI-powered forensic analysis.',
  });

  const accentBar = el('div', {
    className: 'relative h-1 mx-auto w-48 overflow-hidden',
  });
  const accentFill = el('div', {
    className: 'absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-teal)]',
    attrs: { style: 'animation: slideRight 3s ease-in-out infinite alternate;' }
  });
  accentBar.innerHTML = `
    <style>
      @keyframes slideRight {
        from { transform: translateX(-100%); }
        to { transform: translateX(200%); }
      }
    </style>
  `;
  accentBar.append(accentFill);

  const statsRow = el('div', {
    className: 'flex items-center justify-center gap-8 mt-10',
  });

  const stats = [
    { label: 'PROTOCOLS', value: '—' },
    { label: 'SESSIONS', value: '—' },
    { label: 'PACKETS', value: '—' },
  ];

  stats.forEach(stat => {
    const statBox = el('div', { className: 'text-center' });
    statBox.append(
      el('div', { className: 'font-[var(--font-display)] text-2xl font-bold text-white/30 mb-1', text: stat.value }),
      el('div', { className: 'data-label', text: stat.label })
    );
    statsRow.append(statBox);
  });

  welcomeContent.append(hexGrid, welcomeLogo, welcomeTitle, welcomeSubtitle, welcomeBody, accentBar, statsRow);
  welcomePanel.append(welcomeContent);

  // Terminal Panel (replaces evidence panel)
  const terminalPanel = el('section', {
    className: 'h-full flex min-w-0 flex-col overflow-hidden border-t border-[var(--app-line)]',
  });

  const terminalHeader = el('div', {
    className: 'flex items-center gap-1 px-2 py-1 border-b border-[var(--app-line)] bg-[var(--app-surface)]/50',
  });

  // Terminal tabs container
  const terminalTabsContainer = el('div', {
    className: 'flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none',
  });

  // Add terminal button
  const terminalAddButton = el('button', {
    className: 'flex items-center justify-center size-6 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors',
    attrs: { type: 'button', title: 'New Terminal' },
  }) as HTMLButtonElement;
  terminalAddButton.innerHTML = `<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`;

  terminalHeader.append(terminalTabsContainer, terminalAddButton);

  // Container for xterm.js - removed padding, full height
  const terminalContainer = el('div', {
    className: 'flex-1 min-h-0 overflow-hidden bg-[#0d1117]',
    attrs: { id: 'terminal-container' },
  });

  terminalPanel.append(terminalHeader, terminalContainer);

  const sessionKeyPanel = el('section', {
    className: 'h-full flex min-w-0 flex-col overflow-hidden border-l border-[var(--app-line)]',
  });
  const sessionKeyHeader = el('div', {
    className: 'flex items-center justify-between px-4 py-2.5 border-b border-[var(--app-line)] bg-[var(--app-surface)]/30',
  });
  sessionKeyHeader.append(
    el('div', { className: 'section-label', text: 'SESSION KEY' }),
    el('div', { className: 'data-label', text: 'DETAILS' })
  );
  const sessionKeyBody = el('div', {
    className: 'flex-1 overflow-auto px-4 py-3 text-xs text-white/60',
  });
  sessionKeyPanel.append(sessionKeyHeader, sessionKeyBody);

  const insightsPanel = el('section', {
    className: 'h-full flex min-w-0 flex-col overflow-hidden',
  });
  const insightsHeader = el('div', {
    className: 'flex items-center justify-between px-4 py-2.5 border-b border-[var(--app-line)] bg-[var(--app-surface)]/30',
  });
  insightsHeader.append(
    el('div', { className: 'section-label', text: 'INSIGHTS' }),
    el('div', { className: 'data-label', text: 'CAPTURE' })
  );
  const insightsBody = el('div', {
    className: 'flex-1 overflow-auto px-4 py-3 text-xs text-white/60',
  });
  insightsPanel.append(insightsHeader, insightsBody);

  const workflowsPanel = el('section', {
    className: 'h-full flex min-w-0 flex-col overflow-hidden',
  });
  const workflowsHeader = el('div', {
    className: 'flex items-center justify-between px-4 py-2.5 border-b border-[var(--app-line)] bg-[var(--app-surface)]/30',
  });
  workflowsHeader.append(
    el('div', { className: 'section-label', text: 'WORKFLOWS' }),
    el('div', { className: 'data-label', text: 'PROMPT AUTOMATION' })
  );

  const workflowGrid = el('div', {
    className: 'grid flex-1 min-h-0 overflow-hidden workflow-grid',
    attrs: { style: 'grid-template-columns: 280px minmax(0,1fr);' },
  });

  const workflowList = el('div', {
    className: 'min-w-0 overflow-auto p-3 space-y-2 border-r border-[var(--app-line)]',
  });

  const workflowEditor = el('div', {
    className: 'min-w-0 overflow-auto p-4 space-y-4',
  });

  const workflowNameInput = el('input', {
    className:
      'w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-[12px] font-[var(--font-mono)] text-white/80 placeholder:text-white/25 focus:outline-none',
    attrs: { type: 'text', placeholder: 'Workflow name…' },
  }) as HTMLInputElement;

  const workflowScopeSelect = el('select', {
    className:
      'w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-[11px] font-[var(--font-mono)] tracking-wider text-white/70 focus:outline-none',
  }) as HTMLSelectElement;
  workflowScopeSelect.append(new Option('Capture-wide context', 'capture'), new Option('Selected session context', 'session'));

  const workflowPromptsInput = el('textarea', {
    className:
      'w-full min-h-[220px] bg-white/5 border border-white/10 rounded px-3 py-2 text-[12px] font-[var(--font-mono)] text-white/75 placeholder:text-white/25 focus:outline-none',
    attrs: {
      placeholder:
        'One prompt per line.\nExample:\n- Show top IPs (top talkers)\n- Show top ports and protocols\n- Summarize suspicious sessions and flags',
    },
  }) as HTMLTextAreaElement;

  const workflowAutoRunRow = el('label', { className: 'flex items-center gap-2 text-[10px] text-white/50' });
  const workflowAutoRunCheckbox = el('input', {
    className: 'accent-[var(--accent-cyan)]',
    attrs: { type: 'checkbox' },
  }) as HTMLInputElement;
  workflowAutoRunRow.append(workflowAutoRunCheckbox, el('span', { text: 'Default workflow after capture load' }));

  const workflowActions = el('div', { className: 'flex items-center gap-2 flex-wrap' });
  const workflowNewButton = el('button', {
    className: 'cyber-btn px-3 py-2 text-[10px] font-[var(--font-display)] tracking-[0.2em] text-white/70 uppercase',
    text: 'NEW',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  const workflowSaveButton = el('button', {
    className: 'cyber-btn px-3 py-2 text-[10px] font-[var(--font-display)] tracking-[0.2em] text-[var(--accent-cyan)] uppercase',
    text: 'SAVE',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  const workflowRunButton = el('button', {
    className: 'cyber-btn px-3 py-2 text-[10px] font-[var(--font-display)] tracking-[0.2em] text-[var(--accent-teal)] uppercase',
    text: 'RUN',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  const workflowDeleteButton = el('button', {
    className: 'cyber-btn px-3 py-2 text-[10px] font-[var(--font-display)] tracking-[0.2em] text-[var(--accent-red)] uppercase',
    text: 'DELETE',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;

  workflowActions.append(workflowNewButton, workflowSaveButton, workflowRunButton, workflowDeleteButton);
  workflowEditor.append(
    el('div', { className: 'data-label', text: 'Name' }),
    workflowNameInput,
    el('div', { className: 'data-label', text: 'Context' }),
    workflowScopeSelect,
    el('div', { className: 'data-label', text: 'Prompts' }),
    workflowPromptsInput,
    workflowAutoRunRow,
    workflowActions
  );

  workflowGrid.append(workflowList, workflowEditor);
  workflowsPanel.append(workflowsHeader, workflowGrid);

  const workflowModalOverlay = el('div', {
    className: 'workflow-modal fixed inset-0 z-50 hidden items-center justify-center p-4',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-hidden': 'true' },
  });
  const workflowModalPanel = el('div', {
    className: 'workflow-modal-panel w-full max-w-xl max-h-[80vh] overflow-hidden rounded-lg flex flex-col',
  });
  const workflowModalAccent = el('div', { className: 'workflow-modal-accent h-0.5 w-full' });
  const workflowModalContent = el('div', { className: 'flex-1 p-5 overflow-hidden flex flex-col' });
  const workflowModalHeader = el('div', { className: 'flex items-start justify-between gap-4' });
  const workflowModalTitle = el('div', { className: 'section-label', text: 'WORKFLOW' });
  const workflowModalSubtitle = el('div', { className: 'data-label', text: '' });
  workflowModalHeader.append(workflowModalTitle, workflowModalSubtitle);
  const workflowModalBody = el('div', { className: 'mt-2 text-sm text-white/70' });
  const workflowModalList = el('div', { className: 'mt-4 flex-1 overflow-auto space-y-2 pr-1' });
  const workflowModalError = el('div', { className: 'mt-2 text-[10px] text-[var(--accent-red)] hidden' });
  const workflowModalActions = el('div', { className: 'mt-5 flex items-center justify-end gap-2' });
  const workflowModalCancelButton = el('button', {
    className: 'cyber-btn px-3 py-2 text-[10px] font-[var(--font-display)] tracking-[0.2em] text-white/60 uppercase',
    text: 'CANCEL',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  const workflowModalConfirmButton = el('button', {
    className: 'cyber-btn px-3 py-2 text-[10px] font-[var(--font-display)] tracking-[0.2em] text-[var(--accent-teal)] uppercase',
    text: 'RUN',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  workflowModalActions.append(workflowModalCancelButton, workflowModalConfirmButton);
  workflowModalContent.append(
    workflowModalHeader,
    workflowModalBody,
    workflowModalList,
    workflowModalError,
    workflowModalActions
  );
  workflowModalPanel.append(workflowModalAccent, workflowModalContent);
  workflowModalOverlay.append(workflowModalPanel);

  const overviewTopLayout = el('div', {
    className: 'relative grid min-h-0 overflow-hidden overview-top-grid',
    attrs: { style: 'grid-template-columns: var(--sessions-w) minmax(0,1fr);' },
  });

  const overviewLayout = el('div', {
    className: 'relative grid h-full min-h-0 overflow-hidden',
    attrs: { style: 'grid-template-rows: minmax(0,1fr) var(--evidence-h);' },
  });

  const sessionsLayout = el('div', {
    className: 'relative grid h-full min-h-0 overflow-hidden sessions-top-grid',
    attrs: { style: 'grid-template-columns: var(--sessions-w) minmax(0,1fr);' },
  });

  // Default mount = overview.
  overviewTopLayout.append(sessionsPanel, timelinePanel, sessionsSplitHandle);
  overviewLayout.append(overviewTopLayout, terminalPanel, overviewEvidenceHandle);
  analyzeScreenHost.append(overviewLayout, welcomePanel);

  const chatColumn = el('aside', {
    className: 'col-start-5 row-start-1 flex min-w-0 flex-col overflow-hidden border-l border-[var(--app-line)] bg-gradient-to-b from-[var(--app-surface)]/50 to-transparent',
  });

  const analysisPanel = el('div', {
    className: 'hidden border-b border-[var(--app-line)] px-4 py-4 space-y-3',
  });
  const analysisLabel = el('div', {
    className: 'section-label',
    text: 'ANALYSIS',
  });
  const analysisSummary = el('div', {
    className: 'text-sm text-white/80 leading-relaxed',
  });
  const analysisDetail = el('div', {
    className: 'text-xs text-white/60 leading-relaxed',
  });
  analysisPanel.append(analysisLabel, analysisSummary, analysisDetail);

  const chatHeader = el('div', {
    className: 'flex items-center justify-between px-4 py-3 border-b border-[var(--app-line)]',
  });

  const chatTitle = el('div', { className: 'flex items-center gap-2' });
  const termIcon = iconTerminal();
  termIcon.classList.add('size-4', 'text-[var(--accent-purple)]');
  chatTitle.append(
    termIcon,
    el('span', { className: 'section-label', text: 'AI ANALYST' })
  );

  const chatStatus = el('div', {
    className: 'flex items-center gap-2 px-2 py-1 rounded bg-[var(--accent-teal)]/10 border border-[var(--accent-teal)]/20',
  });
  const chatDot = el('div', { className: 'size-1.5 rounded-full bg-[var(--accent-teal)] pulse-dot' });
  const chatStatusText = el('span', {
    className: 'text-[9px] font-[var(--font-mono)] tracking-wider text-[var(--accent-teal)] uppercase',
    text: 'ONLINE',
  });
  chatStatus.append(chatDot, chatStatusText);

  chatHeader.append(chatTitle, chatStatus);

  const chatBody = el('div', {
    className: 'relative flex-1 min-h-0 overflow-hidden',
  });

  const chatEmptyState = el('div', {
    className: 'pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6',
  });

  const emptyVisual = el('div', {
    className: 'relative mb-6',
  });
  const emptyCircle = el('div', {
    className: 'size-20 rounded-full border-2 border-dashed border-[var(--accent-cyan)]/20 flex items-center justify-center',
  });
  const emptyInner = el('div', {
    className: 'size-12 rounded-full bg-gradient-to-br from-[var(--accent-cyan)]/10 to-[var(--accent-purple)]/10 flex items-center justify-center',
  });
  const aiIcon = iconTerminal();
  aiIcon.classList.add('size-5', 'text-[var(--accent-cyan)]/50');
  emptyInner.append(aiIcon);
  emptyCircle.append(emptyInner);
  emptyVisual.append(emptyCircle);

  chatEmptyState.append(
    emptyVisual,
    el('div', {
      className: 'font-[var(--font-display)] text-base font-semibold tracking-[0.2em] text-white/70 uppercase mb-2',
      text: 'FORENSIC AI',
    }),
    el('div', {
      className: 'text-[11px] font-[var(--font-mono)] tracking-wider text-white/30 uppercase leading-relaxed',
      text: 'Ask questions about sessions, protocols, or suspicious activity',
    })
  );

  const chatMessages = el('div', {
    className: 'absolute inset-0 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4',
  });

  chatBody.append(chatEmptyState, chatMessages);

  const chatInputRow = el('div', {
    className: 'px-3 py-3 border-t border-[var(--app-line)] bg-[var(--app-surface)]/30',
  });

  const chatInputWrap = el('div', {
    className: 'relative flex items-center gap-2 rounded-lg bg-[var(--app-bg)] border border-[var(--app-line)] focus-within:border-[var(--accent-cyan)]/50 focus-within:shadow-[0_0_20px_rgba(0,240,255,0.1)] transition-all',
  });

  const inputIcon = el('div', {
    className: 'pl-3 text-white/20',
    text: '›',
  });

  const chatInput = el('input', {
    className: 'flex-1 min-w-0 bg-transparent py-3 text-sm font-[var(--font-ui)] text-white/90 placeholder:text-white/25 focus:outline-none',
    attrs: { 
      type: 'text', 
      placeholder: 'Press / to focus…',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;

  const chatSendBtn = el('button', {
    className: 'mr-1 cyber-btn px-4 py-2 text-[10px] font-[var(--font-display)] font-semibold tracking-[0.15em] text-[var(--accent-cyan)] uppercase',
    text: 'SEND',
  }) as HTMLButtonElement;

  const chatStopBtn = el('button', {
    className: 'mr-1 cyber-btn hidden px-4 py-2 text-[10px] font-[var(--font-display)] font-semibold tracking-[0.15em] text-[var(--accent-red)] uppercase',
    text: 'STOP',
  }) as HTMLButtonElement;

  chatInputWrap.append(inputIcon, chatInput, chatSendBtn, chatStopBtn);
  chatInputRow.append(chatInputWrap);

  chatColumn.append(analysisPanel, chatHeader, chatBody, chatInputRow);

  const capturePanel = el('section', {
    className:
      'col-start-3 col-span-3 row-start-1 hidden flex flex-col overflow-hidden border-l border-[var(--app-line)] bg-gradient-to-b from-[var(--app-surface)]/70 to-transparent',
  });

  const captureHeader = el('div', {
    className: 'flex items-center justify-between px-6 py-4 border-b border-[var(--app-line)] bg-[var(--app-surface)]/30',
  });
  const captureHeaderLeft = el('div', { className: 'flex items-center gap-3' });
  const captureIconEl = iconRadar();
  captureIconEl.classList.add('size-4', 'text-[var(--accent-cyan)]');
  captureHeaderLeft.append(
    captureIconEl,
    el('span', { className: 'section-label', text: 'CAPTURE CONSOLE' })
  );
  captureHeader.append(
    captureHeaderLeft,
    el('span', { className: 'data-label', text: 'LIVE + FILE INGEST' })
  );

  const captureGrid = el('div', {
    className: 'flex-1 overflow-auto p-6 grid grid-cols-2 gap-6 content-start',
  });

  // Open PCAP Card
  const openCard = el('div', {
    className: 'relative group data-card rounded-lg p-5 flex flex-col gap-4 overflow-hidden',
  });
  
  const openCardGlow = el('div', {
    className: 'absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none',
    attrs: { style: 'background: radial-gradient(ellipse at top left, rgba(0, 240, 255, 0.08) 0%, transparent 60%);' }
  });
  
  const openCardHeader = el('div', { className: 'flex items-center justify-between' });
  const openCardTitle = el('div', { className: 'flex items-center gap-2' });
  const folderIconCard = iconFolder();
  folderIconCard.classList.add('size-4', 'text-[var(--accent-cyan)]');
  openCardTitle.append(folderIconCard, el('span', { className: 'section-label', text: 'OPEN PCAP' }));
  
  const openCardBadge = el('div', {
    className: 'px-2 py-0.5 text-[8px] font-[var(--font-mono)] tracking-wider text-[var(--accent-cyan)]/60 border border-[var(--accent-cyan)]/20 rounded uppercase',
    text: 'FILE',
  });
  openCardHeader.append(openCardTitle, openCardBadge);

  const openCardDesc = el('div', {
    className: 'text-[13px] text-white/50 leading-relaxed',
    text: 'Load a packet capture from disk and begin session analysis immediately.',
  });

  const openCardFooter = el('div', { className: 'flex items-center justify-between mt-auto pt-2' });
  const openCardMeta = el('div', {
    className: 'text-[9px] font-[var(--font-mono)] tracking-wider text-white/25 uppercase',
    text: '.PCAP • .PCAPNG',
  });
  openCardFooter.append(openCardMeta, openPcapButton);

  openCard.append(openCardGlow, openCardHeader, openCardDesc, openCardFooter);

  // Live Capture Card
  const liveCard = el('div', {
    className: 'relative group data-card rounded-lg p-5 flex flex-col gap-4 overflow-hidden',
  });
  
  const liveCardGlow = el('div', {
    className: 'absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none',
    attrs: { style: 'background: radial-gradient(ellipse at top left, rgba(0, 255, 157, 0.08) 0%, transparent 60%);' }
  });

  const liveCardHeader = el('div', { className: 'flex items-center justify-between' });
  const liveCardTitle = el('div', { className: 'flex items-center gap-2' });
  const waveIconCard = iconWave();
  waveIconCard.classList.add('size-4', 'text-[var(--accent-teal)]');
  liveCardTitle.append(waveIconCard, el('span', { className: 'section-label text-[var(--accent-teal)]', text: 'LIVE CAPTURE' }));
  
  const liveCardBadge = el('div', {
    className: 'px-2 py-0.5 text-[8px] font-[var(--font-mono)] tracking-wider text-[var(--accent-teal)]/60 border border-[var(--accent-teal)]/20 rounded uppercase',
    text: 'REAL-TIME',
  });
  liveCardHeader.append(liveCardTitle, liveCardBadge);

  const liveCardDesc = el('div', {
    className: 'text-[13px] text-white/50 leading-relaxed',
    text: 'Capture packets from a network interface and stream directly into Kisame for analysis.',
  });

  // Live capture status indicator
  const liveCaptureStatus = el('div', {
    className: 'flex items-center gap-2 px-3 py-2 rounded bg-[var(--app-bg)] border border-[var(--app-line)]',
  });
  const statusIndicator = el('div', {
    className: 'size-2 rounded-full bg-white/20',
    attrs: { 'data-status-dot': 'true' },
  });
  const statusLabel = el('span', {
    className: 'text-[10px] font-[var(--font-mono)] tracking-wider text-white/40 uppercase',
    text: 'READY',
    attrs: { 'data-status-text': 'true' },
  });
  liveCaptureStatus.append(statusIndicator, statusLabel);

  const liveCardFooter = el('div', { className: 'flex items-center justify-between mt-auto pt-2' });
  liveCardFooter.append(liveCaptureStatus, liveCaptureButton);

  liveCard.append(liveCardGlow, liveCardHeader, liveCardDesc, liveCardFooter);

  captureGrid.append(openCard, liveCard);
  capturePanel.append(captureHeader, captureGrid);

  // ============================================================================
  // EXPORT PANEL
  // ============================================================================
  const exportPanel = el('section', {
    className:
      'col-start-3 col-span-3 row-start-1 hidden flex flex-col overflow-hidden border-l border-[var(--app-line)] bg-gradient-to-b from-[var(--app-surface)]/70 to-transparent',
  });
  const exportHeader = el('div', {
    className: 'flex items-center justify-between px-6 py-4 border-b border-[var(--app-line)] bg-[var(--app-surface)]/30',
  });
  const exportHeaderLeft = el('div', { className: 'flex items-center gap-3' });
  const exportIconEl = iconShield();
  exportIconEl.classList.add('size-4', 'text-[var(--accent-amber)]');
  exportHeaderLeft.append(
    exportIconEl,
    el('span', { className: 'section-label', text: 'EXPORT' })
  );
  exportHeader.append(
    exportHeaderLeft,
    el('span', { className: 'data-label', text: 'REPORTS + ARTIFACTS' })
  );
  const exportBody = el('div', {
    className: 'flex-1 flex items-center justify-center text-center px-8 text-white/40 text-sm',
    text: 'Export pipelines will appear here.',
  });
  exportPanel.append(exportHeader, exportBody);

  body.append(
    navRail,
    sidebar,
    analysisMain,
    chatColumn,
    capturePanel,
    exportPanel,
    explorerResizeHandle,
    chatResizeHandle
  );
  app.append(bgEffects, topBar, body, workflowModalOverlay);
  root.replaceChildren(app);

  return {
    root: app,
    mainGrid: body,
    analysisMain,
    analyzeScreenHost,
    analyzeScreenOverviewButton,
    analyzeScreenSessionsButton,
    analyzeScreenTimelineButton,
    analyzeScreenTerminalButton,
    analyzeScreenInsightsButton,
    analyzeScreenWorkflowsButton,
    analyzeScreenLabel,
    navCaptureButton,
    navAnalyzeButton,
    navExportButton,
    navTerminalButton,
    openPcapButton,
    liveCaptureButton,
    liveCaptureStatus,
    captureBadge: badgeText,
    capturePanel,
    exportPanel,
    chatColumn,
    sessionsList,
    timelineList,
    timelineCount,
    timelineScopeSessionButton,
    timelineScopeAllButton,
    timelineKindSelect,
    timelineSearchInput,
    sessionsCount,
    sessionKeyBody,
    insightsBody,
    analysisSummary,
    analysisDetail,
    explorerList: fileList,
    explorerEmptyState: emptyState,
    explorerAddButton,
    explorerRefreshButton,
    workspaceSelect: folderSelect,
    workspaceForm,
    workspaceInput,
    workspaceAddButton,
    workspaceCancelButton,
    uploadIndicator,
    chatMessages,
    chatEmptyState,
    chatInput,
    chatSendBtn,
    chatStopBtn,
    sessionIdLabel,
    welcomePanel,
    overviewLayout,
    overviewTopLayout,
    sessionsLayout,
    sessionsSplitHandle,
    overviewEvidenceHandle,
    sessionsPanel,
    timelinePanel,
    terminalPanel,
    terminalTabsContainer,
    terminalAddButton,
    terminalContainer,
    sessionKeyPanel,
    insightsPanel,
    workflowsPanel,
    workflowList,
    workflowNameInput,
    workflowScopeSelect,
    workflowPromptsInput,
    workflowAutoRunCheckbox,
    workflowNewButton,
    workflowSaveButton,
    workflowRunButton,
    workflowDeleteButton,
    workflowModalOverlay,
    workflowModalTitle,
    workflowModalSubtitle,
    workflowModalBody,
    workflowModalList,
    workflowModalError,
    workflowModalCancelButton,
    workflowModalConfirmButton,
  };
}
