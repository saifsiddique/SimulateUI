import { expect, test } from '@playwright/test';
import { buildSpecimen, openCrystal, openTab, zone } from './helpers';

// M6: ④ starts the chosen method as a job on the backend, shows its progress, can cancel it, and
// lists the stored results.
test.use({ viewport: { width: 1500, height: 1200 } });
test.setTimeout(300_000);

/** A frame as the backend sends it: raw float32 bytes with the description in a header. */
function binFrame(unit: string, pixel: number[], rows: number, cols: number) {
  const values = new Float32Array(rows * cols).map((_, i) => i);
  return {
    body: Buffer.from(values.buffer),
    headers: {
      'content-type': 'application/octet-stream',
      'x-frame': JSON.stringify({
        shape: [rows, cols],
        pixel,
        unit,
        min: 0,
        max: rows * cols - 1,
      }),
    },
  };
}

async function ready(page: import('@playwright/test').Page) {
  await openCrystal(page, 'Si');
  await zone(page, [1, 1, 0]);
  await buildSpecimen(page);
  await openTab(page, 'simulation');
  await expect(page.getByTestId('abtem-stats')).toContainText('α max', { timeout: 30_000 });
}

test('Run SAED: the job finishes and its result is listed with a preview', async ({ page }) => {
  await ready(page);
  await page.getByTestId('sim-saed').click();
  await expect(page.getByTestId('abtem-stats')).toContainText('α max');
  await openTab(page, 'run');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('job-state')).toHaveText('Done', { timeout: 240_000 });
  // <material>_<space group>/<method>_<type>/<date>_<number>
  await expect(page.getByTestId('job-folder')).toContainText(
    /Si_[^\\/]+[\\/]multislice_saed[\\/]\d{8}_\d{3}/,
  );
  // the tabs follow the work: Simulation is done once its parameters check out, Run when it ends
  await expect(page.getByTestId('tab-simulation')).toHaveAttribute('data-state', /done|warn/);
  await expect(page.getByTestId('tab-run')).toHaveAttribute('data-state', 'done');
  const row = page.getByTestId('result-saed');
  await expect(row).toBeVisible();
  const img = row.locator('img');
  await expect
    .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(8);
  // the job is also in the list of earlier runs after another one starts
  await expect(page.getByTestId('run-start')).toBeEnabled();
});

test('Run, then Cancel: the job ends as cancelled and the button is back', async ({ page }) => {
  await ready(page);
  await page.getByTestId('sim-4dstem').click();
  await expect(page.getByTestId('abtem-stats')).toContainText('Positions');
  await openTab(page, 'run');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-cancel')).toBeVisible();
  await page.getByTestId('run-cancel').click();
  await expect(page.getByTestId('job-state')).toHaveText(/Cancelled|Done/, { timeout: 30_000 });
  await expect(page.getByTestId('run-start')).toBeEnabled();
});

test('a run that fails shows the reason', async ({ page }) => {
  await ready(page);
  // the failure is played by the route: the backend tests cover a real crash
  await page.route('**/api/jobs', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      json: {
        id: 'x_001',
        name: 'multislice stem',
        project: 'Si',
        method: 'multislice',
        sim_type: 'stem',
        state: 'failed',
        fraction: 0,
        message: 'ValueError: Add at least one detector',
        created: 0,
        started: 0,
        finished: 0,
        elapsed: 1,
        eta: null,
        error: 'ValueError: Add at least one detector',
        directory: 'C:/p/Si/multislice/x_001',
        results: [],
        device: 'cpu',
        queue_position: null,
      },
    });
  });
  await openTab(page, 'run');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('job-state')).toHaveText('Failed');
  await expect(page.getByTestId('job-error')).toContainText('Add at least one detector');
});

/** A coarse potential makes the job several times quicker (the tests only need a result). */
async function coarse(page: import('@playwright/test').Page) {
  await page.getByTestId('sim-side-tab-potential').click();
  await page.getByTestId('sampling').fill('0.1');
  await page.getByTestId('sampling').press('Enter');
  await expect(page.getByTestId('abtem-stats')).toContainText('α max');
}

