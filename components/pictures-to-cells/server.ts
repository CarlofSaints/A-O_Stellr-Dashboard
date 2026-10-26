/**
 * Pictures to Cells: the run log, server side. An app mounts it as one route:
 *   export const { GET, POST } = logRoute({ access: 'private', user: async req => ... });
 * `user` returns who is calling (name for the log) or null to refuse.
 *
 * POST  a run          -> one log entry (date and user stamped here, not by the browser)
 * POST  blob.* body    -> token so the browser can upload the Excel straight to Blob
 *                         (a function body over 4.5 MB is refused by Vercel)
 * GET                  -> newest 100 runs
 * GET   ?file=path     -> the uploaded Excel
 */
import { get, list, put } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

const LOG = 'pictures-to-cells/log/';
const FILES = 'pictures-to-cells/files/';

export interface LogEntry {
  at: string;
  user: string;
  mode: 'excel' | 'folder';
  path: string;
  photos: number;
  saved: number;
  excelPath?: string;
  excelName?: string;
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const isFile = (p: string) => p.startsWith(FILES) && !p.includes('..');

export function logRoute(opts: { access: 'public' | 'private'; user: (req: Request) => Promise<string | null> }) {
  const deny = () => Response.json({ error: 'Unauthorized' }, { status: 401 });

  async function POST(req: Request) {
    const body = await req.json() as Record<string, unknown>;
    const user = await opts.user(req);
    if (!user) return deny();

    if (typeof body.type === 'string' && body.type.startsWith('blob.')) {
      const res = await handleUpload({
        request: req,
        body: body as unknown as HandleUploadBody,
        onBeforeGenerateToken: async pathname => {
          if (!isFile(pathname)) throw new Error('Bad path');
          return {
            allowedContentTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
            addRandomSuffix: true,
          };
        },
      });
      return Response.json(res);
    }

    const excelPath = str(body.excelPath, 1000);
    const entry: LogEntry = {
      at: new Date().toISOString(),
      user,
      mode: body.mode === 'excel' ? 'excel' : 'folder',
      path: str(body.path),
      photos: num(body.photos),
      saved: num(body.saved),
      ...(isFile(excelPath) ? { excelPath, excelName: str(body.excelName) } : {}),
    };
    // One blob per run: two people finishing at once can't overwrite each other's entry.
    await put(`${LOG}${entry.at}-${Math.random().toString(36).slice(2, 8)}.json`, JSON.stringify(entry), {
      access: opts.access, addRandomSuffix: false, contentType: 'application/json',
    });
    return Response.json(entry);
  }

  async function GET(req: Request) {
    if (!(await opts.user(req))) return deny();
    const file = new URL(req.url).searchParams.get('file');
    if (file) {
      if (!isFile(file)) return Response.json({ error: 'Bad path' }, { status: 400 });
      const blob = await get(file, { access: opts.access });
      if (!blob || blob.statusCode !== 200) return Response.json({ error: 'File not found' }, { status: 404 });
      return new Response(blob.stream, { headers: { 'Content-Type': blob.blob.contentType ?? 'application/octet-stream' } });
    }
    // shortcut: reads the first 1000 log blobs only; page with `cursor` past ~1000 runs.
    const { blobs } = await list({ prefix: LOG, limit: 1000 });
    const newest = blobs.map(b => b.pathname).sort().reverse().slice(0, 100);
    const entries = await Promise.all(newest.map(async p => {
      const b = await get(p, { access: opts.access, useCache: false }).catch(() => null);
      return b && b.statusCode === 200 ? (JSON.parse(await new Response(b.stream).text()) as LogEntry) : null;
    }));
    return Response.json(entries.filter(Boolean), { headers: { 'Cache-Control': 'no-store' } });
  }

  return { GET, POST };
}
