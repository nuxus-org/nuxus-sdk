import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  compareVersions,
  githubRelease,
  publicationDecision,
  publish,
  readRegistry,
  resolveRelease,
} from './release.mjs';

function fixture(t, packageName = 'engine-sdk', version = '0.1.0-alpha.1') {
  const directory = mkdtempSync(path.join(tmpdir(), 'nuxus-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const packageDirectory = path.join(directory, 'typescript', packageName);
  mkdirSync(packageDirectory, { recursive: true });
  mkdirSync(path.join(directory, 'docs/releases'), { recursive: true });
  const manifest = {
    name: `@nuxus/${packageName}`,
    version,
    repository: { url: 'git+https://github.com/nuxus-org/nuxus-sdk.git' },
    publishConfig: {
      access: 'public',
      tag: version.includes('-')
        ? version.split('-')[1].split('.')[0]
        : 'latest',
    },
  };
  const manifestPath = path.join(packageDirectory, 'package.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(
    path.join(packageDirectory, 'CHANGELOG.md'),
    `# Changelog\n\n## ${version} — Unreleased\n`,
  );
  const tag = `${packageName}-v${version}`;
  const notesPath = path.join(directory, 'docs/releases', `${tag}.md`);
  writeFileSync(notesPath, `# ${manifest.name} ${version}\n\nRelease notes.\n`);
  return { directory, manifest, manifestPath, tag, notesPath };
}

const release = {
  name: '@nuxus/engine-sdk',
  version: '0.1.0-alpha.2',
  channel: 'alpha',
};
const integrity = 'sha512-verified-archive';
const packument = (versions = {}, tags = {}) => ({
  name: release.name,
  versions,
  'dist-tags': tags,
});

test('package tags select exactly one SDK and its prepared notes', (t) => {
  for (const packageName of ['engine-sdk', 'data-sdk']) {
    const setup = fixture(t, packageName);
    const resolved = resolveRelease(setup.tag, setup.directory);
    assert.equal(resolved.package, packageName);
    assert.equal(resolved.name, `@nuxus/${packageName}`);
    assert.equal(resolved.channel, 'alpha');
    assert.equal(resolved.prerelease, true);
    assert.equal(resolved.notes, `docs/releases/${setup.tag}.md`);
  }
});

test('stable releases require the latest channel', (t) => {
  const setup = fixture(t, 'data-sdk', '1.0.0');
  const resolved = resolveRelease(setup.tag, setup.directory);
  assert.equal(resolved.channel, 'latest');
  assert.equal(resolved.prerelease, false);
});

test('invalid tags and unsupported versions cannot choose a package or path', () => {
  for (const tag of [
    'v0.1.0-alpha.1',
    'other-v0.1.0',
    'engine-sdk-v../package',
    'engine-sdk-v01.0.0',
    'data-sdk-v0.1.0-alpha.01',
    'data-sdk-v0.1.0-canary.1',
    'data-sdk-v0.1.0+metadata',
  ]) {
    assert.throws(() => resolveRelease(tag));
  }
});

test('tag/version mismatch and accidental latest publication fail before publishing', (t) => {
  const setup = fixture(t);
  assert.throws(
    () => resolveRelease('engine-sdk-v0.1.0-alpha.2', setup.directory),
    /must match the package version/,
  );
  setup.manifest.publishConfig.tag = 'latest';
  writeFileSync(setup.manifestPath, JSON.stringify(setup.manifest));
  assert.throws(
    () => resolveRelease(setup.tag, setup.directory),
    /must match the release channel/,
  );
});

test('release notes, changelog, public access and repository identity are required', (t) => {
  const setup = fixture(t);
  writeFileSync(setup.notesPath, '# Wrong package\n');
  assert.throws(
    () => resolveRelease(setup.tag, setup.directory),
    /Release notes must start/,
  );
  writeFileSync(
    setup.notesPath,
    `# ${setup.manifest.name} ${setup.manifest.version}\n\nNotes.\n`,
  );
  for (const mutate of [
    (manifest) => {
      manifest.private = true;
    },
    (manifest) => {
      manifest.publishConfig.access = 'restricted';
    },
    (manifest) => {
      manifest.repository.url = 'git+https://github.com/other/sdk.git';
    },
  ]) {
    const manifest = structuredClone(setup.manifest);
    mutate(manifest);
    writeFileSync(setup.manifestPath, JSON.stringify(manifest));
    assert.throws(() => resolveRelease(setup.tag, setup.directory));
  }
  writeFileSync(setup.manifestPath, JSON.stringify(setup.manifest));
  writeFileSync(
    path.join(setup.directory, 'typescript/engine-sdk/CHANGELOG.md'),
    '# Changelog\n',
  );
  assert.throws(
    () => resolveRelease(setup.tag, setup.directory),
    /changelog must include/,
  );
});

test('a new version publishes without touching other distribution channels', () => {
  assert.equal(
    publicationDecision(
      packument({}, { alpha: '0.1.0-alpha.1', latest: '0.0.9' }),
      release,
      integrity,
    ),
    'publish',
  );
});

test('retries skip an existing version only when its archive integrity matches', () => {
  assert.equal(
    publicationDecision(
      packument(
        { [release.version]: { dist: { integrity } } },
        { alpha: '0.1.0-alpha.3' },
      ),
      release,
      integrity,
    ),
    'already-published',
  );
  for (const dist of [{ integrity: 'sha512-different' }, {}]) {
    assert.throws(
      () =>
        publicationDecision(
          packument({ [release.version]: { dist } }),
          release,
          integrity,
        ),
      /different contents/,
    );
  }
});

test('missing packages require bootstrap and registry identity must match', () => {
  assert.throws(
    () => publicationDecision(null, release, integrity),
    /first-publication/,
  );
  assert.throws(() =>
    publicationDecision({ name: '@other/package' }, release, integrity),
  );
});

test('identical archives still require the npm channel to point at this version or a newer one', () => {
  for (const tags of [{}, { alpha: '0.1.0-alpha.1' }]) {
    assert.throws(
      () =>
        publicationDecision(
          packument({ [release.version]: { dist: { integrity } } }, tags),
          release,
          integrity,
        ),
      /dist-tag is missing or older/,
    );
  }
});

test('delayed tag runs cannot move an npm channel backwards', () => {
  for (const current of ['0.1.0-alpha.2', '0.1.0-alpha.10', '0.2.0-alpha.1']) {
    assert.throws(
      () =>
        publicationDecision(
          packument({}, { alpha: current }),
          release,
          integrity,
        ),
      /backwards/,
    );
  }
});

test('release ordering follows semantic version precedence and numeric prereleases', () => {
  const ordered = [
    '0.1.0-alpha.2',
    '0.1.0-alpha.10',
    '0.1.0-beta.1',
    '0.1.0-rc.1',
    '0.1.0',
    '0.1.1-alpha.1',
    '1.0.0',
    '10.0.0',
  ];
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
    assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1);
  }
  assert.equal(compareVersions('0.1.0-alpha.2', '0.1.0-alpha.2'), 0);
});

