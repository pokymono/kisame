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
  suggested_next_steps: 'Suggested next steps',
};

function friendlyToolName(name: string): string {
  if (toolDisplayNames[name]) return toolDisplayNames[name];
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    className: 'flex items-center gap-2 py-1 group transition-all duration-200',
  });
  
  if (tool.status === 'done') {
    row.style.opacity = '0.5';
  }

  row.append(toolIcon(tool.status));

  const label = el('span', {
    className: 'text-[11px] font-[var(--font-mono)] truncate transition-colors duration-200',
    text: friendlyToolName(tool.name),
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

const MAX_TOOL_OUTPUT_CHARS = 6000;
const MAX_TOOL_OUTPUT_PREVIEW = 90;

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, val) => {
      if (typeof val === 'bigint') return val.toString();
      if (val && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    },
    2
  );
}

function summarizeToolOutput(output: unknown): string {
  if (output == null) return 'No output';
  if (typeof output === 'string') {
    const firstLine = output.split(/\r?\n/)[0] ?? '';
    const trimmed = firstLine.trim();
    if (!trimmed) return 'Empty output';
    return trimmed.length > MAX_TOOL_OUTPUT_PREVIEW ? `${trimmed.slice(0, MAX_TOOL_OUTPUT_PREVIEW)}…` : trimmed;
  }
  if (Array.isArray(output)) return `Array(${output.length})`;
  if (typeof output === 'object') {
    const keys = Object.keys(output as Record<string, unknown>);
    if (keys.length === 0) return 'Object';
    const preview = keys.slice(0, 3).join(', ');
    return keys.length > 3 ? `Object(${preview}, …)` : `Object(${preview})`;
  }
  return String(output);
}

function stringifyToolOutput(output: unknown): { text: string; truncated: boolean } {
  if (output == null) return { text: 'No output returned.', truncated: false };
  const raw = typeof output === 'string' ? output : safeStringify(output);
  if (raw.length <= MAX_TOOL_OUTPUT_CHARS) return { text: raw, truncated: false };
  return {
    text: `${raw.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n… trimmed ${raw.length - MAX_TOOL_OUTPUT_CHARS} chars`,
    truncated: true,
  };
}

function renderToolOutput(tool: ToolCallLog): HTMLElement {
  const wrapper = el('div', {
    className: 'rounded-md border border-white/5 bg-white/[0.02] overflow-hidden',
  });

  const summaryText =
    tool.output === undefined && tool.status === 'running'
      ? 'Waiting for output…'
      : summarizeToolOutput(tool.output);

  const header = el('button', {
    className:
      'w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ' +
      'hover:bg-white/[0.03] focus:outline-none',
    attrs: { type: 'button', 'data-tool-output-toggle': 'true' },
  });

  const name = el('span', {
    className: 'text-[10px] font-[var(--font-mono)] text-white/55 truncate',
    text: friendlyToolName(tool.name),
  });

  const status = el('span', {
    className:
      'text-[9px] font-[var(--font-mono)] tracking-wide uppercase px-1.5 py-0.5 rounded ' +
      (tool.status === 'error'
        ? 'text-[var(--accent-red)] bg-[var(--accent-red)]/10'
        : tool.status === 'done'
          ? 'text-[var(--accent-teal)] bg-[var(--accent-teal)]/10'
          : 'text-white/40 bg-white/5'),
    text: tool.status,
  });

  const summary = el('span', {
    className: 'ml-auto text-[10px] text-white/35 truncate',
    text: summaryText,
  });

  header.append(name, status, summary);

  const body = el('div', {
    className: 'hidden px-2.5 pb-2.5',
    attrs: { 'data-tool-output-body': 'true' },
  });

  const { text } = stringifyToolOutput(tool.output);
  const pre = el('pre', {
    className: 'chat-code-block tool-output-block text-[10px]',
    text,
  });
  body.append(pre);

  header.addEventListener('click', () => {
    const isHidden = body.classList.contains('hidden');
    body.classList.toggle('hidden', !isHidden);
    summary.classList.toggle('text-white/60', isHidden);
  });

  wrapper.append(header, body);
  return wrapper;
}

function renderToolCalls(tools: ToolCallLog[]): HTMLElement {
  const container = el('div', {
    className: 'my-2 py-2 px-3 rounded-lg overflow-hidden ' +
      'bg-gradient-to-r from-white/[0.02] to-transparent ' +
      'border-l border-white/[0.06]',
    attrs: { 'data-tool-calls': 'true' },
  });

  const list = el('div', { className: 'space-y-1' });
  for (const tool of tools) {
    list.append(renderToolCall(tool));
  }
  container.append(list);

  if (tools.length > 0) {
    const outputs = el('div', {
      className: 'mt-2 pt-2 border-t border-white/[0.06] space-y-2',
      attrs: { 'data-tool-outputs': 'true' },
    });

    const header = el('div', {
      className: 'text-[9px] font-[var(--font-mono)] tracking-[0.2em] text-white/30 uppercase',
      text: 'Tool Output',
    });
    outputs.append(header);

    for (const tool of tools) {
      outputs.append(renderToolOutput(tool));
    }
    container.append(outputs);
  }

  return container;
}

