import { NextRequest, NextResponse } from 'next/server';
import { fetchSpFile, uploadSpFile, deleteSpFile } from '@/lib/graph-oj';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

interface Visit {
  storeCode: string;
  storeName: string;
  channel: string;
  date: string; // YYYY-MM-DD
}

interface DataPayload {
  updatedAt: string;
  updatedBy: string;
  visits: Visit[];
}

function getBasePath(): string {
  const imagesBase = (process.env.AO_SP_IMAGES_BASE_PATH ?? '').replace(/\/$/, '');
  if (!imagesBase) throw new Error('AO_SP_IMAGES_BASE_PATH not configured');
  return imagesBase.split('/').slice(0, -1).join('/');
}

function dataFilePath(): string {
  return `${getBasePath()}/visit-report-data.json`;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const buf = await fetchSpFile(path);
    return JSON.parse(Buffer.from(buf).toString('utf-8')) as T;
  } catch {
    return null;
  }
}

/** Parse a date value from Excel — handles serial numbers and DD/MM/YYYY strings */
function parseDate(val: unknown): string | null {
  if (val == null || val === '') return null;

  // Excel serial number
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) {
      const mm = String(d.m).padStart(2, '0');
      const dd = String(d.d).padStart(2, '0');
      return `${d.y}-${mm}-${dd}`;
    }
  }

  const s = String(val).trim();

  // DD/MM/YYYY
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  // YYYY-MM-DD (already ISO)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  return null;
}

/** Case-insensitive header finder with multiple patterns */
function findCol(headers: string[], ...patterns: RegExp[]): string | undefined {
  for (const pat of patterns) {
    const found = headers.find(h => pat.test(h));
    if (found) return found;
  }
  return undefined;
}

// GET — return current visit data
export async function GET() {
  try {
    const data = await fetchJson<DataPayload>(dataFilePath());
    return NextResponse.json(data, { headers: NO_CACHE });
  } catch (err) {
    console.error('Visit report data GET error:', err);
    return NextResponse.json(null, { headers: NO_CACHE });
  }
}

// POST — upload visit data (append + dedup by storeCode+date)
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

    // Find columns — flexible case-insensitive matching for Perigee exports
    const headers = Object.keys(rows[0]);
    const channelCol = findCol(headers, /^channel$/i);
    const storeCodeCol = findCol(headers, /store\s*code/i);
    const storeNameCol = findCol(headers, /store\s*full\s*name/i, /store\s*name/i);
    const dateCol = findCol(headers, /check\s*in\s*date/i, /^date$/i);

    if (!storeCodeCol || !dateCol) {
      return NextResponse.json(
        { error: `Missing required columns. Found: ${headers.join(', ')}. Need at least: Store Code, Date (or Check In Date)` },
        { status: 400 }
      );
    }

    const incoming: Visit[] = rows
      .map(r => ({
        storeCode: String(r[storeCodeCol] ?? '').trim(),
        storeName: storeNameCol ? String(r[storeNameCol] ?? '').trim() : '',
        channel: channelCol ? String(r[channelCol] ?? '').trim() : '',
        date: parseDate(r[dateCol]) ?? '',
      }))
      .filter(v => v.storeCode && v.date);

    // Load existing and merge (dedup by storeCode+date)
    const existing = await fetchJson<DataPayload>(dataFilePath());
    const existingVisits = existing?.visits ?? [];
    const seen = new Set(existingVisits.map(v => `${v.storeCode}|${v.date}`));

    const newVisits = incoming.filter(v => {
      const key = `${v.storeCode}|${v.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const mergedVisits = [...existingVisits, ...newVisits];

    const payload: DataPayload = {
      updatedAt: new Date().toISOString(),
      updatedBy,
      visits: mergedVisits,
    };

    await uploadSpFile(dataFilePath(), JSON.stringify(payload));

    // Compute stats for response
    const allDates = mergedVisits.map(v => v.date).sort();
    const channels = [...new Set(mergedVisits.map(v => v.channel).filter(Boolean))];
    const stores = [...new Set(mergedVisits.map(v => v.storeCode).filter(Boolean))];
    return NextResponse.json({
      ok: true,
      totalVisits: mergedVisits.length,
      added: newVisits.length,
      duplicatesSkipped: incoming.length - newVisits.length,
      uniqueStores: stores.length,
      channels,
      dateRange: allDates.length ? { from: allDates[0], to: allDates[allDates.length - 1] } : null,
    });
  } catch (err) {
    console.error('Visit report data POST error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

// DELETE — wipe all visit data
export async function DELETE() {
  try {
    await deleteSpFile(dataFilePath());
    return NextResponse.json({ ok: true }, { headers: NO_CACHE });
  } catch (err) {
    console.error('Visit report data DELETE error:', err);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
