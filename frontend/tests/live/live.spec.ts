import { expect, test } from '@playwright/test';

// A smoke test of the app exactly as `run.ps1` serves it (production build from FastAPI, or the
// Vite dev server): the right application answers, the page renders, and a CIF goes through the
// backend to a specimen. Not part of `npm run test:e2e` (it needs a running server).
test.use({ viewport: { width: 1500, height: 1300 } });

test('the SimulateUI page renders and works end to end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const health = await page.request.get('/api/health');
  expect(health.ok(), 'the backend answers /api/health').toBe(true);
  expect(Object.keys((await health.json()).versions)).toContain('abtem');

  await page.goto('/');
  await expect(page).toHaveTitle('SimulateUI'); // not another project's app on the same port
  await expect(page.getByRole('heading', { name: 'SimulateUI', level: 1 })).toBeVisible();
  await expect(page.getByTestId('tab-structure')).toBeVisible();

  await page.getByTestId('cif-input').setInputFiles('tests/fixtures/cifs/Si.cif');
  await expect(page.getByTestId('hud')).toContainText('atoms');
  await expect(page.getByTestId('tab-specimen')).not.toHaveAttribute('data-state', 'locked', {
    timeout: 30_000,
  });
  await page.getByTestId('tab-specimen').click();
  await page.getByTestId('build-specimen').click();
  await expect(page.getByTestId('specimen-summary')).toContainText('Zone axis [0 0 1]');
  expect(errors.filter((e) => !/GPU stall|GL Driver/.test(e))).toEqual([]);
});