test('registry lookup distinguishes a missing package from registry/auth failures', async () => {
  const missing = await readRegistry(release.name, async (url, options) => {
    assert.equal(url, 'https://registry.npmjs.org/%40nuxus%2Fengine-sdk');
    assert.equal(options.cache, 'no-store');
    return { status: 404 };
  });
  assert.equal(missing, null);
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      readRegistry(release.name, async () => ({ status, ok: false })),
      new RegExp(`HTTP ${status}`),
    );
  }
  const data = packument();
  assert.equal(
    await readRegistry(release.name, async () => ({
      status: 200,
      ok: true,
      json: async () => data,
    })),
    data,
  );
});

function publicationFixture(t) {
  const setup = fixture(t);
  const resolved = resolveRelease(setup.tag, setup.directory);
  const archive = path.join(setup.directory, 'engine-sdk.tgz');
  const contents = Buffer.from('Test archive contents');
  writeFileSync(archive, contents);
  const hash = `sha512-${createHash('sha512').update(contents).digest('base64')}`;
  const registered = { name: resolved.name, versions: {}, 'dist-tags': {} };
  const published = {
    ...registered,
    versions: { [resolved.version]: { dist: { integrity: hash } } },
    'dist-tags': { alpha: resolved.version },
  };
  const writes = [];
  const run = (command, args) => {
    if (command === 'tar') return JSON.stringify(setup.manifest);
    assert.equal(command, 'npm');
    if (args[0] === '--version') return '11.6.1';
    assert.equal(args[0], 'publish');
    writes.push(args);
    return '';
  };
  return { ...setup, resolved, archive, registered, published, writes, run };
}

