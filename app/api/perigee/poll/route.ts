import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, noCacheHeaders } from '@/lib/auth';
import { readJson, writeJson } from '@/lib/blob';
import { fetchSpFile, uploadSpFile } from '@/lib/graph-oj';
import { fetchAllPerigeeVisits, PerigeeFetchError } from '@/lib/perigeeFetch';
import { mapPerigeeVisit, isUsableVisit, selectNewVisits, type Visit } from '@/lib/visitMap';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PerigeeConfig {
  apiKey: string;
  endpoint: string;
  enabled: boolean;
  lastPolledAt: string | null;
  requestBody: string;
}

interface DataPayload {
  updatedAt: string;
  updatedBy: string;
  visits: Visit[];
}

const CONFIG_KEY = 'config/perigee-api.json';

function getBasePath(): string {
  const imagesBase = (process.env.AO_SP_IMAGES_BASE_PATH ?? '').replace(/\/$/, '');
  if (!imagesBase) throw new Error('AO_SP_IMAGES_BASE_PATH not configured');
  return imagesBase.split('/').slice(0, -1).join('/');
}

function dataFilePath(): string {
  return `${getBasePath()}/visit-report-data.json`;
}

async function loadExistingVisits(): Promise<DataPayload | null> {
  try {
    const buf = await fetchSpFile(dataFilePath());
    return JSON.parse(Buffer.from(buf).toString('utf-8')) as DataPayload;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await readJson<PerigeeConfig>(CONFIG_KEY, { apiKey: '', endpoint: '', enabled: false, lastPolledAt: null, requestBody: '' });

  if (!config.endpoint || !config.apiKey) {
    return NextResponse.json(
      { error: 'Perigee API not configured. Set endpoint and token in Settings.' },
      { status: 400, headers: noCacheHeaders() }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode = (body as Record<string, string>).mode || 'test';

    // Strip 'mode' before forwarding to Perigee
    const perigeeBody = { ...(body as Record<string, unknown>) };
    delete perigeeBody.mode;

    if (!perigeeBody.startDate) {
      return NextResponse.json(
        { error: 'startDate is required in the request body' },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    // Call Perigee API — walk EVERY page (the response is paginated; reading
    // only page 1 silently dropped most visits for busy date ranges).
    let rawVisits: Record<string, unknown>[];
    let pageInfo, firstPageMeta, rawTopLevelKeys;
    try {
      const result = await fetchAllPerigeeVisits(config.endpoint, config.apiKey, perigeeBody);
      rawVisits = result.rows;
      pageInfo = result.pageInfo;
      firstPageMeta = result.firstPageMeta;
      rawTopLevelKeys = result.rawTopLevelKeys;
    } catch (e) {
      if (e instanceof PerigeeFetchError) {
        return NextResponse.json(
          { error: `Perigee API returned ${e.status}`, detail: e.detail },
          { status: 502, headers: noCacheHeaders() }
        );
      }
      throw e;
    }

    // Update lastPolledAt
    await writeJson(CONFIG_KEY, { ...config, lastPolledAt: new Date().toISOString() });

    if (mode === 'test') {
      const sample = rawVisits.slice(0, 3);
      const responseKeys = rawVisits.length > 0 ? Object.keys(rawVisits[0]) : [];
      return NextResponse.json({
        ok: true,
        mode: 'test',
        totalRows: rawVisits.length,
        responseKeys,
        sample,
        rawTopLevelKeys,
        meta: { visits: firstPageMeta },
        pageInfo,
        sentBody: perigeeBody,
      }, { headers: noCacheHeaders() });
    }

    // mode === 'import' — map, deduplicate, and save to SharePoint
    if (rawVisits.length === 0) {
      return NextResponse.json(
        { ok: true, mode: 'import', message: 'No visits returned for this date range', totalRows: 0, importedRows: 0 },
        { headers: noCacheHeaders() }
      );
    }

    const mappedVisits = rawVisits.map(mapPerigeeVisit).filter(isUsableVisit);

    // De-dupe within the batch (Perigee repeats a GUID across pages) and
    // against what SharePoint already holds.
    const existing = await loadExistingVisits();
    const existingVisits = existing?.visits ?? [];
    const newVisits = selectNewVisits(existingVisits, mappedVisits);

    const skippedDuplicates = mappedVisits.length - newVisits.length;

    if (newVisits.length === 0) {
      return NextResponse.json({
        ok: true,
        mode: 'import',
        message: 'All visits already imported (duplicates skipped)',
        totalRows: rawVisits.length,
        importedRows: 0,
        skippedDuplicates,
      }, { headers: noCacheHeaders() });
    }

    // Merge and save to SharePoint
    const mergedVisits = [...existingVisits, ...newVisits];
    const payload: DataPayload = {
      updatedAt: new Date().toISOString(),
      updatedBy: 'Perigee API',
      visits: mergedVisits,
    };

    await uploadSpFile(dataFilePath(), JSON.stringify(payload));

    return NextResponse.json({
      ok: true,
      mode: 'import',
      totalRows: rawVisits.length,
      importedRows: newVisits.length,
      skippedDuplicates,
      totalStored: mergedVisits.length,
      pageInfo,
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Perigee poll error:', err);
    return NextResponse.json(
      { error: 'Failed to call Perigee API: ' + (err instanceof Error ? err.message : 'Unknown') },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
