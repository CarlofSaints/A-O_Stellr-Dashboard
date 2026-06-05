import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import type { FormType, ParseResult, VisitRow } from '@/lib/types';

// Perigee section-header artefacts — not real data columns
const SECTION_HEADERS = new Set(['Media', 'Stock', 'Stock On Hand', 'Training Stuff', 'Staff', 'Line Management']);

/** Auto-detect form type from raw Excel headers (before filtering) */
function detectFormType(headers: string[]): FormType {
  const set = new Set(headers.map(h => h.toLowerCase().trim()));
  if (set.has("manager's name and surname") && set.has('signature')) return 'signature';
  if (set.has('stock on hand')) return 'stock-count';
  if (set.has('display stands identification')) return 'stand';
  return 'merch';
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(d: Date): string {
  return `${d.getDate().toString().padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Returns "DD MMM YYYY - DD MMM YYYY - Stellr" matching the VBA folder name convention */
function buildFolderName(rows: VisitRow[], dateHeader: string): string {
  let minD: Date | null = null;
  let maxD: Date | null = null;
  for (const row of rows) {
    const v = String(row[dateHeader] ?? '').trim();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (!m) continue;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (!minD || d < minD) minD = d;
    if (!maxD || d > maxD) maxD = d;
  }
  if (minD && maxD) return `${fmtDate(minD)} - ${fmtDate(maxD)} - Stellr`;
  const now = new Date();
  return `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')} - Stellr`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<(string | number | null | Date)[]>(ws, { header: 1, defval: null });

    if (raw.length < 2) {
      return NextResponse.json({ error: 'No data rows found in file' }, { status: 400 });
    }

    const allHeaders = (raw[0] as (string | null)[]).map(h => String(h ?? '').trim());
    const formType = detectFormType(allHeaders);
    const dataRows = raw.slice(1) as (string | number | null | Date)[][];

    // Detect image columns — any column whose values start with the Perigee portal URL
    const imageCols = new Set<string>();
    for (const row of dataRows) {
      allHeaders.forEach((h, i) => {
        const val = row[i];
        if (typeof val === 'string' && val.startsWith('https://live.perigeeportal.co.za')) {
          imageCols.add(h);
        }
      });
    }

    // Keep only meaningful headers
    const keepHeaders = allHeaders.filter(h => h && !SECTION_HEADERS.has(h));

    const rows: VisitRow[] = dataRows
      .map(row => {
        const obj: VisitRow = {};
        allHeaders.forEach((h, i) => {
          if (!keepHeaders.includes(h)) return;
          const val = row[i];
          // Convert Date objects (from cellDates) to DD/MM/YYYY string
          if (val instanceof Date) {
            const d = val.getDate().toString().padStart(2, '0');
            const m = (val.getMonth() + 1).toString().padStart(2, '0');
            const y = val.getFullYear();
            obj[h] = `${d}/${m}/${y}`;
          } else {
            obj[h] = val as string | number | null;
          }
        });
        return obj;
      })
      .filter(row => Object.values(row).some(v => v !== null && v !== ''));

    // Detect date column (header containing "date", case-insensitive; fallback col J index 9)
    const dateHeader =
      keepHeaders.find(h => /date/i.test(h)) ??
      (keepHeaders.length > 9 ? keepHeaders[9] : keepHeaders[0]);

    const imageFolderName = buildFolderName(rows, dateHeader);

    const result: ParseResult = {
      headers: keepHeaders,
      rows,
      imageColumns: [...imageCols],
      imageFolderName,
      formType,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('Parse error:', err);
    return NextResponse.json({ error: 'Failed to parse file' }, { status: 500 });
  }
}
