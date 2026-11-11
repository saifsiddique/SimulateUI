import { expect, test, type Page } from '@playwright/test';
import { buildSpecimen, openCrystal, openTab, zone } from './helpers';

// MU step U5: ③ Simulation, Bloch wave. Type SAED, CBED, LACBED; two square views (reciprocal
// space of the zone axis, kinematic structure factors against |g|); a sidebar without sliders.
test.use({ viewport: { width: 1500, height: 1200 } });

const stats = (page: Page) => page.getByTestId('bloch-stats');
const sideTab = (page: Page, id: string) => page.getByTestId(`bloch-side-tab-${id}`);

async function openBloch(page: Page, uvw: [number, number, number] = [1, 1, 0]) {
  await openCrystal(page, 'Si');
  await zone(page, uvw);
  await buildSpecimen(page);
  await openTab(page, 'simulation');
  await page.getByTestId('method-bloch').click();
  await expect(stats(page)).toContainText('Beams', { timeout: 30_000 });
  await expect(page.getByTestId('factors-head')).toBeVisible({ timeout: 30_000 });
}

async function setNumber(page: Page, testid: string, value: string) {
  const box = page.getByTestId(testid);
  await box.fill(value);
  await box.press('Enter');
}

test('Bloch: two square views, SAED, CBED and LACBED, and a sidebar with no sliders', async ({
  page,
}) => {
  await openBloch(page);
  const recip = (await page.getByTestId('reciprocal').boundingBox())!;
  const fac = (await page.getByTestId('factors').boundingBox())!;
  expect(Math.abs(recip.width - fac.width)).toBeLessThan(2);
  expect(Math.abs(recip.y - fac.y)).toBeLessThan(2);
  expect(fac.x).toBeGreaterThan(recip.x + recip.width - 2);
  for (const b of [recip, fac]) expect(Math.abs(b.height - b.width)).toBeLessThan(60);
  await expect(page.getByTestId('reciprocal-scalebar')).toContainText('Å⁻¹');
  await expect(page.getByTestId('reciprocal-diagram')).toBeVisible();
  for (const id of ['saed', 'cbed', 'lacbed'])
    await expect(page.getByTestId(`bloch-${id}`)).toBeVisible();
  // one Beam tab (voltage, probe, beams); SAED has no Output tab (no pattern, no α); CBED and
  // LACBED have one. The old Beams and Pattern tabs are gone.
  await expect(sideTab(page, 'beam')).toHaveText('Beam');
  await expect(sideTab(page, 'beams')).toHaveCount(0);
  await expect(sideTab(page, 'pattern')).toHaveCount(0);
  await expect(sideTab(page, 'output')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Probe' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Beams' })).toBeVisible();
  await expect(page.getByTestId('k-max')).toBeVisible();
  await expect(page.getByTestId('sg-max')).toBeVisible();
  await expect(page.getByTestId('kv')).toHaveValue('300');
  await expect(page.locator('[data-testid="bloch-side"] input[type="range"]')).toHaveCount(0);
  await page.getByTestId('bloch-cbed').click();
  await expect(sideTab(page, 'output')).toHaveText('Output');
  // the convergence section is called Probe, above the Beams section, in the same tab
  await expect(page.getByRole('heading', { name: 'Probe' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Beams' })).toBeVisible();
  await expect(page.getByTestId('bloch-alpha')).toHaveValue('5');
  await expect(stats(page)).toContainText('Directions');
  await expect(page.locator('[data-testid="bloch-side"] input[type="range"]')).toHaveCount(0);
  // the multislice sidebar's tab count did not change
  await page.getByTestId('method-multislice').click();
  await expect(page.getByTestId('sim-side-tab-series')).toBeVisible();
});

test('k max: the box, the circle and the plot agree, and the beams follow', async ({ page }) => {
  await openBloch(page);
  await sideTab(page, 'beam').click();
  await expect(page.getByTestId('k-max')).toHaveValue('2');
  const before = Number(await page.getByTestId('reciprocal-diagram').getAttribute('data-count'));
  await setNumber(page, 'k-max', '1');
  await expect(page.getByTestId('factors-head')).toContainText('k max 1.00');
  await expect
    .poll(async () =>
      Number(await page.getByTestId('reciprocal-diagram').getAttribute('data-count')),
    )
    .toBeLessThan(before);
  await expect(stats(page)).toContainText('1.00', { timeout: 30_000 });
  await expect(page.getByTestId('kmax-mrad')).toContainText('19.7 mrad'); // 1 Å⁻¹ x 19.687 pm
  // drag the circle outwards in Reciprocal space
  const ring = (await page.getByTestId('kmax-handle').boundingBox())!;
  const cy = ring.y + ring.height / 2;
  await page.mouse.move(ring.x + ring.width - 1, cy);
  await page.mouse.down();
  await page.mouse.move(ring.x + ring.width + 40, cy, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByTestId('k-max').inputValue()))
    .toBeGreaterThan(1);
  // click in the structure-factor plot: x = 3 Å⁻¹ of 0..5
  const plot = (await page.getByTestId('factors-hit').boundingBox())!;
  await page.mouse.click(plot.x + plot.width * 0.6, plot.y + plot.height / 2);
  await expect(page.getByTestId('k-max')).toHaveValue('3');
  await expect(page.getByTestId('factors-head')).toContainText('k max 3.00');
  // the keyboard moves it by 0.05
  await page.getByTestId('factors-hit').press('ArrowLeft');
  await expect(page.getByTestId('k-max')).toHaveValue('2.95');
});

