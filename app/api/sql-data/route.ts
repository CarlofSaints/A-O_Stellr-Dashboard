import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { ParseResult } from '@/lib/types';

const CLIENT_ID = 16; // MerchandisingSA (A&O)

// Stellr form IDs in dashboardFormsExpanded
const STELLR_FORM_IDS = [1199, 1204, 1205, 1208, 1213, 1214, 1223];

const BASE_HEADERS = [
  'Visit UUID', 'Channel', 'Store Name', 'Store Code', 'Rep Name', 'Date',
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

    // ── 1. Visit rows (include hidden join keys _storeId/_peopleId/_visitDate) ──
    const [visitRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         v.storeID                                     AS _storeId,
         v.peopleID                                    AS _peopleId,
         DATE_FORMAT(v.datOfVisit, '%Y-%m-%d')         AS _visitDate,
         v.visitUUID                                   AS \`Visit UUID\`,
         s.channelName                                 AS \`Channel\`,
         s.name                                        AS \`Store Name\`,
         s.storeCode                                   AS \`Store Code\`,
         CONCAT(p.firstName, ' ', p.lastName)          AS \`Rep Name\`,
         DATE_FORMAT(v.datOfVisit, '%d/%m/%Y')         AS \`Date\`
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

    if (visitRows.length === 0) {
      return NextResponse.json({ headers: BASE_HEADERS, rows: [], imageColumns: [] } as ParseResult);
    }

    // ── 2. Form responses — joined via storeID + peopleID + date ──────────────
    const formIdPlaceholders = STELLR_FORM_IDS.map(() => '?').join(',');

    const [formRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         storeID,
         peopleID,
         DATE_FORMAT(captureDate, '%Y-%m-%d')  AS visitDate,
         questionOrder,
         question,
         COALESCE(
           NULLIF(answerTypeBigString, ''),
           NULLIF(answerTypeString, ''),
           CAST(answerTypeNumeric AS CHAR)
         ) AS answer
       FROM dashboardFormsExpanded
       WHERE formID IN (${formIdPlaceholders})
         AND captureDate >= ?
         AND captureDate  < DATE_ADD(?, INTERVAL 1 DAY)
       ORDER BY storeID, peopleID, visitDate, questionOrder`,
      [...STELLR_FORM_IDS, dateFrom, dateTo],
    );

    // ── 3. Pivot: storeID|peopleID|date → { question: answer } ────────────────
    const formMap       = new Map<string, Record<string, string | null>>();
    const questionOrder = new Map<string, number>();
    const imageQuestions = new Set<string>();

    for (const row of formRows) {
      const key = `${row.storeID}|${row.peopleID}|${row.visitDate}`;
      const q   = String(row.question ?? '').trim();
      const a   = row.answer != null ? String(row.answer) : null;

      if (!q) continue;

      if (!formMap.has(key)) formMap.set(key, {});
      formMap.get(key)![q] = a;

      if (!questionOrder.has(q)) questionOrder.set(q, Number(row.questionOrder ?? 999));
      if (a && a.startsWith('https://')) imageQuestions.add(q);
    }

    const allQuestions = [...questionOrder.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([q]) => q);

    // ── 4. Build final rows ───────────────────────────────────────────────────
    const headers      = [...BASE_HEADERS, ...allQuestions];
    const imageColumns = [...imageQuestions];

    const rows = visitRows.map(v => {
      const key         = `${v._storeId}|${v._peopleId}|${v._visitDate}`;
      const formAnswers = formMap.get(key) ?? {};
      const out: Record<string, string | number | null> = {};
      for (const h of BASE_HEADERS) out[h] = (v[h] as string | number | null) ?? null;
      for (const q of allQuestions)  out[q] = formAnswers[q] ?? null;
      return out;
    });

    return NextResponse.json({ headers, rows, imageColumns } as ParseResult);

  } catch (e) {
    console.error('[sql-data]', e);
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
  }
}
