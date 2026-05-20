import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  webServer: {
    command: 'npx http-server . -p 8000 --silent -c-1',
    port: 8000,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  use: {
    baseURL: 'http://localhost:8000',
  },
  reporter: process.env.CI ? 'github' : 'list',
});