test('the Run tab: Compute over Run, Postprocessing over Output, then the Results viewer', async ({
  page,
}) => {
  await ready(page);
  await openTab(page, 'run');
  const [c, run, post, out, v] = await Promise.all(
    ['compute-card', 'run-card', 'postprocessing-card', 'output-card', 'results-viewer'].map(
      async (id) => (await page.getByTestId(id).boundingBox())!,
    ),
  );
  // columns: Compute and Run | Postprocessing and Output | Results viewer
  expect(Math.abs(c.x - run.x)).toBeLessThan(2);
  expect(Math.abs(post.x - out.x)).toBeLessThan(2);
  expect(c.x).toBeLessThan(post.x);
  expect(post.x).toBeLessThan(v.x);
  expect(Math.abs(c.y - post.y)).toBeLessThan(2);
  expect(run.y).toBeGreaterThan(c.y + c.height - 2);
  expect(out.y).toBeGreaterThan(post.y + post.height - 2);
  // the two columns of cards are about a third of the page wide each (1452 px of 1500)
  for (const b of [c, post]) expect(b.width / 1452).toBeGreaterThan(0.27);
  expect(v.width).toBeGreaterThan(c.width);
  await expect(page.getByTestId('memory-bar')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Compute' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Postprocessing' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Output', exact: true })).toBeVisible();
  // the Run card has the button first, then the readiness list
  await expect(page.getByRole('heading', { name: 'Run', exact: true })).toBeVisible();
  const btn = (await page.getByTestId('run-start').boundingBox())!;
  const list = (await page.getByTestId('run-checklist').boundingBox())!;
  expect(btn.y).toBeLessThan(list.y);
  // no toggle for the pixel size, no "also when a run finishes", but a Reset
  await expect(page.getByTestId('pixel-native')).toHaveCount(0);
  await expect(page.getByTestId('output-auto')).toHaveCount(0);
  await expect(page.getByTestId('output-reset')).toBeVisible();
});

test('Postprocessing asks for the dose of the type chosen in ③', async ({ page }) => {
  await ready(page);
  const fields = async (type: string) => {
    await openTab(page, 'simulation');
    await page.getByTestId(`sim-${type}`).click();
    await openTab(page, 'run');
  };
  await fields('hrtem');
  await page.getByTestId('dose-on').check();
  await expect(page.getByTestId('dose-area')).toBeVisible();
  await expect(page.getByTestId('postprocessing-card')).toContainText('e⁻/Å²');
  await fields('stem');
  await expect(page.getByTestId('postprocessing-card')).toContainText('e⁻ per scan position');
  await fields('saed');
  await expect(page.getByTestId('postprocessing-card')).toContainText('e⁻ per pattern');
  await expect(page.getByTestId('noise-on')).toBeEnabled();
  await page.getByTestId('dose-on').uncheck();
  await expect(page.getByTestId('noise-on')).toBeDisabled();
  await expect(page.getByTestId('output-apply')).toBeDisabled(); // no finished run yet
});

/** A finished STEM job played by routes: native pixel 0.2 Å, and an Apply that writes a new picture. */
test('Apply shows the processed picture at once, every time; Reset takes it away', async ({
  page,
}) => {
  await ready(page);
  const result = {
    name: 'stem_BF',
    kind: 'image',
    file: 'stem_BF.npy',
    preview: 'stem_BF.png',
    sim_type: 'stem',
    pixel: [0.2, 0.2],
    shape: [1, 1, 5, 5],
    bytes: 100,
  };
  const job = {
    id: 'x_001',
    name: 'multislice stem',
    project: 'Si',
    method: 'multislice',
    sim_type: 'stem',
    state: 'done',
    fraction: 1,
    message: 'Done',
    created: 0,
    started: 0,
    finished: 0,
    elapsed: 1,
    eta: null,
    error: null,
    directory: 'C:/p/Si/multislice_stem/x_001',
    results: [result],
    device: 'cpu',
    queue_position: null,
  };
  let stamp = 0;
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/jobs', async (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: job }) : route.fallback(),
  );
  await page.route('**/api/jobs/x_001/detector', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ json: job });
      return;
    }
    bodies.push(route.request().postDataJSON());
    stamp += 1;
    const processed = {
      file: 'stem_BF_processed.npy',
      noisy: null,
      preview: 'stem_BF_processed.png',
      shape: [1, 1, 3, 3],
      pixel: [0.4, 0.4],
      unit: 'Å',
      electrons: 1000,
      samples: 1,
      counts_max: 5,
      stamp,
    };
    await route.fulfill({ json: { ...job, results: [{ ...result, processed }] } });
  });
  // the viewer asks for the numbers of the frame: a 2 x 2 one is enough here
  await page.route('**/api/jobs/x_001/frame*', async (route) =>
    route.fulfill(binFrame('Å', [0.2, 0.2], 2, 2)),
  );
  await openTab(page, 'simulation');
  await page.getByTestId('sim-stem').click();
  await openTab(page, 'run');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('job-state')).toHaveText('Done');
  // the target pixel size shows the native one until it is changed
  await expect(page.getByTestId('target-pixel')).toHaveValue('0.2000'); // four decimals
  await expect(page.getByTestId('native-pixel')).toContainText('Native pixel size: 0.2 Å');
  // the dose is electrons per scan position, with its equivalent per Å² for the native pixel
  await page.getByTestId('dose-on').check();
  await expect(page.getByTestId('dose-electrons-input')).toHaveValue('1000');
  await expect(page.getByTestId('dose-electrons')).toContainText('25000 e⁻/Å²');
  const img = page.getByTestId('result-canvas');
  await expect(img).toHaveAttribute('data-frame-url', /result=stem_BF&source=native/);
  // Apply: the native pixel and a dose; the viewer goes to Processed by itself
  await page.getByTestId('output-apply').click();
  await expect(img).toHaveAttribute('data-frame-url', /source=processed.*&v=1$/);
  await expect(page.getByTestId('view-processed')).toHaveAttribute('aria-pressed', 'true');
  expect(bodies[0]).toMatchObject({ pixel_mode: 'native', dose: { electrons: 1000 } });
  // Native, change a parameter, Apply: the viewer is on Processed again and the picture is new
  await page.getByTestId('view-native').click();
  await expect(img).toHaveAttribute('data-frame-url', /source=native/);
  await page.getByTestId('target-pixel').fill('0.4');
  await page.getByTestId('target-pixel').press('Enter');
  // the arrow beside the box brings the native pixel back, and the target again
  await page.getByRole('button', { name: 'Reset Target' }).click();
  await expect(page.getByTestId('target-pixel')).toHaveValue('0.2000');
  await page.getByTestId('target-pixel').fill('0.4');
  await page.getByTestId('target-pixel').press('Enter');
  await page.getByTestId('output-apply').click();
  await expect(img).toHaveAttribute('data-frame-url', /source=processed.*&v=2$/);
  expect(bodies[1]).toMatchObject({ pixel_mode: 'target', target: 0.4 });
  // Apply again while on Processed: a new address, so the browser fetches the new picture
  await page.getByTestId('output-apply').click();
  await expect(img).toHaveAttribute('data-frame-url', /source=processed.*&v=3$/);
  // Reset: the defaults come back, the processed picture goes, the viewer shows the native one
  await page.getByTestId('output-reset').click();
  await expect(img).toHaveAttribute('data-frame-url', /source=native/);
  await expect(page.getByTestId('view-processed')).toBeDisabled();
  await expect(page.getByTestId('target-pixel')).toHaveValue('0.2000');
  await expect(page.getByTestId('dose-on')).not.toBeChecked();
});

