import { test, expect } from '@playwright/test';

// Only this scenario retries once to demonstrate a genuine flaky-test classification.
test.describe.configure({ retries: 1 });

test(
  'DEMO · evaluator intermittently fails then recovers (flaky)',
  {
    annotation: [
      { type: 'priority', description: 'low' },
      { type: 'failure-type', description: 'test-harness' },
      { type: 'tag', description: 'demo' },
    ],
  },
  async ({}, testInfo) => {
    test.skip(
      process.env.REPORT_DEMO !== '1',
      'Run npm run test:demo to include controlled reporting demonstrations.',
    );
    // Attempt 0 fails. The configured demo retry (attempt 1) passes.
    expect(
      testInfo.retry,
      'Intentional first-attempt failure to demonstrate flaky detection',
    ).toBeGreaterThan(0);
  },
);
