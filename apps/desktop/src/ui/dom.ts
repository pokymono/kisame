export type ElementChild = HTMLElement | SVGElement | Text | string;

type ElementOptions = {
  className?: string;
  text?: string;
  attrs?: Record<string, string | undefined>;
  children?: ElementChild[];
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  { className, text, attrs, children }: ElementOptions = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined) continue;
      node.setAttribute(key, value);
    }
  }
  if (children) appendChildren(node, children);
  return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  { className, attrs, children }: Omit<ElementOptions, 'text'> = {}
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (className) node.setAttribute('class', className);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined) continue;
      node.setAttribute(key, String(value));
    }
  }
  if (children) appendChildren(node, children);
  return node;
}

export function appendChildren(parent: Element, children: ElementChild[]) {
  for (const child of children) {
    if (typeof child === 'string') {
      parent.appendChild(document.createTextNode(child));
    } else {
      parent.appendChild(child);
    }
  }
}
