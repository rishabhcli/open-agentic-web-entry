#!/usr/bin/env node
// Plain static file server for site/ with permissive CORS for public artifacts.
// node tools/serve.mjs [port=8080] [dir=site]   Default port 8080 matches the development base URL in the JSON.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8080);
const dir = path.resolve(ROOT, process.argv[3] || 'site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.join(dir, rel);
      if (!file.startsWith(dir)) { res.writeHead(403).end('forbidden'); return; }
      try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html'); } catch { /* 404 below */ }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }).end('not found'); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  createServer().listen(port, '127.0.0.1', () => console.log(`Meeting Finder: http://127.0.0.1:${port}/  (serving ${dir})`));
}
