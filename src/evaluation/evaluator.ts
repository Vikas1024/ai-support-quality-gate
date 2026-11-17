import { validateSummary, type SummaryResponse, type Ticket } from '../domain/summary.js';

export interface EvaluationCase {
  id: string;
  description: string;
  ticket: Ticket;
  output: SummaryResponse;
  expectedAcceptable: boolean;
  unsupportedTerms?: string[];
  requiredTerms?: string[];
}

export interface EvaluationCheck {
  id: string;
  category: 'schema' | 'grounding' | 'hallucination' | 'coverage';
  passed: boolean;
  expected: string;
  actual: string;
}

export interface EvaluationResult {
  id: string;
  passed: boolean;
  acceptable: boolean;
  score: number;
  reasons: string[];
  checks: EvaluationCheck[];
}

/**
 * Deterministic baseline evaluator.
 * It validates response structure, citation integrity, duplicate citations,
 * configured required terms, and configured unsupported terms.
 * Lexical checks are not a substitute for semantic entailment evaluation.
 */
export function evaluateSummary(example: EvaluationCase): EvaluationResult {
  const response = example.output;
  const text = response.summary ?? '';
  const validation = validateSummary(response, example.ticket);
  const sourceIds = response.sourceIds ?? [];
  const allowedIds = new Set(example.ticket.messages.map((message) => message.id));
  const checks: EvaluationCheck[] = [
    {
      id: 'status-is-ok',
      category: 'schema',
      passed: response.status === 'ok',
      expected: 'ok',
      actual: response.status,
    },
    {
      id: 'summary-is-non-empty',
      category: 'schema',
      passed: typeof response.summary === 'string' && response.summary.trim().length > 0,
      expected: 'non-empty string',
      actual: typeof response.summary === 'string' ? response.summary : String(response.summary),
    },
    {
      id: 'citations-present',
      category: 'grounding',
      passed: sourceIds.length > 0,
      expected: 'at least one source ID',
      actual: `${sourceIds.length} source IDs`,
    },
    {
      id: 'citations-belong-to-ticket',
      category: 'grounding',
      passed: sourceIds.every((id) => allowedIds.has(id)),
      expected: `IDs from ticket ${example.ticket.id}`,
      actual: sourceIds.join(', ') || 'none',
    },
    {
      id: 'citations-unique',
      category: 'grounding',
      passed: new Set(sourceIds).size === sourceIds.length,
      expected: 'no duplicate source IDs',
      actual: sourceIds.join(', ') || 'none',
    },
  ];

  for (const term of example.requiredTerms ?? []) {
    checks.push({
      id: `required-term:${term}`,
      category: 'coverage',
      passed: new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text),
      expected: `summary contains "${term}"`,
      actual: new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text)
        ? `found "${term}"`
        : `"${term}" not found`,
    });
  }

  for (const term of example.unsupportedTerms ?? []) {
    const found = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text);
    checks.push({
      id: `unsupported-term:${term}`,
      category: 'hallucination',
      passed: !found,
      expected: `summary must not claim "${term}"`,
      actual: found ? `unsupported term "${term}" found` : 'not found',
    });
  }

  const reasons = [...validation.reasons];
  for (const check of checks) {
    if (!check.passed && !reasons.includes(check.id)) reasons.push(check.id);
  }

  const acceptable = reasons.length === 0;
  const passed = acceptable === example.expectedAcceptable;
  const score = checks.length
    ? Math.round((checks.filter((check) => check.passed).length / checks.length) * 100)
    : 100;

  return { id: example.id, passed, acceptable, score, reasons, checks };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
