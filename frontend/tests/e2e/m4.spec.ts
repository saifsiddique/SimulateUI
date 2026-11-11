import { expect, test, type Page } from '@playwright/test';
import { buildSpecimen, openCrystal, openTab, zone } from './helpers';

// MU step U4: ③ Simulation, multislice. Ribbon (method, type), the views (probe, χ(k), real space,
// diffraction plane), the sidebar and the summary bar.
test.use({ viewport: { width: 1500, height: 1200 } });

const stats = (page: Page) => page.getByTestId('abtem-stats');
const sideTab = (page: Page, id: string) => page.getByTestId(`sim-side-tab-${id}`);

async function openSimulation(page: Page, uvw: [number, number, number] = [1, 1, 0]) {
  await openCrystal(page, 'Si');
  await zone(page, uvw);
  await buildSpecimen(page);
  await openTab(page, 'simulation');
  await expect(stats(page)).toContainText('α max', { timeout: 30_000 });
}

/** Type into a NumberField and commit. */
async function setNumber(page: Page, testid: string, value: string) {
  const box = page.getByTestId(testid);
  await box.fill(value);
  await box.press('Enter');
}

test('two rows: real space and diffraction over probe and χ(k)', async ({ page }) => {
  await openSimulation(page);
  const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
  const [probe, chi, real, diff] = await Promise.all(
    ['probe', 'chi', 'realspace', 'diffraction'].map(box),
  );
  // first row: real space, diffraction; second row: probe, χ
  expect(Math.abs(real.y - diff.y)).toBeLessThan(2);
  expect(Math.abs(probe.y - chi.y)).toBeLessThan(2);
  expect(Math.abs(real.x - probe.x)).toBeLessThan(2);
  expect(Math.abs(diff.x - chi.x)).toBeLessThan(2);
  expect(diff.x).toBeGreaterThan(real.x + real.width - 2);
  expect(probe.y).toBeGreaterThan(real.y + real.height - 2);
  for (const b of [chi, diff, probe]) {
    expect(Math.abs(b.width - real.width)).toBeLessThan(2);
    expect(Math.abs(b.height - real.height)).toBeLessThan(2);
  }
  await expect(page.getByTestId('bf-note')).toHaveText('Green Circle: Bright field disk');
  expect(real.width).toBeGreaterThan(300);
  // every view is a square stage under its header strip
  for (const b of [probe, chi, real, diff]) expect(Math.abs(b.height - b.width)).toBeLessThan(60);
  await expect(page.getByTestId('potential-preview')).toBeVisible();
  await expect(page.getByTestId('probe-preview')).toBeVisible();
  await expect(page.getByTestId('chi-preview')).toBeVisible();
  for (const id of ['realspace', 'diffraction', 'probe', 'chi'])
    await expect(page.getByTestId(`${id}-scalebar`)).toBeVisible();
  await expect(page.getByTestId('realspace-scalebar')).toContainText('Å');
  await expect(page.getByTestId('diffraction-scalebar')).toContainText('mrad');
  await expect(page.getByTestId('chi-scalebar')).toContainText('mrad');
  await expect(page.getByTestId('probe-fwhm')).toContainText('FWHM');
  await expect(page.getByTestId('probe-fwhm-side')).toContainText(/Probe FWHM: \d+\.\d\d Å/);
  // Å⁻¹ changes the diffraction plane's unit
  await page.getByTestId('diffraction-inv').click();
  await expect(page.getByTestId('diffraction-scalebar')).toContainText('Å⁻¹');
  // a plane-wave type has the two planes side by side
  await page.getByTestId('sim-hrtem').click();
  await expect(page.getByTestId('probe')).toHaveCount(0);
  await expect(page.getByTestId('chi')).toHaveCount(0);
  const [r2, d2] = await Promise.all(['realspace', 'diffraction'].map(box));
  expect(Math.abs(r2.y - d2.y)).toBeLessThan(2);
  expect(r2.width).toBeGreaterThan(300);
});