function renderReasoningSummary(summary: string, isStreaming?: boolean): HTMLElement {
  const wrapper = el('div', {
    className:
      'my-2 py-2 px-3 rounded-lg overflow-hidden ' +
      'bg-gradient-to-r from-white/[0.02] to-transparent ' +
      'border-l border-white/[0.06]',
    attrs: { 'data-reasoning-summary': 'true' },
  });

  const content = el('div', {
    className: 'streamdown-host prose-chat text-[11px] text-white/40 font-[var(--font-mono)] leading-relaxed break-words',
    attrs: { 'data-reasoning-content': 'true' },
  });

  wrapper.append(content);
  const markdown = `${summary}`;
  renderMarkdown(content, markdown, Boolean(isStreaming));
  if (isStreaming) {
    content.classList.add('typing-cursor');
  }
  return wrapper;
}

function renderSuggestedNextSteps(steps: SuggestedNextStep[]): HTMLElement {
  const container = el('div', {
    className: 'mt-3 flex flex-wrap gap-2 animate-fade-in-up',
    attrs: { 'data-suggested-next-steps': 'true' },
  });

  for (const step of steps) {
    const button = el('button', {
      className:
        'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-[var(--font-mono)] ' +
        'tracking-wide bg-white/5 border border-white/10 text-white/70 hover:text-white hover:border-white/30 ' +
        'hover:bg-white/10 transition-all duration-200 active:scale-95 hover:translate-y-[-1px]',
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
      className: 'flex justify-end gap-2 animate-slide-in-right',
      children: [
        el('div', {
          className:
            'max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ' +
            'bg-white/[0.04] border border-white/[0.08] text-white/90 ' +
            'break-words overflow-hidden',
          text: message.text,
        }),
      ],
    });
  }

  const messageWrap = el('div', {
    className: 'flex gap-3 animate-slide-in-left',
  });

  const bubble = el('div', {
    className: 'min-w-0 max-w-full space-y-2 overflow-hidden',
  });

  if (message.status && message.isStreaming) {
    const statusRow = el('div', {
      className: 'py-1.5 animate-fade-in',
      attrs: { 'data-status': 'true' },
    });

    const statusText = el('span', {
      className: 'text-[10px] font-[var(--font-mono)] tracking-[0.15em] uppercase status-shimmer inline-block',
      text: message.status,
    });

    statusRow.append(statusText);
    bubble.append(statusRow);
  }

  if (message.toolCalls && message.toolCalls.length > 0) {
    bubble.append(renderToolCalls(message.toolCalls));
  }

  if (message.reasoningSummary) {
    bubble.append(renderReasoningSummary(message.reasoningSummary, message.isStreaming));
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
    contentEl.innerHTML = '<span class="inline-block w-2 h-4 bg-white/30 animate-pulse rounded-sm"></span>';
  }

  if (message.toolSummary && !message.isStreaming) {
    const summaryEl = el('div', {
      className: 'mt-3 py-2 px-3 rounded text-[11px] text-white/40 ' +
        'bg-white/[0.02] border-l-2 border-[var(--accent-teal)]/30 ' +
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
        className: 'py-1 animate-fade-in',
        attrs: { 'data-status': 'true' },
      });

      const statusText = el('span', {
        className: 'text-[10px] font-[var(--font-mono)] tracking-[0.15em] uppercase status-shimmer inline-block',
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

  const existingReasoning = bubble.querySelector('[data-reasoning-summary]') as HTMLElement | null;
  if (existingReasoning) {
    const content = existingReasoning.querySelector('[data-reasoning-content]') as HTMLElement | null;
    if (content) destroyMarkdown(content);
    existingReasoning.remove();
  }
  if (message.reasoningSummary) {
    const reasoningEl = renderReasoningSummary(message.reasoningSummary, message.isStreaming);
    const contentEl = bubble.querySelector('[data-content]');
    if (contentEl) {
      contentEl.before(reasoningEl);
    } else {
      bubble.append(reasoningEl);
    }
  }

  const existingSummary = bubble.querySelector('[data-tool-summary]');
  if (existingSummary) existingSummary.remove();
  if (message.toolSummary && !message.isStreaming) {
    bubble.append(
      el('div', {
        className: 'mt-2 py-2 px-3 rounded text-[11px] text-white/40 ' +
          'bg-white/[0.03] border-l-2 border-[var(--accent-teal)]/30 ' +
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
      contentEl.innerHTML = '<div class="flex items-center gap-2"><span class="loading-spinner loading-spinner-sm"></span><span class="text-xs text-white/40">Thinking…</span></div>';
    } else if (!message.text) {
      destroyMarkdown(contentEl);
      contentEl.textContent = '';
    }
  }
}
