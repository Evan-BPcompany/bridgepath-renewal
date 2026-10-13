// Test-only defaults so suites do not depend on a developer's local .env.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret-0123456789abcdef-0123456789';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

// Safety net for the whole suite: tests must never reach a real service (SendGrid, AWS,
// PostgreSQL, ...). Anything but this machine is refused with an error instead of going out.
// It covers http/https requests, raw TCP/TLS sockets (which is what database drivers use)
// and the global fetch. The error names the host only, never a URL, credentials or a query.
const http = require('http');
const https = require('https');
const net = require('net');

const GUARD_MARK = '__testNetworkGuard';
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

function isLocal(host) {
  return host === '' || LOCAL_HOSTS.includes(host);
}

function block(kind, host) {
  throw new Error(`External ${kind} blocked in tests: ${host}`);
}

function requestHost(args) {
  const first = args[0];
  if (typeof first === 'string') {
    return new URL(first).hostname;
  }
  if (first instanceof URL) {
    return first.hostname;
  }
  const options = first && typeof first === 'object' ? first : args[1];
  return (options && (options.hostname || options.host)) || '';
}

function socketHost(callArgs) {
  // net.connect() / net.createConnection() call socket.connect([options, callback]).
  const args = Array.isArray(callArgs[0]) ? callArgs[0] : callArgs;
  const first = args[0];
  if (first && typeof first === 'object') {
    return first.path ? '' : first.host || first.hostname || '';
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return typeof args[1] === 'string' ? args[1] : '';
  }
  return ''; // a unix socket / named pipe path
}

// Applied once per process even though this file runs before every test file.
function guard(target, name, hostOf, kind) {
  const original = target[name];
  if (original[GUARD_MARK]) {
    return;
  }
  const guarded = function (...args) {
    const host = hostOf(args);
    if (!isLocal(host)) {
      block(kind, host);
    }
    return original.apply(this, args);
  };
  guarded[GUARD_MARK] = true;
  target[name] = guarded;
}

// Sockets fail the way a real network failure does: the socket is destroyed and emits an
// 'error' event. Database drivers handle that and reject their promise at once, whereas a
// synchronous throw out of connect() would leave them waiting.
function guardSocket() {
  const original = net.Socket.prototype.connect;
  if (original[GUARD_MARK]) {
    return;
  }
  const guarded = function (...args) {
    const host = socketHost(args);
    if (!isLocal(host)) {
      this.destroy(new Error(`External network connection blocked in tests: ${host}`));
      return this;
    }
    return original.apply(this, args);
  };
  guarded[GUARD_MARK] = true;
  net.Socket.prototype.connect = guarded;
}

guard(http, 'request', requestHost, 'http request');
guard(https, 'request', requestHost, 'https request');
guardSocket();

for (const mod of [http, https]) {
  if (!mod.get[GUARD_MARK]) {
    const get = function (...args) {
      const request = mod.request(...args);
      request.end();
      return request;
    };
    get[GUARD_MARK] = true;
    mod.get = get;
  }
}

if (typeof globalThis.fetch === 'function' && !globalThis.fetch[GUARD_MARK]) {
  const nativeFetch = globalThis.fetch;
  const guardedFetch = function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
    const host = new URL(url, 'http://localhost').hostname;
    if (!isLocal(host)) {
      return Promise.reject(new Error(`External fetch blocked in tests: ${host}`));
    }
    return nativeFetch.call(this, input, init);
  };
  guardedFetch[GUARD_MARK] = true;
  globalThis.fetch = guardedFetch;
}
