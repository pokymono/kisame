import { el } from './dom';
import { renderMarkdown, destroyMarkdown } from './markdown';
import type { ChatMessage, ToolCallLog, SuggestedNextStep } from '../types';

const toolDisplayNames: Record<string, string> = {
  pcap_overview: 'Loading overview',
  list_sessions: 'Listing sessions',
  get_session: 'Fetching session details',
  get_timeline: 'Building timeline',
  search_timeline: 'Searching timeline',
  pcap_search: 'Searching packets',
  pcap_domains: 'Listing domains',
  pcap_domain_sessions: 'Finding sessions for domain',
  pcap_session_domains: 'Finding domains in session',
  pcap_sessions_query: 'Querying sessions',
  pcap_top_talkers: 'Finding top talkers',
  pcap_protocols: 'Analyzing protocols',
  pcap_tcp_streams: 'Listing TCP streams',
  pcap_follow_tcp_stream: 'Following TCP stream',
  pcap_timeline_range: 'Getting timeline range',
  pcap_event_kinds: 'Listing event types',
  get_evidence_frames: 'Fetching evidence frames',
  suggested_next_steps: 'Suggesting next steps',
};

export interface ChatManagerOptions {
  container: HTMLElement;
  emptyState: HTMLElement;
  scrollThreshold?: number;
}

export class ChatManager {
  private container: HTMLElement;
  private emptyState: HTMLElement;
  private messages: ChatMessage[] = [];
  private elementMap = new WeakMap<ChatMessage, HTMLElement>();
  private scrollThreshold: number;
  private isUserScrolled = false;
  private scrollRAF: number | null = null;

  constructor(options: ChatManagerOptions) {
    this.container = options.container;
    this.emptyState = options.emptyState;
    this.scrollThreshold = options.scrollThreshold ?? 100;

    this.container.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });
  }

  private handleScroll() {
    const { scrollTop, scrollHeight, clientHeight } = this.container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    this.isUserScrolled = distanceFromBottom > this.scrollThreshold;
  }

  private scrollToBottom(smooth = true) {
    if (this.scrollRAF) {
      cancelAnimationFrame(this.scrollRAF);
    }

    this.scrollRAF = requestAnimationFrame(() => {
      this.container.scrollTo({
        top: this.container.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant',
      });
      this.scrollRAF = null;
    });
  }

  addMessage(message: ChatMessage): void {
    this.messages.push(message);

    this.emptyState.classList.add('hidden');

    const element = createMessageElement(message);
    this.elementMap.set(message, element);
    this.container.appendChild(element);

    if (!this.isUserScrolled) {
      this.scrollToBottom();
    }
  }

  updateMessage(message: ChatMessage): void {
    const element = this.elementMap.get(message);
    if (!element) return;

    updateMessageElement(element, message);

    if (!this.isUserScrolled && message.isStreaming) {
      this.scrollToBottom();
    }
  }

  getLastMessage(): ChatMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  clear(): void {
    for (const message of this.messages) {
      const element = this.elementMap.get(message);
      if (element) {
        const contentEl = element.querySelector('[data-content]') as HTMLElement | null;
        if (contentEl) {
          destroyMarkdown(contentEl);
        }
      }
    }

    this.messages = [];
    this.container.replaceChildren();
    this.emptyState.classList.remove('hidden');
    this.isUserScrolled = false;
  }

  forceScrollToBottom(): void {
    this.isUserScrolled = false;
    this.scrollToBottom(false);
  }

  destroy(): void {
    if (this.scrollRAF) {
      cancelAnimationFrame(this.scrollRAF);
    }
    this.clear();
  }
}

function toolIcon(status: ToolCallLog['status']): HTMLElement {
  if (status === 'running') {
    // Animated spinner for running state
    const spinner = el('div', {
      className: 'size-3 relative',
    });
    spinner.innerHTML = `<svg class="animate-spin" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-opacity="0.2" stroke-width="2"/>
      <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
    spinner.style.color = 'var(--accent-cyan)';
    return spinner;
  }
  
  const icon = el('span', {
    className: 'size-3 flex items-center justify-center text-[10px]',
  });
  
  if (status === 'done') {
    icon.innerHTML = `<svg viewBox="0 0 16 16" fill="none" class="size-3">
      <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    icon.style.color = 'var(--accent-teal)';
    icon.style.opacity = '0.7';
  } else if (status === 'error') {
    icon.innerHTML = `<svg viewBox="0 0 16 16" fill="none" class="size-3">
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
    icon.style.color = 'var(--accent-red)';
    icon.style.opacity = '0.7';
  } else {
    icon.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" class="size-2 opacity-30">
      <circle cx="8" cy="8" r="3"/>
    </svg>`;
  }
  return icon;
}

