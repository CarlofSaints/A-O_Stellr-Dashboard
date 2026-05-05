import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, noCacheHeaders } from '@/lib/auth';
import { readJson, writeJson } from '@/lib/blob';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PerigeeConfig {
  apiKey: string;
  endpoint: string;
  enabled: boolean;
  lastPolledAt: string | null;
  requestBody: string;
}

const CONFIG_KEY = 'config/perigee-api.json';

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

    // mode === 'import' — for now just return the count
    // (actual import will be wired up when visit data model is defined)
    return NextResponse.json({
      ok: true,
      mode: 'import',
      totalRows: rawVisits.length,
      message: `${rawVisits.length} visits returned from Perigee. Import storage not yet wired for this project.`,
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Perigee poll error:', err);
    return NextResponse.json(
      { error: 'Failed to call Perigee API: ' + (err instanceof Error ? err.message : 'Unknown') },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
