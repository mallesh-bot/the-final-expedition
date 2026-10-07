// Shared Playwright setup for all test/capture scripts.
// Picks a hardware GPU backend per OS (the old scripts forced macOS-only Metal, which made
// Chrome fall back to software rendering on Windows/Linux and broke every timing-based check).
import { chromium } from 'playwright';

export const BASE_URL = process.env.TFE_URL ?? 'http://localhost:5173/?debug';

export function gpuArgs() {
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl';
  return [`--use-angle=${angle}`, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
}

export function launch({ headed = process.argv.includes('--headed') } = {}) {
  return chromium.launch({ channel: 'chrome', headless: !headed, args: gpuArgs() });
}

/**
 * Simulation-time helpers: wait for game time to advance instead of wall-clock time, so results
 * are identical on fast and slow GPUs (the sim slows below 15 FPS; these waits compensate).
 */
export function simHelpers(page) {
  const simTime = () => page.evaluate(() => window.__TFE.state().simTime);
  const waitSim = async (seconds, timeoutMs = Math.max(15000, seconds * 20000)) => {
    const target = (await simTime()) + seconds;
    await page.waitForFunction((t) => window.__TFE.state().simTime >= t, target, { timeout: timeoutMs, polling: 50 });
  };
  const holdSim = async (keys, seconds) => {
    for (const k of keys) await page.keyboard.down(k);
    await waitSim(seconds);
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
  };
  const until = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
  return { simTime, waitSim, holdSim, until };
}
