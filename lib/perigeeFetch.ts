// Paginating fetch for the Perigee /api/visits endpoint.
//
// Perigee returns visits wrapped as { visits: { data: [...], ...pagination } }
// (Laravel-style paginator). The importer historically read only `visits.data`
// (page 1), so any date range with more visits than one page silently lost the
// rest. This helper walks every page until the paginator is exhausted, with
// strong guards so it can never loop forever — and if the server ignores the
// page parameter it stops after page 1 (same as the old behaviour) and reports
// why, so we can adjust the param name if needed.

export class PerigeeFetchError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`Perigee API returned ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

export interface PerigeePageInfo {
  pagesFetched: number;
  totalRows: number;
  reportedTotal: number | null;
  reportedLastPage: number | null;
  stoppedReason: string;
}

export interface PerigeeFetchResult {
  rows: Record<string, unknown>[];
  pageInfo: PerigeePageInfo;
  /** Page-1 debug info for the Settings "test" preview. */
  firstPageMeta: Record<string, unknown>;
  rawTopLevelKeys: string[];
}

function extractData(resp: unknown): Record<string, unknown>[] {
  if (Array.isArray(resp)) return resp as Record<string, unknown>[];
  const r = resp as Record<string, unknown> | null;
  const visits = r?.visits as Record<string, unknown> | undefined;
  if (visits && Array.isArray(visits.data)) return visits.data as Record<string, unknown>[];
  if (Array.isArray(r?.visits)) return r!.visits as Record<string, unknown>[];
  if (Array.isArray(r?.data)) return r!.data as Record<string, unknown>[];
  return [];
}

/** Pagination/metadata object (the `visits` wrapper minus its `data` array). */
function extractMeta(resp: unknown): Record<string, unknown> {
  const r = resp as Record<string, unknown> | null;
  if (r && typeof r.visits === 'object' && r.visits !== null && !Array.isArray(r.visits)) {
    const { data: _data, ...meta } = r.visits as Record<string, unknown>;
    return meta;
  }
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    const { data: _data, visits: _visits, ...meta } = r;
    return meta;
  }
  return {};
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstRowKey(row: Record<string, unknown> | undefined): string {
  if (!row) return '';
  return String(row.visitGuid ?? row.guid ?? row.visitId ?? JSON.stringify(row).slice(0, 120));
}

/**
 * Fetch ALL pages of visits for the given request body. The next page is asked
 * for both via a `?page=N` query param (Laravel default) and a `page` body field
 * (belt and suspenders). Stops on: last page reached, total collected, an empty
 * or short page, the server not advancing the page, or a hard page cap.
 */
export async function fetchAllPerigeeVisits(
  endpoint: string,
  apiKey: string,
  baseBody: Record<string, unknown>,
  opts?: { maxPages?: number },
): Promise<PerigeeFetchResult> {
  const maxPages = opts?.maxPages ?? 500;
  const all: Record<string, unknown>[] = [];
  let reportedTotal: number | null = null;
  let reportedLastPage: number | null = null;
  let stoppedReason = 'complete';
  let firstPageMeta: Record<string, unknown> = {};
  let rawTopLevelKeys: string[] = [];
  let prevFirstKey = '';
  let page = 1;

  for (; page <= maxPages; page++) {
    const url = page === 1
      ? endpoint
      : `${endpoint}${endpoint.includes('?') ? '&' : '?'}page=${page}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ ...baseBody, page }),
    });

    if (!res.ok) {
      if (page === 1) {
        const detail = await res.text().catch(() => '');
        throw new PerigeeFetchError(res.status, detail.slice(0, 500));
      }
      stoppedReason = `page ${page} returned ${res.status}`;
      break;
    }

    const json = await res.json();
    const data = extractData(json);
    const meta = extractMeta(json);

    if (page === 1) {
      firstPageMeta = meta;
      rawTopLevelKeys = json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json) : [];
    }

    reportedTotal = num(meta.total ?? meta.totalRows ?? meta.totalRecords ?? meta.count) ?? reportedTotal;
    reportedLastPage = num(meta.last_page ?? meta.lastPage ?? meta.totalPages ?? meta.pages) ?? reportedLastPage;
    const currentPage = num(meta.current_page ?? meta.currentPage ?? meta.page);
    const perPage = num(meta.per_page ?? meta.perPage ?? meta.pageSize);

    if (data.length === 0) { stoppedReason = page === 1 ? 'no rows returned' : 'empty page'; break; }

    // Server ignored the page param and returned the same page again.
    const fKey = firstRowKey(data[0]);
    if (page > 1 && fKey === prevFirstKey) { stoppedReason = 'server returned same page (ignores page param)'; break; }
    prevFirstKey = fKey;

    // Server reports it's still on an earlier page than requested → ignores param.
    if (page > 1 && currentPage !== null && currentPage < page) {
      stoppedReason = `server returned page ${currentPage} for requested ${page}`;
      break;
    }

    all.push(...data);

    if (reportedLastPage !== null) {
      if (page >= reportedLastPage) { stoppedReason = 'reached last page'; break; }
    } else if (reportedTotal !== null) {
      if (all.length >= reportedTotal) { stoppedReason = 'collected reported total'; break; }
    } else {
      // No pagination metadata: treat a short (or unknown-size) page as the end.
      if (perPage === null || data.length < perPage) { stoppedReason = 'no pagination metadata'; break; }
    }
  }

  if (page > maxPages) stoppedReason = `hit max page cap (${maxPages})`;

  return {
    rows: all,
    pageInfo: {
      pagesFetched: Math.min(page, maxPages),
      totalRows: all.length,
      reportedTotal,
      reportedLastPage,
      stoppedReason,
    },
    firstPageMeta,
    rawTopLevelKeys,
  };
}
