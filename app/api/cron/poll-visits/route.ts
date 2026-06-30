import { NextRequest, NextResponse } from 'next/server';
import { readJson, writeJson } from '@/lib/blob';
import { requireAdmin } from '@/lib/auth';
import { fetchSpFile, uploadSpFile } from '@/lib/graph-oj';
import { fetchAllPerigeeVisits, PerigeeFetchError } from '@/lib/perigeeFetch';

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

interface PollSlot {
  id: string;
  time: string;
  type: 'short' | 'long';
  enabled: boolean;
}

interface PollSchedule {
  slots: PollSlot[];
  timezone: string;
}

interface CronLogEntry {
  timestamp: string;
  matched: boolean;
  slotTime?: string;
  slotType?: string;
  result?: string;
  imported?: number;
  skipped?: number;
  error?: string;
}

const CONFIG_KEY = 'config/perigee-api.json';
const SCHEDULE_KEY = 'config/perigee-schedule.json';
const CRON_LOG_KEY = 'logs/cron-poll.json';

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

  const rawStore = str('store') || str('Store Full Name') || str('storeName') || str('place') || '';
  let storeName = rawStore;
  let storeCode = str('storeCode') || '';

  if (!storeCode && rawStore.includes(' - ')) {
    const lastDash = rawStore.lastIndexOf(' - ');
    storeName = rawStore.substring(0, lastDash).trim();
    storeCode = rawStore.substring(lastDash + 3).trim();
  }

  const channel = str('channel') || str('Channel') || '';

  let date = '';
  const startDateFull = str('startDateFull');
  if (startDateFull && startDateFull.includes(' ')) {
    date = startDateFull.split(' ')[0];
  } else {
    date = str('checkInDate') || str('startDate') || str('date') || '';
  }
  const dmyMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (dmyMatch) {
    date = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }

  const visitUuid = str('visitGuid') || str('visitsGuid') || str('guid') || str('visitId') || '';

  return { storeCode, storeName, channel, date, visitUuid };
}

