import { expect, test, type Page } from '@playwright/test';
import { openCrystal, openTab, zone } from './helpers';

// MU step U3: ② Specimen. The ribbon (zone axis, centre, size, build), the two square cards and the
// sidebar (Cell, Occupancy, Summary). The scan rectangle is chosen in ③.
test.use({ viewport: { width: 1500, height: 1200 } });

const summary = (page: Page) => page.getByTestId('specimen-summary');
const state = (page: Page, id: string) => page.getByTestId(`tab-${id}`);

test('Si [110] builds an exact cell, and the specimen view shows its atoms', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openCrystal(page, 'Si');
  await openTab(page, 'specimen');
  await zone(page, [1, 1, 0], 'specimen');
  await page.getByTestId('build-specimen').click();
  await expect(summary(page)).toContainText('Zone axis [1 1 0]');
  await expect(summary(page)).toContainText('5.43');
  await expect(summary(page)).toContainText('7.68');
  await expect(page.getByTestId('specimen-strain')).toHaveAttribute('data-level', 'ok');
  const n = Number(/(\d+) atoms$/.exec((await summary(page).textContent())!.trim())?.[1]);
  await expect(page.getByTestId('specimen-hud')).toHaveText(`${n} atoms`);
  await expect(page.getByTestId('specimen-extent')).toContainText('Å');
  expect(errors).toEqual([]);
});

test('two square cards, a sidebar with three tabs, and no scan rectangle', async ({ page }) => {
  await openCrystal(page, 'Si');
  await openTab(page, 'specimen');
  const crystal = (await page.getByTestId('crystal-card').boundingBox())!;
  const spec = (await page.getByTestId('specimen-view').boundingBox())!;
  expect(crystal.width).toBeGreaterThan(300);
  // The stage is square; the header strip adds a little height.
  expect(crystal.height - crystal.width).toBeLessThan(60);
  expect(Math.abs(crystal.width - spec.width)).toBeLessThan(2);
  await expect(page.getByTestId('spec-side-tab-cell')).toBeVisible();
  await expect(page.getByTestId('spec-side-tab-occupancy')).toBeVisible();
  await expect(page.getByTestId('spec-side-tab-summary')).toBeVisible();
  await page.getByTestId('build-specimen').click();
  await expect(summary(page)).toBeVisible();
  // The scan field of view moved to ③.
  await expect(page.getByTestId('fov-rect')).toHaveCount(0);
  await expect(page.getByTestId('fov-panel')).toHaveCount(0);
});

test('the zone axis chosen in the Structure tab is the starting beam of the Specimen tab', async ({
  page,
}) => {
  await openCrystal(page, 'NaCl');
  await zone(page, [1, 1, 0]);
  await openTab(page, 'specimen');
  await expect(page.getByTestId('zone-0')).toHaveValue('1');
  await expect(page.getByTestId('zone-1')).toHaveValue('1');
  await expect(page.getByTestId('zone-2')).toHaveValue('0');
  await expect(page.getByTestId('beam-readout')).toContainText('[1 1 0]');
});

test('Use the crystal view takes a tilted view; a b c and a* b* c* set the beam', async ({
  page,
}) => {
  await openCrystal(page, 'graphite');
  await openTab(page, 'specimen');
  await page.getByRole('button', { name: 'a', exact: true }).first().click();
  await expect(page.getByTestId('zone-0')).toHaveValue('1');
  await expect(page.getByTestId('zone-2')).toHaveValue('0');
  await page.getByRole('button', { name: 'c*', exact: true }).click();
  await expect(page.getByTestId('beam-readout')).toContainText('[0 0 1]');
  // A key tilt moves the view and, like a drag, sets the zone.
  await page.getByTestId('crystal-view').focus();
  await page.keyboard.press('ArrowRight');
  await page.getByTestId('use-view').click();
  await expect(page.getByTestId('beam-readout')).toContainText('off');
});

test('ZrO2 [001] stays within the strain tolerance and lists other cells', async ({ page }) => {
  await openCrystal(page, 'ZrO2_baddeleyite');
  await openTab(page, 'specimen');
  await zone(page, [0, 0, 1], 'specimen');
  await page.getByTestId('spec-side-tab-cell').click();
  await page.getByTestId('compare-abtem').check();
  await expect(page.getByTestId('compare-abtem')).toBeChecked();
  await page.getByTestId('build-specimen').click();
  await page.getByTestId('spec-side-tab-summary').click();
  await expect(page.getByTestId('specimen-strain')).toHaveAttribute('data-level', 'ok');
  await page.getByTestId('spec-side-tab-cell').click();
  await expect(page.getByTestId('abtem-compare')).toContainText('5');
  await page.getByText(/Other cells/).click();
  await expect(
    page.getByTestId('candidates').getByRole('button', { name: 'Use' }).first(),
  ).toBeVisible();
});