test('χ(k) follows the defocus and the aberrations, with the π/4 circle', async ({ page }) => {
  await openSimulation(page);
  await expect(page.getByTestId('chi-max')).toContainText('χ = 0');
  await expect(page.getByTestId('chi-flat')).toHaveCount(0);
  const before = await page.getByTestId('chi-preview').getAttribute('href');
  await setNumber(page, 'defocus', '100');
  await expect(page.getByTestId('chi-max')).toContainText('inside α');
  await expect(page.getByTestId('chi-flat')).toBeVisible();
  // |χ| = π Δf θ² / λ = π/4 at θ = sqrt(λ / (4 Δf)) = 7.0 mrad at 300 kV (to a map pixel)
  await expect(page.getByTestId('chi-flat-text')).toContainText(/(6\.9|7\.0|7\.1) mrad/);
  expect(await page.getByTestId('chi-preview').getAttribute('href')).not.toBe(before);
  await expect(page.getByTestId('chi-aperture')).toBeVisible();
  await expect(page.getByTestId('chi-export-button')).toBeVisible();
});

test('the sidebar is wide: five tabs in one row, the voltage under Probe, no sliders', async ({
  page,
}) => {
  await openSimulation(page);
  expect((await page.getByTestId('sim-side-panel').boundingBox())!.width).toBeGreaterThan(480);
  const ids = ['beam', 'potential', 'scan', 'detectors', 'series'];
  const ys = await Promise.all(ids.map(async (id) => (await sideTab(page, id).boundingBox())!.y));
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2);
  await expect(sideTab(page, 'beam')).toHaveText('Probe');
  await expect(sideTab(page, 'potential')).toHaveText('Potential');
  await expect(page.getByRole('heading', { name: 'Acceleration voltage' })).toBeVisible();
  await expect(page.getByTestId('alpha-slider')).toHaveCount(0);
  await expect(page.getByTestId('defocus-slider')).toHaveCount(0);
  await page.getByTestId('kv-300').click();
  await expect(page.getByTestId('wavelength')).toContainText('1.969 pm');
  await expect(page.getByTestId('kv')).toHaveValue('300');
  await sideTab(page, 'potential').click();
  await expect(page.getByText('Potential sampling')).toBeVisible();
  await expect(page.locator('[data-testid="sim-side"] input[type="range"]')).toHaveCount(0);
});

test('defaults: 300 kV, α = 30 mrad, potential sampling 0.04 Å and no warning', async ({
  page,
}) => {
  await openSimulation(page);
  await expect(page.getByTestId('kv')).toHaveValue('300');
  await expect(page.getByTestId('kv-300')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('alpha')).toHaveValue('30');
  await sideTab(page, 'potential').click();
  await expect(page.getByTestId('sampling')).toHaveValue('0.04');
  await expect(page.getByTestId('abtem-warning')).toHaveCount(0);
});

test('aberration table: Reset on top beside Add random, subscripts and Haider notation', async ({
  page,
}) => {
  await openSimulation(page);
  const table = page.getByTestId('aberrations');
  await expect(table.locator('th')).toHaveText(['Coefficient', 'Magnitude', 'φ (°)']);
  const first = table.locator('tbody tr').first().locator('td').first();
  await expect(first).toHaveText(/^C12 \(A1\) Two-fold astigmatism$/);
  await expect(first.locator('sub')).toHaveText(['12', '1']);
  // the buttons come before the table
  const reset = (await page.getByTestId('ab-reset').boundingBox())!;
  const random = (await page.getByTestId('ab-random').boundingBox())!;
  const tbl = (await table.boundingBox())!;
  expect(reset.y).toBeLessThan(tbl.y);
  expect(Math.abs(reset.y - random.y)).toBeLessThan(2);
  expect(random.x).toBeGreaterThan(reset.x);
  await expect(page.getByTestId('ab-reset')).toBeDisabled();
});

