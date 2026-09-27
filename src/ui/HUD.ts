import { el, show } from './dom';
import type { Line } from '../story/Dialogue';
import { Minimap } from './Minimap';

/** Minimal in-game HUD: contextual prompt, subtitles, toasts, chapter card, skip ring, fades. */
export class HUD {
  readonly root: HTMLElement;
  private prompt: HTMLElement;
  private promptKey: HTMLElement;
  private promptLabel: HTMLElement;
  private subs: HTMLElement;
  private toasts: HTMLElement;
  private card: HTMLElement;
  private cardNum: HTMLElement;
  private cardName: HTMLElement;
  private skip: HTMLElement;
  private skipRing: SVGCircleElement;
  private fadeEl: HTMLElement;
  private clickHint: HTMLElement;
  readonly dev: HTMLElement;
  readonly minimap: Minimap;
  subtitlesEnabled = true;
  private lastPrompt = '';

  constructor(parent: HTMLElement) {
    this.promptKey = el('span', { class: 'key' }, ['E']);
    this.promptLabel = el('span');
    this.prompt = el('div', { class: 'prompt' }, [this.promptKey, this.promptLabel]);
    this.subs = el('div', { class: 'subs' });
    this.toasts = el('div', { class: 'toasts' });
    this.cardNum = el('div', { class: 'num' });
    this.cardName = el('div', { class: 'name' });
    this.card = el('div', { class: 'card' }, [this.cardNum, this.cardName, el('div', { class: 'line' })]);
    this.skip = el('div', { class: 'skip', html: `<svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="11" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/><circle class="fg" cx="13" cy="13" r="11" fill="none" stroke-width="2"/></svg><span>Hold <span class="key">SPACE</span> to skip</span>` });
    this.skipRing = this.skip.querySelector('circle.fg') as SVGCircleElement;
    this.fadeEl = el('div', { class: 'fade' });
    this.dev = el('div', { class: 'dev' });
    this.clickHint = el('div', { class: 'click-hint' }, ['Click to take control']);
    this.root = el('div', { class: 'layer hud' }, [this.prompt, this.subs, this.toasts, this.card, this.skip, this.clickHint, this.fadeEl, this.dev]);
    parent.append(this.root);
    this.minimap = new Minimap(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.visibility = v ? 'visible' : 'hidden';
  }

  setPrompt(label: string | null, key = 'E'): void {
    const k = label ? `${key}|${label}` : '';
    if (k === this.lastPrompt) return;
    this.lastPrompt = k;
    if (label) {
      this.promptKey.textContent = key;
      this.promptLabel.textContent = label;
    }
    show(this.prompt, !!label);
  }

  setLine(l: Line | null): void {
    if (!l || !this.subtitlesEnabled) {
      show(this.subs, false);
      return;
    }
    this.subs.innerHTML = '';
    const name = el('b', { class: l.speaker }, [l.speaker]);
    if (l.radio) name.classList.add('radio');
    this.subs.append(name, document.createTextNode(l.text));
    show(this.subs, true);
  }

  toast(title: string, detail = '', seconds = 3.5): void {
    const t = el('div', { class: 'toast' }, [el('div', { class: 'ico' }), el('div', {}, [title, ...(detail ? [el('small', {}, [detail])] : [])])]);
    this.toasts.append(t);
    requestAnimationFrame(() => show(t, true));
    setTimeout(() => show(t, false), seconds * 1000);
    setTimeout(() => t.remove(), seconds * 1000 + 700);
  }

  chapterCard(num: string, name: string, seconds = 4.5): void {
    this.cardNum.textContent = num;
    this.cardName.textContent = name;
    show(this.card, true);
    setTimeout(() => show(this.card, false), seconds * 1000);
  }

  setSkip(visible: boolean, progress: number): void {
    show(this.skip, visible);
    this.skipRing.style.strokeDashoffset = String(69.1 * (1 - progress));
  }

  fade(on: boolean, seconds = 0.8): Promise<void> {
    this.fadeEl.style.transitionDuration = `${seconds}s`;
    show(this.fadeEl, on);
    return new Promise((r) => setTimeout(r, seconds * 1000 + 30));
  }

  setClickHint(v: boolean): void {
    show(this.clickHint, v);
  }
}