test('publication uses only the verified archive with provenance, the explicit channel and disabled scripts', async (t) => {
  const setup = publicationFixture(t);
  let lookups = 0;
  await publish(setup.resolved, setup.directory, {
    run: setup.run,
    lookup: async (name) => {
      assert.equal(name, '@nuxus/engine-sdk');
      return lookups++ === 0 ? setup.registered : setup.published;
    },
  });
  assert.equal(lookups, 2);
  assert.deepEqual(setup.writes, [
    [
      'publish',
      setup.archive,
      '--access=public',
      '--tag=alpha',
      '--ignore-scripts',
      '--provenance',
      '--registry=https://registry.npmjs.org',
    ],
  ]);
});

test('publication retries do not invoke npm publish for an identical version', async (t) => {
  const setup = publicationFixture(t);
  await publish(setup.resolved, setup.directory, {
    run: setup.run,
    lookup: async () => setup.published,
  });
  assert.equal(setup.writes.length, 0);
});

test('wrong archive metadata, missing packages and integrity conflicts cannot invoke npm publish', async (t) => {
  const setup = publicationFixture(t);
  for (const registered of [
    null,
    {
      ...setup.published,
      versions: {
        [setup.resolved.version]: { dist: { integrity: 'sha512-conflict' } },
      },
    },
  ]) {
    await assert.rejects(
      publish(setup.resolved, setup.directory, {
        run: setup.run,
        lookup: async () => registered,
      }),
    );
    assert.equal(setup.writes.length, 0);
  }
  setup.manifest.version = '0.1.0-alpha.9';
  await assert.rejects(
    publish(setup.resolved, setup.directory, {
      run: setup.run,
      lookup: async () => {
        assert.fail('Wrong metadata must fail before the registry lookup.');
      },
    }),
  );
  assert.equal(setup.writes.length, 0);
});

test('post-publication verification rejects changed integrity and a wrong dist-tag', async (t) => {
  for (const mismatch of ['integrity', 'channel']) {
    const setup = publicationFixture(t);
    const published = structuredClone(setup.published);
    if (mismatch === 'integrity')
      published.versions[setup.resolved.version].dist.integrity =
        'sha512-conflict';
    else published['dist-tags'].alpha = '0.1.0-alpha.9';
    let lookups = 0;
    await assert.rejects(
      publish(setup.resolved, setup.directory, {
        run: setup.run,
        lookup: async () => (lookups++ === 0 ? setup.registered : published),
      }),
    );
    assert.equal(setup.writes.length, 1);
  }
});

test('publication waits for registry processing longer than ten seconds without republishing', async (t) => {
  const setup = publicationFixture(t);
  let elapsed = 0;
  let lookups = 0;
  await publish(setup.resolved, setup.directory, {
    run: setup.run,
    lookup: async () => {
      lookups++;
      return elapsed >= 30_000 ? setup.published : setup.registered;
    },
    now: () => elapsed,
    pause: async (milliseconds) => {
      elapsed += milliseconds;
    },
  });
  assert.equal(elapsed, 30_000);
  assert.ok(lookups > 2);
  assert.equal(setup.writes.length, 1);
});

test('registry visibility retries stop after five minutes without repeating npm publish', async (t) => {
  const setup = publicationFixture(t);
  let lookups = 0;
  let elapsed = 0;
  await assert.rejects(
    publish(setup.resolved, setup.directory, {
      run: setup.run,
      lookup: async () => {
        lookups++;
        return setup.registered;
      },
      pause: async (milliseconds) => {
        assert.ok(milliseconds > 0 && milliseconds <= 10_000);
        elapsed += milliseconds;
      },
      now: () => elapsed,
    }),
    /verification timed out/,
  );
  assert.ok(lookups > 1);
  assert.equal(elapsed, 5 * 60_000);
  assert.equal(setup.writes.length, 1);
});

