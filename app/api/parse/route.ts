import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import type { ParseResult, VisitRow } from '@/lib/types';

// Perigee section-header artefacts — not real data columns
const SECTION_HEADERS = new Set(['Media', 'Stock', 'Training Stuff', 'Staff', 'Line Management']);

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

    const result: ParseResult = {
      headers: keepHeaders,
      rows,
      imageColumns: [...imageCols],
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('Parse error:', err);
    return NextResponse.json({ error: 'Failed to parse file' }, { status: 500 });
  }
}
