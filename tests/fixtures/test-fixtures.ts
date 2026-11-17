import { test as base, expect, type Page, type Route } from '@playwright/test';

export interface MockResponse {
  status: number;
  body: unknown;
}

export interface DashboardFixture {
  page: Page;
  enqueueResponse: (response: MockResponse) => void;
  requestCount: () => number;
}

interface BrowserDiagnostics {
  console: string[];
  pageErrors: string[];
  failedRequests: string[];
  badResponses: string[];
}

export const test = base.extend<{ dashboard: DashboardFixture }>({
  dashboard: async ({ page }, use, testInfo) => {
    const queue: MockResponse[] = [];
    let requests = 0;
    const diagnostics: BrowserDiagnostics = {
      console: [],
      pageErrors: [],
      failedRequests: [],
      badResponses: [],
    };

    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.console.push(message.text());
    });
    page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      diagnostics.failedRequests.push(
        `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'request failed'}`,
      );
    });
    page.on('response', (response) => {
      if (response.status() >= 400)
        diagnostics.badResponses.push(
          `${response.status()} ${response.request().method()} ${response.url()}`,
        );
    });

    await page.route('**/api/tickets/*/summary', async (route: Route) => {
      requests += 1;
      const response = queue.shift() ?? {
        status: 200,
        body: {
          status: 'ok',
          summary: 'Order #8841 is delayed in transit.',
          sourceIds: ['m1', 'm2'],
          ticketVersion: 1,
        },
      };
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
      });
    });

    await page.goto('/');
    await use({
      page,
      enqueueResponse: (response) => queue.push(response),
      requestCount: () => requests,
    });

    await testInfo.attach('ui-browser-diagnostics.json', {
      body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
      contentType: 'application/json',
    });

    if (testInfo.status !== testInfo.expectedStatus) {
      try {
        await testInfo.attach('ui-failure-screenshot.png', {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      } catch {
        // The browser may already be closed after a launch or navigation failure.
      }
    }
  },
});

export { expect };