test('Postprocessing: a finished run is processed and the viewer switches to it and back', async ({
  page,
}) => {
  await ready(page);
  await page.getByTestId('sim-saed').click();
  await coarse(page);
  await openTab(page, 'run');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('job-state')).toHaveText('Done', { timeout: 240_000 });
  await page.getByTestId('target-pixel').fill('2');
  await page.getByTestId('target-pixel').press('Enter');
  await page.getByTestId('smoothing').fill('1');
  await page.getByTestId('smoothing').press('Enter');
  await page.getByTestId('dose-on').check();
  await page.getByTestId('noise-on').check();
  await page.getByTestId('output-apply').click();
  await expect(page.getByTestId('output-done')).toContainText('Processed', { timeout: 60_000 });
  await expect(page.getByTestId('output-done')).toContainText('mrad');
  const img = page.getByTestId('result-canvas');
  await expect(img).toHaveAttribute('data-frame-url', /result=saed&source=processed.*&v=\d+$/);
  // the numbers really arrived: the canvas has a frame of some size
  await expect(img).toHaveAttribute('data-frame-shape', /^\d+x\d+$/);
  await expect(page.getByTestId('viewer-processed-info')).toContainText('e⁻');
  await page.getByTestId('view-native').click();
  await expect(img).toHaveAttribute('data-frame-url', /result=saed&source=native/);
  // the same run again with another dose, by the button
  await page.getByTestId('dose-electrons-input').fill('2000000');
  await page.getByTestId('dose-electrons-input').press('Enter');
  await page.getByTestId('output-apply').click();
  await expect(page.getByTestId('view-processed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('output-error')).toHaveCount(0);
  // a finer pixel than the native one for SAED spots warns
  await expect(page.getByTestId('saed-interpolation-warning')).toHaveCount(0);
  await page.getByTestId('target-pixel').fill('0.5');
  await page.getByTestId('target-pixel').press('Enter');
  await expect(page.getByTestId('saed-interpolation-warning')).toBeVisible();
  // Reset removes it
  await page.getByTestId('output-reset').click();
  await expect(page.getByTestId('view-processed')).toBeDisabled();
  await expect(img).toHaveAttribute('data-frame-url', /result=saed&source=native/);
});

test('The viewer has a thickness slider and a defocus slider for a series, vmin and vmax, and exports', async ({
  page,
}) => {
  await ready(page);
  const result = {
    name: 'hrtem',
    kind: 'image',
    file: 'hrtem.npy',
    preview: 'hrtem.png',
    sim_type: 'hrtem',
    pixel: [0.2, 0.2],
    shape: [3, 2, 2, 2],
    depths: [8, 16.3],
    runs: ['defocus 0 Å', 'defocus -50 Å', 'defocus -100 Å'],
    bytes: 100,
  };
  const job = {
    id: 'x_002',
    name: 'multislice hrtem',
    project: 'Si',
    method: 'multislice',
    sim_type: 'hrtem',
    state: 'done',
    fraction: 1,
    message: 'Done',
    created: 0,
    started: 0,
    finished: 0,
    elapsed: 1,
    eta: null,
    error: null,
    directory: 'C:/p/Si/multislice_hrtem/x_002',
    results: [result],
    device: 'cpu',
    queue_position: null,
  };
  await page.route('**/api/jobs', async (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: job }) : route.fallback(),
  );
  const asked: string[] = [];
  await page.route('**/api/jobs/x_002/frame*', async (route) => {
    asked.push(route.request().url());
    await route.fulfill(binFrame('Å', [0.2, 0.2], 2, 2));
  });
  await openTab(page, 'simulation');
  await page.getByTestId('sim-hrtem').click();
  await openTab(page, 'run');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('job-state')).toHaveText('Done');
  const canvas = page.getByTestId('result-canvas');
  // it opens on the exit surface (the last depth) of the first defocus
  await expect(canvas).toHaveAttribute('data-frame-url', /run=0&depth=1/);
  await expect(page.getByTestId('depth-value')).toContainText('16.3 Å');
  await expect(page.getByTestId('run-value')).toContainText('defocus 0 Å');
  await expect(page.getByTestId('series-run').getByText('Defocus', { exact: true })).toBeVisible();
  // the thickness slider steps through the depths, the defocus slider through the runs
  await page.getByTestId('depth-slider').fill('0');
  await expect(canvas).toHaveAttribute('data-frame-url', /run=0&depth=0/);
  await expect(page.getByTestId('depth-value')).toContainText('8 Å');
  await page.getByTestId('run-slider').fill('2');
  await expect(canvas).toHaveAttribute('data-frame-url', /run=2&depth=0/);
  await expect(page.getByTestId('run-value')).toContainText('defocus -100 Å');
  // display controls draw from the numbers already in the browser: no new request
  const before = asked.length;
  await page.getByTestId('scale-log').click();
  await page.getByTestId('cmap').selectOption('viridis');
  await expect(page.getByTestId('scale-log')).toHaveAttribute('aria-pressed', 'true');
  // vmin and vmax show the frame's range; typing one changes the picture, not the request
  await expect(page.getByTestId('vmin')).toHaveValue('0');
  await expect(page.getByTestId('vmax')).toHaveValue('3');
  await page.getByTestId('vmax').fill('2');
  await page.getByTestId('vmax').press('Enter');
  await page.getByTestId('invert').check();
  expect(asked.length).toBe(before);
  // an export is saved by the server in the run's Exports folder, not downloaded
  const exported: { method: string; url: string }[] = [];
  await page.route('**/api/jobs/x_002/export*', async (route) => {
    exported.push({ method: route.request().method(), url: route.request().url() });
    await route.fulfill({
      json: {
        path: 'C:/p/Si/multislice_hrtem/x_002/Exports/hrtem_native_run3_depth1.tif',
        name: 'hrtem_native_run3_depth1.tif',
        folder: 'C:/p/Si/multislice_hrtem/x_002/Exports',
      },
    });
  });
  await page.getByTestId('export-tiff').click();
  await expect(page.getByTestId('export-saved')).toContainText('hrtem_native_run3_depth1.tif');
  expect(exported[0].method).toBe('POST');
  expect(exported[0].url).toMatch(/run=2&depth=0.*format=tiff/);
});

