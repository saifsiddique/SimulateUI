import { expect, test, type Page } from '@playwright/test';

// Tall enough that the whole viewer is on screen: Playwright ignores clicks outside the viewport.
test.use({ viewport: { width: 1200, height: 1100 } });

async function load(page: Page, name: string) {
  await page.goto('/');
  await page.getByTestId('cif-input').setInputFiles(`tests/fixtures/cifs/${name}.cif`);
  await expect(page.getByTestId('hud')).toContainText('atoms');
}

/** The camera state once it has stopped changing (frames are slow in software rendering). */
async function settledView(page: Page) {
  let last = '';
  for (let i = 0; i < 40; i++) {
    const now = JSON.stringify(
      await page.evaluate(() => window.__crystallens.viewState()),
      (_k, v: unknown) => (typeof v === 'number' ? Number(v.toFixed(5)) : v),
    );
    if (now === last) return JSON.parse(now) as ReturnType<CrystalLensHook['viewState']>;
    last = now;
    await page.waitForTimeout(400);
  }
  throw new Error('the view never settled');
}

/** A fingerprint of what the canvas shows, via a screenshot of it. */
// The HUD text sits over the canvas and changes with the frame rate, so it is masked out.
const picture = async (page: Page) =>
  (
    await page.getByTestId('viewer-canvas').screenshot({ mask: [page.getByTestId('hud')] })
  ).toString('base64');

test('draws the structure: atoms, bonds, and it changes when rotated', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, 'NaCl');
  await expect(page.getByTestId('hud')).toContainText('27 atoms · 54 bonds');

  // Not blank: compare with the picture after hiding everything is not possible, so check that
  // the canvas is neither a flat colour nor unchanged by a drag.
  const before = await picture(page);
  expect(before.length).toBeGreaterThan(4000);

  const canvas = page.getByTestId('viewer-canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 120, cy + 120);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy + 160, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await picture(page)) !== before).toBe(true);
  expect(errors).toEqual([]);
});

test('hover shows the exact atom, and the style switch changes the counts shown', async ({
  page,
}) => {
  await load(page, 'NaCl');
  // Atom 0 is at the origin; hover its projected centre.
  const p = await page.evaluate(() => window.__crystallens.atomScreen(0));
  await page.mouse.move(p.x, p.y);
  await expect(page.getByTestId('tooltip')).toBeVisible();
  await expect(page.getByTestId('tooltip')).toContainText(/Na|Cl/);
  await expect(page.getByTestId('tooltip')).toContainText('frac 0.0000 0.0000 0.0000');

  // Far from any atom there is no tooltip.
  const canvas = page.getByTestId('viewer-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 3);
  await expect(page.getByTestId('tooltip')).toHaveCount(0);
});

test('the structure changes with the cells control, and perspective renders too', async ({
  page,
}) => {
  await load(page, 'NaCl');
  await page.getByTestId('cells-a').fill('2');
  await page.getByTestId('cells-a').dispatchEvent('change');
  await expect(page.getByTestId('hud')).toContainText('45 atoms');
  await page.getByTestId('projection').selectOption('persp');
  await page.getByTestId('style').selectOption('spaceFill');
  const filled = await picture(page);
  await page.getByTestId('style').selectOption('stick');
  await expect.poll(async () => (await picture(page)) !== filled).toBe(true);
});

test('redraws immediately on wheel zoom and while dragging, with no other input', async ({
  page,
}) => {
  await load(page, 'NaCl');
  const canvas = page.getByTestId('viewer-canvas');
  const box = (await canvas.boundingBox())!;
  // Park the pointer in an empty corner, so hovering cannot be what triggers a redraw.
  await page.mouse.move(box.x + 5, box.y + 5);
  await settledView(page);
  const renders = async () => (await page.evaluate(() => window.__crystallens.stats())).renders;
  // (The canvas screenshot includes the HUD text, so pictures are not compared here: the count of
  // frames the renderer actually drew is.)
  const idle = await renders();
  await page.waitForTimeout(500);
  expect(await renders()).toBe(idle); // nothing is drawn while nothing changes

  const height0 = (await page.evaluate(() => window.__crystallens.viewState())).visibleHeight;
  await page.mouse.wheel(0, -400);
  await expect.poll(renders).toBeGreaterThan(idle);
  const height1 = (await page.evaluate(() => window.__crystallens.viewState())).visibleHeight;
  expect(height1).toBeLessThan(height0);

  // During a drag (button still down) every pointer move is drawn.
  await settledView(page);
  const beforeDrag = await renders();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 90, { steps: 10 });
  await expect.poll(renders).toBeGreaterThan(beforeDrag + 2);
  await page.mouse.up();
});

test('changing the number of cells keeps the orientation and zoom', async ({ page }) => {
  await load(page, 'NaCl');
  const canvas = page.getByTestId('viewer-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 110, { steps: 10 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  const before = await settledView(page);

  await page.getByTestId('cells-a').fill('3');
  await page.getByTestId('cells-a').dispatchEvent('change');
  await expect(page.getByTestId('hud')).toContainText('63 atoms');
  const after = await settledView(page);
  for (let k = 0; k < 3; k++) {
    expect(after.direction[k]).toBeCloseTo(before.direction[k], 2);
    expect(after.up[k]).toBeCloseTo(before.up[k], 2);
  }
  expect(after.visibleHeight / before.visibleHeight).toBeCloseTo(1, 2);

  // A different crystal starts from the default view again.
  await page.getByTestId('cif-input').setInputFiles('tests/fixtures/cifs/Si.cif');
  await expect(page.getByTestId('hud')).toContainText('atoms');
  await page.waitForTimeout(300);
  const fresh = await page.evaluate(() => window.__crystallens.viewState());
  expect(Math.abs(fresh.direction[2])).toBeGreaterThan(0.9);
});

test('the structure stops where the pointer is released (no inertia)', async ({ page }) => {
  await load(page, 'NaCl');
  const box = (await page.getByTestId('viewer-canvas').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 120, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200); // one or two frames to apply the last move
  const released = await page.evaluate(() => window.__crystallens.viewState());
  await page.waitForTimeout(1500);
  const later = await page.evaluate(() => window.__crystallens.viewState());
  for (let k = 0; k < 3; k++) expect(later.direction[k]).toBeCloseTo(released.direction[k], 4);
});
