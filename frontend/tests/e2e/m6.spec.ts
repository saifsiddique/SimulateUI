import { expect, test, type Page } from '@playwright/test';
import { buildSpecimen, openCrystal, openTab, zone } from './helpers';

// MU step U6: ③ Simulation, INCOSTEM: the incoherent ADF-STEM image of a thin specimen, live.
test.use({ viewport: { width: 1700, height: 1000 } });

const stats = (page: Page) => page.getByTestId('incostem-stats');
const sideTab = (page: Page, id: string) => page.getByTestId(`incostem-side-tab-${id}`);
const href = (page: Page, id: string) => page.getByTestId(id).getAttribute('href');

async function openIncostem(page: Page, uvw: [number, number, number] = [1, 1, 0]) {
  await openCrystal(page, 'Si');
  await zone(page, uvw);
  await buildSpecimen(page);
  await openTab(page, 'simulation');
  await page.getByTestId('method-incostem').click();
  await expect(stats(page)).toContainText('Image', { timeout: 30_000 });
  await expect(page.getByTestId('incostem-preview')).toBeVisible();
}

async function setNumber(page: Page, testid: string, value: string) {
  const box = page.getByTestId(testid);
  await box.fill(value);
  await box.press('Enter');
}

test('INCOSTEM: three square views, five tabs, a summary, and no sliders', async ({ page }) => {
  await openIncostem(page);
  await expect(page.getByTestId('incostem-type')).toHaveText('ADF-STEM');
  const [img, dif, psf] = await Promise.all(
    ['incostem', 'incostem-diffraction', 'psf'].map(
      async (id) => (await page.getByTestId(id).boundingBox())!,
    ),
  );
  for (const b of [img, dif, psf]) expect(Math.abs(b.height - b.width)).toBeLessThan(60);
  expect(Math.abs(img.width - dif.width)).toBeLessThan(2);
  expect(Math.abs(img.width - psf.width)).toBeLessThan(2);
  expect(Math.abs(img.y - psf.y)).toBeLessThan(2);
  expect(dif.x).toBeGreaterThan(img.x + img.width - 2);
  expect(psf.x).toBeGreaterThan(dif.x + dif.width - 2);
  for (const id of ['incostem', 'incostem-diffraction', 'psf'])
    await expect(page.getByTestId(`${id}-scalebar`)).toBeVisible();
  await expect(page.getByTestId('incostem-scalebar')).toContainText('Å');
  await expect(page.getByTestId('incostem-diffraction-scalebar')).toContainText('mrad');
  await expect(page.getByTestId('psf-preview')).toBeVisible();
  await expect(page.getByTestId('psf-fwhm')).toContainText('FWHM');
  // the tabs, in one row
  const ids = ['probe', 'detector', 'image', 'noise', 'cross'];
  const ys = await Promise.all(ids.map(async (id) => (await sideTab(page, id).boundingBox())!.y));
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2);
  await expect(sideTab(page, 'cross')).toHaveText('Cross sections');
  await expect(page.locator('[data-testid="incostem-side"] input[type="range"]')).toHaveCount(0);
  // the summary: the thickness and that the model is incoherent
  for (const t of ['Image', 'Pixel', 'Thickness', 'Atoms', 'Model', 'PSF FWHM', 'Time'])
    await expect(stats(page)).toContainText(t);
  await expect(stats(page)).toContainText('incoherent');
  await expect(page.getByTestId('incostem-warning')).toHaveCount(0); // 30 Å is thin enough
  // the other methods are one click away, and the voltage follows
  await page.getByTestId('kv-200').click();
  await page.getByTestId('method-multislice').click();
  await expect(page.getByTestId('kv')).toHaveValue('200');
  await page.getByTestId('method-incostem').click();
  await expect(page.getByTestId('incostem-preview')).toBeVisible();
});

