import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSummary, type SummaryResponse } from './src/domain/summary.js';
import { demoTicket } from './src/fixtures/tickets.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, 'public');
const port = Number(process.env.PORT ?? 4173);
const ticket = demoTicket;
const approvals = new Map<
  string,
  { summary: string; sourceIds: string[]; ticketVersion: number; approvedAt: string }
>();

interface SummaryRequest {
  ticketId?: unknown;
  messageIds?: unknown;
}
interface ApprovalRequest {
  ticketId?: unknown;
  summary?: unknown;
  sourceIds?: unknown;
  ticketVersion?: unknown;
}
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}
async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (Buffer.byteLength(body, 'utf8') > 64_000) throw new Error('request_body_too_large');
  }
  return body;
}
async function parseJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  if (!request.headers['content-type']?.toLowerCase().includes('application/json')) return null;
  const raw = await readRequestBody(request);
  const parsed: unknown = JSON.parse(raw || '{}');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}
async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health')
    return sendJson(response, 200, { status: 'ok' });

  const summaryMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/summary$/);
  const approveMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/summary\/approve$/);
  if (request.method === 'POST' && (summaryMatch || approveMatch)) {
    try {
      const routeTicketId = decodeURIComponent((summaryMatch ?? approveMatch)![1]!);
      const payload = await parseJson(request);
      if (!payload) return sendJson(response, 400, { error: 'invalid_json_or_content_type' });
      if (routeTicketId !== payload.ticketId)
        return sendJson(response, 400, { error: 'ticket_id_mismatch' });
      if (routeTicketId !== ticket.id)
        return sendJson(response, 404, { error: 'ticket_not_found' });

      if (summaryMatch) {
        const messageIds = payload.messageIds;
        if (
          !Array.isArray(messageIds) ||
          messageIds.length === 0 ||
          messageIds.some((id) => typeof id !== 'string')
        )
          return sendJson(response, 400, { error: 'invalid_message_ids' });
        const allowed = new Set(ticket.messages.map((message) => message.id));
        if (messageIds.some((id) => !allowed.has(id as string)))
          return sendJson(response, 422, { error: 'message_not_in_current_ticket' });
        const selected = new Set(messageIds as string[]);
        const sourceIds = ticket.messages
          .filter((message) => selected.has(message.id))
          .map((message) => message.id);
        const result: SummaryResponse = {
          status: 'ok',
          summary:
            'Order #8841 is delayed in transit. Support is investigating and will provide an update.',
          sourceIds,
        };
        return sendJson(response, 200, { ...result, ticketVersion: ticket.version });
      }

      const approval = payload as ApprovalRequest;
      if (approval.ticketVersion !== ticket.version)
        return sendJson(response, 409, { error: 'ticket_version_conflict' });
      const candidate: SummaryResponse = {
        status: 'ok',
        summary: approval.summary as string,
        sourceIds: approval.sourceIds as string[],
      };
      const validation = validateSummary(candidate, ticket);
      if (!validation.valid)
        return sendJson(response, 422, {
          error: 'summary_not_approvable',
          reasons: validation.reasons,
        });
      const record = {
        summary: candidate.summary!,
        sourceIds: candidate.sourceIds!,
        ticketVersion: ticket.version,
        approvedAt: new Date().toISOString(),
      };
      approvals.set(ticket.id, record);
      return sendJson(response, 201, { status: 'approved', ticketId: ticket.id, ...record });
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'request_body_too_large';
      return sendJson(response, tooLarge ? 413 : 400, {
        error: tooLarge ? 'request_too_large' : 'invalid_request',
      });
    }
  }

  if (request.method !== 'GET' && request.method !== 'HEAD')
    return sendJson(response, 405, { error: 'method_not_allowed' });
  let requestedPath: string;
  try {
    requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }
  const filePath = path.resolve(publicRoot, `.${requestedPath}`);
  if (
    !filePath.startsWith(`${publicRoot}${path.sep}`) &&
    filePath !== path.join(publicRoot, 'index.html')
  ) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'content-type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream',
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}
const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error('Unhandled server request error:', error);
    if (!response.headersSent) response.writeHead(500);
    response.end('Internal server error');
  });
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Support dashboard listening on http://127.0.0.1:${port}`),
);
