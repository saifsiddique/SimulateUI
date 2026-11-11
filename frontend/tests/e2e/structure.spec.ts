import { expect, test } from '@playwright/test';
import { openCrystal } from './helpers';

// MU step U2: ① Structure. The trimmed viewer: ribbon, legend, crystal data, appearance.
test.use({ viewport: { width: 1500, height: 1100 } });

const FIXTURES = [
  'Si',
  'NaCl',
  'rutile',
  'ZrO2_baddeleyite',
  'graphite',
  'albite',
  'olivine_partial',
];

for (const name of FIXTURES) {
  test(`${name}: the view, the legend and the crystal data, and the tab turns done`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openCrystal(page, name);
    await expect(page.getByTestId('legend-item').first()).toBeVisible();
    await expect(page.getByTestId('crystal-data')).toBeVisible();
    await expect(page.getByTestId('crystal-data')).toContainText('Space group');
    await expect(page.getByTestId('tab-structure')).toHaveAttribute('data-state', 'done', {
      timeout: 30_000,
    });
    expect(errors).toEqual([]);
  });
}

test('the ribbon has display, view direction, rotate and range, and no measuring or polyhedra', async ({
  page,
}) => {
  await openCrystal(page, 'Si');
  for (const legend of ['Display', 'View direction', 'Rotate', 'Range (cells)'])
    await expect(page.getByText(legend, { exact: true })).toBeVisible();
  await expect(page.getByTestId('measure')).toHaveCount(0);
  await expect(page.getByTestId('side-tab-polyhedra')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Bonds' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Crystal data' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Appearance' })).toBeVisible();
});

test('the Appearance and Elements tabs open', async ({ page }) => {
  await openCrystal(page, 'NaCl');
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await expect(page.getByTestId('scheme')).toBeVisible();
  await page.getByRole('tab', { name: 'Elements' }).click();
  await expect(page.getByTestId('view-panel')).toBeVisible();
});

test('the direction looked along is the starting beam of the specimen', async ({ page }) => {
  await openCrystal(page, 'Si');
  await page.getByRole('button', { name: 'a', exact: true }).first().click();
  await expect(page.getByTestId('orientation-readout')).toContainText('along [1 0 0]');
  await page.getByTestId('tab-specimen').click();
  await expect(page.getByTestId('zone-0')).toHaveValue('1');
  await expect(page.getByTestId('zone-1')).toHaveValue('0');
});
