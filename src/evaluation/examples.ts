import type { EvaluationCase } from './evaluator.js';
const ticket = {
  id: 'T-1042',
  version: 1,
  subject: 'Delayed shipment for order #8841',
  messages: [
    { id: 'm1', author: 'Customer', text: 'My order #8841 has not arrived yet.' },
    {
      id: 'm2',
      author: 'Support',
      text: 'The carrier reported a transit delay. We are investigating.',
    },
    { id: 'm3', author: 'Customer', text: 'Please let me know when there is an update.' },
  ],
};
export const evaluationCases: EvaluationCase[] = [
  {
    id: 'valid-grounded-summary',
    description: 'Grounded summary cites current-ticket messages',
    ticket,
    output: {
      status: 'ok',
      summary:
        'Order #8841 is delayed in transit. Support is investigating and will provide an update.',
      sourceIds: ['m1', 'm2', 'm3'],
    },
    expectedAcceptable: true,
    requiredTerms: ['delayed', 'investigating'],
  },
  {
    id: 'cross-ticket-citation',
    description: 'Citation belongs to a different ticket',
    ticket,
    output: { status: 'ok', summary: 'The order is delayed.', sourceIds: ['m1', 'x1'] },
    expectedAcceptable: false,
  },
  {
    id: 'missing-citation',
    description: 'Summary has no source attribution',
    ticket,
    output: { status: 'ok', summary: 'The order is delayed.', sourceIds: [] },
    expectedAcceptable: false,
  },
  {
    id: 'unsupported-delivery-claim',
    description: 'Valid citation does not support a fabricated delivery claim',
    ticket,
    output: {
      status: 'ok',
      summary: 'Order #8841 was delivered yesterday.',
      sourceIds: ['m1', 'm2'],
    },
    expectedAcceptable: false,
    unsupportedTerms: ['delivered'],
  },
  {
    id: 'duplicate-citations',
    description: 'Duplicate source IDs should be rejected',
    ticket,
    output: { status: 'ok', summary: 'Order #8841 is delayed.', sourceIds: ['m1', 'm1'] },
    expectedAcceptable: false,
  },
  {
    id: 'missing-key-fact',
    description: 'A required key fact is absent from the summary',
    ticket,
    output: { status: 'ok', summary: 'Support is investigating.', sourceIds: ['m1', 'm2'] },
    expectedAcceptable: false,
    requiredTerms: ['delayed'],
  },
  {
    id: 'insufficient-information',
    description: 'Insufficient information must not be presented as an approved summary',
    ticket,
    output: { status: 'insufficient_information' },
    expectedAcceptable: false,
  },
];