test('the structure-factor plot: 99 % of the kinematic intensity, forbidden 002 in Si [110]', async ({
  page,
}) => {
  await openBloch(page);
  await expect(page.getByTestId('factors-note')).toContainText('Kinematic |F|');
  // the reflections of the zone: 111 (strong) and the hollow ring of the forbidden 002
  await expect(
    page.locator('[data-testid="reciprocal-diagram"] circle.dark').first(),
  ).toBeVisible();
  await expect(page.getByTestId('factors-cumulative')).toBeVisible();
  await page.getByTestId('kmax-pct-900').click();
  const k90 = Number(await page.getByTestId('kmax-handle').getAttribute('aria-valuenow'));
  await page.getByTestId('kmax-pct-999').click();
  const k999 = Number(await page.getByTestId('kmax-handle').getAttribute('aria-valuenow'));
  expect(k90).toBeGreaterThan(0.3);
  expect(k999).toBeGreaterThan(k90);
  // the plot's headline reads the share kept
  const head = await page.getByTestId('factors-head').textContent();
  expect(Number(/keeps ([\d.]+) %/.exec(head!)![1])).toBeGreaterThanOrEqual(99.9);
  // the same buttons are in the sidebar
  await sideTab(page, 'beam').click();
  await page.getByTestId('side-kmax-pct-900').click();
  await expect(page.getByTestId('k-max')).toHaveValue(String(k90));
  await expect(page.getByTestId('bloch-kept')).not.toHaveText('0');
});

test('CBED and LACBED: the discs, the tilt count, and a slow solve warns with a fix', async ({
  page,
}) => {
  await openBloch(page);
  await page.getByTestId('bloch-lacbed').click();
  await setNumber(page, 'bloch-alpha', '60');
  await expect(page.getByTestId('bloch-alpha')).toHaveValue('60');
  await expect(page.getByTestId('reciprocal-diagram').locator('circle.disc').first()).toBeVisible();
  await sideTab(page, 'output').click();
  await expect(page.getByText('Pattern pixel size')).toBeVisible();
  await expect(page.getByTestId('bloch-tilts')).not.toHaveText('1', { timeout: 30_000 });
  const tilts = Number((await page.getByTestId('bloch-tilts').textContent())!.replace(/,/g, ''));
  const r = Math.round(60e-3 / 0.019687 / 0.02); // disc radius in pattern pixels
  expect(tilts).toBeGreaterThan(Math.PI * r * r * 0.97);
  expect(tilts).toBeLessThan(Math.PI * r * r * 1.03);
  // the cost is beams^3 x tilts: well over ten minutes, so a chip suggests a coarser pixel
  const warn = page.getByTestId('bloch-warning').first();
  await expect(warn).toContainText('coarser pattern pixel', { timeout: 30_000 });
  await warn.click();
  await expect(sideTab(page, 'output')).toHaveAttribute('aria-selected', 'true');
  await setNumber(page, 'bloch-pixel', '0.2');
  await expect(page.getByTestId('bloch-warning')).toHaveCount(0, { timeout: 30_000 });
  // an α beyond the usual range only warns
  await sideTab(page, 'beam').click();
  await setNumber(page, 'bloch-alpha', '80');
  await expect(page.getByTestId('bloch-alpha-warning')).toContainText('above the usual 60 mrad');
  await page.getByTestId('bloch-cbed').click();
  await expect(page.getByTestId('bloch-alpha-warning')).toContainText('above the usual 40 mrad');
});

test('Specimen: a thickness, and a checkbox that turns on a thickness series', async ({ page }) => {
  await openBloch(page);
  await sideTab(page, 'specimen').click();
  await expect(page.getByTestId('bloch-thickness')).toHaveValue('200');
  await expect(page.getByTestId('bloch-thickness')).toBeEnabled();
  await expect(page.getByTestId('bloch-depths')).toContainText('1 depth: 200 Å');
  // the series is off until ticked, like the Series tab of the multislice
  await expect(page.getByTestId('bloch-series-on')).not.toBeChecked();
  await expect(page.getByTestId('bloch-series-start')).toBeDisabled();
  await setNumber(page, 'bloch-thickness', '350');
  await expect(page.getByTestId('bloch-depths')).toContainText('350 Å');
  await page.getByTestId('bloch-series-on').check();
  await expect(page.getByTestId('bloch-series-start')).toBeEnabled();
  await expect(page.getByTestId('bloch-thickness')).toBeDisabled();
  await expect(page.getByTestId('bloch-depths')).toContainText('4 depths: 100, 200, 300, 400 Å');
  await setNumber(page, 'bloch-series-step', '50');
  await expect(page.getByTestId('bloch-depths')).toContainText('7 depths');
  await page.getByTestId('bloch-series-on').uncheck();
  await expect(page.getByTestId('bloch-depths')).toContainText('1 depth: 350 Å');
});

