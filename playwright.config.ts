import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const outputDir = process.env.TEST_OUTPUT_DIR ?? path.resolve('reports', 'temporary-test-output');
const reporterPath = path.resolve('scripts', 'single-html-reporter.ts');
const browserChannel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './tests',
  testIgnore: process.env.REPORT_DEMO === '1' ? [] : '**/*.demo.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  timeout: process.env.REPORT_DEMO === '1' ? 60_000 : 30_000,
  retries: process.env.REPORT_DEMO === '1' ? 0 : process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter:
    process.env.REPORT_DISABLED === '1'
      ? [['list']]
      : [
          ['list'],
          [
            reporterPath,
            {
              outputFile:
                process.env.REPORT_FILE ?? path.resolve('reports', 'COMBINED_TESTREPORT.html'),
            },
          ],
        ],
  outputDir,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(process.env.CHROME_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.CHROME_EXECUTABLE } }
      : { channel: browserChannel }),
  },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
