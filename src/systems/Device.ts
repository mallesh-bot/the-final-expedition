/** Device capability helpers. Only used for input UI and render budgets — never by gameplay. */
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Primary input is touch (phones, tablets). Touch laptops with a mouse report false. */
export const isTouchPrimary = coarse && (navigator.maxTouchPoints ?? 0) > 0;

/** Phone-class screen (short side under 600 CSS px). */
export function isPhone(): boolean {
  return isTouchPrimary && Math.min(screen.width, screen.height) < 600;
}