test('Add random aberrations draws every coefficient except the defocus; Reset clears the table', async ({
  page,
}) => {
  await openSimulation(page);
  await page.getByTestId('ab-random').click();
  await expect(page.getByRole('heading', { name: /Aberrations/ })).toContainText('13 non-zero');
  // C12 within 0 to 2 nm, C30 within ±500 nm (= ±0.5 µm), angles within 0 to 360°
  const c12 = Number(await page.getByTestId('ab-C12').inputValue());
  expect(c12).toBeGreaterThanOrEqual(0);
  expect(c12).toBeLessThanOrEqual(20);
  const cs = Number(await page.getByTestId('ab-C30').inputValue());
  expect(Math.abs(cs)).toBeLessThanOrEqual(0.5 + 1e-9);
  const phi = Number(await page.getByTestId('ab-phi12').inputValue());
  expect(phi).toBeGreaterThanOrEqual(0);
  expect(phi).toBeLessThanOrEqual(360);
  await expect(page.getByTestId('defocus')).toHaveValue('0');
  await page.getByTestId('ab-reset').click();
  await expect(page.getByRole('heading', { name: /Aberrations/ })).toContainText('0 non-zero');
  await expect(page.getByTestId('ab-C12')).toHaveValue('0');
});

test('the sidebar stays in view while the page scrolls past the four views', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await openSimulation(page);
  const side = page.getByTestId('sim-side-panel');
  expect((await side.boundingBox())!.height).toBeLessThan(800);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  const box = (await side.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(800 + 1);
});

test('frozen phonons: off by default, a checkbox turns the number and the element sigmas on', async ({
  page,
}) => {
  await openSimulation(page);
  await sideTab(page, 'potential').click();
  await expect(page.getByTestId('phonons-on')).not.toBeChecked();
  await expect(page.getByTestId('phonons')).toBeDisabled();
  await expect(page.getByTestId('sigmas')).toHaveCount(0);
  await page.getByTestId('phonons-on').check();
  await expect(page.getByTestId('phonons')).toBeEnabled();
  await setNumber(page, 'phonons', '12');
  await expect(page.getByTestId('phonons')).toHaveValue('12');
  // abTEM needs a displacement sigma for each element; it starts at sqrt(Uiso) of the CIF
  const sigma = page.getByTestId('sigma-Si');
  await expect(sigma).toBeVisible();
  expect(Number(await sigma.inputValue())).toBeGreaterThan(0);
  // sigma 0 makes every configuration the same: a warning, and a positive sigma clears it
  await setNumber(page, 'sigma-Si', '0');
  await expect(page.getByTestId('abtem-warning').first()).toContainText('thermal sigma of 0', {
    timeout: 30_000,
  });
  await setNumber(page, 'sigma-Si', '0.1');
  await expect(sigma).toHaveValue('0.1');
  await expect(page.getByTestId('abtem-warning')).toHaveCount(0, { timeout: 30_000 });
  // the sigmas are sent to the backend with the configurations
  const asked = page.waitForRequest(
    (r) => r.url().endsWith('/api/abtem/preview') && r.postDataJSON().phonon_sigmas?.Si === 0.03,
  );
  await setNumber(page, 'sigma-Si', '0.03');
  await asked;
  // phonons off: no sigmas in the request
  const off = page.waitForRequest(
    (r) =>
      r.url().endsWith('/api/abtem/preview') &&
      Object.keys(r.postDataJSON().phonon_sigmas ?? {}).length === 0 &&
      r.postDataJSON().phonons === 1,
  );
  await page.getByTestId('phonons-on').uncheck();
  await off;
});

test('aberrations: every abTEM coefficient, and a coefficient changes the probe', async ({
  page,
}) => {
  await openSimulation(page);
  await expect(page.getByRole('heading', { name: /Aberrations/ })).toBeVisible();
  for (const id of [
    'C12',
    'C21',
    'C23',
    'C30',
    'C32',
    'C34',
    'C41',
    'C43',
    'C45',
    'C50',
    'C52',
    'C54',
    'C56',
  ])
    await expect(page.getByTestId(`ab-${id}`)).toBeVisible();
  await expect(page.getByTestId('ab-phi12')).toBeVisible();
  await expect(page.getByTestId('ab-phi30')).toHaveCount(0);
  const before = await page.getByTestId('probe-preview').getAttribute('href');
  await page.getByTestId('ab-C12').fill('150');
  await page.getByTestId('ab-C12').press('Enter');
  await expect
    .poll(() => page.getByTestId('probe-preview').getAttribute('href'), { timeout: 30_000 })
    .not.toBe(before);
  await expect(page.getByRole('heading', { name: /Aberrations/ })).toContainText('1 non-zero');
});

