import { el, show } from './dom';
import { COLLECTIBLES } from '../story/Collectibles';

export class JournalView {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private page: HTMLElement;
  private selected: string | null = null;
  private found = new Set<string>();
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.list = el('ul');
    this.page = el('div', { class: 'page' });
    const closeBtn = el('button', { class: 'interactive touch-only' }, ['Close']);
    this.root = el('div', { class: 'layer journal' }, [
      el('div', { class: 'book interactive' }, [this.list, this.page]),
      el('div', { class: 'close' }, [el('span', { class: 'kb-only' }, ['J / ESC to close']), closeBtn]),
    ]);
    closeBtn.onclick = () => this.onClose?.();
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('show');
  }

  open(found: Set<string>, focus?: string): void {
    this.found = found;
    this.selected = focus ?? this.selected ?? COLLECTIBLES.find((c) => found.has(c.id))?.id ?? null;
    this.render();
    show(this.root, true);
  }

  close(): void {
    show(this.root, false);
  }

  private render(): void {
    this.list.innerHTML = '';
    for (const c of COLLECTIBLES.filter((x) => x.chapter === 1)) {
      const has = this.found.has(c.id);
      const li = el('li', { class: `${has ? '' : 'locked'} ${c.id === this.selected ? 'on' : ''}` }, [
        el('small', {}, [c.kind === 'journal' ? 'Journal' : 'Relic']),
        has ? c.title : '— undiscovered —',
      ]);
      if (has)
        li.onclick = () => {
          this.selected = c.id;
          this.render();
        };
      this.list.append(li);
    }
    this.page.innerHTML = '';
    const c = COLLECTIBLES.find((x) => x.id === this.selected && this.found.has(x.id));
    if (!c) {
      this.page.append(el('p', {}, ['Nothing recorded yet.']));
      return;
    }
    this.page.append(el('h3', {}, [c.title]), el('p', {}, [c.text]));
    if (c.image) this.page.append(el('img', { src: c.image(), alt: 'Sketch' }));
  }
}
