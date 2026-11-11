import { expect, test, type Page } from '@playwright/test';
import { buildSpecimen, openCrystal, openTab } from './helpers';

// MU step U1: the shell (header, status pill, Open CIF cards, workflow tabs with progress) and the
// design kit page.
test.use({ viewport: { width: 1500, height: 1100 } });

const state = (page: Page, id: string) => page.getByTestId(`tab-${id}`);
const progress = (page: Page) => page.getByTestId('workflow-progress');

test('the header: logo, gradient title, tagline and the status pill', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('SimulateUI');
  await expect(page.getByRole('heading', { name: 'SimulateUI', level: 1 })).toBeVisible();
  await expect(page.getByText('Set up electron microscopy simulations from a CIF')).toBeVisible();
  // The old one-screen layout and its step bar are gone.
  await expect(page.getByTestId('step-load')).toHaveCount(0);
  await expect(page.getByTestId('compute-panel')).toHaveCount(0);
  const pill = page.getByTestId('device-badge');
  await expect(pill).toBeVisible();
  await expect(pill).not.toHaveText('Detecting…', { timeout: 60_000 });
});

test('the status pill opens a compute popover; Escape and a click outside close it', async ({
  page,
}) => {
  await page.goto('/');
  const pill = page.getByTestId('device-badge');
  await expect(pill).not.toHaveText('Detecting…', { timeout: 60_000 });
  await pill.click();
  const pop = page.getByTestId('status-pop');
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('heading', { name: 'Compute' })).toBeVisible();
  await expect(page.getByTestId('status-platform')).toContainText(/Windows|macOS|Linux/);
  // Choosing the parallel CPU shows the worker count, and the pill follows.
  await page.getByTestId('device-cpu-parallel').click();
  // 2: CI runners have only two threads, and the field stops at the thread count.
  await page.getByTestId('workers').fill('2');
  await page.getByTestId('workers').press('Enter');
  await expect(pill).toHaveText('CPU × 2');
  await page.getByTestId('device-cpu-single').click();
  await expect(pill).toHaveText('CPU × 1');
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await pill.click();
  await expect(pop).toBeVisible();
  await page.getByRole('heading', { name: 'SimulateUI', level: 1 }).click();
  await expect(pop).toBeHidden();
});

test('workflow tabs: locked until reachable, then done, with the progress bar', async ({
  page,
}) => {
  await page.goto('/');
  await expect(state(page, 'structure')).toHaveAttribute('data-state', 'todo');
  for (const id of ['specimen', 'simulation', 'run'])
    await expect(state(page, id)).toHaveAttribute('data-state', 'locked');
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '0');
  // A locked tab does not open.
  await state(page, 'specimen').click({ force: true });
  await expect(state(page, 'structure')).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('cif-input').setInputFiles('tests/fixtures/cifs/Si.cif');
  await expect(state(page, 'structure')).toHaveAttribute('data-state', 'done', {
    timeout: 30_000,
  });
  await expect(state(page, 'specimen')).toHaveAttribute('data-state', 'todo');
  await expect(state(page, 'specimen')).toHaveAttribute('title', /build the specimen/);
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '25');

  await buildSpecimen(page);
  await expect(state(page, 'specimen')).toHaveAttribute('data-state', /done|warn/);
  await expect(state(page, 'simulation')).toHaveAttribute('data-state', 'todo');
  await expect(progress(page)).toHaveAttribute('aria-valuenow', '50');
  await expect(state(page, 'run')).toHaveAttribute('data-state', 'todo');

  // Every open tab can be revisited, and keeps what was set there.
  await openTab(page, 'simulation');
  await expect(page.getByTestId('realspace')).toBeVisible();
  await openTab(page, 'structure');
  await expect(page.getByTestId('viewer')).toBeVisible();
  await openTab(page, 'specimen');
  await expect(page.getByTestId('specimen-summary')).toBeVisible();
});

test('the arrow keys move between the open tabs only', async ({ page }) => {
  await openCrystal(page, 'Si');
  await expect(state(page, 'specimen')).not.toHaveAttribute('data-state', 'locked', {
    timeout: 30_000,
  });
  await state(page, 'structure').focus();
  await page.keyboard.press('ArrowRight');
  await expect(state(page, 'specimen')).toHaveAttribute('aria-selected', 'true');
  await expect(state(page, 'specimen')).toBeFocused();
  // Simulation and run are locked: ArrowRight wraps around to the structure tab.
  await page.keyboard.press('ArrowRight');
  await expect(state(page, 'structure')).toHaveAttribute('aria-selected', 'true');
});

