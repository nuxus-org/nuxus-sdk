import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [mode, ...extra] = process.argv.slice(2);
if (!['staged', 'history'].includes(mode) || extra.length) {
  console.error('Usage: node scripts/check-secrets.mjs <staged|history>');
  process.exit(1);
}

const expectedVersion = readFileSync(
  new URL('../.gitleaks-version', import.meta.url),
  'utf8',
).trim();
const version = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  console.error(
    version.error?.code === 'ENOENT'
      ? `Gitleaks ${expectedVersion} is required. Install the CLI and add it to PATH; see README.md.`
      : 'Could not execute Gitleaks. Check the CLI installation and execution permissions.',
  );
  process.exit(1);
}
if (version.stdout.trim().replace(/^v/, '') !== expectedVersion) {
  console.error(
    `Use Gitleaks ${expectedVersion}, as pinned in .gitleaks-version.`,
  );
  process.exit(1);
}

const result = spawnSync(
  'gitleaks',
  [
    'git',
    '--redact=100',
    '--verbose',
    '--no-banner',
    '--no-color',
    ...(mode === 'staged'
      ? ['--pre-commit', '--staged']
      : ['--log-opts=--all']),
  ],
  { stdio: 'inherit' },
);
if (result.error) console.error('Could not run Gitleaks.');
process.exit(result.status ?? 1);
