# LogiQlink Technologies — Principal Quality Engineering Take-home

A local, synthetic Playwright + TypeScript release gate for an AI-assisted support-ticket summary workflow. It requires no credentials, paid services, or external AI calls.

The project demonstrates a small but extensible quality-engineering architecture: browser-level workflow tests, HTTP contract checks, deterministic summary evaluation, release-blocking CI, timestamped HTML reports, and retained failure evidence.

> Scope: this is an assessment-sized reference implementation, not a production support platform. The patch adds server-side citation/version validation and an in-memory approval record. Authentication, agent authorization, durable database storage, and production audit retention remain out of scope.

## 1. Requirements

- Node.js 20+ (CI uses Node 22)
- npm
- Google Chrome installed locally for Linux/macOS/Windows development, or Playwright Chromium on CI

### Browser strategy

On a local machine, the Playwright configuration defaults to the installed stable Google Chrome channel (`channel: "chrome"`). This avoids downloading Playwright's bundled Chromium, which is useful on distributions that Playwright does not yet recognize as supported for browser installation.

On CI, the workflow explicitly installs and uses Playwright Chromium on GitHub's supported Ubuntu runner. This keeps CI reproducible and independent of a developer's locally installed browser.

If Chrome is installed at a non-standard path, set `CHROME_EXECUTABLE` to its absolute path. To override the browser channel, set `PW_CHANNEL=chrome` or `PW_CHANNEL=chromium`.

Linux Chrome can still require system libraries. If Chrome itself does not launch, install the dependencies required by your distribution and verify that `google-chrome --version` works. The Playwright browser installer error on Ubuntu 26.04 concerns Playwright's bundled browser download/support detection; it does not by itself prove that installed Google Chrome cannot be automated.

## 2. Quick start

```bash
npm install
npm run format:write
npm run format:check
npm run typecheck
npm test:demo
```

`npm install` creates `package-lock.json`. Commit that lockfile with the project; CI uses `npm ci` to install exactly the locked dependency graph.

On Linux, install Google Chrome Stable using the official Google Chrome package for your distribution, then verify:

```bash
google-chrome --version
```

If the executable is named `google-chrome-stable`, set `CHROME_EXECUTABLE=/usr/bin/google-chrome-stable`. In most installations, Playwright's `channel: "chrome"` locates the stable channel without an explicit path.

To use Playwright's bundled browser instead:

```bash
PW_CHANNEL=chromium npx playwright install chromium
PW_CHANNEL=chromium npm test
```

Start the local dashboard manually:

```bash
npm run build
npm start
```

Open <http://127.0.0.1:4173>. The synthetic demo ticket is `T-1042`. Stop the server with `Ctrl+C`. During automated runs, Playwright starts the local server and waits for `/health` automatically.

## 3. Commands

| Command                   | Purpose                                                   | Release-blocking?              |
| ------------------------- | --------------------------------------------------------- | ------------------------------ |
| `npm run format:write`    | Apply repository formatting with Prettier                 | No; maintenance command        |
| `npm run format:check`    | Fail if tracked source/docs/config formatting differs     | Yes                            |
| `npm run typecheck`       | Strict TypeScript check without emitting files            | Yes                            |
| `npm run build`           | Clean TypeScript compilation                              | Yes                            |
| `npm run test:evaluation` | Deterministic synthetic summary evaluation                | Yes                            |
| `npm run test:api`        | HTTP service contract tests                               | Yes                            |
| `npm run test:ui`         | Browser workflow tests                                    | Yes                            |
| `npm test`                | Complete API + evaluation + UI suite                      | Yes                            |
| `npm run quality:check`   | Format + typecheck + complete test suite                  | Yes; local pre-push gate       |
| `npm run test:regression` | Mutate citation guard, prove test failure, restore source | Expected non-zero test outcome |

The current suite contains 20 tests: 7 API, 7 evaluation, and 6 UI tests.

## 4. Reporting: classified single-file HTML report

Every execution writes one self-contained HTML report beneath `reports/`:

```text
reports/
  COMBINED_TESTREPORT-STAGING-ddMMyyyy-HHmmss.html
```

The report separates outcomes instead of treating every red test line as a production defect:

