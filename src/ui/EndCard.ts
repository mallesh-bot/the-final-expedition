import { el, show } from './dom';

export class EndCard {
  readonly root: HTMLElement;
  private title: HTMLElement;
  private text: HTMLElement;
  private stats: HTMLElement;
  private nav: HTMLElement;

  constructor(parent: HTMLElement) {
    this.title = el('h1');
    this.text = el('p');
    this.stats = el('div', { class: 'stats' });
    this.nav = el('nav');
    this.root = el('div', { class: 'layer end-card' }, [el('div', { class: 'card-num', style: 'font-size:11px;letter-spacing:.6em;color:#c9a35b' }, ['']), this.title, this.text, this.stats, this.nav]);
    parent.append(this.root);
  }

  open(opts: { kicker: string; title: string; text: string; stats: string; buttons: [string, () => void][] }): void {
    (this.root.firstChild as HTMLElement).textContent = opts.kicker;
    this.title.textContent = opts.title;
    this.text.textContent = opts.text;
    this.stats.textContent = opts.stats;
    this.nav.innerHTML = '';
    for (const [label, fn] of opts.buttons) {
      const b = el('button', { class: 'interactive' }, [label]);
      b.onclick = fn;
      this.nav.append(b);
    }
    show(this.root, true);
  }

  close(): void {
    show(this.root, false);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('show');
  }
}
