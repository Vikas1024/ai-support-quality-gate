import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type RawStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted' | 'unknown';
type DisplayStatus = RawStatus | 'flaky' | 'expected' | 'unexpected';

interface Attachment {
  name: string;
  contentType?: string;
  path?: string;
  body?: Buffer | string;
}
interface MatcherResult {
  name?: string;
  message?: string;
  expected?: unknown;
  actual?: unknown;
}
interface TestError {
  name?: string;
  message?: string;
  stack?: string;
  snippet?: string;
  matcherResult?: MatcherResult;
}
interface ReporterTest {
  id: string;
  title: string;
  titlePath(): string[];
  location?: { file: string; line: number; column: number };
  expectedStatus: string;
  annotations?: Array<{ type?: string; description?: string }>;
  tags?: string[];
}
interface ReporterResult {
  status: string;
  duration: number;
  retry: number;
  errors?: TestError[];
  stdout?: Array<string | Buffer>;
  stderr?: Array<string | Buffer>;
  attachments?: Attachment[];
  workerIndex?: number;
}
interface SuiteLike {
  allTests(): ReporterTest[];
}
interface RunResult {
  status: string;
}
interface ReporterConfig {
  projects?: Array<{ name: string }>;
}
interface StoredAttachment {
  name: string;
  contentType: string;
  html: string;
}
interface StoredAttempt {
  status: RawStatus;
  duration: number;
  retry: number;
  errors: TestError[];
  stdout: string;
  stderr: string;
  attachments: StoredAttachment[];
  workerIndex?: number;
}
interface StoredTest extends StoredAttempt {
  id: string;
  title: string;
  titlePath: string;
  file: string;
  location: string;
  category: string;
  tags: string[];
  expectedStatus: string;
  attempts: StoredAttempt[];
  retryCount: number;
  totalDuration: number;
  displayStatus: DisplayStatus;
  priority: 'low' | 'medium' | 'high' | 'critical' | 'none';
  failureType: string;
}

