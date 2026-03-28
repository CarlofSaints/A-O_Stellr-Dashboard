import { NextRequest, NextResponse } from 'next/server';
import { fetchSpFile } from '@/lib/graph-oj';

/**
 * GET /api/sp-image?token=perigee-TOKEN
 *
 * Fetches a VBA-downloaded image from SharePoint and proxies it to the browser.
 * All images live flat in the base folder — no date-range subfolders.
 * Env var required: AO_SP_IMAGES_BASE_PATH (path relative to library root, no trailing slash)
 * e.g. MERCHANDISING SA (AO)/PERIGEE - FIELD GOOSE/2. EXTERNAL SYNC/REPORTS/Forms/STELLR/DOWNLOADED FORM IMAGES
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');

  if (!token) {
    return new NextResponse('Missing token param', { status: 400 });
  }

  // Basic safety — token must not contain path separators
  if (token.includes('..') || token.includes('/') || token.includes('\\')) {
    return new NextResponse('Invalid token', { status: 400 });
  }

  const basePath = (process.env.AO_SP_IMAGES_BASE_PATH ?? '').replace(/\/$/, '');
  if (!basePath) {
    return new NextResponse('AO_SP_IMAGES_BASE_PATH not configured', { status: 500 });
  }

  const filePath = `${basePath}/${token}.jpg`;

  try {
    const buf = await fetchSpFile(filePath);
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('SP image fetch error:', err);
    return new NextResponse('Image not found', { status: 404 });
  }
}
