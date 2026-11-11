import { expect, type Page } from '@playwright/test';

/** Open a fixture CIF and wait until the crystal view has drawn it. */
export async function openCrystal(page: Page, name: string) {
  await page.goto('/');
  await page.getByTestId('cif-input').setInputFiles(`tests/fixtures/cifs/${name}.cif`);
  await expect(page.getByTestId('hud')).toContainText('atoms');
}

/** Open a workflow tab once it is unlocked (MU: ① structure ② specimen ③ simulation ④ run). */
export async function openTab(page: Page, id: 'structure' | 'specimen' | 'simulation' | 'run') {
  const tab = page.getByTestId(`tab-${id}`);
  await expect(tab).not.toHaveAttribute('data-state', 'locked', { timeout: 30_000 });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/**
 * Type a zone axis and go there: in the Structure tab's ribbon, or in the Specimen tab's (which
 * also sets the beam the specimen is built along).
 */
export async function zone(
  page: Page,
  u: [number, number, number],
  tab: 'structure' | 'specimen' = 'structure',
) {
  const [field, go, readout] =
    tab === 'structure'
      ? ['uvw', 'uvw-go', 'orientation-readout']
      : ['zone', 'zone-go', 'beam-readout'];
  for (let k = 0; k < 3; k++) await page.getByTestId(`${field}-${k}`).fill(String(u[k]));
  await page.getByTestId(go).click();
  await expect(page.getByTestId(readout)).toContainText(`[${u.join(' ')}]`);
}

/** ② Specimen → Build, and wait for the result. */
export async function buildSpecimen(page: Page) {
  await openTab(page, 'specimen');
  await page.getByTestId('build-specimen').click();
  await expect(page.getByTestId('specimen-summary')).toBeVisible({ timeout: 30_000 });
}