test('overlays show only in their tab, and a checkbox there turns them off', async ({ page }) => {
  await openSimulation(page, [0, 0, 1]);
  // Probe tab: no scan box, no detectors
  await expect(page.getByTestId('fov-rect')).toHaveCount(0);
  await expect(page.locator('[data-testid^="det-"][data-testid$="-edge"]')).toHaveCount(0);
  await sideTab(page, 'scan').click();
  await expect(page.getByTestId('fov-rect')).toBeVisible();
  await expect(page.getByTestId('wrap-band')).toBeVisible();
  await page.getByTestId('overlay-scan').uncheck();
  await expect(page.getByTestId('fov-rect')).toHaveCount(0);
  await page.getByTestId('overlay-scan').check();
  await expect(page.getByTestId('fov-rect')).toBeVisible();
  await sideTab(page, 'detectors').click();
  await expect(page.getByTestId('fov-rect')).toHaveCount(0);
  await expect(page.getByTestId('det-1-outer-edge')).toBeVisible();
  await page.getByTestId('overlay-detectors').uncheck();
  await expect(page.getByTestId('det-1-outer-edge')).toHaveCount(0);
  // the crop belongs to Output, for the types that record a pattern
  await page.getByTestId('sim-cbed').click();
  await expect(page.locator('rect.crop')).toHaveCount(0);
  await sideTab(page, 'output').click();
  await expect(page.locator('rect.crop')).toBeVisible();
  await page.getByTestId('overlay-crop').uncheck();
  await expect(page.locator('rect.crop')).toHaveCount(0);
});

test('Output is only for the types that record a pattern; the pixel is λ / L, not the sampling', async ({
  page,
}) => {
  await openSimulation(page);
  // HRTEM, SAED and STEM have no Output tab; CBED and 4D-STEM have one, with no explanatory lines
  for (const type of ['hrtem', 'saed', 'stem']) {
    await page.getByTestId(`sim-${type}`).click();
    await expect(sideTab(page, 'output')).toHaveCount(0);
  }
  await page.getByTestId('sim-4dstem').click();
  await expect(sideTab(page, 'output')).toHaveText('Output');
  await page.getByTestId('sim-cbed').click();
  await sideTab(page, 'output').click();
  await expect(page.getByText(/The exit surface is always saved/)).toHaveCount(0);
  await expect(page.getByText(/Dose and noise arrive/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Compute' })).toHaveCount(0);
  const pixel = page.getByTestId('diffraction-pixel');
  await expect(pixel).toContainText('Pixel size');
  await expect(page.getByTestId('binned-size')).toHaveText('128 × 128 px');
  const text = await pixel.textContent();
  await sideTab(page, 'potential').click();
  await setNumber(page, 'sampling', '0.1');
  await expect(stats(page)).toContainText('α max');
  await expect(page.getByText('updating…')).toHaveCount(0, { timeout: 30_000 });
  await sideTab(page, 'output').click();
  await expect(pixel).toHaveText(text!);
  // binning by 4: a quarter of the pixels across, four times the pixel size
  const before = parseFloat((await page.getByTestId('binned-pixel').textContent())!);
  await setNumber(page, 'binning', '4');
  await expect(page.getByTestId('binned-size')).toHaveText('32 × 32 px', { timeout: 30_000 });
  const after = parseFloat((await page.getByTestId('binned-pixel').textContent())!);
  expect(after).toBeCloseTo(4 * before, 1);
  await setNumber(page, 'binning', '1');
  // Compute moved to ④ Run
  await expect(sideTab(page, 'compute')).toHaveCount(0);
});

test('Series: thickness, defocus and tilt series multiply the runs', async ({ page }) => {
  await openSimulation(page);
  await sideTab(page, 'series').click();
  await expect(page.getByTestId('series-thickness-on')).toBeVisible();
  await expect(page.getByTestId('series-thickness-start')).toBeDisabled();
  await page.getByTestId('series-thickness-on').check();
  await expect(page.getByTestId('series-thickness-values')).toContainText(
    '6 depths: 5, 10, 15, 20, 25, 30 Å',
  );
  await expect(page.getByTestId('series-runs')).toContainText('1 run');
  await page.getByTestId('series-defocus-on').check();
  await expect(page.getByTestId('series-defocus-values')).toContainText('5 runs');
  await expect(page.getByTestId('series-runs')).toContainText('5 runs', { timeout: 30_000 });
  // STEM has no tilt series; CBED has
  await expect(page.getByTestId('series-tilt-on')).toHaveCount(0);
  await page.getByTestId('sim-cbed').click();
  await page.getByTestId('series-tilt-on').check();
  await expect(page.getByTestId('series-tilt-values')).toContainText('6 runs');
  await expect(page.getByTestId('series-runs')).toContainText('30 runs', { timeout: 30_000 });
  await page.getByTestId('series-tilt-grid').click();
  await setNumber(page, 'series-tilt-y-stop', '2');
  await setNumber(page, 'series-tilt-y-step', '2');
  await expect(page.getByTestId('series-tilt-values')).toContainText('12 runs');
  // SAED has a tilt series but no defocus series
  await page.getByTestId('sim-saed').click();
  await expect(page.getByTestId('series-defocus-on')).toHaveCount(0);
  await expect(page.getByTestId('series-runs')).toContainText('12 runs', { timeout: 30_000 });
});

test('the probe: Export is offered; the intensity and the profile download as data', async ({
  page,
}) => {
  await openSimulation(page);
  await page.getByTestId('probe-export-button').click();
  for (const [row, file] of [
    ['png', 'probe.png'],
    ['svg', 'probe.svg'],
  ] as const) {
    const [saved] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(`probe-export-${row}-save`).click(),
    ]);
    expect(saved.suggestedFilename()).toBe(file);
  }
  await page.keyboard.press('Escape');
  for (const [id, file] of [
    ['download-probe-npz', 'probe.npz'],
    ['download-probe-csv', 'probe.csv'],
    ['download-profile', 'probe_profile.csv'],
  ] as const) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(id).click(),
    ]);
    expect(download.suggestedFilename()).toBe(file);
  }
});

