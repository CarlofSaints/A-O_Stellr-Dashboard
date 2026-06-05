import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxies Perigee image URLs and returns base64-encoded image data
 * for embedding into jsPDF documents.
 *
 * GET /api/pdf-image?url=https://live.perigeeportal.co.za/...
 * Returns: { base64: "data:image/jpeg;base64,..." }
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }
  if (!url.startsWith('https://live.perigeeportal.co.za')) {
    return NextResponse.json({ error: 'Disallowed domain' }, { status: 403 });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://live.perigeeportal.co.za/',
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream error: ${upstream.status}` },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const b64 = buffer.toString('base64');
    const dataUri = `data:${contentType};base64,${b64}`;

    return NextResponse.json(
      { base64: dataUri },
      {
        headers: {
          'Cache-Control': 'public, max-age=86400',
        },
      },
    );
  } catch (err) {
    console.error('PDF image proxy error:', err);
    return NextResponse.json({ error: 'Proxy error' }, { status: 500 });
  }
}
