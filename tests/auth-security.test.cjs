const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

Object.assign(process.env, {
  NODE_ENV: 'test', JWT_SECRET: 'test-access-only', JWT_REFRESH_SECRET: 'test-refresh-only',
  JWT_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d',
  ALLOWED_ORIGINS: 'http://localhost:3000', DB_HOST: 'unused.invalid', DB_USER: 'unused',
  DB_PASSWORD: '', DB_NAME: 'unused', IMAGE_UPLOAD_DIR: '/private/tmp/unused-test-images',
});

const sessions = new Map();
let account;
let databaseFailure;
const calls = [];
const db = { execute: async (sql, params) => {
  calls.push({ sql, params });
  if (databaseFailure) throw databaseFailure;
  if (sql.includes('INSERT INTO auth_sessions')) {
    sessions.set(params[0], { userId: String(params[1]), version: params[2] });
    return [{ affectedRows: 1 }];
  }
  if (sql.includes('JOIN auth_sessions')) {
    const session = sessions.get(params[1]);
    const valid = session && session.userId === params[0] && params[0] === String(account.id)
      && session.version === account.auth_version && params[2] === account.auth_version && account.status === 'active';
    return [valid ? [account] : []];
  }
  if (sql.includes('DELETE FROM auth_sessions WHERE id')) {
    if (sessions.get(params[0])?.userId === params[1]) sessions.delete(params[0]);
    return [{ affectedRows: 1 }];
  }
  if (sql.includes('DELETE FROM auth_sessions WHERE user_id')) {
    for (const [id, session] of sessions) {
      if (session.userId === params[0] && (sql.includes('id <>') ? id !== params[1] : id === params[1])) sessions.delete(id);
    }
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('SELECT password_hash')) return [[{ password_hash: account.password_hash }]];
  if (sql.startsWith('UPDATE users SET password_hash')) {
    if (account.password_hash !== params[2] || account.auth_version !== params[3] || account.status !== 'active') return [{ affectedRows: 0 }];
    account.password_hash = params[0];
    account.auth_version++;
    return [{ affectedRows: 1 }];
  }
  throw new Error(`Unexpected test query: ${sql}`);
} };
require.cache[require.resolve('../dist/config/db')] = { exports: { db } };
const service = require('../dist/modules/auth/auth.service');
const controllers = require('../dist/modules/auth/auth.controller');
const { auth, optionalAuth } = require('../dist/middleware/auth');
const { errorHandler } = require('../dist/middleware/errorHandler');
const { HttpError } = require('../dist/utils/httpError');
const { AuthRateLimitStore } = require('../dist/middleware/authRateLimitStore');

function response() {
  return { statusCode: 200, locals: { requestId: 'test-request' }, headers: {}, cookies: [],
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    cookie(...args) { this.cookies.push(args); }, clearCookie(...args) { this.cookies.push(args); },
  };
}

beforeEach(() => {
  sessions.clear(); calls.length = 0; databaseFailure = undefined;
  account = { id: 1, name: 'Test Account', email: 'test@example.invalid', role: 'retail', status: 'active', auth_version: 0 };
});

test('logout revokes both copied access and refresh tokens for that session only', async () => {
  const first = await service.createSession(account);
  const second = await service.createSession(account);
  await controllers.logout({ cookies: { refreshToken: first.refreshToken } }, response());
  await assert.rejects(service.sessionAccount(service.verifySessionToken(first.accessToken, 'access')), { status: 401 });
  await assert.rejects(controllers.refresh({ cookies: { refreshToken: first.refreshToken } }, response()), { status: 401 });
  await service.sessionAccount(service.verifySessionToken(second.accessToken, 'access'));
});

test('refresh does not rewrite cookies or extend session lifetime', async () => {
  const session = await service.createSession(account);
  const res = response();
  await controllers.refresh({ cookies: { refreshToken: session.refreshToken } }, res);
  assert.equal(res.cookies.length, 0);
  assert.equal(sessions.size, 1);
  assert.equal(service.verifySessionToken(res.body.data.accessToken, 'access').sessionId,
    service.verifySessionToken(session.accessToken, 'access').sessionId);
});

