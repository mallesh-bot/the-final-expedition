/** Logical actions. Gameplay code only ever reads these — never raw keys or buttons. */
export type ButtonAction =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'jump'
  | 'interact'
  | 'drop'
  | 'pause'
  | 'journal'
  | 'confirm'
  | 'back';

/** action -> list of device codes. Keyboard uses KeyboardEvent.code; mouse uses "Mouse0".."Mouse2". */
export type BindingMap = Record<ButtonAction, string[]>;

export function defaultBindings(): BindingMap {
  return {
    moveForward: ['KeyW', 'ArrowUp'],
    moveBack: ['KeyS', 'ArrowDown'],
    moveLeft: ['KeyA', 'ArrowLeft'],
    moveRight: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'],
    jump: ['Space'],
    interact: ['KeyE', 'Mouse0'],
    drop: ['KeyC', 'ControlLeft'],
    pause: ['Escape', 'KeyP'],
    journal: ['KeyJ', 'Tab'],
    confirm: ['Enter', 'NumpadEnter'],
    back: ['Escape', 'Backspace'],
  };
}

export function prettyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'SPACE',
    ShiftLeft: 'SHIFT',
    ShiftRight: 'R-SHIFT',
    ControlLeft: 'CTRL',
    Escape: 'ESC',
    Mouse0: 'LMB',
    Mouse1: 'MMB',
    Mouse2: 'RMB',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Tab: 'TAB',
    Enter: 'ENTER',
  };
  return map[code] ?? code;
}
