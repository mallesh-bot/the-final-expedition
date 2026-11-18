import { el, show } from './dom';
import { COLLECTIBLES, KIND_LABEL } from '../story/Collectibles';
import { CHAPTERS } from '../chapters/ChapterRegistry';

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
    // Chapters with something found (always at least Chapter 1), newest last.
    const chapters = CHAPTERS.filter((ch) => ch.id === 1 || COLLECTIBLES.some((c) => c.chapter === ch.id && this.found.has(c.id)));
    for (const ch of chapters) {
      this.list.append(el('li', { class: 'chapter-head' }, [ch.title]));
      for (const c of COLLECTIBLES.filter((x) => x.chapter === ch.id)) {
        const has = this.found.has(c.id);
        const li = el('li', { class: `${has ? '' : 'locked'} ${c.id === this.selected ? 'on' : ''}`, 'data-id': c.id }, [
          el('small', {}, [KIND_LABEL[c.kind]]),
          has ? c.title : '— undiscovered —',
        ]);
        if (has)
          li.onclick = () => {
            this.selected = c.id;
            this.render();
          };
        this.list.append(li);
      }
    }
    this.page.innerHTML = '';
    const c = COLLECTIBLES.find((x) => x.id === this.selected && this.found.has(x.id));
    if (!c) {
      this.page.append(
        el('div', {
          class: 'empty',
          html: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="32" cy="32" r="11"/><circle cx="32" cy="32" r="3.5" fill="currentColor"/><path d="M32 6v9M32 49v9M6 32h9M49 32h9M13.6 13.6l6.4 6.4M44 44l6.4 6.4M50.4 13.6L44 20M20 44l-6.4 6.4"/></svg><p>Nothing recorded yet. Pages, photographs and relics you find will be kept here.</p>',
        }),
      );
      return;
    }
    this.page.append(el('h3', {}, [c.title]), el('p', {}, [c.text]));
    if (c.image) this.page.append(el('img', { src: c.image(), alt: c.kind === 'photo' ? 'Photograph' : 'Sketch', class: c.kind }));
  }
}
