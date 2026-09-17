import { spawn } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export const ADMIN_SECRET = 'test-secret';

// Starts a fresh server on a random port with an empty database.
// Returns { base, dbPath, stop }.
export async function startServer({ dbPath: existingDb } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hexqz-test-'));
  const dbPath = existingDb || join(dir, 'test.sqlite');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, ADMIN_SECRET, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/version`);
      if (r.ok) break;
    } catch {}
    await sleep(100);
  }

  return {
    base,
    dbPath,
    log: () => log,
    stop: () => new Promise(resolve => { child.on('exit', resolve); child.kill(); })
  };
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function api(base) {
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json, headers: res.headers };
  };
  return {
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b, h),
    put: (p, b, h) => call('PUT', p, b, h),
    del: (p, h) => call('DELETE', p, undefined, h)
  };
}

// Polls /current until predicate matches or timeout.
export async function waitFor(client, sessionId, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = (await client.get(`/session/${sessionId}/current`)).body;
    if (predicate(last)) return last;
    await sleep(150);
  }
  throw new Error(`waitFor timed out; last state: ${JSON.stringify(last)}`);
}