const RAW_STATUSES: RawStatus[] = [
  'passed',
  'failed',
  'skipped',
  'timedOut',
  'interrupted',
  'unknown',
];
const DISPLAY_STATUSES: DisplayStatus[] = [
  'passed',
  'failed',
  'flaky',
  'skipped',
  'timedOut',
  'interrupted',
  'expected',
  'unexpected',
  'unknown',
];
const STATUS_LABELS: Record<DisplayStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  flaky: 'Flaky',
  skipped: 'Skipped',
  timedOut: 'Timed out',
  interrupted: 'Interrupted',
  expected: 'Expected failure',
  unexpected: 'Unexpected pass',
  unknown: 'Other',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char] ?? char,
  );
}
function redact(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)\s*["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      '$1[REDACTED]',
    );
}
function safeJson(value: unknown): string {
  try {
    return redact(JSON.stringify(value, null, 2) ?? '');
  } catch {
    return String(value);
  }
}
function durationText(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
function normalizeStatus(status: string): RawStatus {
  return RAW_STATUSES.includes(status as RawStatus) ? (status as RawStatus) : 'unknown';
}
function categoryFor(file: string): string {
  const parts = file.replace(/\\/g, '/').split('/');
  const testsIndex = parts.lastIndexOf('tests');
  return testsIndex >= 0 && parts[testsIndex + 1]
    ? parts[testsIndex + 1]!.toLowerCase()
    : 'uncategorized';
}
function metadataFor(test: ReporterTest): {
  category: string;
  tags: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  failureType: string;
} {
  const tags = new Set(test.tags ?? []);
  let category = '';
  let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';
  let failureType = '';
  for (const annotation of test.annotations ?? []) {
    const type = annotation.type?.trim() ?? '';
    const description = annotation.description?.trim() ?? '';
    if (type.toLowerCase() === 'tag' && description)
      tags.add(description.startsWith('@') ? description : `@${description}`);
    else if (type.toLowerCase() === 'category' && description) category = description.toLowerCase();
    else if (type.toLowerCase().startsWith('tag:')) tags.add(`@${type.slice(4)}`);
    else if (type.toLowerCase().startsWith('category:')) category = type.slice(9).toLowerCase();
    else if (
      type.toLowerCase() === 'priority' &&
      ['low', 'medium', 'high', 'critical'].includes(description.toLowerCase())
    )
      priority = description.toLowerCase() as 'low' | 'medium' | 'high' | 'critical';
    else if (['failure-type', 'failuretype', 'failure_class'].includes(type.toLowerCase()))
      failureType = description.toLowerCase().replace(/_/g, '-');
  }
  return { category, tags: [...tags].filter(Boolean).sort(), priority, failureType };
}
function inferFailureType(attempts: StoredAttempt[], explicit: string): string {
  if (explicit) return explicit;
  const text = attempts
    .flatMap((a) => a.errors.map((e) => `${e.name ?? ''} ${e.message ?? ''} ${e.stack ?? ''}`))
    .join(' ')
    .toLowerCase();
  if (/timeout|timed out|exceeded.*\d+ms/.test(text)) return 'timeout';
  if (/econnrefused|enotfound|network|socket hang up|fetch failed|connection reset/.test(text))
    return 'network';
  if (/fixture|seed|test data|record.*not found|enoent/.test(text)) return 'test-data';
  if (/browser.*closed|target page.*closed|worker.*crash|test harness/.test(text))
    return 'test-harness';
  if (/401|403|configuration|missing environment|invalid config/.test(text))
    return 'environment-configuration';
  if (/expected.*received|assertionerror|to be visible|to equal/.test(text))
    return 'assertion-failure';
  return 'unclassified';
}
function outputText(items: Array<string | Buffer> = []): string {
  return redact(
    items.map((item) => (Buffer.isBuffer(item) ? item.toString('utf8') : item)).join(''),
  );
}

async function attachmentHtml(attachment: Attachment): Promise<StoredAttachment> {
  let body = attachment.body;
  if (!body && attachment.path) {
    try {
      body = await readFile(attachment.path);
    } catch {
      return {
        name: attachment.name,
        contentType: attachment.contentType ?? 'application/octet-stream',
        html: `<p class="muted">Attachment unavailable: ${escapeHtml(attachment.name)}</p>`,
      };
    }
  }
  const contentType = attachment.contentType ?? 'application/octet-stream';
  if (!body)
    return {
      name: attachment.name,
      contentType,
      html: `<p class="muted">${escapeHtml(attachment.name)}: no content captured.</p>`,
    };
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const name = escapeHtml(attachment.name);
  if (contentType.startsWith('image/')) {
    const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
    return {
      name: attachment.name,
      contentType,
      html: `<figure class="evidence-image"><a href="${dataUrl}" target="_blank" rel="noreferrer"><img src="${dataUrl}" alt="${name}" loading="lazy"></a><figcaption>${name}</figcaption></figure>`,
    };
  }
  if (contentType.startsWith('text/') || /json|xml|javascript/.test(contentType)) {
    const raw = buffer.toString('utf8');
    let rendered = redact(raw);
    if (contentType.includes('json')) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        rendered = safeJson(parsed);
        const comparison = parsed.comparison;
        if (
          attachment.name.toLowerCase().includes('api-') &&
          comparison &&
          typeof comparison === 'object'
        ) {
          const rows = Object.entries(comparison as Record<string, unknown>)
            .map(([label, value]) => {
              const item =
                value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
              const matches = item.matches;
              return `<div class="api-diff-row"><div class="api-diff-heading"><b>${escapeHtml(label)}</b><span class="pill ${matches === true ? 'passed' : matches === false ? 'failed' : 'unknown'}">${matches === true ? 'Match' : matches === false ? 'Mismatch' : 'Captured'}</span></div><div class="diff-grid"><div><h5>Expected</h5><pre>${escapeHtml(safeJson(item.expected ?? 'Not specified'))}</pre></div><div><h5>Actual</h5><pre>${escapeHtml(safeJson(item.actual ?? 'Not captured'))}</pre></div></div></div>`;
            })
            .join('');
          const request = parsed.request;
          const response = parsed.response;
          const requestResponse = `<div class="diff-grid"><div><h5>Request</h5><pre>${escapeHtml(safeJson(request ?? 'Not captured'))}</pre></div><div><h5>Actual response</h5><pre>${escapeHtml(safeJson(response ?? 'Not captured'))}</pre></div></div>`;
          return {
            name: attachment.name,
            contentType,
            html: `<details class="attachment api-diagnostics" open><summary>${name}<span class="muted">API diagnostics · ${escapeHtml(contentType)}</span></summary><div class="api-diagnostics-body">${rows}${requestResponse}<details><summary>Raw diagnostic payload</summary><pre>${escapeHtml(rendered)}</pre></details></div></details>`,
          };
        }
      } catch {
        /* Keep raw text. */
      }
    }
    return {
      name: attachment.name,
      contentType,
      html: `<details class="attachment"><summary>${name}<span class="muted">${escapeHtml(contentType)}</span></summary><pre>${escapeHtml(rendered)}</pre></details>`,
    };
  }
  return {
    name: attachment.name,
    contentType,
    html: `<p class="muted">${name} — ${escapeHtml(contentType)}. Binary evidence is retained by Playwright; preview is unavailable.</p>`,
  };
}

