// Small server boundary: (1) optional AI provider proxy that keeps credentials server-side,
// (2) MOCK Intelehealth endpoint, (3) static hosting of the built app.
// Logs never contain request bodies (no clinical content, no credentials).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { MockIntelehealth } from './mockIntelehealth';
import { createAnthropicAdapter, readAiConfig, type AnthropicAdapter, type AiConfig } from './anthropicAdapter';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// minimal .env loader (no dependency); real environment variables take precedence
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const MAX_BODY = 512 * 1024;
const zExtractBody = z.object({
  narrative: z.string().min(1).max(6000),
  lang: z.enum(['en', 'hi', 'mr']),
  permitted: z.array(z.object({ kind: z.enum(['safety_check', 'history_field']), id: z.string().max(120), complaintId: z.string().max(120).optional(), label: z.string().max(300) })).max(120),
});
const zNoteBody = z.object({ factLines: z.array(z.string().max(2000)).max(400), lang: z.literal('en') });

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };

export function createApp(opts: { aiConfig?: AiConfig; mock?: MockIntelehealth; adapter?: Pick<AnthropicAdapter, 'extract' | 'draftNote'>; distDir?: string } = {}) {
  const aiConfig = opts.aiConfig ?? readAiConfig();
  const mock = opts.mock ?? new MockIntelehealth(Number(process.env.MOCK_TOKEN_TTL_SECONDS ?? 900) || 900);
  let adapterPromise: Promise<Pick<AnthropicAdapter, 'extract' | 'draftNote'>> | null = opts.adapter ? Promise.resolve(opts.adapter) : null;
  const getAdapter = () => (adapterPromise ??= aiConfig.enabled ? createAnthropicAdapter(aiConfig) : null);
  const dist = opts.distDir ?? join(root, 'dist');

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/api/health') return send(res, 200, { ok: true, intelehealth: 'mock', ai: aiConfig.enabled ? 'enabled' : 'disabled' });
      if (path === '/api/ai/status') return send(res, 200, { enabled: aiConfig.enabled, provider: aiConfig.provider, model: aiConfig.model, reason: aiConfig.reason });
      if (path === '/api/ai/extract' || path === '/api/ai/note') {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'http_error' });
        const pending = getAdapter();
        if (!pending) return send(res, 503, { ok: false, error: 'disabled', detail: aiConfig.reason });
        const adapter = await pending;
        const body = await readJson(req);
        const ctrl = new AbortController();
        res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
        if (path === '/api/ai/extract') {
          const p = zExtractBody.safeParse(body);
          if (!p.success) return send(res, 400, { ok: false, error: 'bad_config', detail: 'invalid request' });
          const r = await adapter.extract(p.data, ctrl.signal);
          return send(res, r.ok ? 200 : r.error === 'refused' ? 200 : 502, r);
        }
        const p = zNoteBody.safeParse(body);
        if (!p.success) return send(res, 400, { ok: false, error: 'bad_config', detail: 'invalid request' });
        const r = await adapter.draftNote(p.data, ctrl.signal);
        return send(res, r.ok ? 200 : r.error === 'refused' ? 200 : 502, r);
      }
      if (path.startsWith('/mock-intelehealth')) {
        const body = req.method === 'GET' ? undefined : await readJson(req);
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
        const r = mock.handle({ method: req.method ?? 'GET', path: path.slice('/mock-intelehealth'.length) || '/', headers, body });
        return send(res, r.status, r.body);
      }
      // static files (production build)
      if (req.method === 'GET' && existsSync(dist)) {
        const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
        let file = join(dist, rel);
        if (!file.startsWith(dist)) return send(res, 403, { error: 'forbidden' });
        if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
        const ext = extname(file);
        res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600' });
        return res.end(readFileSync(file));
      }
      return send(res, 404, { error: 'not found (run `npm run build` to serve the app from this server)' });
    } catch (e) {
      // do not echo request content
      return send(res, 500, { ok: false, error: 'http_error', detail: (e as Error).message === 'body too large' ? 'body too large' : 'server error' });
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // API_PORT wins so that a host-provided PORT (used for the web app in dev) never collides
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
  const cfg = readAiConfig();
  createApp({ aiConfig: cfg }).listen(port, () => {
    console.log(`[server] http://localhost:${port}  intelehealth=MOCK  ai=${cfg.enabled ? `${cfg.provider}:${cfg.model}` : `disabled (${cfg.reason})`}`);
  });
}
