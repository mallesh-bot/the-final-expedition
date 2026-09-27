import type { ButtonAction } from './Bindings';
import type { InputFrame, InputProvider } from './InputProvider';
import { el } from '../ui/dom';
import { isTouchPrimary } from '../systems/Device';

type TouchButton = 'jump' | 'interact' | 'drop' | 'pause' | 'journal';

/**
 * On-screen touch controls: floating move stick (left half), drag-to-look (right half)
 * and action buttons. Writes the same InputFrame as keyboard/mouse, so gameplay is unchanged.
 */
export class TouchProvider implements InputProvider {
  readonly id = 'touch';
  readonly root: HTMLElement;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private interactBtn: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private sprint = false;
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private dx = 0;
  private dy = 0;
  private down = new Set<ButtonAction>();
  private tapped = new Set<ButtonAction>();
  /** Fired on press of menu-style buttons (pause, journal) so they work while the sim is frozen. */
  onButton: ((b: 'pause' | 'journal') => void) | null = null;
  /** True once the player has used touch this session. */
  active = false;
  lookScale = 1.5;

  constructor(private readonly surface: HTMLElement, parent: HTMLElement) {
    this.stickKnob = el('div', { class: 'knob' });
    this.stickBase = el('div', { class: 'stick' }, [this.stickKnob]);
    const btn = (name: TouchButton, label: string) => el('div', { class: `tbtn interactive ${name}`, 'data-btn': name, 'aria-label': name }, [label]);
    this.interactBtn = btn('interact', 'USE');
    this.root = el('div', { class: 'touch-ui' }, [
      this.stickBase,
      btn('pause', 'II'),
      btn('journal', '✎'),
      btn('jump', 'JUMP'),
      this.interactBtn,
      btn('drop', '▼'),
    ]);
    parent.append(this.root);
    if (isTouchPrimary) this.markActive();
  }

  private radius(): number {
    return this.stickBase.offsetWidth / 2 || 60;
  }

  private onSurfaceDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    this.markActive();
    if (!this.root.classList.contains('show')) return;
    e.preventDefault(); // suppress compatibility mouse events (Mouse0 = interact)
    const left = e.clientX < window.innerWidth * 0.45;
    if (left && this.stickId === null && !this.root.classList.contains('cine')) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.stickBase.classList.add('on');
      this.updateStick(e.clientX, e.clientY);
    } else if (!left && this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId === this.stickId) this.updateStick(e.clientX, e.clientY);
    else if (e.pointerId === this.lookId) {
      this.dx += (e.clientX - this.lookLast.x) * this.lookScale;
      this.dy += (e.clientY - this.lookLast.y) * this.lookScale;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId === this.stickId) this.releaseStick();
    if (e.pointerId === this.lookId) this.lookId = null;
  };

  private onButtonDown = (e: PointerEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-btn]');
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    this.markActive();
    const name = t.dataset.btn as TouchButton;
    t.classList.add('on');
    t.setPointerCapture?.(e.pointerId);
    if (name === 'pause' || name === 'journal') return this.onButton?.(name);
    this.down.add(name);
    this.tapped.add(name);
    const up = () => {
      t.classList.remove('on');
      this.down.delete(name);
      t.removeEventListener('pointerup', up);
      t.removeEventListener('pointercancel', up);
    };
    t.addEventListener('pointerup', up);
    t.addEventListener('pointercancel', up);
  };

  private updateStick(x: number, y: number): void {
    const r = this.radius();
    let ox = x - this.stickOrigin.x;
    let oy = y - this.stickOrigin.y;
    const d = Math.hypot(ox, oy);
    // Pushing past the rim sprints; the base follows the thumb so it never feels stuck.
    this.sprint = d > r * 1.2;
    if (d > r * 1.6) {
      const k = (d - r * 1.6) / d;
      this.stickOrigin.x += ox * k;
      this.stickOrigin.y += oy * k;
      this.stickBase.style.transform = `translate(${this.stickOrigin.x}px, ${this.stickOrigin.y}px)`;
      ox = x - this.stickOrigin.x;
      oy = y - this.stickOrigin.y;
    }
    const len = Math.hypot(ox, oy);
    const cl = Math.min(1, len / r);
    const nx = len > 0 ? ox / len : 0;
    const ny = len > 0 ? oy / len : 0;
    const mag = cl < 0.12 ? 0 : (cl - 0.12) / 0.88; // dead zone
    this.stickVec = { x: nx * mag, y: -ny * mag };
    this.stickKnob.style.transform = `translate(${nx * cl * r}px, ${ny * cl * r}px)`;
    this.stickBase.classList.toggle('sprint', this.sprint);
  }

  private releaseStick(): void {
    this.stickId = null;
    this.stickVec = { x: 0, y: 0 };
    this.sprint = false;
    this.stickKnob.style.transform = '';
    this.stickBase.classList.remove('on', 'sprint');
  }

  private markActive(): void {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('touch');
  }

  private onBlur = () => this.reset();

  /** Drop all held state (menus opening, focus loss). */
  reset(): void {
    this.releaseStick();
    this.lookId = null;
    this.down.clear();
    this.tapped.clear();
    for (const b of this.root.querySelectorAll('.tbtn.on')) b.classList.remove('on');
  }

  /** Show controls; `cine` hides everything except pause and jump (hold-to-skip). */
  setMode(visible: boolean, cine: boolean): void {
    const vis = visible && this.active;
    if (this.root.classList.contains('show') !== vis) {
      this.root.classList.toggle('show', vis);
      if (!vis) this.reset();
    }
    if (this.root.classList.contains('cine') !== cine) {
      this.root.classList.toggle('cine', cine);
      if (cine) this.releaseStick();
    }
  }

  setInteractReady(label: string | null): void {
    this.interactBtn.classList.toggle('ready', !!label);
  }

  attach(): void {
    this.surface.addEventListener('pointerdown', this.onSurfaceDown, { passive: false });
    this.root.addEventListener('pointerdown', this.onButtonDown, { passive: false });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('blur', this.onBlur);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  detach(): void {
    this.surface.removeEventListener('pointerdown', this.onSurfaceDown);
    this.root.removeEventListener('pointerdown', this.onButtonDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }

  poll(frame: InputFrame): void {
    for (const a of this.down) frame.held.add(a);
    for (const a of this.tapped) frame.held.add(a);
    if (this.sprint) frame.held.add('sprint');
    frame.moveX += this.stickVec.x;
    frame.moveY += this.stickVec.y;
    frame.lookX += this.dx;
    frame.lookY += this.dy;
  }

  endFrame(): void {
    this.dx = 0;
    this.dy = 0;
    this.tapped.clear();
  }
}
