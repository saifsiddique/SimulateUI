import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1400, height: 1100 } });

async function load(page: Page, name: string) {
  await page.goto('/');
  await page.getByTestId('cif-input').setInputFiles(`tests/fixtures/cifs/${name}.cif`);
  await expect(page.getByTestId('hud')).toContainText('atoms');
}

const direction = (page: Page) =>
  page.evaluate(() => window.__crystallens.viewState().direction as [number, number, number]);

const angle = (a: number[], b: number[]) => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return (Math.atan2(Math.hypot(...cross), dot) * 180) / Math.PI;
};

async function typeIndices(page: Page, kind: 'uvw' | 'hkl', v: [number, number, number]) {
  for (let k = 0; k < 3; k++) await page.getByTestId(`${kind}-${k}`).fill(String(v[k]));
  await page.getByTestId(`${kind}-go`).click();
}

const readout = (page: Page) => page.getByTestId('orientation-readout');

test('the page uses the full width of the window', async ({ page }) => {
  await load(page, 'NaCl');
  const width = await page.locator('main').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(1400 - 40);
});

test('typing [uvw] looks along it and the live readout reads it back', async ({ page }) => {
  await load(page, 'NaCl');
  await typeIndices(page, 'uvw', [1, 1, 0]);
  await expect(readout(page)).toContainText('along [1 1 0] (0.00° off)');
  const d = await direction(page);
  expect(angle(d, [1, 1, 0])).toBeLessThan(1e-4);
  await typeIndices(page, 'uvw', [-1, 2, 3]);
  await expect(readout(page)).toContainText('along [-1 2 3] (0.00° off)');
});

test('graphite: [100] and the (100) normal are 30 degrees apart; [100] is the (2 -1 0) normal', async ({
  page,
}) => {
  await load(page, 'graphite');
  await typeIndices(page, 'uvw', [1, 0, 0]);
  await expect(readout(page)).toContainText('along [1 0 0] (0.00° off)');
  const along = await direction(page);
  await typeIndices(page, 'hkl', [1, 0, 0]);
  await expect(readout(page)).toContainText('normal to (1 0 0) (0.00° off)');
  const normal = await direction(page);
  expect(angle(along, normal)).toBeCloseTo(30, 3);
  await typeIndices(page, 'hkl', [2, -1, 0]);
  expect(angle(along, await direction(page))).toBeLessThan(1e-4);
});

test('quick buttons: a, b, c and a*, b*, c*', async ({ page }) => {
  await load(page, 'NaCl');
  await page.getByRole('button', { name: 'b', exact: true }).click();
  await expect(readout(page)).toContainText('along [0 1 0]');
  await page.getByRole('button', { name: 'c*', exact: true }).click();
  await expect(readout(page)).toContainText('normal to (0 0 1)');
});

test('arrow keys tilt by the step, Shift by 1 degree, and opposite keys cancel', async ({
  page,
}) => {
  await load(page, 'NaCl');
  await page.getByRole('button', { name: 'c', exact: true }).click();
  const start = await direction(page);
  await page.getByTestId('viewer').locator('.stage').focus();
  await page.keyboard.press('ArrowRight');
  expect(angle(start, await direction(page))).toBeCloseTo(5, 3);
  await page.keyboard.press('Shift+ArrowUp');
  const afterTwo = await direction(page);
  expect(angle(start, afterTwo)).toBeGreaterThan(5);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('ArrowLeft');
  expect(angle(start, await direction(page))).toBeLessThan(1e-4);
});

test('the tilt step is adjustable and the buttons use it', async ({ page }) => {
  await load(page, 'NaCl');
  await page.getByRole('button', { name: 'c', exact: true }).click();
  const start = await direction(page);
  await page.getByTestId('tilt-step').fill('12');
  await page.getByRole('button', { name: 'Tilt up' }).click();
  expect(angle(start, await direction(page))).toBeCloseTo(12, 3);
});

test('in-plane rotation by the step keeps the view and turns the picture', async ({ page }) => {
  await load(page, 'NaCl');
  await page.getByRole('button', { name: 'c', exact: true }).click();
  const before = await page.evaluate(() => window.__crystallens.viewState());
  await page.getByTestId('tilt-step').fill('90');
  await page.getByRole('button', { name: 'Rotate in plane clockwise' }).click();
  const after = await page.evaluate(() => window.__crystallens.viewState());
  expect(angle(before.direction, after.direction)).toBeLessThan(1e-4);
  expect(angle(before.up, after.up)).toBeCloseTo(90, 3);
});

test('mouse rotation does not snap by default; the Snap button snaps within its angle', async ({
  page,
}) => {
  await load(page, 'NaCl');
  const stage = page.getByTestId('viewer').locator('.stage');
  const box = (await stage.boundingBox())!;
  const drag = async () => {
    await page.mouse.move(box.x + 60, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 64, box.y + 61, { steps: 4 });
    await page.mouse.up();
  };

  await page.getByRole('button', { name: 'c', exact: true }).click();
  await page.getByTestId('tilt-step').fill('3');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Tilt right' }).click();
  await drag();
  const off = angle(await direction(page), [0, 0, -1]);
  const offC = Math.min(off, angle(await direction(page), [0, 0, 1]));
  expect(offC).toBeGreaterThan(0.2); // not snapped

  await expect(page.getByTestId('snap')).toHaveText(/off/);
  await page.getByTestId('snap').click();
  await expect(page.getByTestId('snap')).toHaveText(/on/);
  await page.getByTestId('snap-degrees').fill('20');
  await page.getByTestId('snap-index').fill('1');
  await drag();
  const d = await direction(page);
  expect(angle(d, [0, 0, 1])).toBeLessThan(1e-4);
  await expect(readout(page)).toContainText('along [0 0 1] (0.00° off)');
});

test('right-drag pans about as far as the pointer moves', async ({ page }) => {
  await load(page, 'NaCl');
  const stage = page.getByTestId('viewer').locator('.stage');
  const box = (await stage.boundingBox())!;
  const at = () => page.evaluate(() => window.__crystallens.atomScreen(0));
  const before = await at();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + 300, box.y + 100, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  const after = await at();
  const moved = after.x - before.x;
  expect(moved).toBeGreaterThan(160);
  expect(moved).toBeLessThan(240);
});
