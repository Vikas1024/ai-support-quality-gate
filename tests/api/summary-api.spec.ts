import { test, expect } from '@playwright/test';

const validRequest = {
  ticketId: 'T-1042',
  messageIds: ['m1', 'm2', 'm3'],
};

async function attachApiDiagnostics(
  testInfo: import('@playwright/test').TestInfo,
  details: Record<string, unknown>,
): Promise<void> {
  await testInfo.attach('api-request-response-diagnostics.json', {
    body: Buffer.from(JSON.stringify(details, null, 2)),
    contentType: 'application/json',
  });
}

test('summary service returns a successful response with summary and source identifiers', async ({
  request,
}, testInfo) => {
  const startedAt = Date.now();
  const response = await request.post('/api/tickets/T-1042/summary', { data: validRequest });
  const durationMs = Date.now() - startedAt;
  const body = await response.json();
  const expected = {
    statusCode: 200,
    body: { status: 'ok', summary: 'non-empty string', sourceIdsInclude: ['m1'] },
  };

  await attachApiDiagnostics(testInfo, {
    category: 'api',
    method: 'POST',
    url: '/api/tickets/T-1042/summary',
    request: validRequest,
    response: { statusCode: response.status(), body },
    expected,
    durationMs,
    comparison: {
      statusCode: {
        expected: expected.statusCode,
        actual: response.status(),
        matches: response.status() === expected.statusCode,
      },
      bodyStatus: {
        expected: expected.body.status,
        actual: body.status,
        matches: body.status === expected.body.status,
      },
      summaryIsNonEmptyString: {
        expected: true,
        actual: typeof body.summary === 'string' && body.summary.trim().length > 0,
      },
      sourceIdsIncludeM1: {
        expected: ['m1'],
        actual: body.sourceIds,
        matches: Array.isArray(body.sourceIds) && body.sourceIds.includes('m1'),
      },
    },
  });

  expect(response.status()).toBe(200);
  expect(body).toMatchObject({ status: 'ok' });
  expect(typeof body.summary).toBe('string');
  expect(body.summary.trim().length).toBeGreaterThan(0);
  expect(body.sourceIds).toEqual(expect.arrayContaining(['m1']));
  expect(Array.isArray(body.sourceIds)).toBe(true);
});

test('summary service rejects an unknown ticket without returning a summary', async ({
  request,
}, testInfo) => {
  const requestBody = { ticketId: 'T-UNKNOWN', messageIds: ['x1'] };
  const startedAt = Date.now();
  const response = await request.post('/api/tickets/T-UNKNOWN/summary', { data: requestBody });
  const durationMs = Date.now() - startedAt;
  const body = await response.json();
  const expected = { statusCode: 404, body: { error: 'ticket_not_found' } };

  await attachApiDiagnostics(testInfo, {
    category: 'api',
    method: 'POST',
    url: '/api/tickets/T-UNKNOWN/summary',
    request: requestBody,
    response: { statusCode: response.status(), body },
    expected,
    durationMs,
    comparison: {
      statusCode: {
        expected: expected.statusCode,
        actual: response.status(),
        matches: response.status() === expected.statusCode,
      },
      body: {
        expected: expected.body,
        actual: body,
        matches: JSON.stringify(expected.body) === JSON.stringify(body),
      },
    },
  });

  expect(response.status()).toBe(404);
  expect(body).toEqual({ error: 'ticket_not_found' });
});

test('summary endpoint rejects route and body ticket identity mismatch', async ({ request }) => {
  const response = await request.post('/api/tickets/T-UNKNOWN/summary', { data: validRequest });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: 'ticket_id_mismatch' });
});

test('summary endpoint rejects message IDs outside the requested ticket', async ({ request }) => {
  const response = await request.post('/api/tickets/T-1042/summary', {
    data: { ticketId: 'T-1042', messageIds: ['m1', 'foreign-message'] },
  });
  expect(response.status()).toBe(422);
  await expect(response.json()).resolves.toEqual({ error: 'message_not_in_current_ticket' });
});

test('summary endpoint rejects empty message selection', async ({ request }) => {
  const response = await request.post('/api/tickets/T-1042/summary', {
    data: { ticketId: 'T-1042', messageIds: [] },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: 'invalid_message_ids' });
});

test('approval endpoint rejects missing or cross-ticket citations server-side', async ({
  request,
}) => {
  const response = await request.post('/api/tickets/T-1042/summary/approve', {
    data: {
      ticketId: 'T-1042',
      summary: 'Order is delayed.',
      sourceIds: ['m1', 'foreign-message'],
      ticketVersion: 1,
    },
  });
  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(body.error).toBe('summary_not_approvable');
  expect(body.reasons).toContain('citation_not_in_current_ticket');
});

test('approval endpoint records a valid approval and rejects stale ticket versions', async ({
  request,
}) => {
  const stale = await request.post('/api/tickets/T-1042/summary/approve', {
    data: { ticketId: 'T-1042', summary: 'Order is delayed.', sourceIds: ['m1'], ticketVersion: 0 },
  });
  expect(stale.status()).toBe(409);
  await expect(stale.json()).resolves.toEqual({ error: 'ticket_version_conflict' });

  const accepted = await request.post('/api/tickets/T-1042/summary/approve', {
    data: { ticketId: 'T-1042', summary: 'Order is delayed.', sourceIds: ['m1'], ticketVersion: 1 },
  });
  expect(accepted.status()).toBe(201);
  const body = await accepted.json();
  expect(body).toMatchObject({
    status: 'approved',
    ticketId: 'T-1042',
    summary: 'Order is delayed.',
    sourceIds: ['m1'],
    ticketVersion: 1,
  });
  expect(typeof body.approvedAt).toBe('string');
});
