import { defineConfig, devices } from '@playwright/test';

const PORT = 8173;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: [['list']],
  projects: [
    { name: 'unit', testDir: './tests/unit' },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}` },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: PORT,
    reuseExistingServer: true,
    stdout: 'ignore',
  },
});
