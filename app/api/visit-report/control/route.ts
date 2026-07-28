import { NextRequest, NextResponse } from 'next/server';
import { fetchSpFile, uploadSpFile, deleteSpFile, listSpFolder } from '@/lib/graph-oj';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

const VALID_STATUSES = ['ACTIVE', 'CLOSED', 'NOT IN CYCLE', 'LINKED'] as const;
type StoreStatus = (typeof VALID_STATUSES)[number];

interface Store {
  storeName: string;
  storeCode: string;
  channel: string;
  status: string; // ACTIVE, CLOSED, NOT IN CYCLE, or LINKED
  uid?: string;   // Unique ID to link duplicate stores together
}

interface ControlPayload {
  updatedAt: string;
  updatedBy: string;
  stores: Store[];
  /** Where the data actually came from — 'legacy-json' means the live Excel was unreachable */
  source?: 'excel' | 'legacy-json';
  /** Human-readable reason the Excel could not be read, when source is 'legacy-json' */
  warning?: string;
}

function getBasePath(): string {
  const imagesBase = (process.env.AO_SP_IMAGES_BASE_PATH ?? '').replace(/\/$/, '');
  if (!imagesBase) throw new Error('AO_SP_IMAGES_BASE_PATH not configured');
  return imagesBase.split('/').slice(0, -1).join('/');
}

function controlFilePath(): string {
  return `${getBasePath()}/visit-report-control.json`;
}

const CONTROL_FILE_NAME = 'Store Control File- Stellr v3.xlsx';

/** Folder holding the master Excel control file in SP */
function controlExcelDir(): string {
  const imagesBase = (process.env.AO_SP_IMAGES_BASE_PATH ?? '').replace(/\/$/, '');
  if (!imagesBase) throw new Error('AO_SP_IMAGES_BASE_PATH not configured');
  // Find "2. EXTERNAL SYNC" segment, then append PERIGEE DATA/CONTROL FILES
  const idx = imagesBase.indexOf('2. EXTERNAL SYNC');
  if (idx === -1) throw new Error('Could not find "2. EXTERNAL SYNC" in AO_SP_IMAGES_BASE_PATH');
  const syncRoot = imagesBase.substring(0, idx + '2. EXTERNAL SYNC'.length);
  return `${syncRoot}/PERIGEE DATA/CONTROL FILES`;
}

/** Path to the master Excel control file in SP */
function controlExcelPath(): string {
  return `${controlExcelDir()}/${CONTROL_FILE_NAME}`;
}

/**
 * Fetch the control workbook, tolerating a version rename (v3 -> v4).
 * Tries the known filename first; on failure falls back to the most recently
 * modified "*Control File*Stellr*.xlsx" in the CONTROL FILES folder, so a
 * rename degrades to a logged warning instead of a silent 404.
 * Returns the path actually used — writes must go back to the same file.
 */
async function fetchControlExcel(): Promise<{ buf: ArrayBuffer; path: string }> {
  const exact = controlExcelPath();
  try {
    return { buf: await fetchSpFile(exact), path: exact };
  } catch (err) {
    const dir = controlExcelDir();
    const match = (await listSpFolder(dir))
      .filter(e => e.isFile && !e.name.startsWith('~$') && /control file.*stellr.*\.xlsx?$/i.test(e.name))
      .sort((a, b) => b.lastModifiedDateTime.localeCompare(a.lastModifiedDateTime))[0];
    if (!match) throw err;
    console.warn(`Control file "${CONTROL_FILE_NAME}" not found — falling back to "${match.name}"`);
    const resolved = `${dir}/${match.name}`;
    return { buf: await fetchSpFile(resolved), path: resolved };
  }
}

function normaliseStatus(raw: string): StoreStatus {
  const s = raw.trim().toUpperCase();
  if (s === 'CLOSED') return 'CLOSED';
  if (s === 'NOT IN CYCLE') return 'NOT IN CYCLE';
  if (s === 'LINKED') return 'LINKED';
  return 'ACTIVE';
}

/** Parse an Excel buffer into Store[] */
function parseExcelToStores(buf: ArrayBuffer): Store[] {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const storeNameCol = headers.find(h => /store\s*name/i.test(h));
  const storeCodeCol = headers.find(h => /store\s*code/i.test(h));
  const channelCol = headers.find(h => /channel/i.test(h));
  const statusCol = headers.find(h => /^status$/i.test(h));
  const uidCol = headers.find(h => /^uid$/i.test(h));

  if (!storeNameCol || !storeCodeCol || !channelCol) return [];

  return rows
    .map(r => {
      const uid = uidCol ? String(r[uidCol] ?? '').trim() : '';
      return {
        storeName: String(r[storeNameCol] ?? '').trim(),
        storeCode: String(r[storeCodeCol] ?? '').trim(),
        channel: String(r[channelCol] ?? '').trim(),
        status: normaliseStatus(statusCol ? String(r[statusCol] ?? '') : 'ACTIVE'),
        ...(uid ? { uid } : {}),
      };
    })
    .filter(s => s.storeCode && s.channel);
}

