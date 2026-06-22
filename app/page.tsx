'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import type { FormType, VisitRow, LoadedFile, SignatureRecord } from '@/lib/types';

const FORM_TYPE_LABELS: Record<FormType, string> = {
  'merch': 'Merch Form',
  'stock-count': 'Stock Count Form',
  'stand': 'Stand Form',
  'signature': 'Signature Form',
};

interface Session {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

interface ChannelSummary {
  name: string;
  fileCount: number;
  rowCount: number;
  sources?: string[];
  formTypes?: FormType[];
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

// ─── Default column widths ────────────────────────────────────────────────────
const W = {
  num:     40,
  channel: 120,
  store:   180,
  rep:     160,
  default: 150,
  image:   96,
} as const;

const MIN_COL_W = 48;

// ─── Column filtering ─────────────────────────────────────────────────────────

const HIDDEN_COLS = new Set([
  'id', 'email', 'customer', 'sync date', 'sync time', 'tag',
  'visit uuid', 'time', 'first name', 'last name', 'store code', 'rep name',
  'stock on hand',
]);

const SECTION_PREFIXES = ['staff', 'training stuff', 'media', 'stock', 'line management'];

function isHiddenCol(h: string): boolean {
  const low = h.toLowerCase().trim();
  if (HIDDEN_COLS.has(low)) return true;
  for (const prefix of SECTION_PREFIXES) {
    if (low === prefix || (low.startsWith(prefix) && /^\d+$/.test(low.slice(prefix.length).trim()))) {
      return true;
    }
  }
  return false;
}

/** Detect form type from file headers (handles legacy files loaded without formType) */
function detectFormType(headers: string[]): FormType {
  const set = new Set(headers.map(h => h.toLowerCase().trim()));
  if (set.has('stock on hand')) return 'stock-count';
  if (set.has('display stands identification')) return 'stand';
  return 'merch';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDMY(s: string): Date | null {
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function getRepName(row: VisitRow): string {
  const first = String(row['First Name'] ?? '').trim();
  const last = String(row['Last Name'] ?? '').trim();
  if (first || last) return [first, last].filter(Boolean).join(' ');
  const repKey = Object.keys(row).find(k =>
    k.toLowerCase().includes('rep') && !k.toLowerCase().includes('email')
  );
  if (repKey) return String(row[repKey] ?? '').trim();
  return 'Unknown';
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))].sort();
}

/**
 * Extract the unique token segment from a Perigee image URL.
 * URL format: https://live.perigeeportal.co.za/.../perigee-TOKEN/NONE/NONE
 * Returns e.g. "perigee-abc123" (used as the VBA-saved filename without .jpg)
 */
function extractImageToken(url: string): string | null {
  const parts = url.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i].trim();
    if (seg && seg !== 'NONE' && !seg.includes('.')) return seg;
  }
  return null;
}

// ─── ResizableTh ──────────────────────────────────────────────────────────────

function ResizableTh({
  label, colKey, width, sticky, left, onResize,
}: {
  label: string;
  colKey: string;
  width: number;
  sticky?: boolean;
  left?: number;
  onResize: (key: string, w: number) => void;
}) {
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startW.current = width;
    const onMove = (ev: MouseEvent) => {
      onResize(colKey, Math.max(MIN_COL_W, startW.current + ev.clientX - startX.current));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const thStyle: React.CSSProperties = {
    width: `${width}px`,
    minWidth: `${width}px`,
    padding: 0,
    ...(sticky ? { position: 'sticky', left: `${left ?? 0}px`, zIndex: 30 } : {}),
  };

  return (
    <th style={thStyle} className="bg-[#1B3A6B]">
      {/* inner div provides positioning context for the resize handle */}
      <div style={{ position: 'relative' }} className="flex items-start px-3 py-3 h-full">
        <span className="text-xs font-semibold text-white flex-1 min-w-0 leading-tight">
          {label}
        </span>
        {/* Resize handle — sits at right edge */}
        <div
          style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: '5px', cursor: 'col-resize', userSelect: 'none' }}
          className="hover:bg-white/30 active:bg-white/60"
          onMouseDown={onMouseDown}
        />
      </div>
    </th>
  );
}

// ─── MultiSelect with search ──────────────────────────────────────────────────

