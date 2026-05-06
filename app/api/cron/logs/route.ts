import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, noCacheHeaders } from '@/lib/auth';
import { readJson } from '@/lib/blob';

export const dynamic = 'force-dynamic';

const CRON_LOG_KEY = 'logs/cron-poll.json';

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

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: noCacheHeaders() });
  }

  const logs = await readJson<CronLogEntry[]>(CRON_LOG_KEY, []);
  return NextResponse.json({ logs }, { headers: noCacheHeaders() });
}