test('a thickness changes no request: only the phases of a solve depend on it', async ({
  page,
}) => {
  await openBloch(page);
  await sideTab(page, 'specimen').click();
  const bodies: Record<string, unknown>[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/bloch/preview')) bodies.push(r.postDataJSON());
    if (r.url().endsWith('/api/bloch/factors')) bodies.push({ factors: true });
  });
  await setNumber(page, 'bloch-thickness', '450');
  await page.getByTestId('bloch-series-on').check();
  await setNumber(page, 'bloch-series-stop', '800');
  await page.waitForTimeout(900);
  expect(bodies).toHaveLength(0);
  // another k max is a new solve: it asks again, with the processes it may use
  await sideTab(page, 'beam').click();
  await setNumber(page, 'k-max', '1.5');
  await expect.poll(() => bodies.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(bodies[0]).toMatchObject({ k_max: 1.5 });
  expect(Number(bodies[0].workers)).toBeGreaterThanOrEqual(1);
  expect(bodies[0]).not.toHaveProperty('thicknesses');
});

test('Thermal motion: the element sigmas, off until ticked', async ({ page }) => {
  await openBloch(page);
  await sideTab(page, 'specimen').click();
  await expect(page.getByTestId('thermal-on')).not.toBeChecked();
  await expect(page.getByTestId('sigma-Si')).toBeDisabled();
  await page.getByTestId('thermal-on').check();
  await expect(page.getByTestId('sigma-Si')).toBeEnabled();
  const start = Number(await page.getByTestId('sigma-Si').inputValue());
  expect(start).toBeGreaterThan(0);
  expect(start).toBeLessThan(0.5);
  // the structure factors are asked for again with the sigma of each element
  const asked = page.waitForRequest(
    (r) => r.url().endsWith('/api/bloch/factors') && r.postDataJSON().thermal_sigma?.Si === 0.2,
  );
  await setNumber(page, 'sigma-Si', '0.2');
  await asked;
  await expect(page.getByTestId('factors-head')).toBeVisible();
});

test('Compute (④): processes, time, and the saved solve', async ({ page }) => {
  await openBloch(page);
  await page.getByTestId('bloch-cbed').click();
  await expect(sideTab(page, 'compute')).toHaveCount(0); // it is in ④ Run now
  await openTab(page, 'run');
  await expect(page.getByTestId('bloch-time')).toBeVisible();
  expect(Number(await page.getByTestId('bloch-workers').textContent())).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('bloch-cache')).toContainText('temporary file');
  await expect(page.getByTestId('bloch-compute')).toContainText('CPU');
});

test('the voltage is shared with the multislice', async ({ page }) => {
  await openBloch(page);
  await page.getByTestId('kv-120').click();
  await expect(page.getByTestId('wavelength')).toContainText('3.349 pm');
  await page.getByTestId('method-multislice').click();
  await expect(page.getByTestId('kv')).toHaveValue('120');
});

test('Compute (④): the saved solve is shown and a button deletes the temporary file', async ({
  page,
}) => {
  // nothing solves yet, so the file is played by the route: present until the DELETE arrives
  let saved = true;
  const deletes: string[] = [];
  await page.route('**/api/bloch/cache', async (route) => {
    const method = route.request().method();
    if (method === 'DELETE') {
      deletes.push(method);
      saved = false;
    }
    await route.fulfill({
      json: { saved, bytes: saved ? 5_300_000 : 0, directory: 'C:/tmp/emsim-cache' },
    });
  });
  await openBloch(page);
  await openTab(page, 'run');
  await expect(page.getByTestId('bloch-cache-now')).toContainText('Saved solve on disk: 5.');
  await expect(page.getByTestId('bloch-cache-delete')).toBeEnabled();
  await page.getByTestId('bloch-cache-delete').click();
  await expect(page.getByTestId('bloch-cache-now')).toContainText('none');
  await expect(page.getByTestId('bloch-cache-delete')).toBeDisabled();
  expect(deletes).toHaveLength(1);
  await expect(page.getByTestId('bloch-compute')).toContainText('Size once saved');
});

test('Compute (④): with nothing saved the delete button is off', async ({ page }) => {
  await openBloch(page);
  await openTab(page, 'run');
  await expect(page.getByTestId('bloch-cache-now')).toContainText('none');
  await expect(page.getByTestId('bloch-cache-delete')).toBeDisabled();
});