test('Probe: α sets the PSF width; aberrations change it; the table is the multislice one', async ({
  page,
}) => {
  await openIncostem(page);
  const fwhm = async () =>
    Number(/FWHM ([\d.]+)/.exec((await page.getByTestId('psf-fwhm').textContent())!)![1]);
  const f30 = await fwhm();
  expect(f30).toBeGreaterThan(0.25);
  expect(f30).toBeLessThan(0.6);
  await setNumber(page, 'inc-alpha', '10');
  await expect.poll(fwhm, { timeout: 30_000 }).toBeGreaterThan(f30 * 2);
  // the source size blurs it further
  const f10 = await fwhm();
  await setNumber(page, 'inc-source', '1');
  await expect.poll(fwhm, { timeout: 30_000 }).toBeGreaterThan(f10);
  // aberrations: the whole table, as in the multislice
  await expect(page.getByTestId('aberrations')).toBeVisible();
  for (const id of ['C12', 'C21', 'C30', 'C56'])
    await expect(page.getByTestId(`ab-${id}`)).toBeVisible();
  const before = await href(page, 'psf-preview');
  await page.getByTestId('ab-random').click();
  await expect.poll(() => href(page, 'psf-preview'), { timeout: 30_000 }).not.toBe(before);
  await page.getByTestId('ab-reset').click();
  // a defocus changes the image too
  const img0 = await href(page, 'incostem-preview');
  await setNumber(page, 'inc-defocus', '150');
  await expect.poll(() => href(page, 'incostem-preview'), { timeout: 30_000 }).not.toBe(img0);
});

test('Detector: the annulus is drawn only in this tab, can be switched off and dragged', async ({
  page,
}) => {
  await openIncostem(page);
  await expect(page.getByTestId('incostem-adf')).toHaveCount(0); // Probe tab
  await sideTab(page, 'detector').click();
  await expect(page.getByTestId('incostem-adf')).toBeVisible();
  await page.getByTestId('overlay-adf').uncheck();
  await expect(page.getByTestId('incostem-adf')).toHaveCount(0);
  await page.getByTestId('overlay-adf').check();
  await expect(page.getByTestId('adf-outer-edge')).toBeVisible();
  // presets and the numbers (the inner angle cannot pass the outer one)
  await page.getByTestId('adf-preset-HAADF').click();
  await expect(page.getByTestId('adf-inner')).toHaveValue('75');
  await setNumber(page, 'adf-inner', '500');
  expect(Number(await page.getByTestId('adf-inner').inputValue())).toBeLessThan(
    Number(await page.getByTestId('adf-outer').inputValue()),
  );
  await setNumber(page, 'adf-inner', '80');
  await setNumber(page, 'adf-outer', '200');
  // drag the outer edge in
  const before = Number(await page.getByTestId('adf-outer').inputValue());
  const ring = (await page.getByTestId('adf-outer-edge').boundingBox())!;
  const cy = ring.y + ring.height / 2;
  await page.mouse.move(ring.x + ring.width - 1, cy);
  await page.mouse.down();
  await page.mouse.move(ring.x + ring.width * 0.7, cy, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByTestId('adf-outer').inputValue()))
    .toBeLessThan(before);
  await expect(page.getByTestId('incostem-adf-text')).toContainText('ADF 80–');
  // a wider detector catches more: the image values grow
  await sideTab(page, 'cross').click();
  const sigma = async () =>
    Number((await page.getByTestId('cross-Si').locator('td.num').first().textContent())!);
  const narrow = await sigma();
  await sideTab(page, 'detector').click();
  await setNumber(page, 'adf-outer', '400');
  await sideTab(page, 'cross').click();
  await expect.poll(sigma, { timeout: 30_000 }).toBeGreaterThan(narrow);
});

