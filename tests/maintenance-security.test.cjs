const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const credentials = {
  ADMIN_NAME: 'Test Admin',
  ADMIN_EMAIL: 'test-admin@example.invalid',
  ADMIN_PASSWORD: 'test-only-admin-password',
};

// Execute script entry points with no real environment, database, or fixture access.
async function runScript(name, { env = {}, failQuery, failHash = false, existingAdmin = false } = {}) {
  const calls = [];
  const logs = [];
  const errors = [];
  const sessions = new Set(['old-session']);
  const processStub = { env, exitCode: undefined };
  const connection = {
    async ping() { calls.push({ sql: 'PING' }); },
    async query(sql) {
      calls.push({ sql });
      if (failQuery && sql.includes(failQuery)) {
        throw new Error('private SQL and credential details must not be logged');
      }
      if (sql === 'TRUNCATE TABLE `auth_sessions`') sessions.clear();
      return [[]];
    },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (failQuery && sql.includes(failQuery)) {
        throw new Error('private SQL and credential details must not be logged');
      }
      if (sql.startsWith('SELECT')) {
        return [existingAdmin || sql.includes("role = 'admin'") ? [{ id: 1 }] : []];
      }
      return [{ insertId: 1 }];
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  const pool = {
    async getConnection() { return connection; },
    async end() { calls.push({ sql: 'END' }); },
  };
  const dependencies = {
    'dotenv/config': {},
    'mysql2/promise': { createPool() { calls.push({ sql: 'POOL' }); return pool; } },
    bcryptjs: { async hash(value) {
      calls.push({ sql: 'HASH', value });
      if (failHash) throw new Error('private hashing failure');
      return 'test-hash';
    } },
    fs: { readFileSync: () => '[]' },
    path,
  };
  const filename = path.resolve(__dirname, '../dist/scripts', `${name}.js`);
  const source = fs.readFileSync(filename, 'utf8');
  await vm.runInNewContext(source, {
    require(dependency) {
      assert.ok(Object.hasOwn(dependencies, dependency), `Unexpected dependency: ${dependency}`);
      return dependencies[dependency];
    },
    exports: {},
    __dirname: path.dirname(filename),
    Buffer,
    process: processStub,
    console: {
      log: (...args) => logs.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
    },
  }, { filename });
  return { calls, logs, errors, sessions, exitCode: processStub.exitCode };
}

for (const script of ['resetFreshDatabase', 'createAdmin']) {
  test(`${script}: missing or invalid credentials fail before opening a database`, async () => {
    const invalid = [
      {},
      { ...credentials, ADMIN_NAME: ' ' },
      { ...credentials, ADMIN_EMAIL: ' ' },
      { ...credentials, ADMIN_PASSWORD: '' },
      { ...credentials, ADMIN_PASSWORD: 'short' },
      { ...credentials, ADMIN_PASSWORD: 'a'.repeat(73) },
      { ...credentials, ADMIN_PASSWORD: 'é'.repeat(37) },
    ];
    for (const env of invalid) {
      const result = await runScript(script, { env });
      assert.equal(result.exitCode, 1);
      assert.equal(result.calls.length, 0);
      assert.equal(result.logs.length, 0);
      assert.equal(result.errors.length, 1);
    }
  });
}

test('reset revokes sessions before reusing user IDs and logs no credentials', async () => {
  const result = await runScript('resetFreshDatabase', {
    env: { ...credentials, ADMIN_EMAIL: '  TEST-ADMIN@example.invalid  ' },
  });
  const queries = result.calls.map(({ sql }) => sql);
  assert.equal(result.exitCode, undefined);
  assert.equal(result.sessions.size, 0);
  assert.equal(queries.filter((sql) => sql.startsWith('TRUNCATE'))[0], 'TRUNCATE TABLE `auth_sessions`');
  assert.ok(queries.indexOf('TRUNCATE TABLE `auth_sessions`') < queries.indexOf('TRUNCATE TABLE `users`'));
  const insert = result.calls.find(({ sql }) => sql.startsWith('INSERT INTO users'));
  assert.deepEqual(Array.from(insert.params), ['Test Admin', 'test-admin@example.invalid', 'test-hash']);
  assert.ok(queries.indexOf('SET FOREIGN_KEY_CHECKS = 1') < result.calls.indexOf(insert));
  assert.deepEqual(queries.slice(-2), ['RELEASE', 'END']);
  assert.equal(result.logs.length, 1);
  assert.equal(result.errors.length, 0);
  assert.doesNotMatch(result.logs.join(' '), /test-admin|test-only-admin-password|test-hash/);
});

test('missing session table aborts before any users are wiped or recreated', async () => {
  const result = await runScript('resetFreshDatabase', { env: credentials, failQuery: 'TRUNCATE TABLE `auth_sessions`' });
  assert.equal(result.exitCode, 1);
  assert.equal(result.sessions.size, 1);
  assert.equal(result.calls.some(({ sql }) => sql.includes('TRUNCATE TABLE `users`') || sql.startsWith('INSERT')), false);
  assert.ok(result.calls.some(({ sql }) => sql === 'SET FOREIGN_KEY_CHECKS = 1'));
  assert.deepEqual(result.calls.slice(-2).map(({ sql }) => sql), ['RELEASE', 'END']);
  assert.equal(result.logs.length, 0);
  assert.equal(result.errors.length, 1);
  assert.doesNotMatch(result.errors[0], /private SQL|credential details/);
});

test('reset restores foreign-key checks after a later truncate failure', async () => {
  const result = await runScript('resetFreshDatabase', { env: credentials, failQuery: 'TRUNCATE TABLE `users`' });
  assert.equal(result.exitCode, 1);
  assert.equal(result.sessions.size, 0);
  assert.ok(result.calls.some(({ sql }) => sql === 'SET FOREIGN_KEY_CHECKS = 1'));
  assert.equal(result.calls.some(({ sql }) => sql.startsWith('INSERT')), false);
  assert.deepEqual(result.calls.slice(-2).map(({ sql }) => sql), ['RELEASE', 'END']);
  assert.match(result.errors[0], /partially applied/);
});

test('reset does not touch a database if password hashing fails', async () => {
  const result = await runScript('resetFreshDatabase', { env: credentials, failHash: true });
  assert.equal(result.exitCode, 1);
  assert.equal(result.calls.some(({ sql }) => sql === 'POOL'), false);
  assert.doesNotMatch(result.errors.join(' '), /private hashing/);
});

test('admin bootstrap retains its ping and existence check with ID-only projection', async () => {
  const result = await runScript('createAdmin', { env: credentials, existingAdmin: true });
  assert.equal(result.exitCode, undefined);
  assert.ok(result.calls.some(({ sql }) => sql === 'PING'));
  assert.ok(result.calls.some(({ sql }) => sql === 'SELECT id FROM users WHERE email = ? LIMIT 1'));
  assert.equal(result.calls.some(({ sql }) => sql.startsWith('INSERT')), false);
  assert.equal(result.logs.length, 1);
});

test('admin bootstrap driver errors are redacted and connection is released', async () => {
  const result = await runScript('createAdmin', { env: credentials, failQuery: 'SELECT' });
  assert.equal(result.exitCode, 1);
  assert.equal(result.logs.length, 0);
  assert.doesNotMatch(result.errors.join(' '), /private SQL|credential details/);
  assert.deepEqual(result.calls.slice(-2).map(({ sql }) => sql), ['RELEASE', 'END']);
});

test('seeding rejects non-test environments and missing credentials before connecting', async () => {
  for (const env of [
    {},
    { NODE_ENV: 'production', SEED_PASSWORD: 'test-only-seed-password' },
    { NODE_ENV: 'development' },
    { NODE_ENV: 'test', SEED_PASSWORD: 'short' },
    { NODE_ENV: 'test', SEED_PASSWORD: 'é'.repeat(37) },
  ]) {
    const result = await runScript('seedDatabase', { env });
    assert.equal(result.exitCode, 1);
    assert.equal(result.calls.length, 0);
  }
});

test('seeding uses the supplied password and emits one non-identifying success line', async () => {
  const result = await runScript('seedDatabase', { env: { NODE_ENV: 'test', SEED_PASSWORD: 'test-only-seed-password' } });
  assert.equal(result.exitCode, undefined);
  assert.equal(result.calls.find(({ sql }) => sql === 'HASH').value, 'test-only-seed-password');
  assert.deepEqual(result.logs, ['Database seeding complete.']);
  assert.equal(result.errors.length, 0);
});

test('seed errors retain nonzero exit status without raw driver output', async () => {
  const result = await runScript('seedDatabase', {
    env: { NODE_ENV: 'test', SEED_PASSWORD: 'test-only-seed-password' }, failQuery: 'SELECT',
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.logs.length, 0);
  assert.match(result.errors[0], /partially applied/);
  assert.doesNotMatch(result.errors[0], /private SQL|credential details/);
});
