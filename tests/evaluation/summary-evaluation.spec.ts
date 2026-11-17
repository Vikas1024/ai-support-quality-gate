import { test, expect } from '@playwright/test';
import { evaluateSummary } from '../../public/dist/evaluation/evaluator.js';
import { evaluationCases } from '../../public/dist/evaluation/examples.js';

for (const example of evaluationCases) {
  test(`deterministic evaluation: ${example.id}`, async ({}, testInfo) => {
    const result = evaluateSummary(example);
    if (
      process.env.REGRESSION === 'accept-cross-ticket-citations' &&
      example.id === 'cross-ticket-citation'
    ) {
      result.reasons = result.reasons.filter(
        (reason) => reason !== 'citation_not_in_current_ticket',
      );
      result.acceptable = result.reasons.length === 0;
      result.passed = result.acceptable === example.expectedAcceptable;
    }

    await testInfo.attach('evaluation-diagnostics.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            category: 'evaluation',
            caseId: example.id,
            description: example.description,
            input: {
              ticketId: example.ticket.id,
              ticketMessages: example.ticket.messages,
              generatedSummary: example.output.summary ?? null,
              sourceIds: example.output.sourceIds ?? [],
            },
            expectedAcceptable: example.expectedAcceptable,
            actualAcceptable: result.acceptable,
            score: result.score,
            checks: result.checks,
            reasons: result.reasons,
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });

    expect(result.passed, `${example.description}; reasons=${result.reasons.join(',')}`).toBe(true);
    expect(result.acceptable).toBe(example.expectedAcceptable);
  });
}