function renderError(error: TestError, index: number): string {
  const matcher = error.matcherResult;
  const hasComparison = matcher && ('expected' in matcher || 'actual' in matcher);
  return `<section class="diagnostic failure"><div class="diagnostic-title">Failure ${index + 1} · ${escapeHtml(error.name ?? 'Error')}</div>
    <pre>${escapeHtml(redact(error.message ?? 'Test failed without an error message.'))}</pre>
    ${hasComparison ? `<div class="diff-grid"><div><h5>Expected</h5><pre>${escapeHtml(safeJson(matcher.expected))}</pre></div><div><h5>Actual</h5><pre>${escapeHtml(safeJson(matcher.actual))}</pre></div></div>` : ''}
    ${error.snippet ? `<h5>Code context</h5><pre>${escapeHtml(redact(error.snippet))}</pre>` : ''}
    ${error.stack ? `<details class="stack"><summary>Stack trace</summary><pre>${escapeHtml(redact(error.stack))}</pre></details>` : ''}
  </section>`;
}

function classify(test: ReporterTest | undefined, attempts: StoredAttempt[]): DisplayStatus {
  const last = attempts[attempts.length - 1];
  if (!last) return 'unknown';
  if (last.status === 'failed' && test?.expectedStatus === 'failed') return 'expected';
  if (last.status === 'passed' && test && test.expectedStatus !== 'passed') return 'unexpected';
  if (
    last.status === 'passed' &&
    attempts.some((attempt) => attempt.status === 'failed' || attempt.status === 'timedOut')
  )
    return 'flaky';
  return last.status;
}

export default class SingleHtmlReporter {
  private readonly outputFile: string;
  private readonly attemptsByTest = new Map<string, StoredAttempt[]>();
  private discoveredTests: ReporterTest[] = [];
  private startedAt = new Date();
  private projectNames: string[] = [];

  constructor(options: { outputFile?: string } = {}) {
    this.outputFile = options.outputFile ?? path.resolve('reports', 'TESTREPORT.html');
  }
  onBegin(config: ReporterConfig, suite: SuiteLike): void {
    this.startedAt = new Date();
    this.discoveredTests = suite.allTests();
    this.projectNames = (config.projects ?? []).map((project) => project.name).filter(Boolean);
  }
  async onTestEnd(test: ReporterTest, result: ReporterResult): Promise<void> {
    const attachments: StoredAttachment[] = [];
    for (const attachment of result.attachments ?? [])
      attachments.push(await attachmentHtml(attachment));
    const attempt: StoredAttempt = {
      status: normalizeStatus(result.status),
      duration: result.duration,
      retry: result.retry,
      errors: result.errors ?? [],
      stdout: outputText(result.stdout),
      stderr: outputText(result.stderr),
      attachments,
      ...(result.workerIndex === undefined ? {} : { workerIndex: result.workerIndex }),
    };
    const attempts = this.attemptsByTest.get(test.id) ?? [];
    attempts.push(attempt);
    this.attemptsByTest.set(test.id, attempts);
  }

