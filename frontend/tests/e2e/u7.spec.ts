import { expect, test, type Page } from '@playwright/test';
import { buildSpecimen, openCrystal, openTab, zone } from './helpers';

// MU step U7: every open file keeps its own settings; a setup is saved and opened again; step ④
// lists what is ready.
test.use({ viewport: { width: 1700, height: 1000 } });

async function setNumber(page: Page, testid: string, value: string) {
  const box = page.getByTestId(testid);
  await box.fill(value);
  await box.press('Enter');
}

const summary = (page: Page) => page.getByTestId('specimen-summary');

test('switching between two files keeps each one’s specimen, settings and tab', async ({
  page,
}) => {
  await openCrystal(page, 'Si');
  await zone(page, [1, 1, 0]);
  await buildSpecimen(page);
  const siSummary = (await summary(page).textContent())!;
  await openTab(page, 'simulation');
  await setNumber(page, 'alpha', '25');
  await expect(page.getByTestId('alpha')).toHaveValue('25');

  // A second structure starts from the defaults.
  await page.getByTestId('cif-input').setInputFiles('tests/fixtures/cifs/NaCl.cif');
  await expect(page.getByTestId('cif-card')).toHaveCount(2);
  await expect(page.getByTestId('tab-specimen')).not.toHaveAttribute('data-state', 'locked', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('tab-simulation')).toHaveAttribute('data-state', 'locked');
  await buildSpecimen(page);
  await openTab(page, 'simulation');
  await expect(page.getByTestId('alpha')).toHaveValue('30');
  await setNumber(page, 'alpha', '12');

  // Back to the first: its specimen is built again, α is its own, and ③ is the tab shown.
  await page.getByTestId('cif-card-select').first().click();
  await expect(page.getByTestId('tab-simulation')).toHaveAttribute('aria-selected', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('alpha')).toHaveValue('25');
  await openTab(page, 'specimen');
  await expect(summary(page)).toHaveText(siSummary);

  // And forward again.
  await page.getByTestId('cif-card-select').nth(1).click();
  await openTab(page, 'simulation');
  await expect(page.getByTestId('alpha')).toHaveValue('12');
});

test('a setting changed after the build is still changed when the file is shown again', async ({
  page,
}) => {
  await openCrystal(page, 'Si');
  await buildSpecimen(page);
  await page.getByTestId('ext-x').fill('3');
  await expect(page.getByTestId('build-specimen')).toBeEnabled();
  await page.getByTestId('cif-input').setInputFiles('tests/fixtures/cifs/NaCl.cif');
  await expect(page.getByTestId('cif-card')).toHaveCount(2);
  await page.getByTestId('cif-card-select').first().click();
  await expect(page.getByTestId('tab-specimen')).toHaveAttribute('data-state', 'stale', {
    timeout: 30_000,
  });
  // the old build is shown, the new size waits for Rebuild
  await expect(summary(page)).not.toContainText('repeated 3 ×');
  await expect(page.getByTestId('build-specimen')).toBeEnabled();
  await expect(page.getByTestId('ext-x')).toHaveValue('3');
});

test('Save setup, reload the page, Open setup: the same specimen and the same settings', async ({
  page,
}, info) => {
  await openCrystal(page, 'Si');
  await zone(page, [1, 1, 0]);
  await buildSpecimen(page);
  const before = (await summary(page).textContent())!;
  await openTab(page, 'simulation');
  await page.getByTestId('method-incostem').click();
  await expect(page.getByTestId('incostem-stats')).toContainText('Image', { timeout: 30_000 });
  await setNumber(page, 'inc-alpha', '22');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('setup-save').click(),
  ]);
  expect(download.suggestedFilename()).toBe('Si.simulateui.json');
  const path = info.outputPath('Si.simulateui.json');
  await download.saveAs(path);

  await page.reload();
  await expect(page.getByTestId('cif-card')).toHaveCount(0);
  await page.getByTestId('setup-input').setInputFiles(path);
  await expect(page.getByTestId('cif-card')).toHaveCount(1);
  // Opened on the tab it was saved on, with the specimen built again.
  await expect(page.getByTestId('tab-simulation')).toHaveAttribute('aria-selected', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('method-incostem')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('inc-alpha')).toHaveValue('22');
  await expect(page.getByTestId('incostem-stats')).toContainText('Image', { timeout: 30_000 });
  await openTab(page, 'specimen');
  await expect(summary(page)).toHaveText(before);
  await expect(page.getByTestId('setup-notice')).toHaveCount(0);
});

test('a file that is not a setup is refused with a reason', async ({ page }, info) => {
  await page.goto('/');
  const fs = await import('node:fs');
  const bad = info.outputPath('bad.json');
  fs.mkdirSync(info.outputDir, { recursive: true });
  fs.writeFileSync(bad, '{"hello": 1}');
  await page.getByTestId('setup-input').setInputFiles(bad);
  await expect(page.getByTestId('error')).toContainText('not a SimulateUI setup file');
  await expect(page.getByTestId('cif-card')).toHaveCount(0);
  const newer = info.outputPath('newer.json');
  fs.writeFileSync(newer, JSON.stringify({ schemaVersion: 99 }));
  await page.getByTestId('setup-input').setInputFiles(newer);
  await expect(page.getByTestId('error')).toContainText('newer version');
});

test('④ lists what is ready, and goes to the step that fixes an item', async ({ page }) => {
  await openCrystal(page, 'Si');
  await expect(page.getByTestId('tab-run')).toHaveAttribute('data-state', 'locked');
  await buildSpecimen(page);
  await openTab(page, 'run');
  await expect(page.getByTestId('run-verdict')).toContainText('Ready to run');
  // ③ has not been opened, so its parameters have not been checked.
  await expect(page.getByTestId('ready-parameters')).toContainText('Open ③ Simulation');
  await page.getByTestId('ready-parameters').getByRole('button', { name: 'Go there' }).click();
  await expect(page.getByTestId('tab-simulation')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('abtem-stats')).toBeVisible({ timeout: 30_000 });
  await openTab(page, 'run');
  await expect(page.getByTestId('ready-parameters')).toHaveAttribute('data-state', /ok|warn/);
  await expect(page.getByTestId('ready-structure')).toHaveAttribute('data-state', 'ok');
  await expect(page.getByTestId('run-start')).toBeEnabled();

  // A change in ② makes the specimen out of date: ④ is not ready.
  await openTab(page, 'specimen');
  await page.getByTestId('ext-x').fill('3');
  await openTab(page, 'run');
  await expect(page.getByTestId('run-verdict')).toContainText('Not ready');
  await expect(page.getByTestId('ready-specimen')).toHaveAttribute('data-state', 'fail');
  await expect(page.getByTestId('run-start')).toBeDisabled();
});