export async function GET(req: NextRequest) {
  // Validate cron secret OR admin session
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  const isAdminAuth = await requireAdmin(req);
  if (!isCronAuth && !isAdminAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logEntry: CronLogEntry = { timestamp: new Date().toISOString(), matched: false };
  const forceRun = req.nextUrl.searchParams.get('force') === 'true';

  try {
    const schedule = await readJson<PollSchedule>(SCHEDULE_KEY, { slots: [], timezone: 'Africa/Johannesburg' });

    if (schedule.slots.length === 0 && !forceRun) {
      logEntry.result = 'No slots configured';
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: 'none', reason: 'No slots configured' });
    }

    const now = new Date();
    const sastTime = new Date(now.toLocaleString('en-US', { timeZone: schedule.timezone || 'Africa/Johannesburg' }));
    const currentHour = sastTime.getHours();
    const currentMin = sastTime.getMinutes();
    const currentMins = currentHour * 60 + currentMin;

    let matchedSlot: PollSlot | undefined;
    if (forceRun) {
      const firstEnabled = schedule.slots.find(s => s.enabled);
      matchedSlot = {
        id: 'manual',
        time: `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`,
        type: firstEnabled?.type || 'short',
        enabled: true,
      };
    } else {
      matchedSlot = schedule.slots.find(slot => {
        if (!slot.enabled) return false;
        const [slotH, slotM] = slot.time.split(':').map(Number);
        const slotMins = slotH * 60 + slotM;
        const diff = Math.abs(currentMins - slotMins);
        return diff <= 14;
      });
    }

    if (!matchedSlot) {
      logEntry.result = `No matching slot at ${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')} SAST`;
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: 'none', reason: logEntry.result });
    }

    logEntry.matched = true;
    logEntry.slotTime = matchedSlot.time;
    logEntry.slotType = matchedSlot.type;

    // Load Perigee config
    const config = await readJson<PerigeeConfig>(CONFIG_KEY, { apiKey: '', endpoint: '', enabled: false, lastPolledAt: null, requestBody: '' });
    if (!config.endpoint || !config.apiKey) {
      logEntry.error = 'Perigee API not configured';
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: false, error: 'Not configured' }, { status: 400 });
    }

    // Build request body
    const today = now.toISOString().slice(0, 10);
    let startDate: string;
    if (matchedSlot.type === 'long') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDate = sevenDaysAgo.toISOString().slice(0, 10);
    } else {
      startDate = today;
    }

    let perigeeBody: Record<string, unknown> = {};
    if (config.requestBody) {
      try { perigeeBody = JSON.parse(config.requestBody); } catch { /* use empty */ }
    }
    perigeeBody.startDate = startDate;
    perigeeBody.endDate = today;

    // Call Perigee API — walk every page (paginated response).
    let rawVisits: Record<string, unknown>[];
    let pageInfo;
    try {
      const result = await fetchAllPerigeeVisits(config.endpoint, config.apiKey, perigeeBody);
      rawVisits = result.rows;
      pageInfo = result.pageInfo;
    } catch (e) {
      if (e instanceof PerigeeFetchError) {
        logEntry.error = `Perigee ${e.status}: ${e.detail.slice(0, 200)}`;
        await appendCronLog(logEntry);
        return NextResponse.json({ ok: false, error: logEntry.error }, { status: 502 });
      }
      throw e;
    }
    await writeJson(CONFIG_KEY, { ...config, lastPolledAt: new Date().toISOString() });

    if (rawVisits.length === 0) {
      logEntry.result = 'No visits returned';
      logEntry.imported = 0;
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: 'polled', imported: 0 });
    }

    // Map and filter
    const mappedVisits = rawVisits.map(mapPerigeeVisit).filter(v => v.storeCode && v.date);

    // Within-batch dedup by visitUuid
    const batchSeen = new Set<string>();
    const dedupedBatch: Visit[] = [];
    for (const v of mappedVisits) {
      if (v.visitUuid) {
        if (batchSeen.has(v.visitUuid)) continue;
        batchSeen.add(v.visitUuid);
      }
      dedupedBatch.push(v);
    }

    // Cross-batch dedup against existing SharePoint data
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
      if (v.visitUuid) existingKeys.add(`uuid:${v.visitUuid}`);
      existingKeys.add(compKey);
      return true;
    });

    const skipped = mappedVisits.length - newVisits.length;

    if (newVisits.length === 0) {
      logEntry.result = 'All duplicates';
      logEntry.imported = 0;
      logEntry.skipped = skipped;
      await appendCronLog(logEntry);
      return NextResponse.json({ ok: true, action: 'polled', imported: 0, skipped });
    }

    // Merge and save to SharePoint
    const mergedVisits = [...existingVisits, ...newVisits];
    const payload: DataPayload = {
      updatedAt: new Date().toISOString(),
      updatedBy: `Cron (${matchedSlot.time} ${matchedSlot.type})`,
      visits: mergedVisits,
    };
    await uploadSpFile(dataFilePath(), JSON.stringify(payload));

    logEntry.result = 'Success';
    logEntry.imported = newVisits.length;
    logEntry.skipped = skipped;
    await appendCronLog(logEntry);

    return NextResponse.json({
      ok: true,
      action: 'imported',
      imported: newVisits.length,
      skipped,
      totalStored: mergedVisits.length,
      pageInfo,
    });
  } catch (err) {
    logEntry.error = err instanceof Error ? err.message : 'Unknown error';
    await appendCronLog(logEntry).catch(() => {});
    console.error('Cron poll error:', err);
    return NextResponse.json({ ok: false, error: logEntry.error }, { status: 500 });
  }
}

async function appendCronLog(entry: CronLogEntry) {
  try {
    const logs = await readJson<CronLogEntry[]>(CRON_LOG_KEY, []);
    logs.unshift(entry);
    await writeJson(CRON_LOG_KEY, logs.slice(0, 250));
  } catch {
    // Non-blocking
  }
}
