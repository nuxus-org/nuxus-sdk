import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(
  readFileSync(path.join(repository, 'package.json'), 'utf8'),
);

function command(root, executable, args, env = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    env: {
      // A hook's Git variables must not redirect fixture commands to the real checkout.
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
      ),
      CI: '',
      HUSKY: '',
      NODE_ENV: '',
      GIT_CONFIG_GLOBAL: path.join(root, '.no-global-config'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...env,
    },
  });
  if (result.error) throw result.error;
  return result;
}

function checked(root, executable, args, env) {
  const result = command(root, executable, args, env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const parent = path.resolve(tmpdir());
  const root = mkdtempSync(path.join(parent, 'nuxus-sdk-hooks-'));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('nuxus-sdk-hooks-'));
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => checked(root, 'git', args);
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Hook fixture');
  git('config', 'user.email', 'hooks@example.test');
  git('config', 'core.autocrlf', 'false');
  for (const file of [
    '.editorconfig',
    '.gitattributes',
    '.prettierrc.json',
    '.prettierignore',
    'eslint.config.mjs',
    '.husky/install.mjs',
    '.husky/pre-commit',
    '.husky/pre-push',
    '.gitleaks-version',
    'scripts/check-secrets.mjs',
  ]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    copyFileSync(path.join(repository, file), path.join(root, file));
  }
  write('.gitignore', 'node_modules/\n.husky/_/\nremote.git/\n');
  write('README.md', '# Fixture\n');
  write('scripts/sample.mjs', 'export const value = 1;\n');
  write(
    'package.json',
    JSON.stringify(
      {
        private: true,
        type: 'module',
        packageManager: manifest.packageManager,
        scripts: {
          prepare: manifest.scripts.prepare,
          'check:staged': manifest.scripts['check:staged'],
          'check:secrets': manifest.scripts['check:secrets'],
          'check:secrets:staged': manifest.scripts['check:secrets:staged'],
          'check-types': manifest.scripts['check-types'],
        },
        'lint-staged': manifest['lint-staged'],
      },
      null,
      2,
    ) + '\n',
  );
  // Reuse installed tools without allowing pnpm to reinstall symlinked modules.
  write(
    'pnpm-workspace.yaml',
    "packages:\n  - 'typescript/*'\nverifyDepsBeforeRun: false\n",
  );
  symlinkSync(
    path.join(repository, 'node_modules'),
    path.join(root, 'node_modules'),
    'junction',
  );
  for (const name of ['engine-sdk', 'data-sdk']) {
    const directory = `typescript/${name}`;
    write(
      `${directory}/package.json`,
      JSON.stringify({
        name: `@nuxus/${name}`,
        private: true,
        type: 'module',
        scripts: { 'check-types': 'tsc --noEmit' },
      }),
    );
    write(
      `${directory}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          strict: true,
          types: [],
          skipLibCheck: true,
        },
        include: ['src'],
      }),
    );
    write(`${directory}/src/index.ts`, 'export const value: number = 1;\n');
    symlinkSync(
      path.join(repository, directory, 'node_modules'),
      path.join(root, directory, 'node_modules'),
      'junction',
    );
  }
  git('add', '.');
  git('-c', 'core.hooksPath=.no-hooks', 'commit', '-qm', 'fixture');
  const base = git('rev-parse', 'HEAD');
  checked(root, process.execPath, ['.husky/install.mjs']);
  return { root, git, write, base };
}

test('prepare works in a source archive without Git or hook files', (t) => {
  const f = fixture(t);
  f.write(
    'archive/package.json',
    JSON.stringify({ scripts: { prepare: manifest.scripts.prepare } }),
  );
  checked(path.join(f.root, 'archive'), 'pnpm', ['run', 'prepare']);
});

test('CI, production and explicit opt-out skip hook installation', (t) => {
  const f = fixture(t);
  f.git('config', '--unset', 'core.hooksPath');
  for (const env of [
    { CI: 'true' },
    { NODE_ENV: 'production' },
    { HUSKY: '0' },
  ]) {
    checked(f.root, process.execPath, ['.husky/install.mjs'], env);
    assert.equal(
      command(f.root, 'git', ['config', '--get', 'core.hooksPath']).status,
      1,
    );
  }
});

test('pre-commit rejects bad formatting and preserves staged, unstaged and untracked content', (t) => {
  const f = fixture(t);
  const file = 'scripts/sample.mjs';
  const staged = 'export const value=2\n';
  const unstaged = 'export const value = 3;\n';
  f.write(file, staged);
  f.git('add', file);
  f.write(file, unstaged);
  f.write('scratch.txt', 'preserve me\n');
  const result = command(f.root, 'git', ['commit', '-m', 'invalid formatting']);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /prettier|Code style issues/);
  assert.equal(f.git('rev-parse', 'HEAD'), f.base);
  assert.equal(f.git('show', `:${file}`) + '\n', staged);
  assert.equal(readFileSync(path.join(f.root, file), 'utf8'), unstaged);
  assert.equal(
    readFileSync(path.join(f.root, 'scratch.txt'), 'utf8'),
    'preserve me\n',
  );
});

test('pre-commit accepts a partial stage, spaced filenames and public type tests', (t) => {
  const f = fixture(t);
  const file = 'scripts/sample.mjs';
  f.write(file, 'export const value = 2;\n');
  f.write('docs/guide with spaces.md', '# Guide\n');
  f.write(
    'typescript/engine-sdk/tests/contracts.types.ts',
    'export type Fixture = string;\n',
  );
  f.git('add', '.');
  const unstaged = 'missingFunction()\n';
  f.write(file, unstaged);
  f.git('commit', '-qm', 'valid staged content');
  assert.equal(f.git('show', `HEAD:${file}`), 'export const value = 2;');
  assert.equal(readFileSync(path.join(f.root, file), 'utf8'), unstaged);
});

test('pre-commit rejects formatted code with a lint error', (t) => {
  const f = fixture(t);
  f.write('scripts/sample.mjs', 'missingFunction();\n');
  f.git('add', '.');
  const result = command(f.root, 'git', ['commit', '-m', 'lint error']);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /no-undef/);
  assert.equal(f.git('rev-parse', 'HEAD'), f.base);
});

function secretFixture() {
  return (
    'ghp_' +
    Array.from('0123456789abcdefghijklmnopqrstuvwxyz').reverse().join('')
  );
}

test('pre-commit scans the index and blocks a secret absent from the working tree', (t) => {
  const f = fixture(t);
  const secret = secretFixture();
  const file = 'credentials.txt';
  f.write(file, `${secret}\n`);
  f.git('add', file);
  f.write(file, 'safe working copy\n');
  const result = command(f.root, 'git', ['commit', '-m', 'must reject secret']);
  const output = result.stdout + result.stderr;
  assert.notEqual(result.status, 0, output);
  assert.match(output, /github-pat/);
  assert.match(output, /REDACTED/);
  assert.ok(!output.includes(secret));
  assert.equal(f.git('rev-parse', 'HEAD'), f.base);
  assert.equal(f.git('show', `:${file}`), secret);
  assert.equal(
    readFileSync(path.join(f.root, file), 'utf8'),
    'safe working copy\n',
  );
});

test('pre-commit permits a safe stage while preserving an unstaged secret', (t) => {
  const f = fixture(t);
  const file = 'scripts/sample.mjs';
  f.write(file, 'export const value = 2;\n');
  f.git('add', file);
  const unstaged = `export const value = '${secretFixture()}';\n`;
  f.write(file, unstaged);
  f.git('commit', '-qm', 'safe staged content');
  assert.equal(f.git('show', `HEAD:${file}`), 'export const value = 2;');
  assert.equal(readFileSync(path.join(f.root, file), 'utf8'), unstaged);
});

test('history scan finds a removed secret and redacts the result', (t) => {
  const f = fixture(t);
  const secret = secretFixture();
  f.write('credentials.txt', `${secret}\n`);
  f.git('add', '.');
  f.git(
    '-c',
    'core.hooksPath=.no-hooks',
    'commit',
    '-qm',
    'historical secret fixture',
  );
  f.write('credentials.txt', 'safe content\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'remove historical secret');
  const result = command(f.root, 'pnpm', ['run', 'check:secrets']);
  const output = result.stdout + result.stderr;
  assert.notEqual(result.status, 0, output);
  assert.match(output, /github-pat/);
  assert.match(output, /REDACTED/);
  assert.ok(!output.includes(secret));
});

test('secret checks fail when the CLI is missing or the version is wrong', (t) => {
  const f = fixture(t);
  const bin = path.join(f.root, 'bin');
  mkdirSync(bin);
  const missing = command(
    f.root,
    process.execPath,
    ['scripts/check-secrets.mjs', 'staged'],
    { PATH: bin },
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Install the CLI/);
  f.write('bin/gitleaks', "#!/bin/sh\nprintf '0.0.0\\n'\n");
  chmodSync(path.join(bin, 'gitleaks'), 0o755);
  const mismatch = command(
    f.root,
    process.execPath,
    ['scripts/check-secrets.mjs', 'staged'],
    { PATH: bin },
  );
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /as pinned in .gitleaks-version/);
});

test('pre-push checks both SDKs and permits a push after type errors are fixed', (t) => {
  const f = fixture(t);
  f.git('init', '--bare', '-q', 'remote.git');
  f.git('remote', 'add', 'origin', path.join(f.root, 'remote.git'));
  f.git('-c', 'core.hooksPath=.no-hooks', 'push', '-qu', 'origin', 'main');
  for (const name of ['engine-sdk', 'data-sdk']) {
    f.write(
      `typescript/${name}/src/index.ts`,
      "export const value: number = 'invalid';\n",
    );
    f.git('add', '.');
    f.git('commit', '-qm', `type error in ${name}`);
    const result = command(f.root, 'git', ['push', 'origin', 'main']);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /check-types/);
    assert.equal(
      f.git('--git-dir=remote.git', 'rev-parse', 'refs/heads/main'),
      f.base,
    );
    f.write(
      `typescript/${name}/src/index.ts`,
      'export const value: number = 2;\n',
    );
  }
  f.git('add', '.');
  f.git('commit', '-qm', 'valid types');
  f.git('push', '-q', 'origin', 'main');
  assert.equal(
    f.git('--git-dir=remote.git', 'rev-parse', 'refs/heads/main'),
    f.git('rev-parse', 'HEAD'),
  );
});
