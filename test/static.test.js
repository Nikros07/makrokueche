import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';

const server = createApp();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));

function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, path: rawPath, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('"/" liefert index.html mit Headern', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('content-security-policy'), null);
  assert.match(await res.text(), /<html/i);
});

test('JS-Dateien kommen mit JavaScript-Content-Type', async () => {
  const res = await fetch(base + '/js/store.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/javascript/);
});

test('Pfad-Ausbruch wird abgewehrt', async () => {
  for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/..%5cserver.js', '/%2e%2e/%2e%2e/CLAUDE.md']) {
    const r = await rawGet(p);
    assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!r.body.includes('createApp'), p);
  }
});

test('POST wird abgelehnt', async () => {
  const res = await fetch(base + '/', { method: 'POST', body: 'x' });
  assert.ok([404, 405].includes(res.status), String(res.status));
});

test('/api/state gibt es nicht mehr (404)', async () => {
  const res = await fetch(base + '/api/state');
  assert.equal(res.status, 404);
});