| Classification    | Meaning                                                                                                                    | Release interpretation                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Passed            | Test passed on its first execution                                                                                         | Clean pass                                               |
| Expected failure  | Controlled fault injection declared with `test.fail()` failed as designed                                                  | Demonstration evidence; not an unplanned release failure |
| True failure      | A test expected to pass but failed, timed out, was interrupted, or unexpectedly passed after being marked expected-to-fail | Requires investigation; blocks release                   |
| Flaky / recovered | An earlier attempt failed and a retry passed                                                                               | Not a clean pass; investigate and track                  |
| Skipped           | Test was intentionally not executed                                                                                        | Excluded from pass-rate denominator                      |

Each diagnostic test displays its test category (API, UI, evaluation, etc.), severity (`critical`, `high`, `medium`, `low`), failure type (for example `real-defect`, `network`, `timeout`, `test-data`, `test-harness`), and attempt history. Filters allow review by status, category, tag, severity, and failure type. Evidence such as API request/response comparisons, screenshots, traces, and logs is embedded when available.

The report summary has separate counts for true failures, expected failures, flaky/recovered tests, and clean passes. Expected failures are not hidden inside the passed count. A controlled demo fault is not represented as a live production defect; its annotation identifies the scenario and severity for reporting purposes.

Reports are ignored by Git. CI uploads the `reports/` directory as a workflow artifact for 14 days.

## 5. Feature behavior under test

A support agent opens ticket `T-1042`, requests a summary, retries a failed generation, and can approve only an eligible result.

| Service response                                                                         | Expected dashboard behavior                                         | Verification             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| HTTP 200 `{ "status": "ok", "summary": "...", "sourceIds": ["m1"], "ticketVersion": 1 }` | Show summary and enable approval only if citations are valid        | UI + domain + evaluation |
| HTTP 200 `{ "status": "insufficient_information" }`                                      | Show insufficient-information state; approval disabled              | UI                       |
| HTTP 503 `{ "error": "unavailable" }`                                                    | Show error and retry; approval remains disabled until a valid retry | UI recovery              |
| HTTP 200 with missing citations                                                          | Ineligible for approval                                             | UI + domain + evaluation |
| HTTP 200 with cross-ticket citation                                                      | Ineligible for approval                                             | UI + domain + evaluation |

Summary wording can vary. Tests assert meaningful state and eligibility, not an exact generated sentence.

## 6. Architecture and boundaries

```text
Synthetic ticket fixture
       |
       v
Support dashboard (HTML + TypeScript)
       |
       v
Local HTTP summary service
       |
       +---- HTTP contract tests (API)
       |
       +---- Server-side approval endpoint + domain revalidation
       |
       +---- UI tests with isolated Playwright route mocks
       |
       v
Domain validation (approval eligibility)
       |
       v
Deterministic evaluation (attribution + synthetic unsupported-claim tripwire)
       |
       v
GitHub Actions release gate
```

### UI / Playwright

`tests/ui/summary.spec.ts` checks successful generation, insufficient information, 503 retry/recovery, missing citations, and cross-ticket citations. The reusable fixture in `tests/fixtures/test-fixtures.ts` gives each test its own Playwright page/context and response queue. No test shares mutable mock state. `fullyParallel: true` is enabled.

### API / service boundary

`tests/api/summary-api.spec.ts` exercises the local HTTP boundary, including route/body ticket mismatch, invalid/empty message IDs, unknown tickets, server-side rejection of cross-ticket citations, stale ticket versions, and successful approval recording. UI tests mock summary generation to deterministically represent service success, insufficient information, 503 recovery, malformed payloads and invalid citations. No external AI endpoint is called.

### Domain / deterministic AI evaluation

`src/domain/summary.ts` is the single source of truth for summary approval eligibility. It requires an `ok` status, non-empty summary text, at least one citation, citation membership in the current ticket, and no duplicate citation IDs.

`src/evaluation/evaluator.ts` reuses domain attribution checks and adds a narrow unsupported-claim tripwire for explicitly annotated synthetic examples. This is deliberately not described as a general hallucination detector. It establishes that the known synthetic unsupported-delivery example is rejected; it does not establish semantic entailment for arbitrary natural-language output.

### Trust boundary

A disabled browser button is not authorization. The patched approval endpoint revalidates summary content, citation membership and ticket version on the server. Its approval record is in-memory and disappears on process restart. There is no authentication or agent-level authorization in this synthetic exercise. Production requires identity integration, ticket-level authorization, durable transactional storage, immutable audit history, idempotency, and concurrency controls.

## 7. Deterministic evaluation and live-model strategy

Synthetic evaluation establishes that valid current-ticket attribution is accepted, missing and cross-ticket citations are rejected, and a known unsupported delivery assertion is rejected in its annotated example.

