import { NextRequest, NextResponse } from 'next/server';
import { fetchSpFile, uploadSpFile, deleteSpFile } from '@/lib/graph-oj';
import type { FormType, LoadedFile } from '@/lib/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChannelSummary {
  name: string;
  fileCount: number;
  rowCount: number;
  sources?: string[];
  formTypes?: FormType[];
  /** Sorted lowercase header fingerprint per form type.
   *  Two channels are co-selectable only if their fingerprints match
   *  for the currently-selected form type. */
  headerFingerprints?: Record<string, string>;
}

interface IndexPayload {
  updatedAt: string;
  updatedBy: string;
  channels: ChannelSummary[];
}

interface ChannelData {
  files: LoadedFile[];
}

/** Legacy single-file cache format (for migration) */
interface LegacyPayload {
  updatedAt: string;
  updatedBy: string;
  files: LoadedFile[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

function getBasePath(): string {
  const imagesBase = (process.env.AO_SP_IMAGES_BASE_PATH ?? '').replace(/\/$/, '');
  if (!imagesBase) throw new Error('AO_SP_IMAGES_BASE_PATH not configured');
  return imagesBase.split('/').slice(0, -1).join('/');
}

function indexPath(): string {
  return `${getBasePath()}/dashboard-index.json`;
}

function channelPath(channelName: string): string {
  return `${getBasePath()}/dashboard-channel-${slugify(channelName)}.json`;
}

function legacyPath(): string {
  return `${getBasePath()}/latest-dashboard-data.json`;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const buf = await fetchSpFile(path);
    return JSON.parse(Buffer.from(buf).toString('utf-8')) as T;
  } catch {
    return null;
  }
}

/** Detect form type from a file's stored headers (for backfill of legacy data).
 *  Legacy files still have "Stock On Hand" in headers because it wasn't
 *  filtered until this deploy. New files have formType set by the parser. */
function detectFormTypeFromHeaders(headers: string[]): FormType {
  const set = new Set(headers.map(h => h.toLowerCase().trim()));
  if (set.has('stock on hand')) return 'stock-count';
  if (set.has('display stands identification')) return 'stand';
  return 'merch';
}

/** Lowercase-sorted header string — identical fingerprint = identical columns */
function headerFingerprint(headers: string[]): string {
  return headers.map(h => h.toLowerCase().trim()).sort().join('|');
}

/** Compute fingerprints keyed by form type from a set of files */
function computeFingerprints(files: LoadedFile[]): Record<string, string> {
  const fp: Record<string, string> = {};
  for (const f of files) {
    const ft = f.formType ?? detectFormTypeFromHeaders(f.headers);
    if (!fp[ft]) fp[ft] = headerFingerprint(f.headers);
  }
  return fp;
}

/** Deduplicate rows by Visit UUID + formType — keeps first occurrence.
 *  Count/Stand rows from the same visit share a UUID, so formType is needed
 *  to prevent cross-form-type dedup. Legacy data without formType defaults to 'merch'. */
function dedupeRows(existing: LoadedFile[], incoming: LoadedFile[]): LoadedFile[] {
  const seen = new Set(
    existing.flatMap(f => {
      const ft = f.formType ?? 'merch';
      return f.rows.map(r => {
        const uuid = String(r['Visit UUID'] ?? '').trim();
        return uuid ? `${uuid}|${ft}` : '';
      });
    }).filter(Boolean)
  );
  const result: LoadedFile[] = [];
  for (const file of incoming) {
    const ft = file.formType ?? 'merch';
    const filtered = file.rows.filter(r => {
      const uuid = String(r['Visit UUID'] ?? '').trim();
      if (!uuid) return true;
      const key = `${uuid}|${ft}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (filtered.length > 0) {
      result.push({ ...file, rows: filtered, rowCount: filtered.length });
    }
  }
  return result;
}

// ─── Migration from legacy single-file cache ────────────────────────────────

async function migrateIfNeeded(): Promise<IndexPayload | null> {
  // Check for new index first
  const idx = await fetchJson<IndexPayload>(indexPath());
  if (idx) return idx;

  // Try legacy file
  const legacy = await fetchJson<LegacyPayload>(legacyPath());
  if (!legacy?.files?.length) return null;

  // Split legacy files into per-channel buckets
  const buckets = new Map<string, LoadedFile[]>();
  for (const file of legacy.files) {
    // Detect channel from file's rows
    const channels = [...new Set(
      file.rows.map(r => String(r['Channel'] ?? '').trim()).filter(Boolean)
    )];
    const ch = channels[0] || file.channel || file.name;
    if (!buckets.has(ch)) buckets.set(ch, []);
    buckets.get(ch)!.push({ ...file, channel: ch });
  }

  // Write per-channel files
  const channelSummaries: ChannelSummary[] = [];
  for (const [name, files] of buckets) {
    const channelData: ChannelData = { files };
    await uploadSpFile(channelPath(name), JSON.stringify(channelData));
    const sources = [...new Set(files.map(f => f.fileName).filter(Boolean))];
    channelSummaries.push({
      name,
      fileCount: files.length,
      rowCount: files.reduce((s, f) => s + f.rowCount, 0),
      sources,
    });
  }

  // Write new index
  const newIndex: IndexPayload = {
    updatedAt: legacy.updatedAt,
    updatedBy: legacy.updatedBy,
    channels: channelSummaries,
  };
  await uploadSpFile(indexPath(), JSON.stringify(newIndex));

  return newIndex;
}

// ─── One-time backfill: populate `sources` and `formTypes` for legacy entries
// Channels uploaded before these features were added have no `sources`/`formTypes`
// field. On first load after deploy, fetch each such channel's cached file
// and compute values from its files, then write the index back.

async function backfillIfNeeded(idx: IndexPayload): Promise<IndexPayload> {
  const stale = idx.channels.filter(c => !c.sources || !c.formTypes || !c.headerFingerprints);
  if (stale.length === 0) return idx;

  for (const ch of stale) {
    try {
      const data = await fetchJson<ChannelData>(channelPath(ch.name));
      const files = data?.files ?? [];
      if (!ch.sources) {
        ch.sources = [...new Set(files.map(f => f.fileName).filter(Boolean))];
      }
      if (!ch.formTypes) {
        ch.formTypes = [...new Set(files.map(f =>
          f.formType ?? detectFormTypeFromHeaders(f.headers)
        ))] as FormType[];
      }
      if (!ch.headerFingerprints) {
        ch.headerFingerprints = computeFingerprints(files);
      }
    } catch (err) {
      console.error(`Backfill failed for channel "${ch.name}":`, err);
      if (!ch.sources) ch.sources = [];
      if (!ch.formTypes) ch.formTypes = ['merch'];
      if (!ch.headerFingerprints) ch.headerFingerprints = {};
    }
  }

  try {
    await uploadSpFile(indexPath(), JSON.stringify(idx));
  } catch (err) {
    console.error('Backfill: failed to write updated index:', err);
  }
  return idx;
}

// ─── Route handlers ──────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const channel = req.nextUrl.searchParams.get('channel');

    if (channel) {
      // Fetch specific channel data
      const data = await fetchJson<ChannelData>(channelPath(channel));
      if (!data) {
        return NextResponse.json({ files: [] }, { headers: NO_CACHE });
      }
      return NextResponse.json(data, { headers: NO_CACHE });
    }

    // Return index (with migration fallback)
    let idx = await migrateIfNeeded();
    if (!idx) {
      return NextResponse.json(null, { headers: NO_CACHE });
    }
    // One-time backfill of sources/formTypes for channels uploaded before these features
    idx = await backfillIfNeeded(idx);
    return NextResponse.json(idx, { headers: NO_CACHE });
  } catch (err) {
    console.error('SP cache GET error:', err);
    return NextResponse.json(null, { headers: NO_CACHE });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      updatedBy: string;
      channel: string;
      files: LoadedFile[];
    };
    const { updatedBy, channel, files } = body;
    if (!channel || !files?.length) {
      return NextResponse.json({ error: 'channel and files required' }, { status: 400 });
    }

    // 1. Fetch existing channel data
    const existing = await fetchJson<ChannelData>(channelPath(channel));
    const existingFiles = existing?.files ?? [];

    // 2. Merge — deduplicate by Visit UUID
    const newFiles = dedupeRows(existingFiles, files);
    const mergedFiles = [...existingFiles, ...newFiles];

    // 3. Write merged channel file
    const channelData: ChannelData = { files: mergedFiles };
    await uploadSpFile(channelPath(channel), JSON.stringify(channelData));

    // 4. Update index — compute sources cumulatively from ALL merged files
    //    (each upload adds its filename; over time all sibling channels
    //     accumulate the same source list and remain co-selectable)
    let idx = await fetchJson<IndexPayload>(indexPath());
    const sources = [...new Set(mergedFiles.map(f => f.fileName).filter(Boolean))];
    const formTypes = [...new Set(mergedFiles.map(f =>
      f.formType ?? detectFormTypeFromHeaders(f.headers)
    ))] as FormType[];
    const channelSummary: ChannelSummary = {
      name: channel,
      fileCount: mergedFiles.length,
      rowCount: mergedFiles.reduce((s, f) => s + f.rowCount, 0),
      sources,
      formTypes,
      headerFingerprints: computeFingerprints(mergedFiles),
    };

    if (idx) {
      const ci = idx.channels.findIndex(c => c.name === channel);
      if (ci >= 0) {
        idx.channels[ci] = channelSummary;
      } else {
        idx.channels.push(channelSummary);
      }
      idx.updatedAt = new Date().toISOString();
      idx.updatedBy = updatedBy;
    } else {
      idx = {
        updatedAt: new Date().toISOString(),
        updatedBy,
        channels: [channelSummary],
      };
    }
    await uploadSpFile(indexPath(), JSON.stringify(idx));

    return NextResponse.json({ ok: true, added: newFiles.reduce((s, f) => s + f.rowCount, 0) });
  } catch (err) {
    console.error('SP cache POST error:', err);
    return NextResponse.json({ error: 'Cache save failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const channel = req.nextUrl.searchParams.get('channel');
    if (!channel) {
      return NextResponse.json({ error: 'channel required' }, { status: 400 });
    }

    // Delete the per-channel SP file (404 is fine — already gone)
    await deleteSpFile(channelPath(channel));

    // Update index — drop the channel entry
    const idx = await fetchJson<IndexPayload>(indexPath());
    if (idx) {
      idx.channels = idx.channels.filter(c => c.name !== channel);
      idx.updatedAt = new Date().toISOString();
      await uploadSpFile(indexPath(), JSON.stringify(idx));
    }

    return NextResponse.json({ ok: true }, { headers: NO_CACHE });
  } catch (err) {
    console.error('SP cache DELETE error:', err);
    return NextResponse.json({ error: 'Channel reset failed' }, { status: 500 });
  }
}
