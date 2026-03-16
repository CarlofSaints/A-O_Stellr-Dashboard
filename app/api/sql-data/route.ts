import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { ParseResult } from '@/lib/types';

const CLIENT_ID = 16; // MerchandisingSA (A&O)

const BASE_HEADERS = [
  'Visit UUID', 'Channel', 'Store Name', 'Store Code',
  'Rep Name', 'Date', 'Check In', 'Check Out', 'Duration (hrs)', 'Status',
];

export async function GET(req: NextRequest) {
  const sp       = req.nextUrl.searchParams;
  const dateFrom = sp.get('dateFrom') ?? '';
  const dateTo   = sp.get('dateTo')   ?? '';

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 });
  }

  try {
    const pool = getPool();

    // ── 1. Main visit query ────────────────────────────────────────────────────
    // Include raw _storeId / _peopleId / _visitDate for image matching (stripped before response)
    const [visitRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         DATE_FORMAT(v.datOfVisit, '%Y-%m-%d')       AS _visitDate,
         v.storeID                                    AS _storeId,
         v.peopleID                                   AS _peopleId,
         v.visitUUID                                  AS \`Visit UUID\`,
         s.channelName                                AS \`Channel\`,
         s.name                                       AS \`Store Name\`,
         s.storeCode                                  AS \`Store Code\`,
         CONCAT(p.firstName, ' ', p.lastName)         AS \`Rep Name\`,
         DATE_FORMAT(v.datOfVisit, '%d/%m/%Y')        AS \`Date\`,
         DATE_FORMAT(v.visitStart, '%H:%i')           AS \`Check In\`,
         DATE_FORMAT(v.visitEnd,   '%H:%i')           AS \`Check Out\`,
         ROUND(TIMESTAMPDIFF(MINUTE, v.visitStart, v.visitEnd) / 60.0, 1) AS \`Duration (hrs)\`,
         v.status                                     AS \`Status\`
       FROM dashboardVisits v
       JOIN dashboardStores  s ON s.id = v.storeID
       JOIN dashboardPeople  p ON p.id = v.peopleID
       WHERE v.clientID    = ?
         AND v.datOfVisit >= ?
         AND v.datOfVisit <= ?
       ORDER BY v.datOfVisit DESC, v.visitStart DESC
       LIMIT 2000`,
      [CLIENT_ID, dateFrom, dateTo],
    );

    // ── 2. Image URL query (from form responses) ───────────────────────────────
    // captureDate is datetime; range bounds use sargable comparison to allow index use
    let imageRows: RowDataPacket[] = [];
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT DISTINCT
           storeID,
           peopleID,
           DATE_FORMAT(captureDate, '%Y-%m-%d') AS visitDate,
           answerTypeBigString                  AS imageUrl
         FROM dashboardFormsExpanded
         WHERE clientID  = ?
           AND captureDate >= ?
           AND captureDate  < DATE_ADD(?, INTERVAL 1 DAY)
           AND answerTypeBigString LIKE 'https://%'
         ORDER BY storeID, peopleID, visitDate`,
        [CLIENT_ID, dateFrom, dateTo],
      );
      imageRows = rows;
    } catch (imgErr) {
      // Image query failure is non-fatal — return visits without images
      console.warn('[sql-data] image query failed:', imgErr);
    }

    // ── 3. Build storeId|peopleId|date → imageUrl[] map ───────────────────────
    const imageMap = new Map<string, string[]>();
    for (const row of imageRows) {
      const key = `${row.storeID}|${row.peopleID}|${row.visitDate}`;
      const bucket = imageMap.get(key) ?? [];
      if (!bucket.includes(row.imageUrl as string)) bucket.push(row.imageUrl as string);
      imageMap.set(key, bucket);
    }

    // ── 4. Determine how many image columns are needed (cap at 10) ─────────────
    let maxImages = 0;
    for (const v of visitRows) {
      const key = `${v._storeId}|${v._peopleId}|${v._visitDate}`;
      maxImages = Math.max(maxImages, (imageMap.get(key) ?? []).length);
    }
    maxImages = Math.min(maxImages, 10);

    // ── 5. Assemble final rows & headers ──────────────────────────────────────
    const imageCols = Array.from({ length: maxImages }, (_, i) => `Image ${i + 1}`);
    const headers   = [...BASE_HEADERS, ...imageCols];

    const rows = visitRows.map(v => {
      const key  = `${v._storeId}|${v._peopleId}|${v._visitDate}`;
      const urls = imageMap.get(key) ?? [];
      const out: Record<string, string | number | null> = {};
      for (const h of BASE_HEADERS) out[h] = (v[h] as string | number | null) ?? null;
      for (let i = 0; i < maxImages; i++) out[`Image ${i + 1}`] = urls[i] ?? null;
      return out;
    });

    const result: ParseResult = { headers, rows, imageColumns: imageCols };
    return NextResponse.json(result);

  } catch (e) {
    console.error('[sql-data]', e);
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
  }
}
