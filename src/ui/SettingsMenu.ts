import { el, show } from './dom';
import type { Settings, SettingsStore, QualityPreset } from '../save/SettingsStore';
import { prettyCode, type ButtonAction } from '../input/Bindings';

const REBINDABLE: [ButtonAction, string][] = [
  ['moveForward', 'Move forward'],
  ['moveBack', 'Move back'],
  ['moveLeft', 'Move left'],
  ['moveRight', 'Move right'],
  ['sprint', 'Sprint'],
  ['jump', 'Jump / climb up'],
  ['interact', 'Interact / climb'],
  ['drop', 'Let go / drop'],
  ['journal', 'Journal'],
];

export class SettingsMenu {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private tab: 'graphics' | 'audio' | 'controls' = 'graphics';
  private tabs: Record<string, HTMLButtonElement> = {};
  private waiting: { action: ButtonAction; btn: HTMLButtonElement } | null = null;
  onClose: (() => void) | null = null;
  /** Effective adaptive tier label for HIGH. */
  effectiveLabel = () => '';

  constructor(parent: HTMLElement, private store: SettingsStore) {
    this.body = el('div');
    const tabs = el('div', { class: 'tabs' });
    for (const t of ['graphics', 'audio', 'controls'] as const) {
      const b = el('button', { class: 'interactive', 'data-tab': t }, [t]);
      b.onclick = () => {
        this.tab = t;
        this.render();
      };
      this.tabs[t] = b;
      tabs.append(b);
    }
    const close = el('button', { class: 'interactive', 'data-action': 'close-settings' }, ['Back']);
    close.onclick = () => this.onClose?.();
    const reset = el('button', { class: 'interactive' }, ['Reset controls']);
    reset.onclick = () => {
      import('../input/Bindings').then(({ defaultBindings }) => {
        this.store.update({ bindings: defaultBindings() });
        this.render();
      });
    };
    this.root = el('div', { class: 'layer panel-wrap' }, [
      el('div', { class: 'panel interactive' }, [el('h2', {}, ['SETTINGS']), tabs, this.body, el('div', { class: 'actions' }, [reset, close])]),
    ]);
    parent.append(this.root);
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.waiting) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code !== 'Escape') this.assign(this.waiting.action, e.code);
        this.waiting = null;
        this.render();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.root.classList.contains('show');
  }

  get capturingKey(): boolean {
    return this.waiting !== null;
  }

  private assign(action: ButtonAction, code: string): void {
    const b = { ...this.store.value.bindings };
    // Remove the code from any other action to avoid conflicts; keep secondary bindings.
    for (const k of Object.keys(b) as ButtonAction[]) if (k !== action) b[k] = b[k].filter((c) => c !== code);
    const current = b[action].filter((c) => c.startsWith('Arrow') || c.startsWith('Mouse'));
    b[action] = [code, ...current.filter((c) => c !== code)];
    this.store.update({ bindings: b });
  }

  setVisible(v: boolean): void {
    show(this.root, v);
    if (v) this.render();
  }

  private seg<T extends string>(opts: [T, string][], value: T, set: (v: T) => void): HTMLElement {
    const s = el('div', { class: 'seg' });
    for (const [v, label] of opts) {
      const b = el('button', { class: v === value ? 'on interactive' : 'interactive', 'data-value': v }, [label]);
      b.onclick = () => {
        set(v);
        this.render();
      };
      s.append(b);
    }
    return s;
  }

  private slider(value: number, min: number, max: number, step: number, set: (v: number) => void): HTMLElement {
    const i = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), class: 'interactive' });
    i.value = String(value);
    i.oninput = () => set(parseFloat(i.value));
    return i;
  }

  private row(label: string, control: HTMLElement, hint = ''): HTMLElement {
    const l = el('label', {}, [label]);
    if (hint) l.append(el('span', { class: 'hint' }, [hint]));
    return el('div', { class: 'row' }, [l, control]);
  }

  render(): void {
    const s = this.store.value;
    const up = (p: Partial<Settings>) => this.store.update(p);
    for (const [k, b] of Object.entries(this.tabs)) b.classList.toggle('on', k === this.tab);
    this.body.innerHTML = '';
    if (this.tab === 'graphics') {
      this.body.append(
        this.row(
          'Graphics quality',
          this.seg<QualityPreset>([['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']], s.quality, (v) => up({ quality: v })),
          s.quality === 'high' ? `Adaptive — currently ${this.effectiveLabel()}` : 'Visual only; never affects gameplay',
        ),
        this.row('Field of view', this.slider(s.fov, 50, 80, 1, (v) => up({ fov: v })), `${s.fov}°`),
        this.row('Camera shake', this.slider(s.cameraShake, 0, 1, 0.05, (v) => up({ cameraShake: v }))),
        this.row('Minimap', this.seg([['on', 'ON'], ['off', 'OFF']], s.minimap ? 'on' : 'off', (v) => up({ minimap: v === 'on' }))),
        this.row('Subtitles', this.seg([['on', 'ON'], ['off', 'OFF']], s.subtitles ? 'on' : 'off', (v) => up({ subtitles: v === 'on' }))),
      );
    } else if (this.tab === 'audio') {
      this.body.append(
        this.row('Master volume', this.slider(s.masterVolume, 0, 1, 0.01, (v) => up({ masterVolume: v }))),
        this.row('Music', this.slider(s.musicVolume, 0, 1, 0.01, (v) => up({ musicVolume: v }))),
        this.row('Effects', this.slider(s.sfxVolume, 0, 1, 0.01, (v) => up({ sfxVolume: v }))),
        this.row('Ambience', this.slider(s.ambienceVolume, 0, 1, 0.01, (v) => up({ ambienceVolume: v }))),
      );
    } else {
      this.body.append(
        this.row('Mouse sensitivity', this.slider(s.mouseSensitivity, 0.2, 3, 0.05, (v) => up({ mouseSensitivity: v })), s.mouseSensitivity.toFixed(2)),
        this.row('Invert Y axis', this.seg([['off', 'OFF'], ['on', 'ON']], s.invertY ? 'on' : 'off', (v) => up({ invertY: v === 'on' }))),
      );
      for (const [action, label] of REBINDABLE) {
        const codes = s.bindings[action];
        const b = el('button', { class: 'keybtn interactive' }, [codes.map(prettyCode).join(' / ') || '—']);
        if (this.waiting?.action === action) {
          b.classList.add('wait');
          b.textContent = 'Press a key…';
        }
        b.onclick = () => {
          this.waiting = { action, btn: b };
          this.render();
        };
        this.body.append(this.row(label, b));
      }
      this.body.append(el('div', { class: 'note' }, ['Mouse: look · ESC: pause (fixed) · Gamepad support: not yet available (planned).']));
    }
  }
}