function renderToolCall(tool: ToolCallLog): HTMLElement {
  const row = el('div', {
    className: 'flex items-center gap-2 py-1 group transition-opacity',
  });
  
  if (tool.status === 'done') {
    row.style.opacity = '0.5';
  }

  row.append(toolIcon(tool.status));

  const label = el('span', {
    className: 'text-[11px] font-[var(--font-mono)] truncate transition-colors',
    text: toolDisplayNames[tool.name] ?? tool.name.replace(/_/g, ' '),
  });
  
  if (tool.status === 'running') {
    label.style.color = 'var(--accent-cyan)';
  } else if (tool.status === 'error') {
    label.style.color = 'var(--accent-red)';
    label.style.opacity = '0.8';
  } else {
    label.style.color = 'rgba(255, 255, 255, 0.45)';
  }

  row.append(label);
  return row;
}

function renderToolCalls(tools: ToolCallLog[]): HTMLElement {
  const container = el('div', {
    className: 'my-2 py-2 px-3 rounded-lg overflow-hidden ' +
      'bg-gradient-to-r from-white/[0.02] to-transparent ' +
      'border-l border-white/[0.06]',
    attrs: { 'data-tool-calls': 'true' },
  });

  for (const tool of tools) {
    container.append(renderToolCall(tool));
  }
  return container;
}

function renderSuggestedNextSteps(steps: SuggestedNextStep[]): HTMLElement {
  const container = el('div', {
    className: 'mt-3 flex flex-wrap gap-2',
    attrs: { 'data-suggested-next-steps': 'true' },
  });

  for (const step of steps) {
    const button = el('button', {
      className:
        'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-[var(--font-mono)] ' +
        'tracking-wide bg-white/5 border border-white/10 text-white/70 hover:text-white hover:border-white/30 ' +
        'hover:bg-white/10 transition-colors',
      text: step.label,
      attrs: {
        type: 'button',
        title: step.note,
        'data-next-step': 'true',
        'data-next-step-query': step.query,
        'data-next-step-context': step.contextMode,
      },
    });
    container.append(button);
  }

  return container;
}

export function createMessageElement(message: ChatMessage): HTMLElement {
  if (message.role === 'user') {
    return el('div', {
      className: 'flex justify-end gap-2 animate-slide-in',
      children: [
        el('div', {
          className:
            'max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ' +
            'bg-gradient-to-br from-[var(--accent-cyan)]/15 to-[var(--accent-cyan)]/5 ' +
            'border border-[var(--accent-cyan)]/30 text-white/90 ' +
            'shadow-[0_2px_12px_rgba(0,240,255,0.08)] ' +
            'break-words overflow-hidden',
          text: message.text,
        }),
      ],
    });
  }

  const messageWrap = el('div', {
    className: 'flex gap-3 animate-slide-in',
  });

  const bubble = el('div', {
    className: 'min-w-0 max-w-full space-y-2 overflow-hidden',
  });

  if (message.status && message.isStreaming) {
    const statusRow = el('div', {
      className: 'py-1.5',
      attrs: { 'data-status': 'true' },
    });

    const statusText = el('span', {
      className: 'text-[10px] font-[var(--font-mono)] tracking-[0.15em] uppercase status-shimmer inline-block px-1 rounded',
      text: message.status,
    });

    statusRow.append(statusText);
    bubble.append(statusRow);
  }

  if (message.toolCalls && message.toolCalls.length > 0) {
    bubble.append(renderToolCalls(message.toolCalls));
  }

  if (message.reasoningSummary) {
    const reasoningEl = el('div', {
      className:
        'mt-2 py-2 px-3 rounded text-[11px] text-white/60 ' +
        'bg-white/[0.03] border border-white/10 ' +
        'font-[var(--font-mono)] tracking-wide break-words overflow-hidden',
      attrs: { 'data-reasoning-summary': 'true' },
      text: `Reasoning summary: ${message.reasoningSummary}`,
    });
    bubble.append(reasoningEl);
  }

  const contentEl = el('div', {
    className: 'streamdown-host prose-chat text-sm text-white/85 leading-relaxed overflow-hidden break-words',
    attrs: { 'data-content': 'true' },
  });
  bubble.append(contentEl);

  if (message.text) {
    renderMarkdown(contentEl, message.text, Boolean(message.isStreaming));
    if (message.isStreaming && message.text) {
      contentEl.classList.add('typing-cursor');
    }
  } else if (message.isStreaming && !message.status) {
    contentEl.innerHTML = '<span class="inline-block w-3 h-4 bg-[var(--accent-cyan)]/50 animate-pulse rounded-sm"></span>';
  }

  if (message.toolSummary && !message.isStreaming) {
    const summaryEl = el('div', {
      className: 'mt-3 py-2 px-3 rounded text-[11px] text-white/40 ' +
        'bg-[var(--app-surface)]/50 border-l-2 border-[var(--accent-teal)]/30 ' +
        'font-[var(--font-mono)] tracking-wide break-words overflow-hidden',
      attrs: { 'data-tool-summary': 'true' },
      text: message.toolSummary,
    });
    bubble.append(summaryEl);
  }

  if (message.suggestedNextSteps && message.suggestedNextSteps.length > 0 && !message.isStreaming) {
    bubble.append(renderSuggestedNextSteps(message.suggestedNextSteps));
  }

  messageWrap.append(bubble);
  return messageWrap;
}

