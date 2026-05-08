import { NextRequest, NextResponse } from 'next/server';
import { fetchSpFile, uploadSpFile, deleteSpFile } from '@/lib/graph-oj';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

const VALID_STATUSES = ['ACTIVE', 'CLOSED', 'NOT IN CYCLE'] as const;
type StoreStatus = (typeof VALID_STATUSES)[number];

interface Store {
  storeName: string;
  storeCode: string;
  channel: string;
  status: string; // ACTIVE, CLOSED, or NOT IN CYCLE
}

interface ControlPayload {
  updatedAt: string;
  updatedBy: string;
  stores: Store[];
}

function getBasePath(): string {
  const imagesBase = (process.env.AO_SP_IMAGES_BASE_PATH ?? '').replace(/\/$/, '');
  if (!imagesBase) throw new Error('AO_SP_IMAGES_BASE_PATH not configured');
  return imagesBase.split('/').slice(0, -1).join('/');
}

function controlFilePath(): string {
  return `${getBasePath()}/visit-report-control.json`;
}

/** Path to the master Excel control file in SP */
function controlExcelPath(): string {
  const imagesBase = (process.env.AO_SP_IMAGES_BASE_PATH ?? '').replace(/\/$/, '');
  if (!imagesBase) throw new Error('AO_SP_IMAGES_BASE_PATH not configured');
  // Find "2. EXTERNAL SYNC" segment, then append CONTROL FILES/...
  const idx = imagesBase.indexOf('2. EXTERNAL SYNC');
  if (idx === -1) throw new Error('Could not find "2. EXTERNAL SYNC" in AO_SP_IMAGES_BASE_PATH');
  const syncRoot = imagesBase.substring(0, idx + '2. EXTERNAL SYNC'.length);
  return `${syncRoot}/CONTROL FILES/Store Control File- Stellr v3.xlsx`;
}

function normaliseStatus(raw: string): StoreStatus {
  const s = raw.trim().toUpperCase();
  if (s === 'CLOSED') return 'CLOSED';
  if (s === 'NOT IN CYCLE') return 'NOT IN CYCLE';
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

  if (!storeNameCol || !storeCodeCol || !channelCol) return [];

  return rows
    .map(r => ({
      storeName: String(r[storeNameCol] ?? '').trim(),
      storeCode: String(r[storeCodeCol] ?? '').trim(),
      channel: String(r[channelCol] ?? '').trim(),
      status: normaliseStatus(statusCol ? String(r[statusCol] ?? '') : 'ACTIVE'),
    }))
    .filter(s => s.storeCode && s.channel);
}

// GET — read directly from the SharePoint Excel control file
export async function GET() {
  try {
    const buf = await fetchSpFile(controlExcelPath());
    const stores = parseExcelToStores(buf);

    const payload: ControlPayload = {
      updatedAt: new Date().toISOString(),
      updatedBy: 'SharePoint Excel',
      stores,
    };
    return NextResponse.json(payload, { headers: NO_CACHE });
  } catch (err) {
    console.error('Visit report control GET error:', err);
    // Fallback: try the legacy JSON file
    try {
      const buf = await fetchSpFile(controlFilePath());
      const data = JSON.parse(Buffer.from(buf).toString('utf-8')) as ControlPayload;
      return NextResponse.json(data, { headers: NO_CACHE });
    } catch {
      return NextResponse.json(null, { headers: NO_CACHE });
    }
  }
}

// PATCH — add a single store to the Excel control file
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { storeName, storeCode, channel, status } = body as {
      storeName?: string; storeCode?: string; channel?: string; status?: string;
    };

    if (!storeName || !storeCode || !channel || !status) {
      return NextResponse.json(
        { error: 'storeName, storeCode, channel, and status are required' },
        { status: 400 },
      );
    }

    const normStatus = normaliseStatus(status);

    // Fetch current Excel
    const excelPath = controlExcelPath();
    const buf = await fetchSpFile(excelPath);
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      return NextResponse.json({ error: 'Control Excel has no sheets' }, { status: 500 });
    }

    // Determine header columns
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const storeNameCol = headers.find(h => /store\s*name/i.test(h)) ?? 'Store Name';
    const storeCodeCol = headers.find(h => /store\s*code/i.test(h)) ?? 'Store Code';
    const channelCol = headers.find(h => /channel/i.test(h)) ?? 'Channel';
    const statusCol = headers.find(h => /^status$/i.test(h)) ?? 'Status';

    // Find actual last used row (don't trust !ref which may include empty trailing rows)
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    let lastUsedRow = 0;
    for (let r = range.e.r; r >= 0; r--) {
      let hasData = false;
      for (let c = 0; c <= 3; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v !== undefined && cell.v !== '') { hasData = true; break; }
      }
      if (hasData) { lastUsedRow = r; break; }
    }
    // Add new row right after the last used row
    const newRowNum = lastUsedRow + 1;
    ws[XLSX.utils.encode_cell({ r: newRowNum, c: 0 })] = { t: 's', v: channel.trim() };
    ws[XLSX.utils.encode_cell({ r: newRowNum, c: 1 })] = { t: 's', v: storeName.trim() };
    ws[XLSX.utils.encode_cell({ r: newRowNum, c: 2 })] = { t: 's', v: storeCode.trim() };
    ws[XLSX.utils.encode_cell({ r: newRowNum, c: 3 })] = { t: 's', v: normStatus };
    if (newRowNum > range.e.r) {
      range.e.r = newRowNum;
      ws['!ref'] = XLSX.utils.encode_range(range);
    }

    // Write back to SharePoint
    const outArr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    await uploadSpFile(
      excelPath,
      Buffer.from(outArr),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    return NextResponse.json({ ok: true, storeCount: rows.length + 1 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Visit report control PATCH error:', msg);
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

    if (!storeNameCol || !storeCodeCol || !channelCol) {
      return NextResponse.json(
        { error: `Missing required columns. Found: ${headers.join(', ')}. Need: Store Name, Store Code, Channel` },
        { status: 400 }
      );
    }

    const stores: Store[] = rows
      .map(r => ({
        storeName: String(r[storeNameCol] ?? '').trim(),
        storeCode: String(r[storeCodeCol] ?? '').trim(),
        channel: String(r[channelCol] ?? '').trim(),
        status: normaliseStatus(statusCol ? String(r[statusCol] ?? '') : 'ACTIVE'),
      }))
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