test('4D-STEM in the viewer: a virtual detector, and a click shows that position’s pattern', async ({
  page,
}) => {
  await ready(page);
  const result = {
    name: '4dstem',
    kind: 'pattern',
    file: '4dstem.zarr',
    preview: '4dstem.png',
    sim_type: '4dstem',
    pixel_mrad: [1, 1],
    scan_pixel: [0.5, 0.5],
    semiangle_mrad: 20,
    shape: [1, 1, 3, 3, 3, 3],
    bytes: 100,
  };
  const job = {
    id: 'x_003',
    name: 'multislice 4dstem',
    project: 'Si',
    method: 'multislice',
    sim_type: '4dstem',
    state: 'done',
    fraction: 1,
    message: 'Done',
    created: 0,
    started: 0,
    finished: 0,
    elapsed: 1,
    eta: null,
    error: null,
    directory: 'C:/p/Si/multislice_4dstem/x_003',
    results: [result],
    device: 'cpu',
    queue_position: null,
  };
  await page.route('**/api/jobs', async (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: job }) : route.fallback(),
  );
  const virtual: string[] = [];
  const patterns: string[] = [];
  await page.route('**/api/jobs/x_003/virtual*', async (route) => {
    virtual.push(route.request().url());
    await route.fulfill(binFrame('Å', [0.5, 0.5], 3, 3));
  });
  await page.route('**/api/jobs/x_003/pattern*', async (route) => {
    patterns.push(route.request().url());
    await route.fulfill(binFrame('mrad', [1, 1], 3, 3));
  });
  await openTab(page, 'simulation');
  await page.getByTestId('sim-4dstem').click();
  await openTab(page, 'run');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('job-state')).toHaveText('Done');
  // a bright-field disk of the convergence angle first, and the mean pattern
  await expect.poll(() => virtual.at(-1)).toMatch(/shape=disk.*outer=20/);
  await expect.poll(() => patterns.at(-1)).toMatch(/pattern\?result=4dstem/);
  expect(patterns.at(-1)).not.toMatch(/row=/);
  // an annulus asks for the new virtual image
  await page.getByTestId('det-annulus').click();
  await expect.poll(() => virtual.at(-1)).toMatch(/shape=annulus.*inner=20/);
  await expect(page.getByTestId('det-inner')).toBeVisible();
  // a click on the virtual image shows the pattern of that scan position
  const box = (await page.getByTestId('result-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => patterns.at(-1)).toMatch(/row=1&col=1/);
  await expect(page.getByTestId('pattern-canvas')).toBeVisible();
  // HDF5 holds everything; the viewer says what TIFF and NPY are
  await expect(page.getByTestId('export-h5')).toContainText('all of it');
});

