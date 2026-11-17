import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const suiteArg = rawArgs.find((arg) => arg.startsWith('--suite='));
const rawSuite = (suiteArg?.split('=')[1] ?? process.env.REPORT_SUITE ?? 'Complete').replace(
  /[^A-Za-z0-9+_-]/g,
  '',
);

const suiteNames: Record<string, string> = {
  API: 'API',
  UI: 'UI',
  Evaluation: 'AI',
  Complete: 'COMBINED',
};
const suiteName = suiteNames[rawSuite] ?? rawSuite.toUpperCase();
const environment = (process.env.REPORT_ENV ?? 'STAGING')
  .replace(/[^A-Za-z0-9_-]/g, '')
  .toUpperCase();
const demoMode = rawArgs.includes('--demo');
const args = rawArgs.filter((arg) => !arg.startsWith('--suite=') && arg !== '--demo');
const now = new Date();
const pad = (value: number): string => String(value).padStart(2, '0');
const timestamp =
  `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}-` +
  `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const reportsDir = path.join(root, 'reports');
const reportFile = path.join(
  reportsDir,
  `${suiteName}_TESTREPORT-${environment}-${timestamp}.html`,
);
await mkdir(reportsDir, { recursive: true });

const temporaryOutputDir = await mkdtemp(path.join(os.tmpdir(), 'logiqlink-playwright-'));
const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
let exitCode = 1;

try {
  const child = spawn(process.execPath, ['--import', 'tsx', cli, 'test', ...args], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      REPORT_FILE: reportFile,
      REPORT_ENV: environment,
      REPORT_SUITE: suiteName,
      REPORT_DEMO: demoMode ? '1' : '0',
      TEST_OUTPUT_DIR: temporaryOutputDir,
    },
  });

  exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
} finally {
  await rm(temporaryOutputDir, { recursive: true, force: true });
}

try {
  await access(reportFile);
  console.log('\n========================================');
  console.log('REPORT GENERATED');
  console.log('========================================');
  console.log(`File: ${path.relative(root, reportFile)}`);
  console.log('Format: Single self-contained HTML file');
  console.log('Temporary test artifacts: cleaned up');
  console.log('========================================\n');
} catch {
  console.error('\nHTML report was not generated.');
}

process.exitCode = Number(exitCode);