test('α and the detectors update the summary; an outer angle beyond α max warns', async ({
  page,
}) => {
  await openSimulation(page);
  const before = await stats(page).textContent();
  await setNumber(page, 'alpha', '35');
  await expect(stats(page)).not.toHaveText(before!, { timeout: 30_000 });
  await sideTab(page, 'detectors').click();
  await expect(page.getByTestId('detector')).toHaveCount(2);
  await setNumber(page, 'det-outer-1', '300');
  await expect(page.getByTestId('abtem-warning').first()).toContainText('beyond', {
    timeout: 30_000,
  });
  // A warning chip opens the tab of its parameter.
  await sideTab(page, 'potential').click();
  await page.getByTestId('abtem-warning').first().click();
  await expect(sideTab(page, 'detectors')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('add-ABF').click();
  await expect(page.getByTestId('detector')).toHaveCount(3);
});

test('dragging an annulus edge in the diffraction plane changes the detector', async ({ page }) => {
  await openSimulation(page);
  await sideTab(page, 'detectors').click();
  const outer = page.getByTestId('det-outer-1');
  const before = Number(await outer.inputValue());
  const ring = (await page.getByTestId('det-1-outer-edge').boundingBox())!;
  const cx = ring.x + ring.width / 2;
  const cy = ring.y + ring.height / 2;
  // grab the ring at its right-hand edge and pull it inwards
  await page.mouse.move(ring.x + ring.width - 1, cy);
  await page.mouse.down();
  await page.mouse.move(cx + ring.width * 0.3, cy, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await outer.inputValue())).toBeLessThan(before);
});

