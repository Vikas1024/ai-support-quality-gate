import {
  isSummaryResponse,
  validateSummary,
  type SummaryResponse,
  type Ticket,
} from '../domain/summary.js';
import { demoTicket } from '../fixtures/tickets.js';
const ticket: Ticket = demoTicket;
function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Dashboard element not found: ${selector}`);
  return element;
}
const summaryPanel = requiredElement<HTMLElement>('#summary-panel');
const summaryText = requiredElement<HTMLElement>('#summary-text');
const status = requiredElement<HTMLElement>('#status-message');
const generateButton = requiredElement<HTMLButtonElement>('#generate-button');
const approveButton = requiredElement<HTMLButtonElement>('#approve-button');
const retryButton = requiredElement<HTMLButtonElement>('#retry-button');
let currentSummary: SummaryResponse | null = null;
let currentTicketVersion: number | null = null;
let isGenerating = false;
let requestSequence = 0;
function setState(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  status.textContent = message;
  status.dataset.state = kind;
}
function setApprovalEligibility(eligible: boolean): void {
  approveButton.disabled = !eligible;
  approveButton.setAttribute('aria-disabled', String(!eligible));
}
function clearSummary(): void {
  currentSummary = null;
  currentTicketVersion = null;
  summaryText.textContent = 'No summary generated yet.';
  summaryPanel.dataset.state = 'empty';
  setApprovalEligibility(false);
}
async function generateSummary(): Promise<void> {
  if (isGenerating) return;
  isGenerating = true;
  const sequence = ++requestSequence;
  generateButton.disabled = true;
  retryButton.hidden = true;
  setApprovalEligibility(false);
  setState('Generating summary…');
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(ticket.id)}/summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticketId: ticket.id, messageIds: ticket.messages.map((m) => m.id) }),
    });
    if (sequence !== requestSequence) return;
    if (!response.ok) {
      clearSummary();
      summaryPanel.dataset.state = 'error';
      setState(`Summary generation failed (${response.status}). Retry is available.`, 'error');
      retryButton.hidden = false;
      return;
    }
    const payload: unknown = await response.json();
    if (!isSummaryResponse(payload)) throw new Error('invalid_summary_response_schema');
    currentSummary = payload;
    const version = (payload as SummaryResponse & { ticketVersion?: unknown }).ticketVersion;
    currentTicketVersion =
      typeof version === 'number' && Number.isInteger(version) ? version : null;
    if (payload.status === 'insufficient_information') {
      summaryText.textContent =
        'There is not enough information in this ticket to generate a reliable summary.';
      summaryPanel.dataset.state = 'insufficient';
      setState('Insufficient information. Approval is disabled.');
      return;
    }
    summaryText.textContent = payload.summary ?? 'Summary response did not include summary text.';
    summaryPanel.dataset.state = 'ready';
    const validation = validateSummary(payload, ticket);
    const eligible = validation.valid && currentTicketVersion !== null;
    setApprovalEligibility(eligible);
    if (eligible)
      setState(
        `Summary generated. ${payload.sourceIds?.length ?? 0} citation(s) validated.`,
        'success',
      );
    else
      setState(
        `Summary is not eligible for approval: ${[...validation.reasons, ...(currentTicketVersion === null ? ['ticket_version_missing'] : [])].join(', ')}.`,
        'error',
      );
  } catch {
    if (sequence !== requestSequence) return;
    clearSummary();
    summaryPanel.dataset.state = 'error';
    setState(
      'Summary service returned an invalid response or could not be reached. Retry is available.',
      'error',
    );
    retryButton.hidden = false;
  } finally {
    if (sequence === requestSequence) {
      isGenerating = false;
      generateButton.disabled = false;
    }
  }
}
async function approveSummary(): Promise<void> {
  if (
    !currentSummary ||
    currentTicketVersion === null ||
    !validateSummary(currentSummary, ticket).valid
  )
    return;
  setApprovalEligibility(false);
  approveButton.disabled = true;
  setState('Submitting approval…');
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(ticket.id)}/summary/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ticketId: ticket.id,
        summary: currentSummary.summary,
        sourceIds: currentSummary.sourceIds,
        ticketVersion: currentTicketVersion,
      }),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const error =
        result && typeof result === 'object' && 'error' in result
          ? String((result as { error: unknown }).error)
          : 'approval_failed';
      setState(`Approval rejected: ${error}. Regenerate the summary before retrying.`, 'error');
      return;
    }
    setState('Summary approved and recorded for this ticket.', 'success');
  } catch {
    setState('Approval service could not be reached. Approval was not recorded.', 'error');
  }
}
generateButton.addEventListener('click', () => void generateSummary());
retryButton.addEventListener('click', () => void generateSummary());
approveButton.addEventListener('click', () => void approveSummary());
clearSummary();
