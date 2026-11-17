export interface TicketMessage {
  id: string;
  author: string;
  text: string;
}

export interface Ticket {
  id: string;
  subject: string;
  version: number;
  messages: TicketMessage[];
}

export interface SummaryResponse {
  status: 'ok' | 'insufficient_information';
  summary?: string;
  sourceIds?: string[];
}

export interface ValidationResult {
  valid: boolean;
  reasons: string[];
}

/** Runtime guard for untrusted JSON received over HTTP. */
export function isSummaryResponse(value: unknown): value is SummaryResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.status === 'insufficient_information') return true;
  return (
    candidate.status === 'ok' &&
    typeof candidate.summary === 'string' &&
    (candidate.sourceIds === undefined ||
      (Array.isArray(candidate.sourceIds) &&
        candidate.sourceIds.every((id) => typeof id === 'string')))
  );
}

/** Domain-level eligibility check. Enforce this on the server and in the UI. */
export function validateSummary(response: SummaryResponse, ticket: Ticket): ValidationResult {
  const reasons: string[] = [];
  if (response.status !== 'ok') reasons.push('summary_status_not_ok');
  if (typeof response.summary !== 'string' || !response.summary.trim())
    reasons.push('summary_missing_or_empty');
  const sourceIds = response.sourceIds;
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    reasons.push('citations_missing');
  } else {
    const allowedIds = new Set(ticket.messages.map((message) => message.id));
    if (sourceIds.some((id) => typeof id !== 'string' || !allowedIds.has(id)))
      reasons.push('citation_not_in_current_ticket');
    if (new Set(sourceIds).size !== sourceIds.length) reasons.push('duplicate_citations');
  }
  return { valid: reasons.length === 0, reasons };
}