function MultiSelect({
  label, items, selected, onChange, disabledItems, disabledHint,
}: {
  label: string;
  items: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  /** Items that should appear grayed out and cannot be toggled. */
  disabledItems?: Set<string>;
  /** Tooltip shown on disabled items. */
  disabledHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Items the user can actually interact with
  const enabledItems = useMemo(
    () => items.filter(i => !disabledItems?.has(i)),
    [items, disabledItems]
  );
  const all = enabledItems.length > 0 && selected.length === enabledItems.length;

  const filtered = query
    ? items.filter(i => i.toLowerCase().includes(query.toLowerCase()))
    : items;

  const toggle = (item: string) => {
    if (disabledItems?.has(item)) return;
    onChange(selected.includes(item) ? selected.filter(s => s !== item) : [...selected, item]);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (open) setQuery(''); }}
        className="w-full flex items-center justify-between px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-left hover:border-[#1B3A6B] transition-colors min-w-[160px]"
      >
        <span className="truncate text-gray-700">
          {selected.length === 0
            ? `All ${label}`
            : selected.length === enabledItems.length && enabledItems.length === items.length
              ? `All ${label}`
              : `${selected.length} selected`}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ml-2 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[200px] bg-white border border-gray-200 rounded-lg shadow-xl">
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="relative">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full pl-7 pr-6 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:border-[#1B3A6B]"
                onClick={e => e.stopPropagation()}
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            <button
              type="button"
              onClick={() => onChange(all ? [] : [...enabledItems])}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold text-[#1B3A6B] hover:bg-blue-50 border-b border-gray-100"
            >
              <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${all ? 'bg-[#1B3A6B] border-[#1B3A6B]' : 'border-gray-400'}`}>
                {all && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              Select All
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-gray-400 text-center">No results</p>
            ) : (
              filtered.map(item => {
                const checked = selected.includes(item);
                const disabled = disabledItems?.has(item) ?? false;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggle(item)}
                    disabled={disabled}
                    title={disabled ? disabledHint : undefined}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-gray-50'}`}
                  >
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${checked ? 'bg-[#1B3A6B] border-[#1B3A6B]' : 'border-gray-400'}`}>
                      {checked && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate text-left">{item}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
      <div className="text-xl w-9 h-9 flex items-center justify-center bg-blue-50 rounded-lg shrink-0">{icon}</div>
      <div>
        <p className="text-2xl font-bold text-[#1B3A6B] leading-none">{value.toLocaleString()}</p>
        <p className="text-xs text-gray-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
      onClick={onClose}
    >
      <div className="relative max-w-5xl max-h-full" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-9 right-0 text-white/80 hover:text-white text-sm flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Close (Esc)
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Survey photo"
          className="max-h-[85vh] max-w-full rounded-lg shadow-2xl cursor-default"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const router = useRouter();

  const [loadedFiles, setLoadedFiles] = useState<LoadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [channelLoading, setChannelLoading] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<{ updatedAt: string; updatedBy: string } | null>(null);
  const [indexChannels, setIndexChannels] = useState<ChannelSummary[]>([]);
  const [signatures, setSignatures] = useState<SignatureRecord[]>([]);

  // Dual-scroll sync refs
  const tableScrollRef  = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const onTableScroll  = useCallback(() => {
    if (bottomScrollRef.current && tableScrollRef.current)
      bottomScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
  }, []);
  const onBottomScroll = useCallback(() => {
    if (tableScrollRef.current && bottomScrollRef.current)
      tableScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
  }, []);

  // Column widths — keyed by column key string
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const gw = useCallback((key: string, def: number) => colWidths[key] ?? def, [colWidths]);
  const handleColResize = useCallback((key: string, w: number) => {
    setColWidths(prev => ({ ...prev, [key]: w }));
  }, []);

  const [selChannels, setSelChannels] = useState<string[]>([]);
  const [selFormType, setSelFormType] = useState<FormType>('merch');
  const [selProvinces, setSelProvinces] = useState<string[]>([]);
  const [selReps, setSelReps] = useState<string[]>([]);
  const [selStores, setSelStores] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Auth check
  useEffect(() => {
    const raw = localStorage.getItem('ao_session');
    if (!raw) { router.replace('/login'); return; }
    setSession(JSON.parse(raw));
    setAuthChecked(true);
  }, [router]);

  // Escape key exits fullscreen table
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('ao_session');
    router.replace('/login');
  };

  // Form types available across all channels (from index — no need to load data first)
  const allFormTypes = useMemo<FormType[]>(() => {
    const types = new Set(indexChannels.flatMap(c => c.formTypes ?? ['merch']));
    return (['merch', 'stock-count', 'stand'] as FormType[]).filter(t => types.has(t));
  }, [indexChannels]);

  // Auto-set selFormType to first available when data changes
  useEffect(() => {
    if (allFormTypes.length > 0 && !allFormTypes.includes(selFormType)) {
      setSelFormType(allFormTypes[0]);
    }
  }, [allFormTypes, selFormType]);

  // Files filtered to selected form type only
  const formFilteredFiles = useMemo(
    () => loadedFiles.filter(f => (f.formType ?? 'merch') === selFormType),
    [loadedFiles, selFormType]
  );

  // Merged dataset (from form-filtered files only → clean column list per form type)
  const mergedData = useMemo(() => {
    if (formFilteredFiles.length === 0) return null;
    const headers = unique(formFilteredFiles.flatMap(f => f.headers));
    const imageColumns = unique(formFilteredFiles.flatMap(f => f.imageColumns));
    const rows: VisitRow[] = formFilteredFiles.flatMap(f =>
      f.rows.map(r => ({ ...r, _source: f.name, _formType: f.formType ?? 'merch' } as VisitRow))
    );

    // Inject signature data by matching Visit UUID
    if (signatures.length > 0) {
      const sigMap = new Map(signatures.map(s => [s.visitUuid, s]));
      for (const row of rows) {
        const uuid = String(row['Visit UUID'] ?? '').trim();
        if (uuid) {
          const sig = sigMap.get(uuid);
          if (sig) {
            row['Manager Name'] = sig.managerName;
            row['Signature'] = sig.signatureUrl;
          }
        }
      }
      // Add Manager Name and Signature to headers if signatures matched any rows
      const hasMatches = rows.some(r => r['Manager Name']);
      if (hasMatches) {
        if (!headers.includes('Manager Name')) headers.push('Manager Name');
        if (!headers.includes('Signature')) {
          headers.push('Signature');
          imageColumns.push('Signature');
        }
      }
    }

    return { headers, rows, imageColumns };
  }, [formFilteredFiles, signatures]);

  const channelCol = useMemo(
    () => mergedData?.headers.find(h => h.toLowerCase() === 'channel') ?? null,
    [mergedData]
  );
  const storeCol = useMemo(
    () => mergedData?.headers.find(h => ['store name', 'store'].includes(h.toLowerCase())) ?? null,
    [mergedData]
  );

  // Dynamic widths for frozen cols (update when colWidths changes)
  const numW      = gw('__num',     W.num);
  const channelW  = gw('__channel', W.channel);
  const storeW    = gw('__store',   W.store);
  const repW      = gw('__rep',     W.rep);
  const storeLeft = numW + (channelCol ? channelW : 0);

  // Non-sticky visible columns
  const tableHeaders = useMemo(() => {
    if (!mergedData) return [];
    const channelLow = channelCol?.toLowerCase();
    const storeLow   = storeCol?.toLowerCase();
    const nonImage   = mergedData.headers.filter(h => {
      const low = h.toLowerCase();
      return !mergedData.imageColumns.includes(h) && !isHiddenCol(h) && low !== channelLow && low !== storeLow;
    });
    const imgCols = mergedData.imageColumns.filter(h => !isHiddenCol(h));
    return [...nonImage, ...imgCols];
  }, [mergedData, channelCol, storeCol]);

  // Total table width (for table-layout: fixed)
  const totalTableW = useMemo(() => {
    if (!mergedData) return 0;
    return (
      numW +
      (channelCol ? channelW : 0) +
      (storeCol   ? storeW  : 0) +
      repW +
      tableHeaders.reduce((sum, h) => {
        const def = mergedData.imageColumns.includes(h) ? W.image : W.default;
        return sum + gw(h, def);
      }, 0)
    );
  }, [mergedData, channelCol, storeCol, numW, channelW, storeW, repW, tableHeaders, gw]);

  const allChannels = useMemo(
    () => indexChannels.map(c => c.name).sort(),
    [indexChannels]
  );

  // Channels whose headers don't match the first selected channel's headers
  // (for the current form type) are grayed out. Before any channel is selected,
  // channels without data for the selected form type are grayed out.
  const incompatibleChannels = useMemo(() => {
    const disabled = new Set<string>();
    // Get fingerprint of the first selected channel (if any) for matching
    const first = selChannels.length > 0
      ? indexChannels.find(ic => ic.name === selChannels[0])
      : null;
    const targetFp = first?.headerFingerprints?.[selFormType];
    for (const c of allChannels) {
      if (selChannels.includes(c)) continue;
      const summary = indexChannels.find(ic => ic.name === c);
      const fp = summary?.headerFingerprints?.[selFormType];
      // Disable if: no data for this form type, or columns don't match selected
      if (!fp || (targetFp && fp !== targetFp)) disabled.add(c);
    }
    return disabled;
  }, [allChannels, selChannels, selFormType, indexChannels]);

  const allProvinces = useMemo(
    () => unique((mergedData?.rows ?? []).map(r => String(r['Province'] ?? '').trim()).filter(Boolean)),
    [mergedData]
  );
  const allReps = useMemo(
    () => unique((mergedData?.rows ?? []).map(r => getRepName(r))),
    [mergedData]
  );

  // Stores available given current channel/province/rep/date selections (cascaded)
  const availableStores = useMemo(() => {
    if (!mergedData || !storeCol || selChannels.length === 0) return [];
    const fromDate = dateFrom ? (() => { const [y,m,d] = dateFrom.split('-').map(Number); return new Date(y, m-1, d); })() : null;
    const toDate   = dateTo   ? (() => { const [y,m,d] = dateTo.split('-').map(Number);   return new Date(y, m-1, d, 23, 59, 59, 999); })() : null;
    return unique(
      mergedData.rows
        .filter(row => {
          const channel  = String(row['Channel']  ?? '').trim();
          const province = String(row['Province'] ?? '').trim();
          const rep      = getRepName(row);
          if (!selChannels.includes(channel)) return false;
          if (selProvinces.length > 0 && selProvinces.length < allProvinces.length && !selProvinces.includes(province)) return false;
          if (selReps.length      > 0 && selReps.length      < allReps.length      && !selReps.includes(rep))           return false;
          if (fromDate || toDate) {
            const rowDate = parseDMY(String(row['Date'] ?? ''));
            if (rowDate) {
              if (fromDate && rowDate < fromDate) return false;
              if (toDate   && rowDate > toDate)   return false;
            }
          }
          return true;
        })
        .map(r => String(r[storeCol] ?? '').trim())
        .filter(Boolean)
    );
  }, [mergedData, storeCol, selChannels, selProvinces, selReps, dateFrom, dateTo, allProvinces.length, allReps.length]);

  useEffect(() => {
    setSelProvinces(allProvinces);
    setSelReps(allReps);
  }, [allProvinces, allReps]);

  // Keep selStores in sync when availableStores changes.
  // If new stores appear (channels/form type added) → reset to all.
  // If stores only shrink (province/rep/date narrowed) → keep valid selections.
  useEffect(() => {
    setSelStores(prev => {
      if (prev.length === 0) return availableStores; // initial load
      const hasNewStores = availableStores.some(s => !prev.includes(s));
      if (hasNewStores) return availableStores; // new channels added → show all
      const intersection = prev.filter(s => availableStores.includes(s));
      return intersection.length === 0 ? availableStores : intersection;
    });
  }, [availableStores]);

  const filteredRows = useMemo(() => {
    if (!mergedData || selChannels.length === 0) return [];
    const fromDate = dateFrom ? (() => { const [y,m,d] = dateFrom.split('-').map(Number); return new Date(y, m-1, d); })() : null;
    const toDate   = dateTo   ? (() => { const [y,m,d] = dateTo.split('-').map(Number);   return new Date(y, m-1, d, 23, 59, 59, 999); })() : null;
    return mergedData.rows.filter(row => {
      const channel  = String(row['Channel']  ?? '').trim();
      const province = String(row['Province'] ?? '').trim();
      const rep      = getRepName(row);
      const store    = storeCol ? String(row[storeCol] ?? '').trim() : '';
      if (!selChannels.includes(channel)) return false;
      if (selProvinces.length > 0 && selProvinces.length < allProvinces.length  && !selProvinces.includes(province)) return false;
      if (selReps.length      > 0 && selReps.length      < allReps.length       && !selReps.includes(rep))           return false;
      if (selStores.length    > 0 && selStores.length    < availableStores.length && !selStores.includes(store))     return false;
      if (fromDate || toDate) {
        const rowDate = parseDMY(String(row['Date'] ?? ''));
        if (rowDate) {
          if (fromDate && rowDate < fromDate) return false;
          if (toDate   && rowDate > toDate)   return false;
        }
      }
      return true;
    });
  }, [mergedData, storeCol, selChannels, selProvinces, selReps, selStores, dateFrom, dateTo, allProvinces.length, allReps.length, availableStores.length]);

  const kpis = useMemo(() => ({
    stores:    new Set(filteredRows.map(r => String(r['Store'] ?? r['Store Name'] ?? '').trim()).filter(Boolean)).size,
    surveys:   new Set(filteredRows.map(r => String(r['Visit UUID'] ?? '').trim()).filter(Boolean)).size,
    reps:      new Set(filteredRows.map(r => getRepName(r))).size,
    channels:  new Set(filteredRows.map(r => String(r['Channel']  ?? '').trim()).filter(Boolean)).size,
    provinces: new Set(filteredRows.map(r => String(r['Province'] ?? '').trim()).filter(Boolean)).size,
  }), [filteredRows]);

  // Fetch one or more channels in parallel and merge their files
  const loadChannelsData = useCallback(async (channels: string[]) => {
    if (channels.length === 0) { setLoadedFiles([]); return; }
    setChannelLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        channels.map(ch =>
          fetch(`/api/sp-cache?channel=${encodeURIComponent(ch)}`, { cache: 'no-store' })
            .then(r => r.json() as Promise<ChannelData>)
        )
      );
      const allFiles = results.flatMap(r => (r?.files ?? []).map(f => ({
        ...f,
        formType: f.formType ?? detectFormType(f.headers),
      })));
      setLoadedFiles(allFiles);
    } catch {
      setError(`Failed to load channel data`);
      setLoadedFiles([]);
    } finally {
      setChannelLoading(false);
    }
  }, []);

  // Auto-fetch whenever the channel selection changes
  useEffect(() => {
    loadChannelsData(selChannels);
  }, [selChannels, loadChannelsData]);

  // Auto-load index from SP cache on first render once auth is confirmed
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!authChecked || autoLoaded.current) return;
    autoLoaded.current = true;
    setCacheLoading(true);
    Promise.all([
      fetch('/api/sp-cache', { cache: 'no-store' })
        .then(r => r.json())
        .then((data: IndexPayload | null) => {
          if (data?.channels?.length) {
            setIndexChannels(data.channels);
            setCacheInfo({ updatedAt: data.updatedAt, updatedBy: data.updatedBy });
          }
        })
        .catch(() => { /* no cache — show upload UI */ }),
      fetch('/api/signatures', { cache: 'no-store' })
        .then(r => r.json())
        .then((sigs: SignatureRecord[]) => {
          if (Array.isArray(sigs)) setSignatures(sigs);
        })
        .catch(() => { /* no signatures yet */ }),
    ]).finally(() => setCacheLoading(false));
  }, [authChecked]);


  const clearFilters = () => {
    setSelChannels([]);          setSelFormType(allFormTypes[0] ?? 'merch');
    setSelProvinces(allProvinces);
    setSelReps(allReps);         setSelStores(availableStores);
    setDateFrom('');             setDateTo('');
  };

  const totalCols = 1 + (channelCol ? 1 : 0) + (storeCol ? 1 : 0) + 1 + tableHeaders.length;

  const exportToExcel = useCallback(async () => {
    if (!mergedData || filteredRows.length === 0) return;
    const XLSX = (await import('xlsx')).default ?? await import('xlsx');
    // Build visible column list in table order
    const cols: { key: string; label: string }[] = [];
    if (channelCol) cols.push({ key: channelCol, label: channelCol });
    if (storeCol) cols.push({ key: storeCol, label: storeCol });
    cols.push({ key: '__rep', label: 'Rep' });
    for (const h of tableHeaders) {
      if (!mergedData.imageColumns.includes(h)) cols.push({ key: h, label: h });
    }
    const data = filteredRows.map(row => {
      const out: Record<string, string | number | null> = {};
      for (const c of cols) {
        if (c.key === '__rep') out[c.label] = getRepName(row);
        else out[c.label] = row[c.key] ?? null;
      }
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Export');
    const formLabel = FORM_TYPE_LABELS[selFormType].replace(/ /g, '_');
    const channels = selChannels.join('-') || 'All';
    XLSX.writeFile(wb, `A&O_${channels}_${formLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [mergedData, filteredRows, channelCol, storeCol, tableHeaders, selFormType, selChannels]);

  // ─── Stock Count summaries (only computed when form type is stock-count) ────

  // Identify product columns: any tableHeader whose values are numeric
  const productCols = useMemo(() => {
    if (selFormType !== 'stock-count' || filteredRows.length === 0) return [];
    return tableHeaders.filter(h =>
      filteredRows.some(r => { const v = r[h]; return v !== null && v !== '' && !isNaN(Number(v)); })
    );
  }, [selFormType, filteredRows, tableHeaders]);

  // Summary by product: total SOH per product column
  const productSummary = useMemo(() => {
    if (productCols.length === 0) return [];
    return productCols.map(h => {
      let total = 0;
      for (const row of filteredRows) {
        const n = Number(row[h]);
        if (!isNaN(n)) total += n;
      }
      return { product: h, total };
    }).sort((a, b) => b.total - a.total);
  }, [productCols, filteredRows]);

  // Summary by store: total SOH across all product columns per store
  const storeSummary = useMemo(() => {
    if (productCols.length === 0 || !storeCol) return [];
    const map = new Map<string, number>();
    for (const row of filteredRows) {
      const store = String(row[storeCol] ?? '').trim() || 'Unknown';
      let rowTotal = 0;
      for (const h of productCols) {
        const n = Number(row[h]);
        if (!isNaN(n)) rowTotal += n;
      }
      map.set(store, (map.get(store) ?? 0) + rowTotal);
    }
    return [...map.entries()]
      .map(([store, total]) => ({ store, total }))
      .sort((a, b) => b.total - a.total);
  }, [productCols, filteredRows, storeCol]);

  if (!authChecked) return null;

  return (
    <div className="min-h-screen" style={{ backgroundImage: "url('/stellr-bg.jpg')", backgroundSize: 'cover', backgroundAttachment: 'fixed', backgroundPosition: 'center' }}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 shadow-sm">
        <div className="w-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Image
              src="/ao-logo.png" alt="A&O" width={72} height={36} className="object-contain"
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = 'none';
                const fb = el.nextSibling as HTMLElement | null;
                if (fb) fb.style.display = 'flex';
              }}
            />
            <div className="w-10 h-10 bg-[#1B3A6B]/10 rounded-lg items-center justify-center text-xs font-bold tracking-tight text-[#1B3A6B] hidden">A&O</div>
            <div>
              <h1 className="text-base font-bold leading-tight text-[#1B3A6B]">A&O Interactive Services</h1>
              <p className="text-[#1B3A6B]/60 text-xs">Field Survey Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <Image src="/perigee-logo.jpg" alt="Perigee" width={72} height={28} className="object-contain rounded" />
            <div className="h-6 w-px bg-gray-200" />
            <Image src="/stellr-logo.png" alt="Stellr" width={44} height={44} className="object-contain" />
            <div className="h-6 w-px bg-gray-200" />
            <div className="text-right">
              <p className="text-[#1B3A6B] text-xs font-semibold">{session?.name}</p>
              <p className="text-gray-400 text-xs">{session?.email}</p>
            </div>
            <button onClick={() => router.push('/visit-report')} className="text-gray-400 hover:text-[#1B3A6B] text-xs flex items-center gap-1 transition-colors" title="Visit Report">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Visit Report
            </button>
            <button onClick={() => router.push('/pdf-download')} className="text-gray-400 hover:text-[#1B3A6B] text-xs flex items-center gap-1 transition-colors" title="PDF Download">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              PDF Download
            </button>
            {session?.isAdmin && (
              <>
                <button onClick={() => router.push('/admin/users')} className="text-gray-400 hover:text-[#1B3A6B] text-xs flex items-center gap-1 transition-colors" title="Manage Users">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-5.477-3.716M9 20H4v-2a4 4 0 015.477-3.716M15 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  Users
                </button>
                <button onClick={() => router.push('/admin/data')} className="text-gray-400 hover:text-[#1B3A6B] text-xs flex items-center gap-1 transition-colors" title="Loaded Data">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7zM9 11h6M9 15h4" />
                  </svg>
                  Data
                </button>
                <button onClick={() => router.push('/admin/settings')} className="text-gray-400 hover:text-[#1B3A6B] text-xs flex items-center gap-1 transition-colors" title="API Settings">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>
              </>
            )}
            <button onClick={handleLogout} className="text-gray-400 hover:text-[#1B3A6B] text-xs flex items-center gap-1 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="w-full px-6 py-6">

        {/* Loading index from cache */}
        {indexChannels.length === 0 && cacheLoading && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-16 text-center">
            <div className="w-8 h-8 border-2 border-[#1B3A6B] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-500">Loading latest data...</p>
          </div>
        )}

        {/* Empty state — no data uploaded yet */}
        {indexChannels.length === 0 && !cacheLoading && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-16 text-center">
            <div className="text-5xl mb-4">📂</div>
            <p className="text-xl font-semibold text-gray-700 mb-2">No data loaded yet</p>
            <p className="text-gray-400 text-sm mb-6">
              {session?.isAdmin
                ? 'Upload Perigee Excel exports from the Data page to get started.'
                : 'An admin needs to upload data before the dashboard becomes available.'}
            </p>
            {session?.isAdmin && (
              <button
                type="button"
                onClick={() => router.push('/admin/data')}
                className="inline-flex items-center gap-2 bg-[#1B3A6B] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#152f5a] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7zM9 11h6M9 15h4" />
                </svg>
                Go to Data page
              </button>
            )}
          </div>
        )}

        {/* Dashboard — show when index has channels */}
        {indexChannels.length > 0 && (
          <>
            {/* Error from file upload */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 mb-5">
                <p className="text-red-600 text-xs">{error}</p>
              </div>
            )}

            {/* Filter Bar */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
              <div className="flex flex-wrap items-end gap-4">
                <MultiSelect
                  label="Channel"
                  items={allChannels}
                  selected={selChannels}
                  onChange={setSelChannels}
                  disabledItems={incompatibleChannels}
                  disabledHint="Different fields — not compatible with selected channel(s)"
                />
                {allFormTypes.length > 1 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Form Name</label>
                    <select
                      value={selFormType}
                      onChange={e => setSelFormType(e.target.value as FormType)}
                      className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:border-[#1B3A6B] focus:outline-none focus:border-[#1B3A6B] transition-colors min-w-[160px]"
                    >
                      {allFormTypes.map(ft => (
                        <option key={ft} value={ft}>{FORM_TYPE_LABELS[ft]}</option>
                      ))}
                    </select>
                  </div>
                )}
                <MultiSelect label="Province" items={allProvinces}   selected={selProvinces} onChange={setSelProvinces} />
                {storeCol && availableStores.length > 0 && (
                  <MultiSelect label="Store" items={availableStores} selected={selStores}   onChange={setSelStores} />
                )}
                <MultiSelect label="Rep"      items={allReps}        selected={selReps}      onChange={setSelReps} />
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Date From</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Date To</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]" />
                </div>
                <div className="ml-auto">
                  <button onClick={clearFilters} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    Clear Filters
                  </button>
                </div>
              </div>
            </div>

            {/* Channel loading indicator */}
            {channelLoading && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center mb-5">
                <div className="w-8 h-8 border-2 border-[#1B3A6B] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-500">
                  Loading {selChannels.length === 1 ? selChannels[0] : `${selChannels.length} channels`} data...
                </p>
              </div>
            )}

            {/* Prompt to select channel when none is selected */}
            {selChannels.length === 0 && !channelLoading && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center mb-5">
                <p className="text-gray-500 text-sm">Select one or more channels above to view data</p>
              </div>
            )}

            {/* KPI Cards */}
            {mergedData && selChannels.length > 0 && !channelLoading && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
                <KpiCard label="Stores Visited"     value={kpis.stores}    icon="🏪" />
                <KpiCard label="Surveys Completed"  value={kpis.surveys}   icon="📋" />
                <KpiCard label="Reps Active"         value={kpis.reps}      icon="👤" />
                <KpiCard label="Channels"            value={kpis.channels}  icon="📡" />
                <KpiCard label="Provinces"           value={kpis.provinces} icon="🗺️" />
              </div>
            )}

            {/* Data Table */}
            {mergedData && selChannels.length > 0 && !channelLoading && (
            <div className={isFullscreen ? 'fixed inset-0 z-50 bg-white flex flex-col' : 'bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden'}>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div>
                  <p className="text-sm font-semibold text-gray-700">
                    Survey Results
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {filteredRows.length} of {mergedData.rows.length} rows
                    </span>
                  </p>
                  {cacheInfo && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Cached {new Date(cacheInfo.updatedAt).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} by {cacheInfo.updatedBy}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-gray-400">Drag column edges to resize</p>
                  <button
                    type="button"
                    onClick={exportToExcel}
                    className="text-gray-400 hover:text-[#1B3A6B] transition-colors flex items-center gap-1 text-xs"
                    title="Export to Excel"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFullscreen(v => !v)}
                    className="text-gray-400 hover:text-[#1B3A6B] transition-colors"
                    title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen'}
                  >
                    {isFullscreen ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div
                ref={tableScrollRef}
                onScroll={onTableScroll}
                className={isFullscreen ? 'hide-x-scrollbar flex-1' : 'hide-x-scrollbar'}
                style={{ overflowX: 'scroll', overflowY: 'auto', maxHeight: isFullscreen ? undefined : '82vh' }}
              >
                <table
                  className="text-sm border-collapse"
                  style={{ tableLayout: 'fixed', width: `${totalTableW}px` }}
                >
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-[#1B3A6B] text-white">
                      {/* # — not resizable, fixed */}
                      <th
                        style={{ position: 'sticky', left: 0, width: `${numW}px`, minWidth: `${numW}px`, zIndex: 30, padding: 0 }}
                        className="bg-[#1B3A6B]"
                      >
                        <div className="px-3 py-3 text-xs font-semibold">#</div>
                      </th>
                      {/* Channel — frozen */}
                      {channelCol && (
                        <ResizableTh
                          label={channelCol} colKey="__channel" width={channelW}
                          sticky left={numW} onResize={handleColResize}
                        />
                      )}
                      {/* Store — frozen */}
                      {storeCol && (
                        <ResizableTh
                          label={storeCol} colKey="__store" width={storeW}
                          sticky left={storeLeft} onResize={handleColResize}
                        />
                      )}
                      {/* Rep */}
                      <ResizableTh label="Rep" colKey="__rep" width={repW} onResize={handleColResize} />
                      {/* Remaining columns */}
                      {tableHeaders.map(h => {
                        const def = mergedData.imageColumns.includes(h) ? W.image : W.default;
                        return (
                          <ResizableTh key={h} label={h} colKey={h} width={gw(h, def)} onResize={handleColResize} />
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={totalCols} className="px-6 py-12 text-center text-gray-400">
                          No results match the current filters
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row, idx) => {
                        const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                        return (
                          <tr key={idx} className={rowBg}>
                            {/* # */}
                            <td
                              style={{ position: 'sticky', left: 0, width: `${numW}px`, zIndex: 10 }}
                              className={`px-3 py-2 text-xs text-gray-400 ${rowBg}`}
                            >{idx + 1}</td>
                            {/* Channel */}
                            {channelCol && (
                              <td
                                style={{ position: 'sticky', left: `${numW}px`, width: `${channelW}px`, zIndex: 10 }}
                                className={`px-3 py-2 text-xs text-gray-600 whitespace-nowrap ${rowBg}`}
                              >
                                {row[channelCol] != null && row[channelCol] !== ''
                                  ? String(row[channelCol])
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            )}
                            {/* Store */}
                            {storeCol && (
                              <td
                                style={{ position: 'sticky', left: `${storeLeft}px`, width: `${storeW}px`, zIndex: 10 }}
                                className={`px-3 py-2 font-medium text-gray-800 break-words ${rowBg}`}
                              >
                                {row[storeCol] != null && row[storeCol] !== ''
                                  ? String(row[storeCol])
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            )}
                            {/* Rep */}
                            <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                              {getRepName(row)}
                            </td>
                            {/* Remaining columns */}
                            {tableHeaders.map(h => {
                              const val     = row[h];
                              const isImage = mergedData.imageColumns.includes(h);
                              if (isImage) {
                                if (val && typeof val === 'string' && val.startsWith('https://')) {
                                  // Use Perigee proxy for Perigee URLs, SP proxy for others
                                  const isPerigee = val.startsWith('https://live.perigeeportal.co.za');
                                  let displayUrl: string | null;
                                  if (isPerigee) {
                                    displayUrl = `/api/image?url=${encodeURIComponent(val)}`;
                                  } else {
                                    const imgToken = extractImageToken(val);
                                    displayUrl = imgToken
                                      ? `/api/sp-image?token=${encodeURIComponent(imgToken)}`
                                      : null;
                                  }
                                  return (
                                    <td key={h} className="px-2 py-1.5">
                                      <div className="flex flex-col items-start gap-1">
                                        {displayUrl ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            src={displayUrl}
                                            alt={h}
                                            className="h-16 w-20 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                                            onClick={() => setLightboxUrl(displayUrl!)}
                                            loading="lazy"
                                          />
                                        ) : (
                                          <span className="text-gray-300 text-xs">no image</span>
                                        )}
                                        <a
                                          href={val}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-[10px] text-blue-500 hover:underline max-w-[96px] truncate block"
                                          title={val}
                                        >
                                          View original
                                        </a>
                                      </div>
                                    </td>
                                  );
                                }
                                return <td key={h} className="px-3 py-2 text-gray-300 text-xs">—</td>;
                              }
                              return (
                                <td key={h} className="px-3 py-2 overflow-hidden">
                                  {val !== null && val !== undefined && val !== '' ? (
                                    <span className="block truncate text-gray-700" title={String(val)}>
                                      {String(val)}
                                    </span>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {/* Always-visible horizontal scrollbar */}
              <div
                ref={bottomScrollRef}
                onScroll={onBottomScroll}
                style={{ overflowX: 'scroll', overflowY: 'hidden', borderTop: '1px solid #e5e7eb' }}
              >
                <div style={{ width: `${totalTableW}px`, height: '1px' }} />
              </div>
            </div>
            )}

            {/* Stock Count summary tables */}
            {selFormType === 'stock-count' && productSummary.length > 0 && !channelLoading && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
                {/* Summary by Product */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-700">
                      SOH by Product
                      <span className="ml-2 text-xs font-normal text-gray-400">{productSummary.length} products</span>
                    </p>
                  </div>
                  <div className="max-h-[50vh] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-[#1B3A6B] text-white">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold">Product</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold w-28">Total SOH</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productSummary.map((p, i) => (
                          <tr key={p.product} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-4 py-2 text-gray-700 break-words">{p.product}</td>
                            <td className="px-4 py-2 text-right font-semibold text-[#1B3A6B] tabular-nums">{p.total.toLocaleString()}</td>
                          </tr>
                        ))}
                        <tr className="bg-[#1B3A6B]/5 border-t border-gray-200 font-bold">
                          <td className="px-4 py-2.5 text-gray-800">Grand Total</td>
                          <td className="px-4 py-2.5 text-right text-[#1B3A6B] tabular-nums">
                            {productSummary.reduce((s, p) => s + p.total, 0).toLocaleString()}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Summary by Store */}
                {storeSummary.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-semibold text-gray-700">
                        SOH by Store
                        <span className="ml-2 text-xs font-normal text-gray-400">{storeSummary.length} stores</span>
                      </p>
                    </div>
                    <div className="max-h-[50vh] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-[#1B3A6B] text-white">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold">Store</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold w-28">Total SOH</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storeSummary.map((s, i) => (
                            <tr key={s.store} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-4 py-2 text-gray-700">{s.store}</td>
                              <td className="px-4 py-2 text-right font-semibold text-[#1B3A6B] tabular-nums">{s.total.toLocaleString()}</td>
                            </tr>
                          ))}
                          <tr className="bg-[#1B3A6B]/5 border-t border-gray-200 font-bold">
                            <td className="px-4 py-2.5 text-gray-800">Grand Total</td>
                            <td className="px-4 py-2.5 text-right text-[#1B3A6B] tabular-nums">
                              {storeSummary.reduce((s, p) => s + p.total, 0).toLocaleString()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
