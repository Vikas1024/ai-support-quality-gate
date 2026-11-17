import { test, expect } from '@playwright/test';

const demoOnly = process.env.REPORT_DEMO === '1';

test(
  'DEMO · API contract returns an incorrect status (real defect)',
  {
    annotation: [
      { type: 'priority', description: 'high' },
      { type: 'failure-type', description: 'real-defect' },
      { type: 'tag', description: 'demo' },
    ],
  },
  async ({}, testInfo) => {
    test.skip(!demoOnly, 'Run npm run test:demo to include controlled reporting demonstrations.');
    test.fail(true, 'Controlled fault injection: this assertion is expected to fail.');
    const expected = { statusCode: 200, body: { status: 'ok' } };
    const actual = { statusCode: 500, body: { error: 'internal_server_error' } };
    await testInfo.attach('api-request-response-diagnostics.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            category: 'api',
            method: 'POST',
            url: '/api/demo/summary',
            request: { ticketId: 'T-DEMO-500' },
            expected,
            response: actual,
            comparison: {
              statusCode: {
                expected: expected.statusCode,
                actual: actual.statusCode,
                matches: false,
              },
              body: { expected: expected.body, actual: actual.body, matches: false },
            },
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
    expect(actual.statusCode, 'The API returned HTTP 500 instead of HTTP 200').toBe(
      expected.statusCode,
    );
  },
);

test(
  'DEMO · required fixture record is missing (test data issue)',
  {
    annotation: [
      { type: 'priority', description: 'medium' },
      { type: 'failure-type', description: 'test-data' },
      { type: 'tag', description: 'demo' },
    ],
  },
  async () => {
    test.skip(!demoOnly, 'Run npm run test:demo to include controlled reporting demonstrations.');
    test.fail(true, 'Controlled fault injection: this assertion is expected to fail.');
    const seededRecord: { id: string } | undefined = undefined;
    expect(seededRecord, 'Seed data record T-DEMO-404 was not created').toBeDefined();
  },
);

test(
  'DEMO · upstream connection is refused (network issue)',
  {
    annotation: [
      { type: 'priority', description: 'high' },
      { type: 'failure-type', description: 'network' },
      { type: 'tag', description: 'demo' },
    ],
  },
  async () => {
    test.skip(!demoOnly, 'Run npm run test:demo to include controlled reporting demonstrations.');
    test.fail(true, 'Controlled fault injection: this assertion is expected to fail.');
    throw new Error('ECONNREFUSED: demo upstream service connection refused');
  },
);

test(
  'DEMO · response exceeds the configured deadline (timeout)',
  {
    annotation: [
      { type: 'priority', description: 'medium' },
      { type: 'failure-type', description: 'timeout' },
      { type: 'tag', description: 'demo' },
    ],
  },
  async () => {
    test.skip(!demoOnly, 'Run npm run test:demo to include controlled reporting demonstrations.');
    test.fail(true, 'Controlled fault injection: this assertion is expected to fail.');
    await expect.poll(() => 'pending', { timeout: 150, intervals: [25] }).toBe('completed');
  },
);
