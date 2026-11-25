import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const domainPath = path.join(root, 'src/domain/summary.ts');
const evaluatorPath = path.join(root, 'src/evaluation/evaluator.ts');

const originalDomain = await readFile(domainPath, 'utf8');
const originalEvaluator = await readFile(evaluatorPath, 'utf8');

// Keep the .some() expression in place so TypeScript retains its array narrowing.
// The trailing && false disables the guard at runtime without breaking the build.
const domainGuard = "if (sourceIds.some((id) => typeof id !== 'string' || !allowedIds.has(id)))";
const disabledDomainGuard =
  "if (sourceIds.some((id) => typeof id !== 'string' || !allowedIds.has(id)) && false)";

const evaluatorGuard = 'passed: sourceIds.every((id) => allowedIds.has(id)),';
const disabledEvaluatorGuard = 'passed: true, // intentional regression: accept any source ID';

if (!originalDomain.includes(domainGuard)) {
  console.error('Could not find the domain citation guard. No files changed.');
  process.exit(2);
}

if (!originalEvaluator.includes(evaluatorGuard)) {
  console.error('Could not find the evaluator attribution check. No files changed.');
  process.exit(2);
}

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

let regressionBuildExit = 0;
let testExit = 0;
let restoreExit = 0;

try {
  await writeFile(domainPath, originalDomain.replace(domainGuard, disabledDomainGuard));
  await writeFile(evaluatorPath, originalEvaluator.replace(evaluatorGuard, disabledEvaluatorGuard));

  console.log(
    '\n[REGRESSION] Disabled domain citation validation and evaluator source-attribution validation.',
  );

  regressionBuildExit = await run('npm', ['run', 'build']);

  if (regressionBuildExit === 0) {
    testExit = await run(process.execPath, [
      '--import',
      'tsx',
      'scripts/run-playwright.ts',
      '--suite=Regression',
      'tests/evaluation',
    ]);
  } else {
    console.error('[ERROR] Regression build failed. Evaluation tests were not executed.');
  }
} finally {
  await writeFile(domainPath, originalDomain);
  await writeFile(evaluatorPath, originalEvaluator);

  console.log('\n[RESTORE] Original source files restored. Rebuilding clean output.');
  restoreExit = await run('npm', ['run', 'build']);
}

if (restoreExit !== 0) {
  console.error(
    'CRITICAL: source files were restored but the clean rebuild failed. Run npm run build manually.',
  );
  process.exitCode = 2;
} else if (regressionBuildExit !== 0) {
  console.error('Regression demonstration invalid: the mutated project did not build.');
  process.exitCode = 2;
} else if (testExit === 0) {
  console.error('Regression was NOT detected. The evaluation suite passed unexpectedly.');
  process.exitCode = 1;
} else {
  console.log(
    '\n[EXPECTED] Evaluation failed under the intentional citation regression. Original source is restored.',
  );
  process.exitCode = 1;
}
