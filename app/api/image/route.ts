import { NextRequest, NextResponse } from 'next/server';
import { isPhotoUrl } from '@/lib/photoUrl';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  if (!url) return new NextResponse('Missing url param', { status: 400 });
  if (!isPhotoUrl(url)) {
    return new NextResponse('Disallowed domain', { status: 403 });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://live.perigeeportal.co.za/',
      },
    });

    if (!upstream.ok) {
      return new NextResponse(`Upstream error: ${upstream.status}`, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    // Streamed, not buffered: Vercel refuses a buffered body over 4.5 MB.
    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('Image proxy error:', err);
    return new NextResponse('Proxy error', { status: 500 });
  }
}
