/** Tiny DOM helper. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export function show(e: HTMLElement, on: boolean): void {
  e.classList.toggle('show', on);
}

export const SUN_SVG = `<svg class="sun" viewBox="0 0 64 64" fill="none" stroke="#c9a35b" stroke-width="1.4">
<circle cx="32" cy="32" r="12"/><path d="M20 32 Q32 22 44 32 Q32 42 20 32Z"/><circle cx="32" cy="32" r="3" fill="#c9a35b"/>
${Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return `<line x1="${32 + Math.cos(a) * 18}" y1="${32 + Math.sin(a) * 18}" x2="${32 + Math.cos(a) * 26}" y2="${32 + Math.sin(a) * 26}"/>`;
}).join('')}</svg>`;
