import { test, expect } from '../fixtures/test-fixtures.js';
test('successful generation displays summary and enables approval for current-ticket citations', async ({
  dashboard,
}) => {
  const { page } = dashboard;
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await expect(page.locator('#summary-text')).toContainText('delayed in transit');
  await expect(page.getByRole('button', { name: 'Approve summary' })).toBeEnabled();
  await expect(page.locator('#status-message')).toContainText('2 citation(s) validated');
  await page.getByRole('button', { name: 'Approve summary' }).click();
  await expect(page.locator('#status-message')).toContainText('Summary approved and recorded');
});
test('insufficient information is visible and approval remains disabled', async ({ dashboard }) => {
  dashboard.enqueueResponse({ status: 200, body: { status: 'insufficient_information' } });
  const { page } = dashboard;
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await expect(page.locator('#summary-panel')).toHaveAttribute('data-state', 'insufficient');
  await expect(page.locator('#summary-text')).toContainText('not enough information');
  await expect(page.getByRole('button', { name: 'Approve summary' })).toBeDisabled();
});
test('503 shows retry and a valid retry recovers approval eligibility', async ({ dashboard }) => {
  dashboard.enqueueResponse({ status: 503, body: { error: 'unavailable' } });
  dashboard.enqueueResponse({
    status: 200,
    body: {
      status: 'ok',
      summary: 'Carrier delay confirmed; support is investigating.',
      sourceIds: ['m1', 'm2'],
      ticketVersion: 1,
    },
  });
  const { page } = dashboard;
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await expect(page.locator('#summary-panel')).toHaveAttribute('data-state', 'error');
  await expect(page.getByRole('button', { name: 'Retry generation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve summary' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry generation' }).click();
  await expect(page.locator('#summary-text')).toContainText('Carrier delay confirmed');
  await expect(page.getByRole('button', { name: 'Approve summary' })).toBeEnabled();
  expect(dashboard.requestCount()).toBe(2);
});
test('summary with missing citations cannot be approved', async ({ dashboard }) => {
  dashboard.enqueueResponse({
    status: 200,
    body: { status: 'ok', summary: 'The order is delayed.', sourceIds: [] },
  });
  const { page } = dashboard;
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await expect(page.locator('#status-message')).toContainText('citations_missing');
  await expect(page.getByRole('button', { name: 'Approve summary' })).toBeDisabled();
});
test('summary with a cross-ticket citation cannot be approved', async ({ dashboard }) => {
  dashboard.enqueueResponse({
    status: 200,
    body: { status: 'ok', summary: 'The order is delayed.', sourceIds: ['m1', 'x1'] },
  });
  const { page } = dashboard;
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await expect(page.locator('#status-message')).toContainText('citation_not_in_current_ticket');
  await expect(page.getByRole('button', { name: 'Approve summary' })).toBeDisabled();
});

test('malformed HTTP 200 payload is rejected and approval remains disabled', async ({
  dashboard,
}) => {
  dashboard.enqueueResponse({
    status: 200,
    body: { status: 'ok', summary: 42, sourceIds: ['m1'] },
  });
  const { page } = dashboard;
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await expect(page.locator('#summary-panel')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status-message')).toContainText('invalid response');
  await expect(page.getByRole('button', { name: 'Approve summary' })).toBeDisabled();
});
