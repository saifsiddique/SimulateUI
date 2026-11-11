import { defineConfig, devices } from '@playwright/test';

// Runs tests/live against a server that is ALREADY running (what `run.ps1` starts):
//   EMSIM_URL=http://localhost:8765 npx playwright test -c playwright.live.config.ts
export default defineConfig({
  testDir: './tests/live',
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: { baseURL: process.env.EMSIM_URL ?? 'http://localhost:8765' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