test('several CIFs open as cards; closing the shown one locks the later tabs', async ({ page }) => {
  await page.goto('/');
  await page
    .getByTestId('cif-input')
    .setInputFiles(['tests/fixtures/cifs/Si.cif', 'tests/fixtures/cifs/NaCl.cif']);
  await expect(page.getByTestId('cif-card')).toHaveCount(2);
  const names = page.getByTestId('cif-card-name');
  await expect(names).toHaveText(['Si', 'NaCl']);
  // The last one opened is shown.
  await expect(page.getByTestId('cif-card-select').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('hud')).toContainText('27 atoms');
  await page.getByTestId('cif-card-select').first().click();
  await expect(page.getByTestId('hud')).not.toContainText('27 atoms');

  await buildSpecimen(page);
  await openTab(page, 'simulation');
  // Close the shown card (Si): NaCl is shown, its specimen is not built, the tab falls back.
  await page.getByTestId('cif-card-close').first().click();
  await expect(page.getByTestId('cif-card')).toHaveCount(1);
  await expect(state(page, 'simulation')).toHaveAttribute('data-state', 'locked');
  await expect(state(page, 'simulation')).toHaveAttribute('aria-selected', 'false');
  // Close the last one: back to the empty page.
  await page.getByTestId('cif-card-close').click();
  await expect(page.getByTestId('cif-card')).toHaveCount(0);
  await expect(state(page, 'structure')).toHaveAttribute('aria-selected', 'true');
  await expect(state(page, 'structure')).toHaveAttribute('data-state', 'todo');
  await expect(page.getByText('Open a CIF or XYZ file above')).toBeVisible();
});

for (const size of [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
]) {
  test(`no horizontal scroll at ${size.width}×${size.height} on any open tab`, async ({ page }) => {
    await page.setViewportSize(size);
    await openCrystal(page, 'ZrO2_baddeleyite');
    await buildSpecimen(page);
    // ④ Run stays locked until M6.
    for (const id of ['structure', 'specimen', 'simulation'] as const) {
      await openTab(page, id);
      await page.waitForTimeout(300); // the abTEM preview's pictures arrive after the tab opens
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `tab ${id}`).toBeLessThanOrEqual(0);
    }
  });
}

test('dark mode uses the dark tokens', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(15, 17, 23)');
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  );
  expect(accent).toBe('#f08a9c');
});

test.describe('design kit (?kit)', () => {
  test('renders every component, and NumberField commits, clamps and resets', async ({ page }) => {
    await page.goto('/?kit');
    await expect(page.getByTestId('kit')).toBeVisible();
    const box = page.getByTestId('kit-alpha');
    await box.fill('45');
    await box.press('Enter');
    await expect(page.getByTestId('kit-alpha-value')).toHaveText('α = 45 mrad');
    // Beyond the box's range: clamped to max (100), above the slider's range (60).
    await box.fill('500');
    await box.press('Enter');
    await expect(page.getByTestId('kit-alpha-value')).toHaveText('α = 100 mrad');
    // Not a number: put back.
    await box.fill('abc');
    await box.press('Enter');
    await expect(box).toHaveValue('100');
    await page.getByRole('button', { name: 'Reset Convergence α' }).click();
    await expect(page.getByTestId('kit-alpha-value')).toHaveText('α = 20 mrad');
    // The slider moves the value too.
    await page.getByTestId('kit-alpha-slider').fill('30');
    await expect(page.getByTestId('kit-alpha-value')).toHaveText('α = 30 mrad');
  });

  test('the sidebar resizes, collapses to a rail and comes back', async ({ page }) => {
    await page.goto('/?kit');
    const side = page.getByTestId('kit-side-panel');
    await side.scrollIntoViewIfNeeded();
    const w0 = (await side.boundingBox())!.width;
    const handle = (await page.getByTestId('kit-panel-handle').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 100, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await side.boundingBox())!.width).toBeGreaterThan(w0 + 50);
    await page.getByTestId('kit-side-tab-detectors').click();
    await expect(side).toContainText('Tab: detectors');
    await page.getByTestId('kit-panel-collapse').click();
    await expect(side).toBeHidden();
    await page.getByTestId('kit-panel-expand').click();
    await expect(page.getByTestId('kit-side-panel')).toBeVisible();
  });
});
