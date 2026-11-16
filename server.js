// Makroküche: kleiner statischer Dateiserver für public/ (lokale Vorschau). Keine Abhängigkeiten.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = import.meta.dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Methode nicht erlaubt.');
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Ungültiger Pfad.'); }
  if (rel.includes('\0')) throw new HttpError(400, 'Ungültiger Pfad.');
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Zugriff verweigert.');
  let data;
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('keine Datei');
    data = await readFile(file);
  } catch {
    throw new HttpError(404, 'Nicht gefunden.');
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

export function createApp() {
  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      await serveStatic(req, res, pathname);
    } catch (e) {
      if (e instanceof HttpError) {
        req.resume();
        return sendText(res, e.status, e.message);
      }
      sendText(res, 500, 'Interner Serverfehler.');
    }
  });
}

// Direktstart
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 5175;
  createApp().listen(port, host, () => {
    console.log(`Makroküche läuft auf http://${host}:${port}`);
  });
}
