import { el, show } from './dom';

export interface MainMenuActions {
  onContinue(): void;
  onNew(): void;
  onSettings(): void;
  hover(): void;
}

export class MainMenu {
  readonly root: HTMLElement;
  private cont: HTMLButtonElement;
  private meta: HTMLElement;
  private confirming = false;
  private newBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, a: MainMenuActions) {
    this.cont = el('button', { class: 'interactive', 'data-action': 'continue' }, ['Continue']);
    this.newBtn = el('button', { class: 'interactive', 'data-action': 'new' }, ['New Expedition']);
    const settings = el('button', { class: 'interactive', 'data-action': 'settings' }, ['Settings']);
    this.meta = el('div', { class: 'meta' });
    this.root = el('div', { class: 'layer menu' }, [
      el('div', { class: 'title', html: '<small>A CINEMATIC ADVENTURE</small>THE FINAL<br/>EXPEDITION' }),
      el('div', { class: 'rule' }),
      el('nav', {}, [this.cont, this.newBtn, settings]),
      this.meta,
      el('div', { class: 'foot' }, ['Vertical slice · Chapter 1 of 5 · Headphones recommended']),
    ]);
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

  setSave(label: string | null): void {
    this.cont.disabled = !label;
    this.meta.textContent = label ? `Last expedition · ${label}` : '';
  }

  setVisible(v: boolean): void {
    show(this.root, v);
    if (!v) this.resetConfirm();
  }
}