test('Image: the field of view is drawn in this tab, follows its numbers, and drags', async ({
  page,
}) => {
  await openIncostem(page);
  await expect(page.getByTestId('incostem-fov')).toHaveCount(0);
  await sideTab(page, 'image').click();
  await expect(page.getByTestId('incostem-fov')).toBeVisible();
  await page.getByTestId('overlay-incfov').uncheck();
  await expect(page.getByTestId('incostem-fov')).toHaveCount(0);
  await page.getByTestId('overlay-incfov').check();
  // a smaller field: fewer pixels
  const whole = await page.getByTestId('incostem-info').textContent();
  await page.getByRole('button', { name: 'Centre 50 %' }).click();
  await expect(page.getByTestId('incostem-info')).not.toHaveText(whole!, { timeout: 30_000 });
  await expect(page.getByTestId('inc-pixels')).toContainText('×');
  // the pixel size and the pixels across agree
  await setNumber(page, 'inc-pixel', '0.2');
  const w = Number(await page.getByTestId('inc-fov-w').inputValue());
  await expect(page.getByTestId('inc-nx')).toHaveValue(String(Math.round(w / 0.2)));
  await setNumber(page, 'inc-nx', '40');
  expect(Number(await page.getByTestId('inc-pixel').inputValue())).toBeCloseTo(w / 40, 3);
  await expect(page.getByTestId('incostem-info')).toContainText('40 ×', { timeout: 30_000 });
  // drag the rectangle: +x points left, so dragging right lowers x0; the image moves with it
  const x0 = Number(await page.getByTestId('inc-fov-x0').inputValue());
  const img = await href(page, 'incostem-preview');
  const rect = (await page.getByTestId('incostem-fov').boundingBox())!;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByTestId('inc-fov-x0').inputValue()))
    .toBeLessThan(x0);
  await expect.poll(() => href(page, 'incostem-preview'), { timeout: 30_000 }).not.toBe(img);
  // a handle resizes it
  const w0 = Number(await page.getByTestId('inc-fov-w').inputValue());
  const hdl = (await page.getByTestId('incostem-fov-handle-e').boundingBox())!;
  await page.mouse.move(hdl.x + 5, hdl.y + 5);
  await page.mouse.down();
  await page.mouse.move(hdl.x + 25, hdl.y + 5, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByTestId('inc-fov-w').inputValue()))
    .not.toBe(w0);
  // a coarse pixel under-samples the probe: a notice and a chip, which opens the Image tab
  await setNumber(page, 'inc-pixel', '0.5');
  await expect(page.getByTestId('inc-nyquist')).toContainText('λ / (4 α)');
  await sideTab(page, 'probe').click();
  const chip = page.getByTestId('incostem-warning').first();
  await expect(chip).toContainText('under-sampled', { timeout: 30_000 });
  await chip.click();
  await expect(sideTab(page, 'image')).toHaveAttribute('aria-selected', 'true');
});

test('Noise: off by default; counts with a seed are reproducible', async ({ page }) => {
  await openIncostem(page);
  await expect(page.getByTestId('incostem-range')).toContainText('fraction of the beam');
  await sideTab(page, 'noise').click();
  await expect(page.getByTestId('noise-on')).not.toBeChecked();
  await expect(page.getByTestId('noise-current')).toBeDisabled();
  await page.getByTestId('noise-on').check();
  await expect(page.getByTestId('noise-current')).toBeEnabled();
  await expect(page.getByTestId('incostem-range')).toContainText('electrons', { timeout: 30_000 });
  await expect(page.getByTestId('noise-dose')).toContainText('electrons per pixel');
  const seed1 = await href(page, 'incostem-preview');
  await setNumber(page, 'noise-seed', '2');
  await expect.poll(() => href(page, 'incostem-preview'), { timeout: 30_000 }).not.toBe(seed1);
  await setNumber(page, 'noise-seed', '1');
  await expect.poll(() => href(page, 'incostem-preview'), { timeout: 30_000 }).toBe(seed1);
});

test('Cross sections: one σ for each element, with a bar, from the ADF annulus', async ({
  page,
}) => {
  await openIncostem(page);
  await sideTab(page, 'cross').click();
  const row = page.getByTestId('cross-Si');
  await expect(row).toContainText('Z = 14');
  const sigma = Number((await row.locator('td.num').first().textContent())!);
  expect(sigma).toBeGreaterThan(0.0001);
  expect(sigma).toBeLessThan(0.001);
  await expect(row.locator('.bar')).toBeVisible();
  await expect(page.getByTestId('cross-total')).toContainText('256 atoms');
  // Lobato gives a slightly different value
  await sideTab(page, 'detector').click();
  await page.getByTestId('parametrization').selectOption('lobato');
  await sideTab(page, 'cross').click();
  await expect
    .poll(async () => Number((await row.locator('td.num').first().textContent())!), {
      timeout: 30_000,
    })
    .not.toBe(sigma);
});