test('nothing rebuilds by itself: Rebuild turns on after a change, and ③ is stale until it is pressed', async ({
  page,
}) => {
  await openCrystal(page, 'Si');
  await openTab(page, 'specimen');
  const build = page.getByTestId('build-specimen');
  await build.click();
  await expect(summary(page)).toContainText('Zone axis [0 0 1]');
  await expect(state(page, 'simulation')).toHaveAttribute('data-state', 'todo');
  await expect(build).toBeDisabled();
  // Size: the summary keeps the old box until Rebuild is pressed.
  await page.getByTestId('ext-x').fill('3');
  await expect(build).toBeEnabled();
  await expect(state(page, 'simulation')).toHaveAttribute('data-state', 'stale');
  await expect(summary(page)).not.toContainText('repeated 3 ×');
  await build.click();
  await expect(summary(page)).toContainText('repeated 3 ×', { timeout: 15_000 });
  await expect(build).toBeDisabled();
  // A new beam direction needs a rebuild too.
  await zone(page, [1, 1, 0], 'specimen');
  await expect(build).toBeEnabled();
  await expect(state(page, 'simulation')).toHaveAttribute('data-state', 'stale');
  await build.click();
  await expect(summary(page)).toContainText('Zone axis [1 1 0]', { timeout: 15_000 });
  await expect(state(page, 'simulation')).not.toHaveAttribute('data-state', 'stale');
});

test('the Supercell tab has size, centring and the orthogonalize method', async ({ page }) => {
  await openCrystal(page, 'Si');
  await openTab(page, 'specimen');
  await page.getByTestId('spec-side-tab-cell').click();
  await expect(
    page.getByRole('heading', { name: 'Supercell size (unit cell repeats)' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unit cell centering' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Orthogonalize unit cell' })).toBeVisible();
  // The size is a copy of the ribbon's: both edit the same value.
  await page.getByTestId('side-ext-y').fill('3');
  await expect(page.getByTestId('ext-y')).toHaveValue('3');
  await page.getByTestId('centre-atom').click();
  await expect(page.getByTestId('centre-atom')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('build-specimen')).toBeEnabled();
});

test('three view directions with x, y, z axes; Reset zoom on both cards', async ({ page }) => {
  await openCrystal(page, 'Si');
  await openTab(page, 'specimen');
  await page.getByTestId('build-specimen').click();
  await expect(summary(page)).toBeVisible();
  const card = page.getByTestId('specimen-view');
  await expect(card.getByText('Supercell (to be simulated)')).toBeVisible();
  for (const label of ['Zone axis', 'Side x', 'Side y']) {
    await card.getByRole('button', { name: label, exact: true }).click();
    await expect(card.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  // Down the beam, z is the dot; only x, y and z are drawn.
  await card.getByRole('button', { name: 'Zone axis', exact: true }).click();
  await expect(card.getByText(/^z [⊗⊙]$/)).toBeVisible();
  await expect(card.getByText(/^[abc]$/)).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Reset zoom' })).toBeVisible();
  await expect(
    page.getByTestId('crystal-card').getByRole('button', { name: 'Reset zoom' }),
  ).toBeVisible();
});

test('Rotate sample: the left view sets the zone axis, the right view leaves it', async ({
  page,
}) => {
  await openCrystal(page, 'Si');
  await openTab(page, 'specimen');
  await page.getByTestId('build-specimen').click();
  await expect(summary(page)).toBeVisible();
  await page.getByTestId('rotate-step').fill('10');
  const read = () => page.evaluate(() => window.__beamview.viewState().direction);
  const before = await read();
  await page.getByRole('button', { name: 'Tilt right' }).click();
  const after = await read();
  expect(after).not.toEqual(before);
  await expect(page.getByTestId('beam-readout')).toContainText('off');
  // Right view: the supercell turns, the crystal view and the zone stay.
  await page.getByTestId('rotate-right').click();
  await page.getByRole('button', { name: 'Tilt up' }).click();
  expect(await read()).toEqual(after);
  await expect(
    page.getByTestId('specimen-view').getByRole('button', { name: 'Zone axis', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('occupancy: the random seed appears only for a random sample', async ({ page }) => {
  await openCrystal(page, 'olivine_partial');
  await openTab(page, 'specimen');
  await page.getByTestId('spec-side-tab-occupancy').click();
  await expect(page.getByTestId('seed')).toHaveCount(0);
  await page.getByTestId('occupancy').selectOption('random');
  await expect(page.getByTestId('seed')).toBeVisible();
});

test('the crystal draws the periodic cell once a specimen exists', async ({ page }) => {
  await openCrystal(page, 'graphite');
  await openTab(page, 'specimen');
  expect(await page.evaluate(() => window.__beamview.overlayCount())).toBe(0);
  await page.getByTestId('build-specimen').click();
  await expect(summary(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__beamview.overlayCount())).toBe(17);
});