It does not prove general factuality, safety, semantic correctness, robustness, or resistance to prompt injection for a live model. Before production, add a versioned golden dataset with claim-level evidence annotations, human-adjudicated labels, calibrated model graders, repeated sampling and confidence intervals. Add separate evaluations for prompt injection, PII leakage, refusal behavior, RAG retrieval precision/recall, citation completeness, structured output, tool-call correctness, agent state transitions, latency, cost, timeouts, rate limits and model-version drift. Use risk-based thresholds and a human review path for ambiguous cases.

## 8. CI quality gate and release policy

`.github/workflows/quality-gate.yml` runs on pushes and pull requests to `main` / `master`, plus manual dispatch. The required job executes:

1. Locked dependency installation (`npm ci`).
2. Playwright Chromium installation on the supported GitHub-hosted runner.
3. Prettier format check.
4. Strict TypeScript type check.
5. TypeScript build.
6. Complete API + UI + deterministic evaluation suite.
7. Upload of HTML reports and failure evidence even when earlier steps fail.

**A release is blocked** by any formatting, type-check, build, API contract, UI behavior, domain eligibility, deterministic evaluation, or required test-infrastructure failure. Infrastructure failures must be investigated and rerun successfully; they are not silently converted to passes. Configure GitHub branch protection to require the `Required quality checks` status before merge. Workflow YAML alone cannot turn on branch protection.

### Local pre-push hook

Enable the repository hook once:

```bash
git config core.hooksPath .githooks
```

The `.githooks/pre-push` hook runs `npm run quality:check`. A push is rejected if formatting, TypeScript checks, or the complete test suite fails. A developer can still run the same command manually before pushing.

## 9. Intentional regression demonstration

```bash
npm run test:regression
```

The script temporarily disables the real current-ticket citation membership guard in `src/domain/summary.ts`, rebuilds, and runs the deterministic evaluation suite. The cross-ticket example must fail. The script restores the original source in a `finally` block and rebuilds the clean implementation. The command exits non-zero when the regression is correctly detected; this is expected for the demonstration.

Afterwards, prove the baseline is restored:

```bash
npm test
```

The unmodified baseline must pass all 20 tests.

## 10. Maintainability and scaling approach

The framework is intentionally layered and configuration-driven rather than tied to one dashboard or one model. To extend it:

- add ticket scenarios under `src/fixtures/`;
- add service adapters and contract tests under `src/` and `tests/api/`;
- add isolated browser workflows under `tests/ui/`;
- add versioned synthetic/golden evaluation examples and independent evaluation rules under `src/evaluation/`;
- add environment/browser settings through environment variables rather than hard-coded machine paths;
- keep shared fixtures stateless and test data unique per test;
- keep quality policy centralized in the CI workflow and `quality:check` command.

Avoid premature abstractions. Introduce plugin interfaces, multiple model adapters, distributed execution, or a test-orchestration service only when there are multiple real consumers and stable contracts to support them.

## 11. Should this have a dedicated dashboard?

**Not for this take-home.** A custom dashboard would consume the three-hour assessment budget and introduce an unrequested product surface. The Playwright HTML report plus GitHub Actions artifacts already provide readable results and investigation evidence.

Consider a dashboard later when the organization needs centralized multi-repository history, release comparisons, flaky-test trends, ownership, quality KPIs, scheduled runs, or role-based access. At that point, build a thin reporting layer over CI artifacts and a normalized results store; do not build a second test runner. For now, one `reports/` directory and the GitHub Actions workflow are the correct scope.

## 12. AI coding tools and verification

AI assistance may be used for scaffolding, drafting repetitive test cases and reviewing documentation. The final implementation must be verified through formatting, type checking, build, test execution and the intentional mutation demonstration. Generated code is not treated as correct merely because it compiles. The person submitting the work owns every design choice and must be able to explain it.

## 13. Next improvements

- Authentication, agent authorization, durable approval storage, immutable audit history and idempotency.
- Ticket mutation/version concurrency tests against a persistent ticket store.
- Runtime response-schema validation and malformed-payload contract tests.
- Stronger claim-level evidence evaluation and a curated, versioned golden dataset.
- Prompt-injection, PII, security, accessibility and browser-compatibility suites.
- Mutation testing, flaky-test telemetry, runtime budgets and deployment smoke tests.
- A centralized quality dashboard only when multi-project trend reporting becomes a real requirement.
