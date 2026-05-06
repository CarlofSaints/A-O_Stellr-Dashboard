import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, noCacheHeaders } from '@/lib/auth';
import { readJson, writeJson } from '@/lib/blob';
import { fetchSpFile, uploadSpFile } from '@/lib/graph-oj';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PerigeeConfig {
  apiKey: string;
  endpoint: string;
  enabled: boolean;
  lastPolledAt: string | null;
  requestBody: string;
}

interface Visit {
  storeCode: string;
  storeName: string;
  channel: string;
  date: string;
  visitUuid: string;
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

function mapPerigeeVisit(row: Record<string, unknown>): Visit {
  const str = (key: string) => String(row[key] ?? '').trim();

  // Store name and code
  const rawStore = str('store') || str('Store Full Name') || str('storeName') || str('place') || '';
  const storeName = rawStore;
  const storeCode = str('Store Code') || str('storeCode') || '';

  // Channel
  const channel = str('channel') || str('Channel') || '';

  // Date — extract YYYY-MM-DD from startDateFull "2026-05-04 16:39:02" or startDate or checkInDate
  let date = '';
  const startDateFull = str('startDateFull');
  if (startDateFull && startDateFull.includes(' ')) {
    date = startDateFull.split(' ')[0];
  } else {
    date = str('checkInDate') || str('startDate') || str('date') || '';
  }
  // Convert DD/MM/YYYY → YYYY-MM-DD if needed
  const dmyMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (dmyMatch) {
    date = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }

  // Visit UUID for dedup
  const visitUuid = str('visitGuid') || str('visitsGuid') || str('guid') || str('visitId') || '';

  return { storeCode, storeName, channel, date, visitUuid };
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

    // Call Perigee API
    const perigeeRes = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(perigeeBody),
    });

    if (!perigeeRes.ok) {
      const errText = await perigeeRes.text().catch(() => '');
      return NextResponse.json(
        { error: `Perigee API returned ${perigeeRes.status}`, detail: errText.slice(0, 500) },
        { status: 502, headers: noCacheHeaders() }
      );
    }

    const perigeeData = await perigeeRes.json();

    // Update lastPolledAt
    await writeJson(CONFIG_KEY, { ...config, lastPolledAt: new Date().toISOString() });

    // Determine the visits array from the response
    let rawVisits: Record<string, unknown>[] = [];
    if (Array.isArray(perigeeData)) {
      rawVisits = perigeeData;
    } else if (perigeeData.visits && Array.isArray(perigeeData.visits.data)) {
      rawVisits = perigeeData.visits.data;
    } else if (Array.isArray(perigeeData.visits)) {
      rawVisits = perigeeData.visits;
    } else if (Array.isArray(perigeeData.data)) {
      rawVisits = perigeeData.data;
    }

    if (mode === 'test') {
      const sample = rawVisits.slice(0, 3);
      const responseKeys = rawVisits.length > 0 ? Object.keys(rawVisits[0]) : [];
      const meta: Record<string, unknown> = {};
      for (const k of Object.keys(perigeeData)) {
        if (k === 'visits' && typeof perigeeData[k] === 'object' && !Array.isArray(perigeeData[k])) {
          const { data: _d, ...visitsMeta } = perigeeData[k] as Record<string, unknown>;
          meta['visits'] = visitsMeta;
        } else if (k !== 'visits') {
          meta[k] = perigeeData[k];
        }
      }
      return NextResponse.json({
        ok: true,
        mode: 'test',
        totalRows: rawVisits.length,
        responseKeys,
        sample,
        rawTopLevelKeys: Object.keys(perigeeData),
        meta,
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

    const mappedVisits = rawVisits
      .map(mapPerigeeVisit)
      .filter(v => v.storeCode && v.date);

    // Within-batch dedup by visitUuid (Perigee returns same GUID 2+ times)
    const batchSeen = new Set<string>();
    const dedupedBatch: Visit[] = [];
    for (const v of mappedVisits) {
      if (v.visitUuid) {
        if (batchSeen.has(v.visitUuid)) continue;
        batchSeen.add(v.visitUuid);
      }
      dedupedBatch.push(v);
    }

    // Load existing visits from SharePoint and cross-batch dedup
    const existing = await loadExistingVisits();
    const existingVisits = existing?.visits ?? [];
    const existingKeys = new Set<string>();
    for (const v of existingVisits) {
      if (v.visitUuid) existingKeys.add(`uuid:${v.visitUuid}`);
      existingKeys.add(`comp:${v.storeCode}|${v.date}`);
    }

    const newVisits = dedupedBatch.filter(v => {
      if (v.visitUuid && existingKeys.has(`uuid:${v.visitUuid}`)) return false;
      const compKey = `comp:${v.storeCode}|${v.date}`;
      if (existingKeys.has(compKey)) return false;
      // Add to set so we don't add dupes within this new batch either
      if (v.visitUuid) existingKeys.add(`uuid:${v.visitUuid}`);
      existingKeys.add(compKey);
      return true;
    });

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
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Perigee poll error:', err);
    return NextResponse.json(
      { error: 'Failed to call Perigee API: ' + (err instanceof Error ? err.message : 'Unknown') },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
