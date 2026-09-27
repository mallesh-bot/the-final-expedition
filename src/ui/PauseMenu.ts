import { el, show } from './dom';

export interface PauseActions {
  onResume(): void;
  onSave(): void;
  onSettings(): void;
  onMainMenu(): void;
  onJournal(): void;
  hover(): void;
}

export class PauseMenu {
  readonly root: HTMLElement;
  private objective: HTMLElement;
  private progress: HTMLElement;
  private saveBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, a: PauseActions) {
    const mk = (label: string, action: string, fn: () => void) => {
      const b = el('button', { class: 'interactive', 'data-action': action }, [label]);
      b.onclick = fn;
      b.onmouseenter = () => a.hover();
      return b;
    };
    this.saveBtn = mk('Save', 'save', () => a.onSave());
    this.objective = el('p');
    this.progress = el('div', { class: 'progress' });
    this.root = el('div', { class: 'layer menu pause' }, [
      el('div', { class: 'title', html: '<small>PAUSED</small>THE FINAL<br/>EXPEDITION' }),
      el('div', { class: 'rule' }),
      el('nav', {}, [
        mk('Resume', 'resume', () => a.onResume()),
        this.saveBtn,
        mk('Journal', 'journal', () => a.onJournal()),
        mk('Settings', 'settings', () => a.onSettings()),
        mk('Main Menu', 'mainmenu', () => a.onMainMenu()),
      ]),
      el('div', { class: 'objective' }, [el('h4', {}, ['Current objective']), this.objective, this.progress]),
    ]);
    parent.append(this.root);
  }

  setInfo(objective: string, progress: string): void {
    this.objective.textContent = objective;
    this.progress.textContent = progress;
  }

  flashSaved(ok: boolean): void {
    this.saveBtn.textContent = ok ? 'Saved ✓' : 'Save failed';
    setTimeout(() => (this.saveBtn.textContent = 'Save'), 1600);
  }

  setVisible(v: boolean): void {
    show(this.root, v);
  }
}
