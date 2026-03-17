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

    // ── 1. Visit rows ──────────────────────────────────────────────────────────
    const [visitRows] = await pool.query<RowDataPacket[]>(
      `SELECT
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

    if (visitRows.length === 0) {
      return NextResponse.json({ headers: BASE_HEADERS, rows: [], imageColumns: [] } as ParseResult);
    }

    // ── 2. Form responses — join on responseUUID = visitUUID ──────────────────
    const visitUUIDs = visitRows.map(v => v['Visit UUID'] as string).filter(Boolean);
    const placeholders = visitUUIDs.map(() => '?').join(',');

    const [formRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         responseUUID,
         questionOrder,
         question,
         COALESCE(
           NULLIF(answerTypeBigString, ''),
           NULLIF(answerTypeString, ''),
           CAST(answerTypeNumeric AS CHAR)
         ) AS answer
       FROM dashboardFormsExpanded
       WHERE clientID = ?
         AND responseUUID IN (${placeholders})
       ORDER BY responseUUID, questionOrder`,
      [CLIENT_ID, ...visitUUIDs],
    );

    // ── 3. Pivot: build visitUUID → { question: answer } + ordered question list
    const formMap        = new Map<string, Record<string, string | null>>();
    const questionOrder  = new Map<string, number>(); // question → min order seen
    const imageQuestions = new Set<string>();

    for (const row of formRows) {
      const uuid = String(row.responseUUID ?? '');
      const q    = String(row.question    ?? '').trim();
      const a    = row.answer != null ? String(row.answer) : null;

      if (!uuid || !q) continue;

      if (!formMap.has(uuid)) formMap.set(uuid, {});
      formMap.get(uuid)![q] = a;

      if (!questionOrder.has(q)) questionOrder.set(q, Number(row.questionOrder ?? 999));
      if (a && a.startsWith('https://')) imageQuestions.add(q);
    }

    const allQuestions = [...questionOrder.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([q]) => q);

    // ── 4. Assemble final rows ─────────────────────────────────────────────────
    const headers      = [...BASE_HEADERS, ...allQuestions];
    const imageColumns = [...imageQuestions];

    const rows = visitRows.map(v => {
      const uuid        = String(v['Visit UUID'] ?? '');
      const formAnswers = formMap.get(uuid) ?? {};
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
