import type { Ticket } from '../domain/summary.js';
export const demoTicket: Ticket = {
  id: 'T-1042',
  subject: 'Delayed shipment for order #8841',
  version: 1,
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