// GET — read directly from the SharePoint Excel control file
export async function GET() {
  try {
    const { buf } = await fetchControlExcel();
    const stores = parseExcelToStores(buf);

    const payload: ControlPayload = {
      updatedAt: new Date().toISOString(),
      updatedBy: 'SharePoint Excel',
      stores,
      source: 'excel',
    };
    return NextResponse.json(payload, { headers: NO_CACHE });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Visit report control GET error:', msg);
    // Fallback: the legacy JSON snapshot. This is NOT live data — flag it loudly,
    // otherwise a broken Excel path shows a plausible-but-stale store list.
    try {
      const buf = await fetchSpFile(controlFilePath());
      const data = JSON.parse(Buffer.from(buf).toString('utf-8')) as ControlPayload;
      return NextResponse.json(
        { ...data, source: 'legacy-json', warning: msg },
        { headers: NO_CACHE },
      );
    } catch {
      return NextResponse.json(null, { headers: NO_CACHE });
    }
  }
}

interface StoreInput {
  storeName?: string;
  storeCode?: string;
  channel?: string;
  status?: string;
  uid?: string;
}

// PATCH — add one or many stores to the Excel control file.
// Accepts either a single store at the top level (legacy) or { stores: [...] }.
// A batch is applied in ONE fetch-modify-upload cycle: sending N single requests
// would download and re-upload the whole workbook N times and race itself.
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const incoming: StoreInput[] = Array.isArray((body as { stores?: StoreInput[] }).stores)
      ? (body as { stores: StoreInput[] }).stores
      : [body as StoreInput];

    if (incoming.length === 0) {
      return NextResponse.json({ error: 'No stores supplied' }, { status: 400 });
    }
    const invalid = incoming.find(s => !s.storeName || !s.storeCode || !s.channel || !s.status);
    if (invalid) {
      return NextResponse.json(
        { error: 'storeName, storeCode, channel, and status are required for every store' },
        { status: 400 },
      );
    }

    // Fetch current Excel — write back to whatever path it resolved to
    const { buf, path: excelPath } = await fetchControlExcel();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      return NextResponse.json({ error: 'Control Excel has no sheets' }, { status: 500 });
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');

    // Resolve column positions off the header row. GET matches columns by header
    // name, so the write has to as well — assuming a fixed order puts values
    // under the wrong headers and the store never enters the control set.
    const headerCols: string[] = [];
    for (let c = 0; c <= Math.max(4, range.e.c); c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      headerCols.push(cell && cell.v !== undefined ? String(cell.v).trim() : '');
    }
    const colIdx = (re: RegExp, fallback: number): number => {
      const i = headerCols.findIndex(h => h && re.test(h));
      return i === -1 ? fallback : i;
    };
    const channelIdx = colIdx(/channel/i, 0);
    const nameIdx = colIdx(/store\s*name/i, 1);
    const codeIdx = colIdx(/store\s*code/i, 2);
    const statusIdx = colIdx(/^status$/i, 3);
    let uidIdx = headerCols.findIndex(h => /^uid$/i.test(h));

    // Find actual last used row (don't trust !ref which may include empty trailing rows)
    let lastUsedRow = 0;
    const maxCol = Math.max(4, range.e.c); // scan up to UID column too
    for (let r = range.e.r; r >= 0; r--) {
      let hasData = false;
      for (let c = 0; c <= maxCol; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v !== undefined && cell.v !== '') { hasData = true; break; }
      }
      if (hasData) { lastUsedRow = r; break; }
    }

    // If UID header doesn't exist yet, append it after the last used column
    if (uidIdx === -1) {
      uidIdx = range.e.c + 1;
      ws[XLSX.utils.encode_cell({ r: 0, c: uidIdx })] = { t: 's', v: 'UID' };
      range.e.c = uidIdx;
    }

    // Codes already in the sheet — a queue can legitimately contain a store that
    // someone else added in the meantime; skip rather than duplicate it.
    const existingCodes = new Set(
      rows
        .map(r => {
          const key = Object.keys(r).find(h => /store\s*code/i.test(h));
          return key ? String(r[key] ?? '').trim().toUpperCase() : '';
        })
        .filter(Boolean),
    );

    // Append each store on its own row after the last used row
    let nextRow = lastUsedRow;
    const added: string[] = [];
    const skipped: string[] = [];

    for (const s of incoming) {
      const code = s.storeCode!.trim();
      if (existingCodes.has(code.toUpperCase())) {
        skipped.push(code);
        continue;
      }
      existingCodes.add(code.toUpperCase());

      nextRow += 1;
      const put = (c: number, v: string) => {
        ws[XLSX.utils.encode_cell({ r: nextRow, c })] = { t: 's', v };
      };
      put(channelIdx, s.channel!.trim());
      put(nameIdx, s.storeName!.trim());
      put(codeIdx, code);
      put(statusIdx, normaliseStatus(s.status!));
      const u = (s.uid ?? '').trim();
      if (u) put(uidIdx, u);
      added.push(code);
    }

    if (added.length === 0) {
      // Nothing to write — don't touch SharePoint at all.
      return NextResponse.json({ ok: true, added: 0, skipped, alreadyPresent: true });
    }

    // Always re-encode: the UID column may have widened the range even when the
    // new rows still fall inside the existing row bounds.
    if (nextRow > range.e.r) range.e.r = nextRow;
    if (uidIdx > range.e.c) range.e.c = uidIdx;
    ws['!ref'] = XLSX.utils.encode_range(range);

    // Write back to SharePoint — one upload for the whole batch
    const outArr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    await uploadSpFile(
      excelPath,
      Buffer.from(outArr),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    return NextResponse.json({
      ok: true,
      added: added.length,
      skipped,
      storeCount: rows.length + added.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Visit report control PATCH error:', msg);
    // 423 Locked = the workbook is open in Excel (desktop or online). Nothing is
    // wrong with the app; say so plainly rather than surfacing a raw status code.
    if (msg.includes('423')) {
      return NextResponse.json(
        {
          error:
            `"${CONTROL_FILE_NAME}" is currently open in Excel, so SharePoint is refusing the update. ` +
            `Close the file (desktop Excel and any Excel Online tab), wait a few seconds, then try again.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: `Add store failed: ${msg}` }, { status: 500 });
  }
}

// POST — upload new control file (bulk replace — admin fallback)
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const updatedBy = formData.get('updatedBy') as string | null;

    if (!file || !updatedBy) {
      return NextResponse.json({ error: 'file and updatedBy required' }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      return NextResponse.json({ error: 'Empty workbook' }, { status: 400 });
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data rows found' }, { status: 400 });
    }

    // Find columns — case-insensitive match
    const headers = Object.keys(rows[0]);
    const storeNameCol = headers.find(h => /store\s*name/i.test(h));
    const storeCodeCol = headers.find(h => /store\s*code/i.test(h));
    const channelCol = headers.find(h => /channel/i.test(h));
    const statusCol = headers.find(h => /^status$/i.test(h));
    const uidCol = headers.find(h => /^uid$/i.test(h));

    if (!storeNameCol || !storeCodeCol || !channelCol) {
      return NextResponse.json(
        { error: `Missing required columns. Found: ${headers.join(', ')}. Need: Store Name, Store Code, Channel` },
        { status: 400 }
      );
    }

    const stores: Store[] = rows
      .map(r => {
        const uid = uidCol ? String(r[uidCol] ?? '').trim() : '';
        return {
          storeName: String(r[storeNameCol] ?? '').trim(),
          storeCode: String(r[storeCodeCol] ?? '').trim(),
          channel: String(r[channelCol] ?? '').trim(),
          status: normaliseStatus(statusCol ? String(r[statusCol] ?? '') : 'ACTIVE'),
          ...(uid ? { uid } : {}),
        };
      })
      .filter(s => s.storeCode && s.channel);

    const payload: ControlPayload = {
      updatedAt: new Date().toISOString(),
      updatedBy,
      stores,
    };

    await uploadSpFile(controlFilePath(), JSON.stringify(payload));

    const channels = [...new Set(stores.map(s => s.channel))];
    return NextResponse.json({
      ok: true,
      storeCount: stores.length,
      channelCount: channels.length,
      channels,
    });
  } catch (err) {
    console.error('Visit report control POST error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

// DELETE — wipe control file
export async function DELETE() {
  try {
    await deleteSpFile(controlFilePath());
    return NextResponse.json({ ok: true }, { headers: NO_CACHE });
  } catch (err) {
    console.error('Visit report control DELETE error:', err);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
