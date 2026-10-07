// Chapter-to-chapter flow: end card → Continue carries progress into the next chapter; Main Menu
// returns to the Chapter 1 backdrop; the chapter list unlocks what has been reached.
import { openChapter } from './lib/chapterTest.mjs';

const T = await openChapter(2);
const { E, check, state, waitSim, page } = T;
await E(() => { const g = window.__TFE.game; g.state.progress.collectibles.add('ch2_plate_41'); g.chapters.completeChapter(); });
await page.waitForSelector('.end-card.show button', { timeout: 20000 });
const btns = await page.$$eval('.end-card.show button', (b) => b.map((x) => x.textContent));
check('end card offers Continue + Main Menu', btns.includes('Continue') && btns.includes('Main Menu'), btns.join(','));
check('end card copy is per chapter', (await page.textContent('.end-card h1')) === 'INTO THE UNKNOWN');
await page.click('.end-card.show button:has-text("Continue")');
await page.waitForFunction(() => window.__TFE.state().chapter === 3 && window.__TFE.state().gameState === 'playing', null, { timeout: 120000 });
let st = await state();
check('Continue loads Chapter 3', st.chapter === 3 && st.checkpoint === 'ch3_start', `ch=${st.chapter} cp=${st.checkpoint}`);
check('collectibles carry over', st.collectibles.includes('ch2_plate_41'), st.collectibles.join(','));
check('chapter flags carry over', st.flags.ch2_complete === true);
await waitSim(2);
// Pause → Main Menu → backdrop is Chapter 1 again.
await E(() => window.__TFE.pause());
await page.waitForTimeout(300);
await E(() => window.__TFE.game['toMainMenu']());
await page.waitForFunction(() => window.__TFE.state().gameState === 'menu', null, { timeout: 120000 });
check('main menu restores the Chapter 1 backdrop', (await E(() => window.__TFE.chapter().id)) === 1);
await page.click('button[data-action="chapters"]');
const list = await page.$$eval('.menu nav.chapters button[data-chapter]', (b) => b.map((x) => [x.textContent, x.disabled]));
check('chapter list shows all six entries', list.length === 6, JSON.stringify(list));
await page.screenshot({ path: 'playtest-output/flow-chapters.png' });
await T.finish('flow');
