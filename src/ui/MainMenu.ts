import { el, show } from './dom';

export interface MainMenuActions {
  onContinue(): void;
  onNew(): void;
  onChapter(id: number): void;
  onSettings(): void;
  hover(): void;
}

export class MainMenu {
  readonly root: HTMLElement;
  private cont: HTMLButtonElement;
  private meta: HTMLElement;
  private confirming = false;
  private newBtn: HTMLButtonElement;
  private chaptersBtn: HTMLButtonElement;
  private chapterList: HTMLElement;
  private mainNav: HTMLElement;
  private actions: MainMenuActions;

  constructor(parent: HTMLElement, a: MainMenuActions) {
    this.cont = el('button', { class: 'interactive', 'data-action': 'continue' }, ['Continue']);
    this.newBtn = el('button', { class: 'interactive', 'data-action': 'new' }, ['New Expedition']);
    const settings = el('button', { class: 'interactive', 'data-action': 'settings' }, ['Settings']);
    this.chaptersBtn = el('button', { class: 'interactive', 'data-action': 'chapters' }, ['Chapters']);
    this.meta = el('div', { class: 'meta' });
    this.actions = a;
    this.mainNav = el('nav', {}, [this.cont, this.newBtn, this.chaptersBtn, settings]);
    this.chapterList = el('nav', { class: 'chapters' });
    this.root = el('div', { class: 'layer menu' }, [
      el('div', { class: 'title', html: '<small>A CINEMATIC ADVENTURE</small>THE FINAL<br/>EXPEDITION' }),
      el('div', { class: 'rule' }),
      this.mainNav,
      this.chapterList,
      this.meta,
      el('div', { class: 'foot' }, ['Five chapters and an epilogue · Headphones recommended']),
    ]);
    this.chaptersBtn.onclick = () => this.showChapters(true);
    this.chaptersBtn.onmouseenter = () => a.hover();
    this.showChapters(false);
    parent.append(this.root);
    this.cont.onclick = () => a.onContinue();
    this.newBtn.onclick = () => {
      if (!this.cont.disabled && !this.confirming) {
        this.confirming = true;
        this.newBtn.textContent = 'Overwrite save? Click again';
        setTimeout(() => this.resetConfirm(), 3500);
        return;
      }
      this.resetConfirm();
      a.onNew();
    };
    settings.onclick = () => a.onSettings();
    for (const b of [this.cont, this.newBtn, settings]) b.onmouseenter = () => a.hover();
  }

  private resetConfirm(): void {
    this.confirming = false;
    this.newBtn.textContent = 'New Expedition';
  }

  /** Chapter select: every chapter is listed; locked ones are disabled until reached. */
  setChapters(list: { id: number; label: string }[], unlocked: number[]): void {
    this.chapterList.innerHTML = '';
    for (const c of list) {
      const b = el('button', { class: 'interactive', 'data-chapter': String(c.id) }, [c.label]);
      b.disabled = !unlocked.includes(c.id);
      b.onclick = () => {
        if (!this.cont.disabled && b.dataset.confirm !== '1') {
          b.dataset.confirm = '1';
          b.textContent = 'Replaces your save. Click again';
          setTimeout(() => {
            b.dataset.confirm = '';
            b.textContent = c.label;
          }, 3500);
          return;
        }
        this.showChapters(false);
        this.actions.onChapter(c.id);
      };
      b.onmouseenter = () => this.actions.hover();
      this.chapterList.append(b);
    }
    const back = el('button', { class: 'interactive back' }, ['Back']);
    back.onclick = () => this.showChapters(false);
    this.chapterList.append(back);
  }

  private showChapters(v: boolean): void {
    this.chapterList.style.display = v ? 'flex' : 'none';
    this.mainNav.style.display = v ? 'none' : 'flex';
  }

  setSave(label: string | null): void {
    this.cont.disabled = !label;
    this.meta.textContent = label ? `Last expedition · ${label}` : '';
  }

  setVisible(v: boolean): void {
    show(this.root, v);
    if (!v) this.resetConfirm();
    this.showChapters(false);
  }
}
