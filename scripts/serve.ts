import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { APP_DIR } from '../tools/paths.ts';

const PORT = Number(process.env['PORT'] ?? 8173);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

http
  .createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      let rel = normalize(decodeURIComponent(pathname));
      if (rel.endsWith('/')) rel += 'index.html';
      const file = join(APP_DIR, rel);
      if (!file.startsWith(APP_DIR)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Content-Length': body.length,
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    }
  })
  .listen(PORT, () => console.log(`serving app/ on http://localhost:${PORT}`));
