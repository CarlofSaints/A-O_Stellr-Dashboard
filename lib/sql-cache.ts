import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { ParseResult } from '@/lib/types';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDMY(iso: string): string {
  // iso = YYYY-MM-DD
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2,'0')} ${MONTHS[m - 1]} ${y}`;
}

function buildFolderName(dateFrom: string, dateTo: string): string {
  try {
    return `${fmtDMY(dateFrom)} - ${fmtDMY(dateTo)} - Stellr`;
  } catch {
    return `${dateFrom} - ${dateTo} - Stellr`;
  }
}

const CLIENT_ID      = 16;
const STELLR_FORM_IDS = [1199, 1204, 1205, 1208, 1213, 1214, 1223];
const CACHE_TTL_MS   = 60 * 60 * 1000; // 1 hour

const BASE_HEADERS = [
  'Visit UUID', 'Channel', 'Store Name', 'Store Code', 'Rep Name', 'Date',
];

export const cache = new Map<string, { data: ParseResult; expiresAt: number }>();

export async function fetchAndCache(dateFrom: string, dateTo: string): Promise<ParseResult> {
  const imageFolderName = buildFolderName(dateFrom, dateTo);
  const cacheKey = `${dateFrom}|${dateTo}`;
  const cached   = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const pool = getPool();
  const t0   = Date.now();

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

  console.log(`[sql-cache] visit query: ${Date.now() - t0}ms, ${visitRows.length} rows`);

  if (visitRows.length === 0) {
    const empty: ParseResult = { headers: BASE_HEADERS, rows: [], imageColumns: [], imageFolderName };
    cache.set(cacheKey, { data: empty, expiresAt: Date.now() + CACHE_TTL_MS });
    return empty;
  }

  const uniqueStoreIds  = [...new Set(visitRows.map(v => v._storeId  as number))];
  const uniquePeopleIds = [...new Set(visitRows.map(v => v._peopleId as number))];

  const formIdPlaceholders   = STELLR_FORM_IDS.map(() => '?').join(',');
  const storeIdPlaceholders  = uniqueStoreIds.map(() => '?').join(',');
  const peopleIdPlaceholders = uniquePeopleIds.map(() => '?').join(',');

  const [formRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       f.storeID,
       f.peopleID,
       DATE_FORMAT(f.captureDate, '%Y-%m-%d')  AS visitDate,
       f.questionOrder,
       f.question,
       COALESCE(
         NULLIF(f.answerTypeBigString, ''),
         NULLIF(f.answerTypeString, ''),
         CAST(f.answerTypeNumeric AS CHAR)
       ) AS answer
     FROM dashboardFormsExpanded f
     WHERE f.formID    IN (${formIdPlaceholders})
       AND f.captureDate >= ?
       AND f.captureDate  < DATE_ADD(?, INTERVAL 1 DAY)
       AND f.storeID   IN (${storeIdPlaceholders})
       AND f.peopleID  IN (${peopleIdPlaceholders})
     ORDER BY f.storeID, f.peopleID, visitDate, f.questionOrder`,
    [...STELLR_FORM_IDS, dateFrom, dateTo, ...uniqueStoreIds, ...uniquePeopleIds],
  );

  console.log(`[sql-cache] form query: ${Date.now() - t0}ms, ${formRows.length} rows`);

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

  const result: ParseResult = { headers, rows, imageColumns, imageFolderName };
  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  console.log(`[sql-cache] total: ${Date.now() - t0}ms — cached 15 min`);
  return result;
}
