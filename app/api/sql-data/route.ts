import { NextRequest, NextResponse } from 'next/server';
import { fetchAndCache, cache } from '@/lib/sql-cache';
import type { ParseResult } from '@/lib/types';

export async function GET(req: NextRequest) {
  const sp       = req.nextUrl.searchParams;
  const dateFrom = sp.get('dateFrom') ?? '';
  const dateTo   = sp.get('dateTo')   ?? '';

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 });
  }

  try {
    const cacheKey = `${dateFrom}|${dateTo}`;
    if (cache.get(cacheKey)?.expiresAt ?? 0 > Date.now()) {
      console.log(`[sql-data] cache hit for ${cacheKey}`);
    }
    const result = await fetchAndCache(dateFrom, dateTo);
    return NextResponse.json(result as ParseResult);
  } catch (e) {
    console.error('[sql-data]', e);
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
  }
}
