import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const [directory, ...options] = process.argv.slice(2);
if (
  !directory ||
  options.length > 1 ||
  (options.length && options[0] !== '--check-types')
) {
  console.error(
    'Usage: node scripts/check-packages.mjs <archive-directory> [--check-types]',
  );
  process.exit(1);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} failed (${result.status ?? result.signal}).`,
  );
}

function validateArchive(name) {
  const archive = path.resolve(directory, `${name}.tgz`);
  const source = JSON.parse(
    readFileSync(
      path.join(repository, 'typescript', name, 'package.json'),
      'utf8',
    ),
  );
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .trim()
    .split('\n');
  for (const file of files) {
    assert.ok(!file.split('/').includes('..'), `Invalid archive path: ${file}`);
    assert.match(
      file,
      /^package\/(?:dist\/.+\.(?:js|d\.ts)|docs\/.+\.md|README\.md|CHANGELOG\.md|LICENSE|package\.json)$/,
    );
  }
  for (const file of [
    'package.json',
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
    'docs/usage.md',
    'dist/index.js',
    'dist/index.d.ts',
  ]) {
    assert.ok(files.includes(`package/${file}`), `${name} is missing ${file}.`);
  }
  const metadata = JSON.parse(
    execFileSync('tar', ['-xOzf', archive, 'package/package.json'], {
      encoding: 'utf8',
    }),
  );
  assert.equal(metadata.name, source.name);
  assert.equal(metadata.version, source.version);
  assert.equal(metadata.license, 'MIT');
  assert.equal(metadata.type, 'module');
  assert.equal(metadata.sideEffects, false);
  assert.deepEqual(metadata.exports, source.publishConfig.exports);
  assert.equal(metadata.main, './dist/index.js');
  assert.equal(metadata.types, './dist/index.d.ts');
  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    assert.deepEqual(
      metadata[field] ?? {},
      {},
      `${metadata.name} must remain dependency-free.`,
    );
  }
  console.log(
    `Verified ${metadata.name}@${metadata.version}: ${files.length} distribution files.`,
  );
  return [metadata.name, pathToFileURL(archive).href];
}

const consumer = mkdtempSync(path.join(tmpdir(), 'nuxus-sdk-consumer-'));
try {
  const dependencies = Object.fromEntries(
    ['engine-sdk', 'data-sdk'].map(validateArchive),
  );
  cpSync(path.join(repository, 'scripts/fixtures/package-consumer'), consumer, {
    recursive: true,
  });
  const manifestPath = path.join(consumer, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(
    manifestPath,
    JSON.stringify({ ...manifest, dependencies }, null, 2) + '\n',
  );
  run(
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--cache',
      path.join(consumer, '.npm-cache'),
    ],
    consumer,
  );
  run(
    process.execPath,
    ['--conditions=development', '--test', 'smoke.test.mjs'],
    consumer,
  );
  if (options.includes('--check-types')) {
    const require = createRequire(
      path.join(repository, 'typescript/engine-sdk/package.json'),
    );
    run(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'],
      consumer,
    );
    console.log('Packed TypeScript declarations passed consumer checks.');
  }
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
