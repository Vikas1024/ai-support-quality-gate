# LogiQlink Technologies — Principal Quality Engineering Take-home

A local Playwright + TypeScript release gate for an AI-assisted support-ticket summary workflow. The project uses synthetic data and does not require external AI services, credentials, or paid services.

## 1. Requirements

- Node.js 20+
- npm
- Google Chrome Stable installed locally

The Playwright configuration uses the installed Chrome Stable channel by default. If Chrome is installed at a non-standard path, set `CHROME_EXECUTABLE` to its absolute path.

## 2. Quick start

```bash
npm ci
npm run format:check
npm run typecheck
npm run build
npm test
```

To start the local demo:

```bash
npm start
```

Open `http://127.0.0.1:4173/`. The synthetic demo ticket is `T-1042`. Stop the server with `Ctrl+C`.

## 3. Main commands

| Command                   | Purpose                                                     | Release-blocking         |
| ------------------------- | ----------------------------------------------------------- | ------------------------ |
| `npm run format:check`    | Check repository formatting                                 | Yes                      |
| `npm run typecheck`       | Run strict TypeScript checks                                | Yes                      |
| `npm run build`           | Compile the TypeScript project                              | Yes                      |
| `npm run test:evaluation` | Run deterministic summary evaluation                        | Yes                      |
| `npm run test:api`        | Run HTTP contract tests                                     | Yes                      |
| `npm run test:ui`         | Run browser workflow tests                                  | Yes                      |
| `npm test`                | Run the complete test suite                                 | Yes                      |
| `npm run quality:check`   | Run local formatting, type and test checks                  | Yes; local pre-push gate |
| `npm run test:regression` | Demonstrate detection of an intentional citation regression | Expected non-zero result |

The suite contains 20 tests: 7 API, 7 evaluation and 6 UI tests.

## 4. Workflow under test

A support agent opens ticket `T-1042`, requests a summary, retries a failed generation, and can approve only an eligible result.

| Service response                       | Expected behavior                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| HTTP 200 with a summary and source IDs | Display the summary; enable approval only when citations are valid           |
| HTTP 200 `insufficient_information`    | Display the insufficient-information state; keep approval disabled           |
| HTTP 503                               | Display an error and allow retry; keep approval disabled until a valid retry |
| Missing or cross-ticket citations      | Block approval                                                               |

Tests verify meaningful states and approval eligibility rather than exact summary wording.

## 5. Test design

- **UI:** `tests/ui/summary.spec.ts` covers successful generation, insufficient information, 503 retry/recovery, missing citations and cross-ticket citations.
- **API:** `tests/api/summary-api.spec.ts` covers service contracts, invalid message IDs, ticket mismatches, citation validation, stale ticket versions and approval recording.
- **Domain:** `src/domain/summary.ts` centralizes approval eligibility. A summary must have `ok` status, non-empty text, at least one citation, citations belonging to the current ticket, and no duplicate citation IDs.
- **Fixtures:** `tests/fixtures/test-fixtures.ts` provides isolated Playwright contexts and response queues so tests can run in parallel without sharing mutable mock state.

The approval endpoint repeats the citation and ticket-version checks on the server. The browser's disabled approval button is not treated as an authorization boundary.

## 6. Deterministic summary evaluation

`src/evaluation/evaluator.ts` evaluates synthetic examples. It checks source attribution and includes a narrow unsupported-claim check for an explicitly annotated synthetic example.

These tests establish that the known valid and invalid examples are handled as expected. They do not prove general factual accuracy or detect every possible hallucination.

A live-model evaluation would separately need a reviewed golden dataset and testing for factuality, prompt injection, privacy leakage, output variability, retrieval quality and model-version changes. Those live-model checks are outside this synthetic exercise.

Run the evaluation checks with:

```bash
npm run test:evaluation
```

## 7. Reports and failure evidence

Test runs generate a timestamped HTML report under `reports/`. The report includes test outcomes and available diagnostic evidence, such as request/response details, screenshots, traces and logs.

Reports are ignored by Git. GitHub Actions uploads the `reports/` directory as an artifact and retains it for 14 days.

## 8. CI release gate

The GitHub Actions workflow is defined in `.github/workflows/quality-gate.yml`. It runs on pushes and pull requests to `main` or `master`, and supports manual execution.

The workflow installs locked dependencies, sets up Google Chrome Stable and the Playwright FFmpeg utility, then runs formatting, TypeScript checks, the build and the complete test suite.

Formatting, type-checking, build, API, UI, evaluation or required test-infrastructure failures block the workflow. Reports and available failure evidence are uploaded even when a preceding step fails.

To make the check mandatory before merging, configure GitHub branch protection to require the `Required quality checks` status.

## 9. Intentional regression demonstration

Run:

```bash
npm run test:regression
```

The script temporarily disables the current-ticket citation membership guard in `src/domain/summary.ts`, rebuilds, and runs the deterministic evaluation suite. The cross-ticket citation example should then fail. The script restores the original source in a `finally` block and rebuilds the clean implementation.

The command exits non-zero when the regression is detected; this is expected for the demonstration. Verify that the baseline is restored by running:

```bash
npm test
```

The unmodified baseline should pass all 20 tests.

## 10. AI tool disclosure

AI coding tools were used selectively for implementation assistance. Changes were reviewed through code inspection, formatting, TypeScript checks, builds and test execution. The submitter is responsible for the implementation and its design decisions.

## 11. Scope and next steps

This is an assessment-sized reference implementation, not a production support platform. Authentication, agent authorization, durable approval storage and immutable audit retention are not implemented. Before production use, these controls and a broader, human-reviewed evaluation dataset would be required.
