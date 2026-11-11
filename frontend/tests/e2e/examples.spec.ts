import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { EXAMPLES, type Example } from '../../src/core/examples';
import { buildSpecimen, openTab, zone } from './helpers';

// M8: the example setups. With MAKE_EXAMPLES=1 the first test makes them with the app itself, from
// the CIFs in ../examples/cifs (open, zone axis, build, choose the method and type, Save setup), so
// they always have the current setup format. The other tests open every shipped example from the
// Examples menu and check that it comes back ready to run.
test.use({ viewport: { width: 1500, height: 1100 } });
test.setTimeout(180_000);

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

/** The summary bar of the method and the text that says its preview has arrived. */
function stats(ex: Example): { id: string; text: RegExp } {
  if (ex.method === 'bloch') return { id: 'bloch-stats', text: /Beams/ };
  if (ex.method === 'incostem') return { id: 'incostem-stats', text: /PSF FWHM/ };
  return { id: 'abtem-stats', text: /α max/ };
}

async function chooseMethod(page: Page, ex: Example) {
  await page.getByTestId(`method-${ex.method}`).click();
  if (ex.method === 'bloch') await page.getByTestId(`bloch-${ex.type}`).click();
  if (ex.method === 'multislice') await page.getByTestId(`sim-${ex.type}`).click();
}

test('make the example setups', async ({ page }) => {
  test.skip(!process.env.MAKE_EXAMPLES, 'set MAKE_EXAMPLES=1 to write public/examples/');
  test.setTimeout(900_000);
  for (const ex of EXAMPLES) {
    await page.goto('/');
    await page.getByTestId('cif-input').setInputFiles(root(`../examples/cifs/${ex.cif}.cif`));
    await expect(page.getByTestId('hud')).toContainText('atoms');
    await zone(page, ex.zone);
    await buildSpecimen(page);
    await openTab(page, 'simulation');
    await chooseMethod(page, ex);
    const s = stats(ex);
    await expect(page.getByTestId(s.id)).toContainText(s.text, { timeout: 60_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('setup-save').click(),
    ]);
    await download.saveAs(root(`public/examples/${ex.file}`));
  }
});

for (const ex of EXAMPLES) {
  test(`example ${ex.title} opens ready to run`, async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('examples').selectOption(ex.file);
    await expect(page.getByTestId('cif-card')).toHaveCount(1);
    // it opens on ③ with the specimen built again and the method's preview in place
    await expect(page.getByTestId('tab-simulation')).toHaveAttribute('aria-selected', 'true', {
      timeout: 60_000,
    });
    const s = stats(ex);
    await expect(page.getByTestId(s.id)).toContainText(s.text, { timeout: 90_000 });
    await expect(page.getByTestId('tab-specimen')).toHaveAttribute('data-state', /done|warn/);
    // ④ lists it as ready (warnings may be listed; nothing fails)
    await openTab(page, 'run');
    await expect(page.getByTestId('run-verdict')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('run-start')).toBeEnabled();
  });
}
