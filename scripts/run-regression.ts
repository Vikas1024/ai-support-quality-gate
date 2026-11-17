import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'src/domain/summary.ts');
const original = await readFile(sourcePath, 'utf8');
const correctGuard = 'if (sourceIds.some((id) => typeof id !== "string" || !allowedIds.has(id))) {';
const regressedGuard =
  'if (false && sourceIds.some((id) => typeof id !== "string" || !allowedIds.has(id))) {';

if (!original.includes(correctGuard)) {
  console.error(
    'Regression mutation could not find the expected citation-membership guard. No files changed.',
  );
  process.exit(2);
}

function run(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

let testExit = 0;
let restoreExit = 0;

try {
  await writeFile(sourcePath, original.replace(correctGuard, regressedGuard));
  console.log('\n[REGRESSION] Temporarily disabled current-ticket citation membership validation.');
  const buildExit = await run('npm', ['run', 'build']);
  if (buildExit !== 0) throw new Error('Regression build failed before tests could run.');
  testExit = await run(
    process.execPath,
    ['--import', 'tsx', 'scripts/run-playwright.ts', 'tests/evaluation'],
    {
      REPORT_SUITE: 'Regression',
    },
  );
} finally {
  await writeFile(sourcePath, original);
  console.log('\n[RESTORE] Original citation validation restored. Rebuilding clean output.');
  restoreExit = await run('npm', ['run', 'build']);
}

if (restoreExit !== 0) {
  console.error(
    'CRITICAL: source was restored but the clean rebuild failed. Run npm run build manually.',
  );
  process.exitCode = 2;
} else if (testExit === 0) {
  console.error('Regression was NOT detected. The quality gate should have failed but passed.');
  process.exitCode = 1;
} else {
  console.log(
    '\n[EXPECTED] The evaluation suite failed under the intentional regression. Source is restored.',
  );
  process.exitCode = 1;
}