test('password change invalidates all sessions; concurrent changes cannot both succeed', async () => {
  account.password_hash = await bcrypt.hash('original-password', 4);
  const first = await service.createSession(account);
  const second = await service.createSession(account);
  const req = { user: { id: '1', authVersion: 0 }, body: { currentPassword: 'original-password', newPassword: 'replacement-password' } };
  const results = await Promise.allSettled([controllers.changePassword(req, response()), controllers.changePassword(req, response())]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(account.auth_version, 1);
  for (const session of [first, second]) {
    await assert.rejects(service.sessionAccount(service.verifySessionToken(session.accessToken, 'access')), { status: 401 });
    await assert.rejects(controllers.refresh({ cookies: { refreshToken: session.refreshToken } }, response()), { status: 401 });
  }
});

test('wrong current password does not revoke sessions or change credentials', async () => {
  account.password_hash = await bcrypt.hash('original-password', 4);
  const session = await service.createSession(account);
  await assert.rejects(controllers.changePassword({ user: { id: '1', authVersion: 0 }, body: {
    currentPassword: 'wrong', newPassword: 'replacement-password',
  } }, response()), { status: 400 });
  assert.equal(account.auth_version, 0);
  await service.sessionAccount(service.verifySessionToken(session.accessToken, 'access'));
});

test('revoking another account session cannot delete it', async () => {
  const own = await service.createSession(account);
  const foreign = await service.createSession({ ...account, id: 2 });
  const foreignId = service.verifySessionToken(foreign.accessToken, 'access').sessionId;
  await controllers.revokeSession({ user: { id: '1' }, params: { id: foreignId } }, response());
  assert.ok(sessions.has(foreignId));
  const ownId = service.verifySessionToken(own.accessToken, 'access').sessionId;
  await controllers.revokeSession({ user: { id: '1', sessionId: ownId }, params: { id: ownId } }, response());
  assert.equal(sessions.has(ownId), false);
});

test('sign out others retains the current session and foreign sessions', async () => {
  const own = await service.createSession(account);
  await service.createSession(account);
  await service.createSession({ ...account, id: 2 });
  const ownId = service.verifySessionToken(own.accessToken, 'access').sessionId;
  await controllers.revokeOtherSessions({ user: { id: '1', sessionId: ownId } }, response());
  assert.equal(sessions.size, 2);
  assert.ok(sessions.has(ownId));
});

test('database outages remain server errors for required and optional authentication', async () => {
  const session = await service.createSession(account);
  databaseFailure = Object.assign(new Error('private SQL and password'), { code: 'ECONNREFUSED' });
  for (const middleware of [auth, optionalAuth]) {
    const req = { headers: { authorization: `Bearer ${session.accessToken}` } };
    let failure;
    await middleware(req, response(), (error) => { failure = error; });
    assert.equal(failure, databaseFailure);
    assert.equal(req.user, undefined);
  }
});

test('invalid optional credentials fail closed; absent credentials permit anonymous access', async () => {
  let failure;
  await optionalAuth({ headers: { authorization: 'Bearer broken' } }, response(), (error) => { failure = error; });
  assert.equal(failure.status, 401);
  await optionalAuth({ headers: {} }, response(), (error) => { failure = error; });
  assert.equal(failure, undefined);
});

test('tokens enforce purpose, issuer and required session claims', () => {
  const old = jwt.sign({ id: '1' }, process.env.JWT_SECRET);
  assert.throws(() => service.verifySessionToken(old, 'access'), { status: 401 });
  const wrongPurpose = jwt.sign({ id: '1', sessionId: '8305a944-bb77-4aca-86b0-e4eed1e56f77', version: 0, purpose: 'refresh' }, process.env.JWT_SECRET,
    { issuer: 'smoke-time-api', audience: 'smoke-time-web', expiresIn: '15m' });
  assert.throws(() => service.verifySessionToken(wrongPurpose, 'access'), { status: 401 });
});

test('error responses and logs redact database details while preserving request IDs', (t) => {
  const logs = [];
  t.mock.method(console, 'error', (line) => logs.push(line));
  const error = Object.assign(new Error('SELECT password_hash FROM users; secret@example.invalid'), { code: 'ECONNRESET', sql: 'private query' });
  const res = response();
  errorHandler(error, { method: 'GET' }, res, () => {});
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['Retry-After'], '5');
  assert.equal(res.body.requestId, 'test-request');
  assert.doesNotMatch(JSON.stringify({ body: res.body, logs }), /password_hash|secret@example|private query/);
  const invalid = response();
  errorHandler(new HttpError(400, 'VALIDATION_FAILED', 'Check input', { field: ['Required'] }), { method: 'POST' }, invalid, () => {});
  assert.deepEqual(invalid.body.errors, { field: ['Required'] });
});

test('rate-limit transactions roll back and release the connection on failure', async () => {
  const steps = [];
  const connection = {
    beginTransaction: async () => steps.push('begin'),
    execute: async () => { throw new Error('database unavailable'); },
    rollback: async () => steps.push('rollback'), release: () => steps.push('release'),
  };
  const store = new AuthRateLimitStore('login', 1000, { getConnection: async () => connection });
  await assert.rejects(store.increment('192.0.2.1'));
  assert.deepEqual(steps, ['begin', 'rollback', 'release']);
});

test('rate-limit keys are hashed and different policies cannot share a counter', async () => {
  const keys = [];
  const pool = { execute: async (_sql, params) => { keys.push(params[0]); } };
  await new AuthRateLimitStore('login', 1000, pool).decrement('192.0.2.1');
  await new AuthRateLimitStore('password', 1000, pool).decrement('192.0.2.1');
  assert.notEqual(keys[0], keys[1]);
  assert.ok(keys.every((key) => !key.includes('192.0.2.1')));
});
