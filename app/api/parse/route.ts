import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, unauthorized } from '@/lib/auth';
import * as XLSX from 'xlsx';
import type { FormType, ParseResult, VisitRow } from '@/lib/types';

// Perigee section-header artefacts — not real data columns
const SECTION_HEADERS = new Set(['Media', 'Stock', 'Stock On Hand', 'Training Stuff', 'Staff', 'Line Management']);

/**
 * Auto-detect form type.
 * The client's redesigned Perigee forms dropped the old marker columns
 * ("Stock On Hand" / "Display Stands Identification"), so header sniffing alone
 * now misclassifies the count + stand exports as plain merch. The export
 * filename is the reliable signal ("… In Store Merc Count …", "… stands …"),
 * so it takes precedence; header markers remain as a fallback for the separately
 * exported sign-off form and any legacy files.
 */
function detectFormType(headers: string[], fileName: string): FormType {
  const fn = fileName.toLowerCase();
  // The count exports stopped being named "… In Store Merc Count …" and are now
  // just "Stellr <Chain> Count <date>.xlsx", so an exact "merc count" match
  // stopped firing around 7 Aug 2026 and every count file since has been filed
  // as 'merch'. That put them on the same de-dupe key as the weekly raw export,
  // which carries the same Visit UUIDs, so each one was cut to 1-2 rows on
  // arrival: PNP-Corporate 85 rows on 31 Jul, then 1, 1, 1. Match the word.
  if (/\bcounts?\b/.test(fn)) return 'stock-count';
  if (/\bstands?\b/.test(fn)) return 'stand';

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
  if (!(await requireAdmin(req))) return unauthorized();

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
    const formType = detectFormType(allHeaders, file.name ?? '');

    // Disambiguate duplicate header names. The redesigned forms repeat the same
    // question label after every display section (e.g. "Stand back and take a
    // photo of the area where the display is situated."). Rows are keyed by
    // header, so without unique names every repeated column collapses onto the
    // last one — silently dropping all but the final section's photo. Suffix
    // repeats with " (2)", " (3)", … so each column keeps its own value.
    const seenHeader = new Map<string, number>();
    const headers = allHeaders.map(h => {
      if (!h) return h;
      const n = (seenHeader.get(h) ?? 0) + 1;
      seenHeader.set(h, n);
      return n === 1 ? h : `${h} (${n})`;
    });

    const dataRows = raw.slice(1) as (string | number | null | Date)[][];

    // Detect image columns — any column whose values start with the Perigee portal URL
    const imageCols = new Set<string>();
    for (const row of dataRows) {
      headers.forEach((h, i) => {
        const val = row[i];
        if (typeof val === 'string' && val.startsWith('https://live.perigeeportal.co.za')) {
          imageCols.add(h);
        }
      });
    }

    // Keep only meaningful headers
    const keepHeaders = headers.filter(h => h && !SECTION_HEADERS.has(h));

    const rows: VisitRow[] = dataRows
      .map(row => {
        const obj: VisitRow = {};
        headers.forEach((h, i) => {
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