export function updateMessageElement(
  element: HTMLElement,
  message: ChatMessage
): void {
  const bubble = element.querySelector('[data-content]')?.parentElement as HTMLElement | null;
  if (!bubble) return;

  const existingStatus = bubble.querySelector('[data-status]');
  if (message.status && message.isStreaming) {
    if (existingStatus) {
      const span = existingStatus.querySelector('span');
      if (span) span.textContent = message.status;
    } else {
      const statusRow = el('div', {
        className: 'py-1.5',
        attrs: { 'data-status': 'true' },
      });

      const statusText = el('span', {
        className: 'text-[10px] font-[var(--font-mono)] tracking-[0.15em] uppercase status-shimmer inline-block px-1 rounded',
        text: message.status,
      });

      statusRow.append(statusText);
      bubble.prepend(statusRow);
    }
  } else if (existingStatus) {
    existingStatus.remove();
  }

  const existingToolCalls = bubble.querySelector('[data-tool-calls]');
  if (existingToolCalls) existingToolCalls.remove();
  if (message.toolCalls && message.toolCalls.length > 0) {
    const toolCallsEl = renderToolCalls(message.toolCalls);
    const contentEl = bubble.querySelector('[data-content]');
    if (contentEl) {
      contentEl.before(toolCallsEl);
    } else {
      bubble.append(toolCallsEl);
    }
  }

  const existingReasoning = bubble.querySelector('[data-reasoning-summary]');
  if (existingReasoning) existingReasoning.remove();
  if (message.reasoningSummary) {
    bubble.append(
      el('div', {
        className:
          'mt-2 py-2 px-3 rounded text-[11px] text-white/60 ' +
          'bg-white/[0.03] border border-white/10 ' +
          'font-[var(--font-mono)] tracking-wide break-words overflow-hidden',
        attrs: { 'data-reasoning-summary': 'true' },
        text: `Reasoning summary: ${message.reasoningSummary}`,
      })
    );
  }

  const existingSummary = bubble.querySelector('[data-tool-summary]');
  if (existingSummary) existingSummary.remove();
  if (message.toolSummary && !message.isStreaming) {
    bubble.append(
      el('div', {
        className: 'mt-3 py-2 px-3 rounded text-[11px] text-white/40 ' +
          'bg-[var(--app-surface)]/50 border-l-2 border-[var(--accent-teal)]/30 ' +
          'font-[var(--font-mono)] tracking-wide break-words overflow-hidden',
        attrs: { 'data-tool-summary': 'true' },
        text: message.toolSummary,
      })
    );
  }

  const existingNextSteps = bubble.querySelector('[data-suggested-next-steps]');
  if (existingNextSteps) existingNextSteps.remove();
  if (message.suggestedNextSteps && message.suggestedNextSteps.length > 0 && !message.isStreaming) {
    bubble.append(renderSuggestedNextSteps(message.suggestedNextSteps));
  }

  const contentEl = bubble.querySelector('[data-content]') as HTMLElement | null;
  if (contentEl) {
    if (!message.isStreaming) {
      contentEl.classList.remove('typing-cursor');
    } else if (message.text) {
      contentEl.classList.add('typing-cursor');
    }

    if (message.text) {
      renderMarkdown(contentEl, message.text, Boolean(message.isStreaming));
    } else if (message.isStreaming && !message.status) {
      contentEl.innerHTML = '<span class="inline-block w-3 h-4 bg-[var(--accent-cyan)]/50 animate-pulse rounded-sm"></span>';
    } else if (!message.text) {
      destroyMarkdown(contentEl);
      contentEl.textContent = '';
    }
  }
}
