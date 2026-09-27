import { el, show, SUN_SVG } from './dom';

const TIPS = [
  'Faded red ribbons mark routes someone has climbed before you.',
  'Pale, worn stone edges can usually be grabbed.',
  "Marta's journal pages often describe what she saw — and what she didn't understand yet.",
  'The Ysharu read the sky the way the sun walks it.',
  'Progress is saved automatically at checkpoints. You can also save from the pause menu.',
];

export class LoadingScreen {
  readonly root: HTMLElement;
  private bar: HTMLElement;
  private status: HTMLElement;
  private tip: HTMLElement;
  private sub: HTMLElement;

  constructor(parent: HTMLElement) {
    this.bar = el('i');
    this.status = el('div', { class: 'status' });
    this.tip = el('div', { class: 'tip' });
    this.sub = el('div', { class: 'sub' }, ['Preparing the expedition']);
    this.root = el('div', { class: 'layer loading show' }, [
      el('div', { html: SUN_SVG }),
      el('div', { class: 'title' }, ['THE FINAL EXPEDITION']),
      this.sub,
      el('div', { class: 'bar' }, [this.bar]),
      this.status,
      this.tip,
    ]);
    parent.append(this.root);
    this.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  setTitle(sub: string): void {
    this.sub.textContent = sub;
  }

  progress(frac: number, label = ''): void {
    this.bar.style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
    this.status.textContent = label;
  }

  setVisible(v: boolean): void {
    show(this.root, v);
    if (v) this.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }
}