test('slow registry responses count toward the publication verification deadline', async (t) => {
  const setup = publicationFixture(t);
  let elapsed = 0;
  let lookups = 0;
  await assert.rejects(
    publish(setup.resolved, setup.directory, {
      run: setup.run,
      lookup: async () => {
        if (lookups++ > 0) elapsed += 80_000;
        return setup.registered;
      },
      now: () => elapsed,
      pause: async (milliseconds) => {
        elapsed += milliseconds;
      },
    }),
    /verification timed out/,
  );
  assert.ok(elapsed >= 5 * 60_000 && elapsed < 5 * 60_000 + 80_000);
  assert.equal(setup.writes.length, 1);
});

test('GitHub prereleases use the selected tag and checked-in notes', async (t) => {
  const setup = fixture(t);
  const resolved = resolveRelease(setup.tag, setup.directory);
  const requests = [];
  await githubRelease(resolved, {
    token: 'test-only',
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1
        ? { status: 404, ok: false }
        : { status: 201 };
    },
  });
  assert.equal(
    requests[0].url,
    `https://api.github.com/repos/nuxus-org/nuxus-sdk/releases/tags/${setup.tag}`,
  );
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    tag_name: setup.tag,
    name: '@nuxus/engine-sdk 0.1.0-alpha.1',
    body: resolved.body,
    draft: false,
    prerelease: true,
    make_latest: 'false',
  });
});

test('GitHub retries preserve matching releases and reject conflicting notes or API failures', async (t) => {
  const setup = fixture(t);
  const resolved = resolveRelease(setup.tag, setup.directory);
  for (const scenario of ['matching', 'conflicting', 'forbidden']) {
    let requests = 0;
    const result = githubRelease(resolved, {
      token: 'test-only',
      fetcher: async () => {
        requests++;
        return scenario === 'forbidden'
          ? { status: 403, ok: false }
          : {
              status: 200,
              ok: true,
              json: async () => ({
                draft: false,
                prerelease: true,
                body: scenario === 'matching' ? resolved.body : 'Other notes',
              }),
            };
      },
    });
    if (scenario === 'matching') await result;
    else await assert.rejects(result);
    assert.equal(requests, 1);
  }
});

test('the command refuses local publishing and branch dispatches', () => {
  const script = new URL('./release.mjs', import.meta.url);
  const local = spawnSync(
    process.execPath,
    [script.pathname, 'publish', '/tmp'],
    { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' } },
  );
  assert.equal(local.status, 1);
  assert.match(local.stderr, /only in GitHub Actions/);
  const branch = spawnSync(process.execPath, [script.pathname, 'prepare'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'nuxus-org/nuxus-sdk',
      GITHUB_REF_TYPE: 'branch',
    },
  });
  assert.equal(branch.status, 1);
  assert.match(branch.stderr, /not a branch/);
});

test('tag preflight accepts main commits and rejects commits outside main', (t) => {
  const setup = fixture(t);
  mkdirSync(path.join(setup.directory, 'scripts'));
  copyFileSync(
    new URL('./release.mjs', import.meta.url),
    path.join(setup.directory, 'scripts/release.mjs'),
  );
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('GIT_')) delete environment[key];
  }
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: setup.directory,
      env: environment,
      encoding: 'utf8',
    }).trim();
  git('init', '--initial-branch=main', '--quiet');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('tag', setup.tag);
  const output = path.join(setup.directory, 'outputs');
  const run = () =>
    spawnSync(process.execPath, ['scripts/release.mjs', 'prepare'], {
      cwd: setup.directory,
      encoding: 'utf8',
      env: {
        ...environment,
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'nuxus-org/nuxus-sdk',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_REF: `refs/tags/${setup.tag}`,
        GITHUB_REF_NAME: setup.tag,
        GITHUB_SHA: git('rev-parse', 'HEAD'),
        GITHUB_OUTPUT: output,
      },
    });
  const accepted = run();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'package=engine-sdk\n');
  git('checkout', '--quiet', '-b', 'unmerged');
  git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'Unmerged',
  );
  git('tag', '--force', setup.tag);
  assert.equal(run().status, 1);
});