  async onEnd(result: RunResult): Promise<void> {
    const tests: StoredTest[] = [];
    for (const test of this.discoveredTests) {
      const attempts = this.attemptsByTest.get(test.id) ?? [];
      const finalAttempt = attempts[attempts.length - 1] ?? {
        status: 'skipped' as RawStatus,
        duration: 0,
        retry: 0,
        errors: [],
        stdout: '',
        stderr: '',
        attachments: [],
      };
      const filePath = test.location?.file ?? '';
      const relativeFile = filePath
        ? path.relative(process.cwd(), filePath).replace(/\\/g, '/')
        : '';
      const metadata = metadataFor(test);
      const displayStatus = classify(test, attempts.length ? attempts : [finalAttempt]);
      tests.push({
        ...finalAttempt,
        id: test.id,
        title: test.title,
        titlePath: test.titlePath().join(' › '),
        file: relativeFile,
        location: test.location ? `${relativeFile}:${test.location.line}` : '',
        category: metadata.category || categoryFor(relativeFile),
        tags: metadata.tags,
        expectedStatus: test.expectedStatus,
        attempts: attempts.length ? attempts : [finalAttempt],
        retryCount: Math.max(0, attempts.length - 1),
        totalDuration: attempts.reduce((sum, item) => sum + item.duration, 0),
        displayStatus,
        priority: ['passed', 'skipped'].includes(displayStatus) ? 'none' : metadata.priority,
        failureType: inferFailureType(
          attempts.length ? attempts : [finalAttempt],
          metadata.failureType,
        ),
      });
    }

    const counts = Object.fromEntries(
      DISPLAY_STATUSES.map((status) => [
        status,
        tests.filter((test) => test.displayStatus === status).length,
      ]),
    ) as Record<DisplayStatus, number>;
    const total = tests.length;
    const completed = total - counts.skipped - counts.expected;
    const passRate = completed > 0 ? (counts.passed / completed) * 100 : 0;
    const trueFailures = counts.failed + counts.timedOut + counts.interrupted + counts.unexpected;
    const diagnosticTests = tests.filter((t) => !['passed', 'skipped'].includes(t.displayStatus));
    const severityCounts = Object.fromEntries(
      ['critical', 'high', 'medium', 'low'].map((level) => [
        level,
        diagnosticTests.filter((t) => t.priority === level).length,
      ]),
    ) as Record<'critical' | 'high' | 'medium' | 'low', number>;
    const categories = [...new Set(tests.map((test) => test.category))].sort();
    const tags = [...new Set(tests.flatMap((test) => test.tags))].sort();
    const failureTypes = [
      ...new Set(
        tests
          .filter((t) => !['passed', 'skipped'].includes(t.displayStatus))
          .map((t) => t.failureType),
      ),
    ].sort();
    const priorities = ['critical', 'high', 'medium', 'low'];
    const colors: Record<DisplayStatus, string> = {
      passed: '#16a34a',
      failed: '#dc2626',
      flaky: '#d97706',
      skipped: '#94a3b8',
      timedOut: '#ea580c',
      interrupted: '#8b5cf6',
      expected: '#64748b',
      unexpected: '#be123c',
      unknown: '#cbd5e1',
    };
    let offset = 0;
    const donutStops =
      DISPLAY_STATUSES.filter((status) => counts[status] > 0)
        .map((status) => {
          const start = offset;
          offset += total ? (counts[status] / total) * 100 : 0;
          return `${colors[status]} ${start}% ${offset}%`;
        })
        .join(', ') || '#e5e7eb';

    const grouped = new Map<string, StoredTest[]>();
    for (const test of tests) {
      const key = `${test.category}||${test.file || 'Unlocated tests'}`;
      const group = grouped.get(key) ?? [];
      group.push(test);
      grouped.set(key, group);
    }
    const groupHtml = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => {
        const [category, file] = key.split('||');
        const cards = group
          .sort((a, b) => a.titlePath.localeCompare(b.titlePath))
          .map((test) => {
            const errors = test.attempts
              .flatMap((attempt, attemptIndex) =>
                attempt.errors.map(
                  (error, errorIndex) =>
                    `<div class="attempt-block">${test.attempts.length > 1 ? `<p class="muted">Attempt ${attemptIndex + 1} · ${escapeHtml(attempt.status)}</p>` : ''}${renderError(error, errorIndex)}</div>`,
                ),
              )
              .join('');
            const evidence = test.attempts
              .map((attempt, index) => {
                const parts: string[] = [];
                if (attempt.stdout)
                  parts.push(
                    `<section class="diagnostic"><h4>Standard output · attempt ${index + 1}</h4><pre>${escapeHtml(attempt.stdout)}</pre></section>`,
                  );
                if (attempt.stderr)
                  parts.push(
                    `<section class="diagnostic"><h4>Standard error · attempt ${index + 1}</h4><pre>${escapeHtml(attempt.stderr)}</pre></section>`,
                  );
                if (attempt.attachments.length)
                  parts.push(
                    `<section class="diagnostic"><h4>Evidence · attempt ${index + 1}</h4><div class="evidence-grid">${attempt.attachments.map((item) => item.html).join('')}</div></section>`,
                  );
                return parts.join('');
              })
              .join('');
            const retryHistory =
              test.attempts.length > 1
                ? `<section class="diagnostic"><h4>Attempt history</h4><div class="attempt-list">${test.attempts.map((attempt, index) => `<div>Attempt ${index + 1}<span class="pill ${attempt.status}">${escapeHtml(STATUS_LABELS[attempt.status])}</span><span>${durationText(attempt.duration)}</span></div>`).join('')}</div></section>`
                : '';
            const tagHtml = test.tags
              .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
              .join('');
            const searchText = [
              test.titlePath,
              test.file,
              test.location,
              test.category,
              test.tags.join(' '),
              test.priority,
              test.failureType,
              ...test.attempts.flatMap((a) => a.errors.map((e) => e.message ?? '')),
            ]
              .join(' ')
              .toLowerCase();
            const noDetails = !errors && !evidence && !retryHistory;
            return `<article class="test-card" data-status="${test.displayStatus}" data-category="${escapeHtml(test.category)}" data-tags="${escapeHtml(test.tags.join(' '))}" data-priority="${test.priority}" data-failure-type="${escapeHtml(test.failureType)}" data-search="${escapeHtml(searchText)}"><details>
          <summary><span class="pill ${test.displayStatus}">${escapeHtml(test.displayStatus === 'expected' && test.tags.includes('@demo') ? 'Demo · expected failure' : STATUS_LABELS[test.displayStatus])}</span><span class="test-title">${escapeHtml(test.title)}<small>${escapeHtml(test.location)}</small>${tagHtml ? `<span class="tag-list">${tagHtml}</span>` : ''}</span>${!['passed', 'skipped'].includes(test.displayStatus) ? `<span class="meta-chip priority-${test.priority}">${escapeHtml(test.priority.toUpperCase())}</span><span class="meta-chip">${escapeHtml(test.failureType)}</span>` : ''}<span class="duration">${durationText(test.totalDuration)}</span>${test.retryCount ? `<span class="retry">${test.retryCount} retries</span>` : ''}</summary>
          <div class="test-details"><div class="test-meta"><span><b>Category</b>${escapeHtml(test.category)}</span><span><b>Expected status</b>${escapeHtml(test.expectedStatus)}</span><span><b>Attempts</b>${test.attempts.length}</span><span><b>Worker</b>${test.workerIndex ?? '—'}</span>${!['passed', 'skipped'].includes(test.displayStatus) ? `<span><b>Severity</b>${escapeHtml(test.priority)}</span><span><b>Failure type</b>${escapeHtml(test.failureType)}</span><span><b>Classification</b>${escapeHtml(test.displayStatus === 'expected' ? 'Expected / controlled' : test.displayStatus === 'flaky' ? 'Flaky / recovered' : 'True failure')}</span>` : ''}</div>${errors}${retryHistory}${evidence}${noDetails ? '<p class="muted">No failure diagnostics or attachments were captured for this test.</p>' : ''}</div>
        </details></article>`;
          })
          .join('');
        const passed = group.filter((t) => t.displayStatus === 'passed').length;
        const expected = group.filter((t) => t.displayStatus === 'expected').length;
        const flaky = group.filter((t) => t.displayStatus === 'flaky').length;
        const failures = group.filter((t) =>
          ['failed', 'timedOut', 'interrupted', 'unexpected'].includes(t.displayStatus),
        ).length;
        return `<section class="file-group" data-category-group="${escapeHtml(category ?? '')}"><div class="group-heading"><div><span class="category-label">${escapeHtml(category ?? 'uncategorized')}</span><h3>${escapeHtml(file ?? '')}</h3><p>${group.length} tests · ${passed} passed · ${expected} expected failures · ${flaky} flaky · ${failures} true failures</p></div><span class="group-count">${group.length}</span></div>${cards}</section>`;
      })
      .join('');

