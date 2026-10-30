import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repository = 'nuxus-org/nuxus-sdk';
const root = fileURLToPath(new URL('../', import.meta.url));
const registry = 'https://registry.npmjs.org';
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;

function parseVersion(version) {
  const match = versionPattern.exec(version);
  assert.ok(match, `Unsupported release version: ${version}`);
  const [, major, minor, patch, channel, iteration] = match;
  return {
    channel: channel ?? 'latest',
    order: [
      major,
      minor,
      patch,
      { alpha: 0, beta: 1, rc: 2 }[channel] ?? 3,
      iteration ?? 0,
    ].map(BigInt),
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left).order;
  const b = parseVersion(right).order;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

export function resolveRelease(tag, directory = root) {
  const match = /^(engine-sdk|data-sdk)-v(.+)$/.exec(tag);
  assert.ok(match, 'Use a package tag such as engine-sdk-v0.1.0-alpha.1.');
  const [, packageName, version] = match;
  const { channel } = parseVersion(version);
  const manifest = JSON.parse(
    readFileSync(
      path.join(directory, 'typescript', packageName, 'package.json'),
      'utf8',
    ),
  );
  assert.equal(manifest.name, `@nuxus/${packageName}`);
  assert.equal(
    manifest.version,
    version,
    'Release tag must match the package version.',
  );
  assert.notEqual(manifest.private, true);
  assert.equal(
    manifest.repository?.url,
    `git+https://github.com/${repository}.git`,
  );
  assert.equal(manifest.publishConfig?.access, 'public');
  assert.equal(
    manifest.publishConfig?.tag,
    channel,
    'publishConfig.tag must match the release channel.',
  );
  const notes = `docs/releases/${tag}.md`;
  const body = readFileSync(path.join(directory, notes), 'utf8').trim();
  assert.ok(
    body.startsWith(`# ${manifest.name} ${version}\n`),
    'Release notes must start with the package name and version.',
  );
  const changelog = readFileSync(
    path.join(directory, 'typescript', packageName, 'CHANGELOG.md'),
    'utf8',
  );
  assert.ok(
    changelog
      .split('\n')
      .some(
        (line) =>
          line === `## ${version}` || line.startsWith(`## ${version} — `),
      ),
    'Package changelog must include the release version.',
  );
  return {
    tag,
    package: packageName,
    name: manifest.name,
    version,
    channel,
    notes,
    body,
    prerelease: channel !== 'latest',
  };
}

export function publicationDecision(packument, release, integrity) {
  assert.ok(
    packument,
    `${release.name} does not exist on npm. Complete the first-publication step with an authenticated npm account before configuring Trusted Publishing.`,
  );
  assert.equal(packument.name, release.name);
  const current = packument['dist-tags']?.[release.channel];
  const existing = packument.versions?.[release.version];
  if (existing) {
    assert.equal(
      existing.dist?.integrity,
      integrity,
      'This npm version already exists with different contents. Versions are immutable; prepare a new version.',
    );
    assert.ok(
      current && compareVersions(current, release.version) >= 0,
      `The existing version matches, but the ${release.channel} dist-tag is missing or older. Restore the npm channel before retrying.`,
    );
    return 'already-published';
  }
  assert.ok(
    !current || compareVersions(release.version, current) > 0,
    `Refusing to move the ${release.channel} dist-tag backwards from ${current}.`,
  );
  return 'publish';
}

export async function readRegistry(name, fetcher = fetch) {
  const response = await fetcher(`${registry}/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  assert.ok(
    response.ok,
    `npm registry lookup failed: HTTP ${response.status}.`,
  );
  return response.json();
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function actionsRelease() {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    'true',
    'Publishing tools run only in GitHub Actions.',
  );
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  assert.equal(
    process.env.GITHUB_REF_TYPE,
    'tag',
    'Run this workflow from a package tag, not a branch.',
  );
  assert.equal(
    process.env.GITHUB_REF,
    `refs/tags/${process.env.GITHUB_REF_NAME}`,
  );
  assert.equal(
    git('rev-parse', 'HEAD'),
    git('rev-parse', `${process.env.GITHUB_SHA}^{commit}`),
    'Checkout must match the workflow commit.',
  );
  return resolveRelease(process.env.GITHUB_REF_NAME);
}

function prepare(release) {
  assert.equal(
    git('rev-parse', `${release.tag}^{commit}`),
    git('rev-parse', 'HEAD'),
  );
  git('merge-base', '--is-ancestor', 'HEAD', 'origin/main');
  assert.ok(process.env.GITHUB_OUTPUT);
  appendFileSync(process.env.GITHUB_OUTPUT, `package=${release.package}\n`);
  console.log(
    `Validated ${release.tag} on main; npm channel: ${release.channel}.`,
  );
}

export async function publish(
  release,
  directory,
  { run = execFileSync, lookup = readRegistry, pause = delay } = {},
) {
  assert.ok(directory, 'An archive directory is required.');
  const npmVersion = run('npm', ['--version'], {
    encoding: 'utf8',
  }).trim();
  assert.ok(
    compareVersions(npmVersion, '11.5.1') >= 0,
    'Trusted Publishing requires npm >=11.5.1.',
  );
  const archive = path.resolve(directory, `${release.package}.tgz`);
  const metadata = JSON.parse(
    run('tar', ['-xOzf', archive, 'package/package.json'], {
      encoding: 'utf8',
    }),
  );
  assert.equal(metadata.name, release.name);
  assert.equal(metadata.version, release.version);
  assert.equal(
    metadata.repository?.url,
    `git+https://github.com/${repository}.git`,
  );
  assert.equal(metadata.publishConfig?.tag, release.channel);
  const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
  const decision = publicationDecision(
    await lookup(release.name),
    release,
    integrity,
  );
  if (decision === 'already-published') {
    console.log(
      `${release.name}@${release.version} already matches the verified archive; continuing to GitHub release.`,
    );
    return;
  }
  run(
    'npm',
    [
      'publish',
      archive,
      '--access=public',
      `--tag=${release.channel}`,
      '--ignore-scripts',
      '--provenance',
      `--registry=${registry}`,
    ],
    { stdio: 'inherit', timeout: 120_000 },
  );
  for (let attempt = 0; attempt < 6; attempt++) {
    const published = await lookup(release.name);
    if (published?.versions?.[release.version]) {
      assert.equal(
        publicationDecision(published, release, integrity),
        'already-published',
      );
      assert.equal(
        published['dist-tags']?.[release.channel],
        release.version,
        'npm dist-tag does not match the published version.',
      );
      console.log(
        `Verified npm integrity and ${release.channel} dist-tag for ${release.name}@${release.version}.`,
      );
      return;
    }
    if (attempt < 5) await pause(2_000);
  }
  throw new Error(
    'npm publish completed but registry verification timed out. Rerun this workflow to check the existing version.',
  );
}

export async function githubRelease(
  release,
  { token = process.env.GH_TOKEN, fetcher = fetch } = {},
) {
  assert.ok(token, 'The GitHub release job needs contents: write.');
  const url = `https://api.github.com/repos/${repository}/releases`;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  };
  const existing = await fetcher(`${url}/tags/${release.tag}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (existing.ok) {
    const published = await existing.json();
    assert.equal(
      published.draft,
      false,
      'An existing draft must be reviewed before rerunning.',
    );
    assert.equal(published.prerelease, release.prerelease);
    assert.equal(
      published.body?.trim(),
      release.body,
      'Existing GitHub release notes differ; review them before rerunning.',
    );
    console.log(
      `GitHub release ${release.tag} already exists with matching notes.`,
    );
    return;
  }
  assert.equal(
    existing.status,
    404,
    `GitHub release lookup failed: HTTP ${existing.status}.`,
  );
  const response = await fetcher(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      tag_name: release.tag,
      name: `${release.name} ${release.version}`,
      body: release.body,
      draft: false,
      prerelease: release.prerelease,
      make_latest: release.prerelease ? 'false' : 'true',
    }),
  });
  assert.equal(
    response.status,
    201,
    `GitHub release creation failed: HTTP ${response.status}.`,
  );
  console.log(`Created GitHub release ${release.tag}.`);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const [command, directory, ...extra] = process.argv.slice(2);
    assert.ok(
      ['prepare', 'publish', 'github'].includes(command) &&
        extra.length === 0 &&
        (command === 'publish' ? directory : !directory),
      'Usage: node scripts/release.mjs <prepare|github> or publish <archive-directory>',
    );
    const release = actionsRelease();
    if (command === 'prepare') prepare(release);
    if (command === 'publish') {
      assert.ok(
        process.env.ACTIONS_ID_TOKEN_REQUEST_URL &&
          process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
        'The publish job needs id-token: write.',
      );
      await publish(release, directory);
    }
    if (command === 'github') await githubRelease(release);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release failed.');
    process.exitCode = 1;
  }
}
