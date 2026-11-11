import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1500, height: 1100 } });

test('a CIF opens as a card and in the crystal view', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('cif-input').setInputFiles('tests/fixtures/cifs/Si.cif');
  await expect(page.getByTestId('hud')).toContainText('atoms');
  await expect(page.getByTestId('cif-card')).toHaveAttribute('title', /Si\.cif/);
  await expect(page.getByTestId('cif-card-name')).toHaveText('Si');
  await expect(page.getByTestId('orientation-readout')).toContainText('along [0 0 1]');
});

test('an XYZ file opens too', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('cif-input').setInputFiles({
    name: 'si.xyz',
    mimeType: 'chemical/x-xyz',
    buffer: Buffer.from('2\nLattice="5 0 0 0 5 0 0 0 5"\nSi 0 0 0\nSi 2.5 2.5 2.5\n'),
  });
  await expect(page.getByTestId('hud')).toContainText('atoms');
  await expect(page.getByTestId('cif-card')).toHaveAttribute('title', /si\.xyz/);
});

test('mixed sites are mentioned', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('cif-input').setInputFiles('tests/fixtures/cifs/olivine_partial.cif');
  await expect(page.getByTestId('partial-sites')).toContainText('dominant species');
});
