import { test, expect } from '../fixtures/test-fixtures.js';

test(
  'DEMO · injected UI regression: approval control becomes enabled for invalid citations',
  {
    annotation: [
      { type: 'priority', description: 'critical' },
      { type: 'failure-type', description: 'test-harness-fault-injection' },
      { type: 'tag', description: 'demo' },
    ],
  },
  async ({ dashboard }) => {
    test.skip(
      process.env.REPORT_DEMO !== '1',
      'Run npm run test:demo to include controlled reporting demonstrations.',
    );
    test.fail(true, 'Controlled fault injection: the test deliberately re-enables approval.');

    dashboard.enqueueResponse({
      status: 200,
      body: {
        status: 'ok',
        summary: 'The order is delayed.',
        sourceIds: ['m1', 'x1'],
      },
    });

    const { page } = dashboard;
    await page.getByRole('button', { name: 'Generate summary' }).click();
    const approve = page.getByRole('button', { name: 'Approve summary' });
    await expect(approve, 'Cross-ticket citations must block approval').toBeDisabled();

    // Inject a frontend state regression after the real guard has correctly blocked approval.
    await approve.evaluate((element: HTMLButtonElement) => {
      element.disabled = false;
      element.removeAttribute('aria-disabled');
    });
    await expect(
      approve,
      'Injected regression: approval is now enabled despite invalid citations',
    ).toBeDisabled();
  },
);
