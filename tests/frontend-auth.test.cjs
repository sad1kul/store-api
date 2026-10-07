const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');

const frontendRoot = process.env.FRONTEND_ROOT || path.resolve(__dirname, '../../Smoke Time Store');
const available = fs.existsSync(path.join(frontendRoot, 'lib/store/authStore.ts'));

// Helper to run frontend TS modules in-memory without a build step.
// Handles '@/...' path aliases.
function loadFrontend() {
  const cache = new Map();
  const requirePackage = createRequire(path.join(frontendRoot, 'package.json'));
  function load(name, parent = frontendRoot) {
    if (!name.startsWith('.') && !name.startsWith('@/') && !path.isAbsolute(name)) return requirePackage(name);
    const filename = name.startsWith('@/') ? path.join(frontendRoot, name.slice(2)) : path.resolve(parent, name);
    const file = filename.endsWith('.ts') ? filename : `${filename}.ts`;
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', source)(
      (dependency) => load(dependency, path.dirname(file)), module, module.exports,
    );
    return module.exports;
  }
  return load;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const result = (token = 'token') => ({ success: true, data: { accessToken: token, user: { id: '1', name: 'Test', role: 'retail' } } });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const frontendTest = (name, fn) => test(name, { skip: available ? false : 'Set FRONTEND_ROOT to the frontend checkout' }, fn);

frontendTest('concurrent session refreshes share one request', async () => {
  const load = loadFrontend();
  const pending = deferred();
  let calls = 0;
  const store = load('@/lib/store/authStore').createAuthStore({
    refresh: () => { calls++; return pending.promise; }, login: async () => result(), logout: async () => ({ success: true }),
  });
  const requests = Array.from({ length: 8 }, () => store.getState().initAuth());
  assert.equal(calls, 1);
  pending.resolve(result('fresh-token'));
  assert.deepEqual(await Promise.all(requests), Array(8).fill('fresh-token'));
});

frontendTest('late refresh cannot restore a logged-out account', async () => {
  const load = loadFrontend();
  const pending = deferred();
  const store = load('@/lib/store/authStore').createAuthStore({
    refresh: () => pending.promise, login: async () => result(), logout: async () => ({ success: true }),
  });
  const refresh = store.getState().initAuth();
  await store.getState().logout();
  pending.resolve(result());
  assert.equal(await refresh, null);
  assert.equal(store.getState().isAuthenticated, false);
  assert.equal(store.getState().accessToken, null);
});

frontendTest('refresh service failures preserve an existing session and remain retryable', async () => {
  const load = loadFrontend();
  const { ApiError } = load('@/lib/api/transport');
  let unavailable = true;
  const store = load('@/lib/store/authStore').createAuthStore({
    login: async () => result('original'), logout: async () => ({ success: true }),
    refresh: async () => { if (unavailable) throw new ApiError('Unavailable', 503); return result('restored'); },
  });
  await store.getState().login('test@example.invalid', 'password');
  await assert.rejects(store.getState().initAuth(), { status: 503 });
  assert.equal(store.getState().accessToken, 'original');
  assert.equal(store.getState().isAuthenticated, true);
  unavailable = false;
  assert.equal(await store.getState().initAuth(), 'restored');
});

frontendTest('an invalid refresh clears the session without calling logout recursively', async () => {
  const load = loadFrontend();
  const { ApiError } = load('@/lib/api/transport');
  let logoutCalls = 0;
  const store = load('@/lib/store/authStore').createAuthStore({
    login: async () => result(), logout: async () => { logoutCalls++; return { success: true }; },
    refresh: async () => { throw new ApiError('Expired', 401); },
  });
  await store.getState().login('test@example.invalid', 'password');
  assert.equal(await store.getState().initAuth(), null);
  assert.equal(store.getState().isAuthenticated, false);
  assert.equal(logoutCalls, 0);
});

frontendTest('login and logout cookie mutations are serialized', async () => {
  const load = loadFrontend();
  const pending = deferred();
  const events = [];
  const store = load('@/lib/store/authStore').createAuthStore({
    login: () => { events.push('login'); return pending.promise; },
    refresh: async () => result(), logout: async () => { events.push('logout'); return { success: true }; },
  });
  const login = store.getState().login('test@example.invalid', 'password');
  await tick();
  const logout = store.getState().logout();
  assert.deepEqual(events, ['login']);
  pending.resolve(result());
  assert.equal((await login).success, false);
  await logout;
  assert.deepEqual(events, ['login', 'logout']);
  assert.equal(store.getState().isAuthenticated, false);
});

frontendTest('logout failures are visible instead of claiming server revocation', async () => {
  const load = loadFrontend();
  const store = load('@/lib/store/authStore').createAuthStore({
    login: async () => result(), refresh: async () => result(),
    logout: async () => { throw new Error('offline'); },
  });
  await store.getState().login('test@example.invalid', 'password');
  await assert.rejects(store.getState().logout());
  assert.equal(store.getState().isAuthenticated, false);
  assert.match(store.getState().sessionError, /could not be revoked/);
});

frontendTest('HTTP errors retain status, validation details, retry interval and request ID', async (t) => {
  const load = loadFrontend();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    message: 'Slow down', code: 'RATE_LIMITED', errors: { email: ['Required'] },
  }), { status: 429, headers: { 'Retry-After': '25', 'X-Request-ID': 'request-123' } }));
  await assert.rejects(load('@/lib/api/transport').request('/auth/login'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.retryAfterSeconds, 25);
    assert.equal(error.requestId, 'request-123');
    assert.deepEqual(error.details, { email: ['Required'] });
    return true;
  });
});

frontendTest('late 401 requests are not replayed after account switching', async (t) => {
  const load = loadFrontend();
  const store = load('@/lib/store/authStore').useAuthStore;
  store.setState({ accessToken: 'old-user', sessionEpoch: 1 });
  const pending = deferred();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; return pending.promise; });
  const operation = load('@/lib/api/client').apiClient('/auth/me');
  store.setState({ accessToken: 'new-user', sessionEpoch: 2 });
  pending.resolve(new Response(JSON.stringify({ message: 'Expired' }), { status: 401 }));
  await assert.rejects(operation, { status: 401 });
  assert.equal(calls, 1);
  assert.equal(store.getState().accessToken, 'new-user');
});

frontendTest('concurrent API 401 responses produce one refresh and one retry per request', async (t) => {
  const load = loadFrontend();
  const store = load('@/lib/store/authStore').useAuthStore;
  store.setState({ accessToken: 'old', isAuthenticated: true });
  const refresh = deferred();
  let refreshCalls = 0;
  let retries = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/auth/refresh') { refreshCalls++; return refresh.promise; }
    if (options.headers.get('Authorization') === 'Bearer fresh') {
      retries++;
      return new Response(JSON.stringify({ success: true }));
    }
    return new Response(JSON.stringify({ message: 'Expired' }), { status: 401 });
  });
  const requests = Array.from({ length: 4 }, () => load('@/lib/api/client').apiClient('/auth/me'));
  await tick();
  assert.equal(refreshCalls, 1);
  refresh.resolve(new Response(JSON.stringify(result('fresh'))));
  await Promise.all(requests);
  assert.equal(retries, 4);
});
