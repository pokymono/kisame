import { el } from './dom';
import { renderMarkdown, destroyMarkdown } from './markdown';
import type { ChatMessage, ToolCallLog } from '../types';

const toolDisplayNames: Record<string, string> = {
  pcap_overview: 'PCAP OVERVIEW',
  list_sessions: 'LIST SESSIONS',
  get_session: 'SESSION DETAIL',
  get_timeline: 'TIMELINE EVENTS',
  search_timeline: 'SEARCH TIMELINE',
  pcap_search: 'PCAP SEARCH',
  get_evidence_frames: 'EVIDENCE FRAMES',
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
  const icon = el('div', {
    className: 'relative size-2.5 rounded-full transition-all',
  });
  
  if (status === 'pending') {
    icon.className += ' bg-white/20 border border-white/30';
  } else if (status === 'running') {
    icon.className += ' bg-[var(--accent-amber)] status-pulse';
  } else if (status === 'done') {
    icon.className += ' bg-[var(--accent-teal)]';
    icon.style.boxShadow = '0 0 8px rgba(0, 255, 157, 0.5)';
  } else {
    icon.className += ' bg-[var(--accent-red)]';
    icon.style.boxShadow = '0 0 8px rgba(255, 61, 90, 0.5)';
  }
  return icon;
}

function renderToolCall(tool: ToolCallLog): HTMLElement {
  const row = el('div', {
    className: 'flex items-center gap-2.5 py-1',
  });
  
  const iconWrap = el('div', {
    className: 'flex items-center justify-center w-4',
  });
  iconWrap.append(toolIcon(tool.status));
  
  const label = el('span', {
    className: 'text-[10px] font-[var(--font-mono)] tracking-[0.1em] uppercase truncate',
    text: toolDisplayNames[tool.name] ?? tool.name,
  });
  
  if (tool.status === 'running') {
    label.classList.add('text-[var(--accent-amber)]');
  } else if (tool.status === 'done') {
    label.classList.add('text-[var(--accent-teal)]/70');
  } else if (tool.status === 'error') {
    label.classList.add('text-[var(--accent-red)]/70');
  } else {
    label.classList.add('text-white/40');
  }
  
  row.append(iconWrap, label);
  return row;
}

function renderToolCalls(tools: ToolCallLog[]): HTMLElement {
  const container = el('div', {
    className: 'mt-3 py-2 px-3 rounded bg-[var(--app-surface)] border border-[var(--app-line)] space-y-0.5 overflow-hidden',
    attrs: { 'data-tool-calls': 'true' },
  });
  
  const header = el('div', {
    className: 'text-[9px] font-[var(--font-display)] tracking-[0.2em] text-white/30 uppercase mb-2',
    text: 'TOOL EXECUTION',
  });
  container.append(header);
  
  for (const tool of tools) {
    container.append(renderToolCall(tool));
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

  const avatar = el('div', {
    className: 'relative shrink-0 mt-1',
  });
  
  const avatarInner = el('div', {
    className:
      'size-7 rounded flex items-center justify-center ' +
      'bg-gradient-to-br from-[var(--accent-purple)]/30 to-[var(--accent-cyan)]/20 ' +
      'border border-[var(--accent-purple)]/50',
  });
  
  const avatarText = el('span', {
    className: 'text-[9px] font-[var(--font-display)] font-bold tracking-wider text-[var(--accent-purple)]',
    text: 'AI',
  });
  avatarInner.append(avatarText);
  avatar.append(avatarInner);

  const bubble = el('div', {
    className: 'min-w-0 max-w-[calc(100%-40px)] space-y-2 overflow-hidden',
  });

  if (message.status && message.isStreaming) {
    const statusRow = el('div', {
      className: 'flex items-center gap-2 py-1',
      attrs: { 'data-status': 'true' },
    });
    
    const pulseRing = el('div', {
      className: 'relative flex items-center justify-center',
    });
    const pulseDot = el('div', { 
      className: 'size-2 rounded-full bg-[var(--accent-cyan)] status-pulse' 
    });
    pulseRing.append(pulseDot);
    
    const statusText = el('span', {
      className: 'text-[10px] font-[var(--font-mono)] tracking-[0.15em] text-[var(--accent-cyan)]/70 uppercase',
      text: message.status,
    });
    
    statusRow.append(pulseRing, statusText);
    bubble.append(statusRow);
  }

  if (message.toolCalls && message.toolCalls.length > 0) {
    bubble.append(renderToolCalls(message.toolCalls));
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

  messageWrap.append(avatar, bubble);
  return messageWrap;
}

export function updateMessageElement(
  element: HTMLElement,
  message: ChatMessage
): void {
  const bubble = element.children[1] as HTMLElement | undefined;
  if (!bubble) return;

  const existingStatus = bubble.querySelector('[data-status]');
  if (message.status && message.isStreaming) {
    if (existingStatus) {
      const span = existingStatus.querySelector('span:last-child');
      if (span) span.textContent = message.status;
    } else {
      const statusRow = el('div', {
        className: 'flex items-center gap-2 py-1',
        attrs: { 'data-status': 'true' },
      });
      
      const pulseRing = el('div', {
        className: 'relative flex items-center justify-center',
      });
      const pulseDot = el('div', { 
        className: 'size-2 rounded-full bg-[var(--accent-cyan)] status-pulse' 
      });
      pulseRing.append(pulseDot);
      
      const statusText = el('span', {
        className: 'text-[10px] font-[var(--font-mono)] tracking-[0.15em] text-[var(--accent-cyan)]/70 uppercase',
        text: message.status,
      });
      
      statusRow.append(pulseRing, statusText);
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
