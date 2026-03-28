import { NextRequest, NextResponse } from 'next/server';
import { fetchSpFile, uploadSpFile } from '@/lib/graph-oj';
import type { LoadedFile } from '@/lib/types';

interface CachePayload {
  updatedAt: string;
  updatedBy: string;
  files: LoadedFile[];
}

function getCachePath(): string {
  const imagesBase = (process.env.AO_SP_IMAGES_BASE_PATH ?? '').replace(/\/$/, '');
  if (!imagesBase) throw new Error('AO_SP_IMAGES_BASE_PATH not configured');
  // Parent folder of DOWNLOADED FORM IMAGES — store cache file alongside it
  const parent = imagesBase.split('/').slice(0, -1).join('/');
  return `${parent}/latest-dashboard-data.json`;
}

export async function GET() {
  try {
    const buf = await fetchSpFile(getCachePath());
    const payload = JSON.parse(Buffer.from(buf).toString('utf-8')) as CachePayload;
    return NextResponse.json(payload);
  } catch {
    // Cache file doesn't exist yet — not an error, just return null
    return NextResponse.json(null);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as CachePayload;
    await uploadSpFile(getCachePath(), JSON.stringify(body));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('SP cache save error:', err);
    return NextResponse.json({ error: 'Cache save failed' }, { status: 500 });
  }
}