test('the scan rectangle: presets in the Scan tab, drag in Real space, the probe and the edge band', async ({
  page,
}) => {
  await openSimulation(page, [0, 0, 1]);
  await sideTab(page, 'scan').click();
  await expect(page.getByTestId('fov-rect')).toBeVisible();
  await expect(page.getByTestId('probe-footprint')).toBeVisible();
  await expect(page.getByTestId('scan-count')).toContainText('positions');
  // the step shows the Nyquist step, not 0
  expect(Number(await page.getByTestId('scan-step').inputValue())).toBeGreaterThan(0);
  // a larger periodic cell: whole cells, starting on a cell origin
  await page.getByTestId('cells-x').fill('2');
  await page.getByTestId('cells-x').press('Enter');
  await page.getByTestId('cells-y').fill('2');
  await page.getByTestId('cells-y').press('Enter');
  await page.getByTestId('fov-cells').click();
  await expect(page.getByTestId('fov-w')).toHaveValue('10.86');
  await expect(page.getByTestId('fov-h')).toHaveValue('10.86');
  const x0 = Number(await page.getByTestId('fov-x0').inputValue());
  expect(Math.abs(x0 / 5.43 - Math.round(x0 / 5.43))).toBeLessThan(0.01);
  await page.getByRole('button', { name: 'One periodic cell' }).click();
  await expect(page.getByTestId('fov-w')).toHaveValue('5.43');
  const before = Number(await page.getByTestId('fov-x0').inputValue());
  const box = (await page.getByTestId('fov-rect').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  // +x points left: dragging right moves the rectangle to smaller x
  await expect
    .poll(async () => Number(await page.getByTestId('fov-x0').inputValue()))
    .toBeLessThan(before);
  // the whole box reaches the edge: the wrap-round warning and the shaded band
  await page.getByRole('button', { name: 'Whole box' }).click();
  await expect(page.getByTestId('fov-margin')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wrap-band')).toBeVisible();
  await expect(page.getByTestId('scan-nyquist')).toContainText('Nyquist');
});

test('Si [110]: the kinematic reflections sit at |g| of 111 (to a pixel)', async ({ page }) => {
  await openSimulation(page);
  await page.getByTestId('sim-cbed').click();
  await setNumber(page, 'alpha', '2');
  await page.getByTestId('diffraction-spots').click();
  const bf = page.getByTestId('bf-disc');
  await expect(bf).toHaveAttribute('r', /.+/, { timeout: 30_000 });
  await expect
    .poll(async () => Number(await page.getByTestId('bragg-discs').getAttribute('data-count')))
    .toBeGreaterThan(10);
  const geom = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="bf-disc"]')!;
    const cx = Number(b.getAttribute('cx'));
    const cy = Number(b.getAttribute('cy'));
    const r = Number(b.getAttribute('r'));
    const d = [...document.querySelectorAll('[data-testid="bragg-discs"] circle')].map((c) =>
      Math.hypot(Number(c.getAttribute('cx')) - cx, Number(c.getAttribute('cy')) - cy),
    );
    return { r, d };
  });
  const pxPerMrad = geom.r / 2; // α = 2 mrad
  const lambda = 0.019687; // Å at 300 kV
  for (const g of [Math.sqrt(3) / 5.431, Math.sqrt(8) / 5.431]) {
    const want = lambda * g * 1e3 * pxPerMrad;
    expect(Math.min(...geom.d.map((x) => Math.abs(x - want)))).toBeLessThan(1);
  }
});

test('multislice has no LACBED (it is a Bloch-wave type)', async ({ page }) => {
  await openSimulation(page);
  await expect(page.getByTestId('sim-cbed')).toBeVisible();
  await expect(page.getByTestId('sim-lacbed')).toHaveCount(0);
  await expect(page.getByTestId('lacbed-mode')).toHaveCount(0);
});

test('HRTEM: a plane wave lights the whole box, no probe, and the objective aperture is drawn', async ({
  page,
}) => {
  await openSimulation(page);
  await page.getByTestId('sim-hrtem').click();
  await expect(page.getByTestId('illuminated')).toBeVisible();
  await expect(page.getByTestId('probe')).toHaveCount(0);
  await expect(sideTab(page, 'beam')).toHaveText('Plane wave');
  await expect(sideTab(page, 'scan')).toHaveCount(0);
  await setNumber(page, 'aperture', '15');
  await expect(page.getByTestId('aperture-circle')).toBeVisible();
});