    const statusOptions = DISPLAY_STATUSES.map(
      (status) => `<option value="${status}">${STATUS_LABELS[status]} (${counts[status]})</option>`,
    ).join('');
    const categoryOptions = categories
      .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
      .join('');
    const tagOptions = tags
      .map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`)
      .join('');
    const generatedAt = new Date();
    const duration = generatedAt.getTime() - this.startedAt.getTime();
    const environment = (process.env.REPORT_ENV ?? 'LOCAL')
      .replace(/[^a-z0-9_-]/gi, '')
      .toUpperCase();
    const suiteName = process.env.REPORT_SUITE ?? 'Complete';
    const statusSummary = DISPLAY_STATUSES.filter((status) => counts[status] > 0)
      .map(
        (status) =>
          `<div class="legend-row"><i style="background:${colors[status]}"></i><span>${STATUS_LABELS[status]}</span><b>${counts[status]}</b></div>`,
      )
      .join('');

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LogiQLink ${escapeHtml(suiteName)} QA Report</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#172033;background:#f3f6fb;font-synthesis:none}*{box-sizing:border-box}body{margin:0;padding:26px}.container{max-width:1600px;margin:auto}.hero{background:linear-gradient(120deg,#111c32,#263b5d);color:#fff;padding:28px 32px;border-radius:16px;margin-bottom:16px;box-shadow:0 10px 30px #17203318}.eyebrow{text-transform:uppercase;letter-spacing:.15em;font-size:10px;font-weight:800;color:#a9bfdf}.hero h1{font-size:28px;margin:9px 0 16px}.meta{display:flex;gap:10px 25px;flex-wrap:wrap;color:#d4deed;font-size:12px}.meta b{color:white}.metrics{display:grid;grid-template-columns:repeat(4,minmax(115px,1fr));gap:12px;margin:14px 0}.metric,.panel{background:#fff;border:1px solid #e2e8f0;border-radius:13px;padding:17px;box-shadow:0 2px 7px #17203308}.metric small{display:block;color:#718096;font-size:10px;text-transform:uppercase;font-weight:800;letter-spacing:.08em}.metric strong{display:block;font-size:27px;margin-top:6px}.green{color:#15803d}.red{color:#dc2626}.amber{color:#b45309}.overview{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(380px,2fr);gap:12px}.panel h2{font-size:15px;margin:0 0 14px}.chart{display:flex;align-items:center;gap:22px;flex-wrap:wrap}.donut{width:142px;height:142px;border-radius:50%;display:grid;place-items:center;position:relative;flex:none}.donut:after{content:"";position:absolute;width:94px;height:94px;background:#fff;border-radius:50%}.donut strong{z-index:1;font-size:23px}.legend{display:grid;gap:9px;min-width:145px;flex:1}.legend-row{display:grid;grid-template-columns:10px 1fr auto;gap:8px;align-items:center;font-size:11px;color:#526176}.legend-row i{width:9px;height:9px;border-radius:50%}.legend-row b{color:#172033}.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.stat{padding:12px;background:#f7f9fc;border-radius:9px}.stat small{display:block;color:#64748b;font-size:10px;text-transform:uppercase}.stat b{font-size:20px;display:block;margin-top:5px}.heading{display:flex;justify-content:space-between;align-items:end;gap:15px;margin:25px 0 12px}.heading h2{margin:0;font-size:20px}.heading p{margin:5px 0 0;color:#64748b;font-size:12px}.toolbar{display:flex;gap:9px;flex-wrap:wrap;background:#fff;padding:12px;border:1px solid #e2e8f0;border-radius:12px}.toolbar input,.toolbar select,.toolbar button,.heading button{padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#172033;font-size:12px}.toolbar input{flex:1;min-width:210px}.toolbar button,.heading button{cursor:pointer;font-weight:700}.toolbar button:hover,.heading button:hover{background:#f1f5f9}.result-count{font-size:11px;color:#64748b;margin:10px 2px}.file-group{margin:17px 0 21px}.group-heading{display:flex;justify-content:space-between;align-items:center;padding:12px 15px;background:#eaf0f8;border-radius:10px 10px 0 0;border:1px solid #d9e2ef}.group-heading h3{font-size:13px;margin:4px 0}.group-heading p{font-size:11px;color:#64748b;margin:0}.category-label{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#315b8e;font-weight:900}.group-count{background:white;border:1px solid #d8e1ed;border-radius:20px;padding:5px 10px;font-size:11px;font-weight:800}.test-card{background:white;border:1px solid #e2e8f0;border-top:0;overflow:hidden}.test-card:last-child{border-radius:0 0 10px 10px}.test-card summary{display:flex;align-items:center;gap:13px;padding:14px 15px;cursor:pointer;list-style:none}.test-card summary::-webkit-details-marker{display:none}.test-card summary:after{content:"＋";color:#64748b;font-size:14px}.test-card details[open]>summary:after{content:"−"}.pill{display:inline-flex;align-items:center;justify-content:center;min-width:82px;padding:5px 8px;border-radius:6px;font-size:10px;font-weight:850;text-transform:uppercase;white-space:nowrap}.pill.passed{background:#dcfce7;color:#166534}.pill.failed,.pill.unexpected{background:#fee2e2;color:#991b1b}.pill.flaky{background:#fef3c7;color:#92400e}.pill.skipped,.pill.expected{background:#e2e8f0;color:#475569}.pill.timedOut{background:#ffedd5;color:#9a3412}.pill.interrupted{background:#f3e8ff;color:#6b21a8}.pill.unknown{background:#f1f5f9;color:#475569}.test-title{flex:1;font-size:13px;font-weight:700;overflow-wrap:anywhere}.test-title small{display:block;margin-top:4px;color:#64748b;font-size:10px;font-weight:400}.duration,.retry{font-size:11px;color:#64748b;white-space:nowrap}.retry{color:#b45309;font-weight:700}.meta-chip{font-size:10px;font-weight:800;padding:5px 7px;border-radius:5px;background:#f1f5f9;color:#475569;text-transform:uppercase}.priority-critical{background:#fee2e2;color:#991b1b}.priority-high{background:#ffedd5;color:#9a3412}.priority-medium{background:#fef3c7;color:#92400e}.priority-low{background:#e0f2fe;color:#075985}.tag-list{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.tag{font-size:9px;padding:3px 6px;background:#eff6ff;color:#1d4ed8;border-radius:5px}.test-details{padding:0 16px 18px;border-top:1px solid #e8edf4;background:#fcfdff}.test-meta{display:flex;gap:8px;flex-wrap:wrap;padding:12px 0}.test-meta span{background:#f1f5f9;padding:7px 9px;border-radius:6px;font-size:10px;color:#475569}.test-meta b{color:#172033;margin-right:5px}.diagnostic{margin-top:13px;padding:12px;background:white;border:1px solid #e2e8f0;border-radius:9px}.diagnostic.failure{border-left:4px solid #dc2626}.diagnostic-title{font-size:12px;font-weight:800;color:#991b1b;margin-bottom:8px}.diagnostic h4{font-size:12px;margin:0 0 9px}.diagnostic h5{font-size:10px;margin:8px 0 5px}.diff-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.diff-grid>div{min-width:0}.diagnostic pre,.attachment pre,.stack pre{background:#111c32;color:#e2e8f0;border-radius:7px;padding:12px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,monospace;max-height:420px}.failure pre{background:#3b1018}.evidence-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.evidence-image{margin:0;padding:8px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}.evidence-image img{display:block;max-width:100%;max-height:560px;object-fit:contain;margin:auto;border-radius:5px}.evidence-image figcaption{font-size:10px;color:#64748b;margin-top:7px;overflow-wrap:anywhere}.attachment{margin:8px 0;border:1px solid #e2e8f0;border-radius:7px;padding:9px}.attachment summary,.stack summary{cursor:pointer;font-size:11px;font-weight:700}.api-diagnostics-body{padding-top:10px}.api-diff-row{padding:10px 0;border-bottom:1px solid #e2e8f0}.api-diff-heading{display:flex;justify-content:space-between;align-items:center;font-size:11px;margin-bottom:5px}.attachment summary .muted{margin-left:8px;font-weight:400}.attempt-list{display:grid;gap:6px}.attempt-list>div{display:flex;align-items:center;gap:12px;font-size:11px;padding:7px;background:#f8fafc;border-radius:6px}.muted{color:#64748b;font-size:11px}.stack{margin-top:8px}footer{text-align:center;color:#94a3b8;font-size:10px;margin:24px 0 8px}[hidden]{display:none!important}@media(max-width:1000px){.metrics{grid-template-columns:repeat(3,1fr)}.overview{grid-template-columns:1fr}}@media(max-width:650px){body{padding:12px}.hero{padding:21px}.hero h1{font-size:22px}.metrics{grid-template-columns:repeat(2,1fr)}.stats-grid{grid-template-columns:repeat(2,1fr)}.test-card summary{flex-wrap:wrap}.test-title{min-width:65%}.diff-grid{grid-template-columns:1fr}.heading{align-items:start;flex-direction:column}}
</style></head><body><main class="container">
<header class="hero"><div class="eyebrow">Quality Engineering · Execution Intelligence</div><h1>Automation Test Report</h1><div class="meta"><span><b>Environment</b> ${escapeHtml(environment)}</span><span><b>Suite</b> ${escapeHtml(suiteName)}</span><span><b>Run status</b> ${escapeHtml(result.status)}</span><span><b>Started</b> ${escapeHtml(this.startedAt.toLocaleString())}</span><span><b>Generated</b> ${escapeHtml(generatedAt.toLocaleString())}</span><span><b>Duration</b> ${durationText(duration)}</span><span><b>Projects</b> ${escapeHtml(this.projectNames.join(', ') || 'Default')}</span></div></header>
<section class="metrics"><div class="metric"><small>Discovered tests</small><strong>${this.discoveredTests.length}</strong></div><div class="metric"><small>Executed / reported</small><strong>${total}</strong></div><div class="metric"><small>Passed</small><strong class="green">${counts.passed}</strong></div><div class="metric"><small>True failures</small><strong class="red">${trueFailures}</strong></div><div class="metric"><small>Expected failures</small><strong>${counts.expected}</strong></div><div class="metric"><small>Flaky / recovered</small><strong class="amber">${counts.flaky}</strong></div><div class="metric"><small>Skipped</small><strong>${counts.skipped}</strong></div><div class="metric"><small>Pass rate</small><strong>${passRate.toFixed(1)}%</strong></div></section>
<section class="overview"><div class="panel"><h2>Execution distribution</h2><div class="chart"><div class="donut" style="background:conic-gradient(${donutStops})"><strong>${total}</strong></div><div class="legend">${statusSummary || '<span class="muted">No test results</span>'}</div></div></div><div class="panel"><h2>Run intelligence</h2><div class="stats-grid"><div class="stat"><small>Categories discovered</small><b>${categories.length}</b></div><div class="stat"><small>Tags discovered</small><b>${tags.length}</b></div><div class="stat"><small>Flaky tests</small><b>${counts.flaky}</b></div><div class="stat"><small>Timed out</small><b>${counts.timedOut}</b></div><div class="stat"><small>Interrupted</small><b>${counts.interrupted}</b></div><div class="stat"><small>Expected failures</small><b>${counts.expected}</b></div><div class="stat"><small>Controlled demo failures</small><b>${tests.filter((t) => t.displayStatus === 'expected' && t.tags.includes('@demo')).length}</b></div><div class="stat"><small>Critical severity</small><b>${severityCounts.critical}</b></div><div class="stat"><small>High severity</small><b>${severityCounts.high}</b></div><div class="stat"><small>Medium severity</small><b>${severityCounts.medium}</b></div><div class="stat"><small>Low severity</small><b>${severityCounts.low}</b></div><div class="stat"><small>Failure types</small><b>${failureTypes.length}</b></div></div></div></section>
<div class="heading"><div><h2>Test results</h2><p>Expected failures are controlled fault injections. True failures are unplanned failures against passing expectations. Flaky tests failed before a successful retry. Severity and failure type come from test annotations or diagnostic inference.</p></div><div><button id="expandAll" type="button">Expand visible</button> <button id="collapseAll" type="button">Collapse all</button></div></div>
<div class="toolbar"><input id="search" type="search" placeholder="Search test, file, category, tag or failure…"><select id="statusFilter"><option value="all">All statuses</option>${statusOptions}</select><select id="categoryFilter"><option value="all">All categories</option>${categoryOptions}</select><select id="tagFilter"><option value="all">All tags</option>${tagOptions}</select><select id="priorityFilter"><option value="all">All priorities</option>${priorities.map((p) => `<option value="${p}">${p.toUpperCase()}</option>`).join('')}</select><select id="failureTypeFilter"><option value="all">All failure types</option>${failureTypes.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</select><button id="clearFilters" type="button">Clear filters</button></div>
<p class="result-count" id="resultCount">Showing ${total} of ${total} tests</p><div id="testGroups">${groupHtml || '<p class="muted">No test results were recorded.</p>'}</div><footer>Generated by LogiQLink Principal QE · Self-contained HTML report · Evidence embedded at execution time</footer></main>
<script>(()=>{const search=document.getElementById('search'),status=document.getElementById('statusFilter'),category=document.getElementById('categoryFilter'),tag=document.getElementById('tagFilter'),priority=document.getElementById('priorityFilter'),failureType=document.getElementById('failureTypeFilter'),cards=[...document.querySelectorAll('.test-card')],groups=[...document.querySelectorAll('.file-group')],count=document.getElementById('resultCount');function apply(){const q=search.value.trim().toLowerCase();let shown=0;for(const card of cards){const tags=(card.dataset.tags||'').split(' ').filter(Boolean);const visible=(!q||(card.dataset.search||'').includes(q))&&(status.value==='all'||card.dataset.status===status.value)&&(category.value==='all'||card.dataset.category===category.value)&&(tag.value==='all'||tags.includes(tag.value))&&(priority.value==='all'||card.dataset.priority===priority.value)&&(failureType.value==='all'||card.dataset.failureType===failureType.value);card.hidden=!visible;if(visible)shown++;}for(const group of groups)group.hidden=!group.querySelector('.test-card:not([hidden])');count.textContent='Showing '+shown+' of '+cards.length+' tests';}search.addEventListener('input',apply);status.addEventListener('change',apply);category.addEventListener('change',apply);tag.addEventListener('change',apply);priority.addEventListener('change',apply);failureType.addEventListener('change',apply);document.getElementById('clearFilters').addEventListener('click',()=>{search.value='';status.value=category.value=tag.value=priority.value=failureType.value='all';apply();});document.getElementById('expandAll').addEventListener('click',()=>cards.filter(c=>!c.hidden).forEach(c=>c.querySelector('details').open=true));document.getElementById('collapseAll').addEventListener('click',()=>cards.forEach(c=>c.querySelector('details').open=false));apply();})();</script></body></html>`;

    await writeFile(this.outputFile, html, 'utf8');
    console.log(`\nSingle-file HTML report: ${this.outputFile}`);
    console.log(`Pass rate: ${passRate.toFixed(1)}%`);
  }
}
