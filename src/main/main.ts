import '../ui/styles.css';
import { Game } from './Game';

async function start(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const ui = document.getElementById('ui-root') as HTMLElement;
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    ui.innerHTML =
      '<div class="layer loading show"><div class="title">THE FINAL EXPEDITION</div><div class="sub">WebGL 2 is required. Please use a current desktop Chrome, Edge, Firefox or Safari.</div></div>';
    return;
  }
  const game = new Game(canvas, ui);
  try {
    await game.boot();
  } catch (err) {
    console.error('[boot] failed', err);
    const msg = document.createElement('div');
    msg.className = 'layer loading show';
    msg.innerHTML = `<div class="title">THE FINAL EXPEDITION</div><div class="sub">Something went wrong while loading.</div><div class="status">${String((err as Error)?.message ?? err)}</div>`;
    ui.append(msg);
  }
}

void start();
