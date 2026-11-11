import { defineConfig, devices } from '@playwright/test';

// Serves the production build (`vite preview`, which proxies /api) and the real backend, so the
// e2e tests exercise the actual bundle against the actual simulators. Run from an activated
// `em-sim` environment (uvicorn and node must be on PATH).
export default defineConfig({
  testDir: './tests/e2e',
  // Software WebGL in headless Chromium is slow when several workers draw at once.
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // The copied m6 spec asserts a 16 ms colour-change time; with many browsers and the backend
  // competing for the CPU it fails (it passed 48/48 with 2 workers, flaked with 7).
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4273', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'uvicorn emsim.main:app --app-dir ../backend --port 8765',
      url: 'http://127.0.0.1:8765/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npm run preview -- --port 4273 --strictPort',
      url: 'http://localhost:4273',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
