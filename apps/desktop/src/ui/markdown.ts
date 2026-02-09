import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Streamdown } from 'streamdown';
import { streamdownPlugins } from './streamdown-plugins';

const roots = new WeakMap<HTMLElement, Root>();
const fallbackTimers = new WeakMap<HTMLElement, number>();

function scheduleFallback(target: HTMLElement, content: string) {
  const existing = fallbackTimers.get(target);
  if (existing) {
    window.clearTimeout(existing);
  }
  if (!content) return;

  const timer = window.setTimeout(() => {
    const hasText = (target.textContent ?? '').trim().length > 0;
    if (!hasText) {
      target.textContent = content;
    }
  }, 50);

  fallbackTimers.set(target, timer);
}

export function renderMarkdown(
  target: HTMLElement,
  content: string,
  isStreaming: boolean
): void {
  let root = roots.get(target);
  if (!root) {
    target.replaceChildren();
    root = createRoot(target);
    roots.set(target, root);
  }

  root.render(
    React.createElement(
      Streamdown,
      {
        key: isStreaming ? 'streaming' : 'static',
        className: 'streamdown-content prose-chat text-sm text-white/80 leading-relaxed',
        isAnimating: isStreaming,
        mode: isStreaming ? 'streaming' : 'static',
        plugins: streamdownPlugins,
        controls: { table: true, code: true },
      },
      content
    )
  );

  scheduleFallback(target, content);
}

export function destroyMarkdown(target: HTMLElement): void {
  const existing = fallbackTimers.get(target);
  if (existing) {
    window.clearTimeout(existing);
    fallbackTimers.delete(target);
  }
  const root = roots.get(target);
  if (root) {
    root.unmount();
    roots.delete(target);
  }
}