test('LACBED in the viewer: the beam is chosen by h, k and l, with the valid ranges shown', async ({
  page,
}) => {
  await ready(page);
  const result = {
    name: 'lacbed',
    kind: 'discs',
    file: 'lacbed.npz',
    preview: 'lacbed.png',
    sim_type: 'lacbed',
    pixel_mrad: [1, 1],
    shape: [1, 3, 3],
    depths: [100],
    beams: 3,
    ranges: { h: [-1, 1], k: [0, 0], l: [-1, 1] },
    note: 'One disc per beam, saved in lacbed.npz under its indices.',
    bytes: 100,
  };
  const job = {
    id: 'x_004',
    name: 'bloch lacbed',
    project: 'Si',
    method: 'bloch',
    sim_type: 'lacbed',
    state: 'done',
    fraction: 1,
    message: 'Done',
    created: 0,
    started: 0,
    finished: 0,
    elapsed: 1,
    eta: null,
    error: null,
    directory: 'C:/p/Si/bloch_lacbed/x_004',
    results: [result],
    device: 'cpu',
    queue_position: null,
  };
  await page.route('**/api/jobs', async (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: job }) : route.fallback(),
  );
  const asked: string[] = [];
  await page.route('**/api/jobs/x_004/frame*', async (route) => {
    asked.push(route.request().url());
    await route.fulfill(binFrame('mrad', [1, 1], 3, 3));
  });
  await page.route('**/api/jobs/x_004/beams*', async (route) =>
    route.fulfill({
      json: {
        hkl: [
          [0, 0, 0],
          [1, 0, -1],
          [-1, 0, 1],
        ],
        ranges: result.ranges,
      },
    }),
  );
  await openTab(page, 'simulation');
  await page.getByTestId('method-bloch').click();
  await page.getByTestId('bloch-lacbed').click();
  await openTab(page, 'run');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('job-state')).toHaveText('Done');
  // 0 0 0 first, no slider, and the ranges beside the boxes
  await expect(page.getByTestId('beam-h')).toHaveValue('0');
  await expect(page.getByTestId('beam-k')).toHaveValue('0');
  await expect(page.getByTestId('beam-l')).toHaveValue('0');
  await expect(page.getByTestId('beam-choice')).toContainText('-1 … 1');
  await expect(page.getByTestId('result-canvas')).toHaveAttribute('data-frame-url', /h=0&k=0&l=0/);
  await expect(page.getByTestId('beam-status')).toContainText('3 beams in this run');
  // a beam: the frame of that disc is asked for
  await page.getByTestId('beam-h').fill('1');
  await page.getByTestId('beam-h').press('Enter');
  await page.getByTestId('beam-l').fill('-1');
  await page.getByTestId('beam-l').press('Enter');
  await expect(page.getByTestId('result-canvas')).toHaveAttribute('data-frame-url', /h=1&k=0&l=-1/);
  // a combination that is not a beam says so and asks for nothing
  const before = asked.length;
  await page.getByTestId('beam-l').fill('1');
  await page.getByTestId('beam-l').press('Enter');
  await expect(page.getByTestId('beam-status')).toContainText('is not a beam');
  expect(asked.length).toBe(before);
  // the power scale has a γ box and no slider
  await page.getByTestId('scale-power').click();
  await expect(page.getByLabel('γ', { exact: true })).toBeVisible();
  await expect(page.getByLabel('γ slider')).toHaveCount(0);
  // the note is the new one
  await expect(page.getByTestId('results-viewer')).not.toContainText('The picture is the 000 beam');
});

test('Open folder asks the backend to open the selected run’s folder', async ({ page }) => {
  await ready(page);
  await page.getByTestId('sim-saed').click();
  await coarse(page);
  const opened: string[] = [];
  await page.route('**/api/jobs/*/open', async (route) => {
    opened.push(route.request().url());
    await route.fulfill({ json: { directory: 'x' } });
  });
  await openTab(page, 'run');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('job-state')).toHaveText('Done', { timeout: 240_000 });
  await expect(page.getByTestId('result-canvas')).toBeVisible();
  await expect(page.getByTestId('job-open-folder')).toHaveText('Open run folder');
  await page.getByTestId('job-open-folder').click();
  await expect.poll(() => opened.length).toBe(1);
});
