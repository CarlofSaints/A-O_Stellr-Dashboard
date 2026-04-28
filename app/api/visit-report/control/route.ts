import { NextRequest, NextResponse } from 'next/server';
import { fetchSpFile, uploadSpFile, deleteSpFile } from '@/lib/graph-oj';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

interface Store {
  storeName: string;
  storeCode: string;
  channel: string;
  status: string; // ACTIVE or CLOSED
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

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const buf = await fetchSpFile(path);
    return JSON.parse(Buffer.from(buf).toString('utf-8')) as T;
  } catch {
    return null;
  }
}

// GET — return the current control file
export async function GET() {
  try {
    const data = await fetchJson<ControlPayload>(controlFilePath());
    return NextResponse.json(data, { headers: NO_CACHE });
  } catch (err) {
    console.error('Visit report control GET error:', err);
    return NextResponse.json(null, { headers: NO_CACHE });
  }
}

// POST — upload new control file (replace mode)
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
      .map(r => {
        const rawStatus = statusCol ? String(r[statusCol] ?? '').trim().toUpperCase() : 'ACTIVE';
        return {
          storeName: String(r[storeNameCol] ?? '').trim(),
          storeCode: String(r[storeCodeCol] ?? '').trim(),
          channel: String(r[channelCol] ?? '').trim(),
          status: rawStatus === 'CLOSED' ? 'CLOSED' : 'ACTIVE',
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
