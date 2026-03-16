'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import type { ParseResult, VisitRow, LoadedFile } from '@/lib/types';

interface Session {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
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

function stripExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
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
  label, items, selected, onChange,
}: {
  label: string;
  items: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const all = selected.length === items.length;

  const filtered = query
    ? items.filter(i => i.toLowerCase().includes(query.toLowerCase()))
    : items;

  const toggle = (item: string) => {
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
          {selected.length === 0 || selected.length === items.length
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
              onClick={() => onChange(all ? [] : [...items])}
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
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggle(item)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
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
          src={`/api/image?url=${encodeURIComponent(url)}`}
          alt="Survey photo"
          className="max-h-[85vh] max-w-full rounded-lg shadow-2xl cursor-default"
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

  const [dataMode, setDataMode] = useState<'excel' | 'sql'>('excel');
  const [loadedFiles, setLoadedFiles] = useState<LoadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // SQL mode state
  const today = new Date();
  const thirtyAgo = new Date(today); thirtyAgo.setDate(today.getDate() - 30);
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const [sqlDateFrom, setSqlDateFrom] = useState(fmtDate(thirtyAgo));
  const [sqlDateTo,   setSqlDateTo]   = useState(fmtDate(today));
  const [sqlLoading,  setSqlLoading]  = useState(false);

  // Column widths — keyed by column key string
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const gw = useCallback((key: string, def: number) => colWidths[key] ?? def, [colWidths]);
  const handleColResize = useCallback((key: string, w: number) => {
    setColWidths(prev => ({ ...prev, [key]: w }));
  }, []);

  const [selChannels, setSelChannels] = useState<string[]>([]);
  const [selProvinces, setSelProvinces] = useState<string[]>([]);
  const [selReps, setSelReps] = useState<string[]>([]);
  const [selSources, setSelSources] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Auth check
  useEffect(() => {
    const raw = localStorage.getItem('ao_session');
    if (!raw) { router.replace('/login'); return; }
    setSession(JSON.parse(raw));
    setAuthChecked(true);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('ao_session');
    router.replace('/login');
  };

  // Merged dataset
  const mergedData = useMemo(() => {
    if (loadedFiles.length === 0) return null;
    const headers = unique(loadedFiles.flatMap(f => f.headers));
    const imageColumns = unique(loadedFiles.flatMap(f => f.imageColumns));
    const rows: VisitRow[] = loadedFiles.flatMap(f =>
      f.rows.map(r => ({ ...r, _source: f.name } as VisitRow))
    );
    return { headers, rows, imageColumns };
  }, [loadedFiles]);

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
    () => unique((mergedData?.rows ?? []).map(r => String(r['Channel'] ?? '').trim()).filter(Boolean)),
    [mergedData]
  );
  const allProvinces = useMemo(
    () => unique((mergedData?.rows ?? []).map(r => String(r['Province'] ?? '').trim()).filter(Boolean)),
    [mergedData]
  );
  const allReps = useMemo(
    () => unique((mergedData?.rows ?? []).map(r => getRepName(r))),
    [mergedData]
  );
  const allSources = useMemo(
    () => unique((mergedData?.rows ?? []).map(r => String(r['_source'] ?? '').trim()).filter(Boolean)),
    [mergedData]
  );

  useEffect(() => {
    setSelChannels(allChannels);
    setSelProvinces(allProvinces);
    setSelReps(allReps);
    setSelSources(allSources);
  }, [allChannels, allProvinces, allReps, allSources]);

  const filteredRows = useMemo(() => {
    if (!mergedData) return [];
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate   = dateTo   ? new Date(dateTo)   : null;
    return mergedData.rows.filter(row => {
      const channel  = String(row['Channel']  ?? '').trim();
      const province = String(row['Province'] ?? '').trim();
      const rep      = getRepName(row);
      const source   = String(row['_source']  ?? '').trim();
      if (selChannels.length  > 0 && selChannels.length  < allChannels.length  && !selChannels.includes(channel))   return false;
      if (selProvinces.length > 0 && selProvinces.length < allProvinces.length && !selProvinces.includes(province)) return false;
      if (selReps.length      > 0 && selReps.length      < allReps.length      && !selReps.includes(rep))           return false;
      if (selSources.length   > 0 && selSources.length   < allSources.length   && !selSources.includes(source))     return false;
      if (fromDate || toDate) {
        const rowDate = parseDMY(String(row['Date'] ?? ''));
        if (rowDate) {
          if (fromDate && rowDate < fromDate) return false;
          if (toDate   && rowDate > toDate)   return false;
        }
      }
      return true;
    });
  }, [mergedData, selChannels, selProvinces, selReps, selSources, dateFrom, dateTo, allChannels.length, allProvinces.length, allReps.length, allSources.length]);

  const kpis = useMemo(() => ({
    stores:    new Set(filteredRows.map(r => String(r['Store'] ?? r['Store Name'] ?? '').trim()).filter(Boolean)).size,
    surveys:   new Set(filteredRows.map(r => String(r['Visit UUID'] ?? '').trim()).filter(Boolean)).size,
    reps:      new Set(filteredRows.map(r => getRepName(r))).size,
    channels:  new Set(filteredRows.map(r => String(r['Channel']  ?? '').trim()).filter(Boolean)).size,
    provinces: new Set(filteredRows.map(r => String(r['Province'] ?? '').trim()).filter(Boolean)).size,
  }), [filteredRows]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f => f.name.match(/\.xlsx?$/i));
    if (fileArray.length === 0) { setError('Please upload Excel files (.xlsx or .xls)'); return; }
    setUploading(true);
    setError(null);
    const results: LoadedFile[] = [];
    for (const file of fileArray) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res  = await fetch('/api/parse', { method: 'POST', body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Parse failed');
        const parsed = json as ParseResult;
        results.push({
          name: stripExt(file.name), fileName: file.name,
          rowCount: parsed.rows.length, headers: parsed.headers,
          imageColumns: parsed.imageColumns, rows: parsed.rows,
        });
      } catch (e) {
        setError(`Failed to parse "${file.name}": ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }
    if (results.length > 0) setLoadedFiles(prev => [...prev, ...results]);
    setUploading(false);
  }, []);

  const removeFile = (name: string) => setLoadedFiles(prev => prev.filter(f => f.name !== name));
  const clearAll   = () => { setLoadedFiles([]); setError(null); setColWidths({}); };

  const loadSqlData = useCallback(async () => {
    setSqlLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/sql-data?dateFrom=${sqlDateFrom}&dateTo=${sqlDateTo}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Query failed');
      const parsed = json as ParseResult;
      const label  = `Live Data ${sqlDateFrom} – ${sqlDateTo}`;
      setLoadedFiles([{
        name: label, fileName: label,
        rowCount: parsed.rows.length, headers: parsed.headers,
        imageColumns: parsed.imageColumns, rows: parsed.rows,
      }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SQL query failed');
    } finally {
      setSqlLoading(false);
    }
  }, [sqlDateFrom, sqlDateTo]);
  const clearFilters = () => {
    setSelChannels(allChannels); setSelProvinces(allProvinces);
    setSelReps(allReps);         setSelSources(allSources);
    setDateFrom('');             setDateTo('');
  };

  const totalCols = 1 + (channelCol ? 1 : 0) + (storeCol ? 1 : 0) + 1 + tableHeaders.length;

  if (!authChecked) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 shadow-sm">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
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
            <div className="text-right">
              <p className="text-[#1B3A6B] text-xs font-semibold">{session?.name}</p>
              <p className="text-gray-400 text-xs">{session?.email}</p>
            </div>
            {session?.isAdmin && (
              <button onClick={() => router.push('/admin/users')} className="text-gray-400 hover:text-[#1B3A6B] text-xs flex items-center gap-1 transition-colors" title="Manage Users">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-5.477-3.716M9 20H4v-2a4 4 0 015.477-3.716M15 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Users
              </button>
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

      <main className="max-w-[1600px] mx-auto px-6 py-6">

        {/* Mode Toggle + Load Zone */}
        {loadedFiles.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Mode tabs */}
            <div className="flex border-b border-gray-200">
              <button
                type="button"
                onClick={() => { setDataMode('excel'); setError(null); }}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-colors ${dataMode === 'excel' ? 'text-[#1B3A6B] border-b-2 border-[#1B3A6B] -mb-px' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Upload Excel
              </button>
              <button
                type="button"
                onClick={() => { setDataMode('sql'); setError(null); }}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-colors ${dataMode === 'sql' ? 'text-[#1B3A6B] border-b-2 border-[#1B3A6B] -mb-px' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7zM9 11h6M9 15h4" />
                </svg>
                Live Database
              </button>
            </div>

            {/* Excel upload panel */}
            {dataMode === 'excel' && (
              <div
                className={`p-16 text-center transition-colors ${dragOver ? 'bg-blue-50' : ''}`}
                style={{ borderRadius: 0 }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
              >
                {uploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-[#1B3A6B] border-t-transparent rounded-full animate-spin" />
                    <p className="text-gray-600 font-medium">Parsing files…</p>
                  </div>
                ) : (
                  <>
                    <div className="text-5xl mb-4">📊</div>
                    <p className="text-xl font-semibold text-gray-700 mb-2">Drop your Perigee Excel exports here</p>
                    <p className="text-gray-400 text-sm mb-1">Load multiple files to combine channels into one view</p>
                    <p className="text-gray-400 text-sm mb-6">or click to browse for .xlsx files</p>
                    <label className="cursor-pointer inline-flex items-center gap-2 bg-[#1B3A6B] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#152f5a] transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Choose Files
                      <input type="file" accept=".xlsx,.xls" multiple className="hidden"
                        onChange={e => { if (e.target.files) handleFiles(e.target.files); }} />
                    </label>
                    {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}
                  </>
                )}
              </div>
            )}

            {/* SQL / Live Database panel */}
            {dataMode === 'sql' && (
              <div className="p-16 text-center">
                {sqlLoading ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-[#1B3A6B] border-t-transparent rounded-full animate-spin" />
                    <p className="text-gray-600 font-medium">Querying database…</p>
                  </div>
                ) : (
                  <>
                    <div className="text-5xl mb-4">🗄️</div>
                    <p className="text-xl font-semibold text-gray-700 mb-2">Load live visit data from the database</p>
                    <p className="text-gray-400 text-sm mb-8">Select a date range and click Load Data</p>
                    <div className="flex items-end justify-center gap-4 flex-wrap">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1 text-left">Date From</label>
                        <input type="date" value={sqlDateFrom} onChange={e => setSqlDateFrom(e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1 text-left">Date To</label>
                        <input type="date" value={sqlDateTo} onChange={e => setSqlDateTo(e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]" />
                      </div>
                      <button
                        type="button"
                        onClick={loadSqlData}
                        disabled={!sqlDateFrom || !sqlDateTo}
                        className="inline-flex items-center gap-2 bg-[#1B3A6B] text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-[#152f5a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                        Load Data
                      </button>
                    </div>
                    {error && <p className="mt-6 text-red-600 text-sm">{error}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Dashboard */}
        {loadedFiles.length > 0 && mergedData && (
          <>
            {/* Loaded Files Panel */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-700">
                  Loaded Files
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {loadedFiles.length} file{loadedFiles.length !== 1 ? 's' : ''} · {mergedData.rows.length.toLocaleString()} total rows
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  {(uploading || sqlLoading) && <div className="w-4 h-4 border-2 border-[#1B3A6B] border-t-transparent rounded-full animate-spin" />}
                  {dataMode === 'sql' ? (
                    <button
                      type="button"
                      onClick={loadSqlData}
                      disabled={sqlLoading}
                      className="cursor-pointer inline-flex items-center gap-1.5 text-xs text-[#1B3A6B] border border-[#1B3A6B] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors font-medium disabled:opacity-50"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh
                    </button>
                  ) : (
                    <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs text-[#1B3A6B] border border-[#1B3A6B] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors font-medium">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Files
                      <input type="file" accept=".xlsx,.xls" multiple className="hidden"
                        onChange={e => { if (e.target.files) handleFiles(e.target.files); }} />
                    </label>
                  )}
                  <button onClick={clearAll} className="text-xs text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                    Clear
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {loadedFiles.map(f => (
                  <div key={f.name} className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5">
                    <svg className="w-3.5 h-3.5 text-[#1B3A6B] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-xs font-medium text-[#1B3A6B] max-w-[220px] truncate" title={f.fileName}>{f.name}</span>
                    <span className="text-xs text-gray-400">{f.rowCount.toLocaleString()} rows</span>
                    <button onClick={() => removeFile(f.name)} className="text-gray-400 hover:text-red-500 transition-colors ml-1" title={`Remove ${f.name}`}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              {error && <p className="mt-2 text-red-600 text-xs">{error}</p>}
            </div>

            {/* Filter Bar */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
              <div className="flex flex-wrap items-end gap-4">
                {allSources.length > 1 && (
                  <MultiSelect label="Source" items={allSources} selected={selSources} onChange={setSelSources} />
                )}
                <MultiSelect label="Channel"  items={allChannels}  selected={selChannels}  onChange={setSelChannels} />
                <MultiSelect label="Province" items={allProvinces} selected={selProvinces} onChange={setSelProvinces} />
                <MultiSelect label="Rep"      items={allReps}      selected={selReps}      onChange={setSelReps} />
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

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
              <KpiCard label="Stores Visited"     value={kpis.stores}    icon="🏪" />
              <KpiCard label="Surveys Completed"  value={kpis.surveys}   icon="📋" />
              <KpiCard label="Reps Active"         value={kpis.reps}      icon="👤" />
              <KpiCard label="Channels"            value={kpis.channels}  icon="📡" />
              <KpiCard label="Provinces"           value={kpis.provinces} icon="🗺️" />
            </div>

            {/* Data Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">
                  Survey Results
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {filteredRows.length} of {mergedData.rows.length} rows
                  </span>
                </p>
                <p className="text-xs text-gray-400">Drag column edges to resize</p>
              </div>
              <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: '70vh' }}>
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
                                className={`px-3 py-2 font-medium text-gray-800 whitespace-nowrap ${rowBg}`}
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
                                  return (
                                    <td key={h} className="px-2 py-1.5">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={`/api/image?url=${encodeURIComponent(val)}`}
                                        alt={h}
                                        className="h-16 w-20 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                                        onClick={() => setLightboxUrl(val)}
                                        loading="lazy"
                                      />
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
            </div>
          </>
        )}
      </main>

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
