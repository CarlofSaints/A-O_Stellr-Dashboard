'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

interface CtrlStore {
  storeName: string;
  storeCode: string;
  channel: string;
}

interface ControlPayload {
  updatedAt: string;
  updatedBy: string;
  stores: CtrlStore[];
}

interface Visit {
  storeCode: string;
  storeName: string;
  channel: string;
  date: string; // YYYY-MM-DD
}

interface DataPayload {
  updatedAt: string;
  updatedBy: string;
  visits: Visit[];
}

/** A single row in the visit grid */
interface GridRow {
  storeName: string;
  storeCode: string;
  channel: string;
  visits: Record<string, boolean>;
  visitCount: number;
  inControlFile: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))].sort();
}

/** Format YYYY-MM-DD to short display like "Mon 14/04" */
function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${days[d.getDay()]} ${dd}/${mm}`;
}

/** Generate array of YYYY-MM-DD strings between from and to (inclusive) */
function makeDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yy}-${mm}-${dd}`);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function currentWeekMon(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return isoDate(d);
}

function currentWeekSun(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  return isoDate(d);
}

function isoDate(d: Date): string {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function weeksInRange(from: string, to: string): number {
  const f = new Date(from + 'T00:00:00');
  const t = new Date(to + 'T00:00:00');
  const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
  return Math.ceil(days / 7);
}

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── MultiSelect ─────────────────────────────────────────────────────────────

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

  const all = items.length > 0 && selected.length === items.length;
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
                placeholder="Search..."
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function VisitReportPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Data
  const [control, setControl] = useState<ControlPayload | null>(null);
  const [visitData, setVisitData] = useState<DataPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // Upload state
  const [uploading, setUploading] = useState<'control' | 'data' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Filters
  const [selChannels, setSelChannels] = useState<string[]>([]);
  const [selStores, setSelStores] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState(currentWeekMon);
  const [dateTo, setDateTo] = useState(currentWeekSun);

  // Drag-drop highlight
  const [dragOver, setDragOver] = useState<'control' | 'data' | null>(null);

  // Auth check
  useEffect(() => {
    const raw = localStorage.getItem('ao_session');
    if (!raw) { router.replace('/login'); return; }
    setSession(JSON.parse(raw));
    setAuthChecked(true);
  }, [router]);

  // Load both datasets on mount
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ctrlRes, dataRes] = await Promise.all([
        fetch('/api/visit-report/control', { cache: 'no-store' }),
        fetch('/api/visit-report/data', { cache: 'no-store' }),
      ]);
      const ctrlJson = await ctrlRes.json() as ControlPayload | null;
      const dataJson = await dataRes.json() as DataPayload | null;
      setControl(ctrlJson);
      setVisitData(dataJson);
    } catch {
      // silently handle — empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authChecked) loadData();
  }, [authChecked, loadData]);

  const handleLogout = () => {
    localStorage.removeItem('ao_session');
    router.replace('/login');
  };

  // ─── Upload handlers ───────────────────────────────────────────────────────

  const uploadFile = useCallback(async (type: 'control' | 'data', file: File) => {
    if (!session) return;
    setUploading(type);
    setUploadError(null);
    setUploadSuccess(null);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('updatedBy', session.name);

    try {
      const res = await fetch(`/api/visit-report/${type}`, {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setUploadError(json.error ?? 'Upload failed');
        return;
      }

      if (type === 'control') {
        setUploadSuccess(`Control file uploaded: ${json.storeCount} stores across ${json.channelCount} channels`);
      } else {
        setUploadSuccess(`Visit data uploaded: ${json.added} new visits added (${json.uniqueStores} unique stores)${json.duplicatesSkipped ? `, ${json.duplicatesSkipped} duplicates skipped` : ''}`);
      }

      await loadData();
    } catch {
      setUploadError('Upload failed — network error');
    } finally {
      setUploading(null);
    }
  }, [session, loadData]);

  const handleFileInput = useCallback((type: 'control' | 'data') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(type, file);
    e.target.value = '';
  }, [uploadFile]);

  const handleDrop = useCallback((type: 'control' | 'data') => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      uploadFile(type, file);
    } else {
      setUploadError('Please drop an Excel file (.xlsx)');
    }
  }, [uploadFile]);

  const handleReset = useCallback(async (type: 'control' | 'data') => {
    if (!confirm(`Are you sure you want to delete all ${type === 'control' ? 'control file' : 'visit'} data? This cannot be undone.`)) return;
    setUploadError(null);
    setUploadSuccess(null);
    try {
      await fetch(`/api/visit-report/${type}`, { method: 'DELETE' });
      setUploadSuccess(`${type === 'control' ? 'Control file' : 'Visit data'} deleted`);
      await loadData();
    } catch {
      setUploadError('Delete failed');
    }
  }, [loadData]);

  // ─── Derived: merge control file + visit data into a unified store universe ─

  // Build a map of storeCode → { storeName, channel } from BOTH sources.
  // Visit data is the primary source; control file supplements with unvisited stores.
  const storeMap = useMemo(() => {
    const map = new Map<string, { storeName: string; channel: string; inControlFile: boolean }>();

    // 1. Seed from control file (the "base")
    for (const s of control?.stores ?? []) {
      map.set(s.storeCode, { storeName: s.storeName, channel: s.channel, inControlFile: true });
    }

    // 2. Overlay / add from visit data (visit data wins for storeName/channel)
    for (const v of visitData?.visits ?? []) {
      const existing = map.get(v.storeCode);
      if (existing) {
        // Visit data enriches — update name/channel if visit data has it
        if (v.storeName) existing.storeName = v.storeName;
        if (v.channel) existing.channel = v.channel;
      } else {
        // Store only in visit data, not in control file
        map.set(v.storeCode, {
          storeName: v.storeName || v.storeCode,
          channel: v.channel || 'Unknown',
          inControlFile: false,
        });
      }
    }

    return map;
  }, [control, visitData]);

  const hasData = storeMap.size > 0;

  // All channels from the merged universe
  const allChannels = useMemo(
    () => unique([...storeMap.values()].map(s => s.channel)),
    [storeMap]
  );

  // Stores filtered by selected channels — for the Store filter dropdown
  const filteredStoreLabels = useMemo(() => {
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);
    const labels: string[] = [];
    for (const [code, info] of storeMap) {
      if (chSet.has(info.channel)) {
        labels.push(`${info.storeName} (${code})`);
      }
    }
    return labels.sort();
  }, [storeMap, selChannels, allChannels]);

  // Date columns for the grid
  const dateCols = useMemo(
    () => dateFrom && dateTo ? makeDateRange(dateFrom, dateTo) : [],
    [dateFrom, dateTo]
  );

  // O(1) visit lookup: "storeCode|date"
  const visitSet = useMemo(() => {
    const set = new Set<string>();
    for (const v of visitData?.visits ?? []) {
      set.add(`${v.storeCode}|${v.date}`);
    }
    return set;
  }, [visitData]);

  // Grid rows — one per store in the merged universe matching filters
  const gridRows = useMemo((): GridRow[] => {
    if (!hasData || dateCols.length === 0) return [];
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);
    const stSet = selStores.length > 0 && selStores.length < filteredStoreLabels.length
      ? new Set(selStores)
      : null;

    const rows: GridRow[] = [];
    for (const [code, info] of storeMap) {
      if (!chSet.has(info.channel)) continue;
      if (stSet && !stSet.has(`${info.storeName} (${code})`)) continue;

      const visits: Record<string, boolean> = {};
      let visitCount = 0;
      for (const d of dateCols) {
        const has = visitSet.has(`${code}|${d}`);
        visits[d] = has;
        if (has) visitCount++;
      }
      rows.push({
        storeName: info.storeName,
        storeCode: code,
        channel: info.channel,
        visits,
        visitCount,
        inControlFile: info.inControlFile,
      });
    }

    rows.sort((a, b) => a.channel.localeCompare(b.channel) || a.storeName.localeCompare(b.storeName));
    return rows;
  }, [hasData, storeMap, selChannels, selStores, allChannels, filteredStoreLabels.length, dateCols, visitSet]);

  // Channel summary table
  const channelSummary = useMemo(() => {
    if (!hasData || dateCols.length === 0) return [];
    const weeks = weeksInRange(dateFrom, dateTo);

    // Per-channel: totalStores (from control file base), visits in period
    const channelMap = new Map<string, { baseStores: number; visits: number }>();

    // Count control file stores per channel (the denominator for completion %)
    // Only count channels that appear in our grid (respects channel filter)
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);

    if (control) {
      for (const s of control.stores) {
        if (!chSet.has(s.channel)) continue;
        const prev = channelMap.get(s.channel) ?? { baseStores: 0, visits: 0 };
        prev.baseStores++;
        channelMap.set(s.channel, prev);
      }
    }

    // Count visits from the grid rows (already filtered)
    for (const row of gridRows) {
      const prev = channelMap.get(row.channel) ?? { baseStores: 0, visits: 0 };
      prev.visits += row.visitCount;
      // If no control file, use visit-data stores as the base
      if (!control) prev.baseStores++;
      channelMap.set(row.channel, prev);
    }

    // If control file exists but a channel has 0 base stores (only in visit data),
    // fall back to counting distinct stores from gridRows for that channel
    if (control) {
      for (const row of gridRows) {
        const entry = channelMap.get(row.channel);
        if (entry && entry.baseStores === 0) {
          // Channel not in control file — count distinct grid stores instead
          const storesInChannel = gridRows.filter(r => r.channel === row.channel);
          entry.baseStores = new Set(storesInChannel.map(r => r.storeCode)).size;
        }
      }
    }

    const totalVisits = [...channelMap.values()].reduce((s, v) => s + v.visits, 0);
    const totalBase = [...channelMap.values()].reduce((s, v) => s + v.baseStores, 0);

    const rows = [...channelMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([channel, stats]) => ({
        channel,
        totalStores: stats.baseStores,
        visits: stats.visits,
        contribution: totalVisits > 0 ? (stats.visits / totalVisits) * 100 : 0,
        completion: stats.baseStores * weeks > 0
          ? (stats.visits / (stats.baseStores * weeks)) * 100
          : 0,
      }));

    return [
      ...rows,
      {
        channel: 'Total',
        totalStores: totalBase,
        visits: totalVisits,
        contribution: 100,
        completion: -1, // sentinel — "—"
      },
    ];
  }, [hasData, control, gridRows, dateCols, dateFrom, dateTo, selChannels, allChannels]);

  // ─── Clear filters ─────────────────────────────────────────────────────────

  const clearFilters = () => {
    setSelChannels([]);
    setSelStores([]);
    setDateFrom(currentWeekMon());
    setDateTo(currentWeekSun());
  };

  if (!authChecked) return null;

  return (
    <div className="min-h-screen" style={{ backgroundImage: "url('/stellr-bg.jpg')", backgroundSize: 'cover', backgroundAttachment: 'fixed', backgroundPosition: 'center' }}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 shadow-sm">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Image
              src="/ao-logo.png" alt="A&O" width={72} height={36} className="object-contain"
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = 'none';
              }}
            />
            <div>
              <h1 className="text-base font-bold leading-tight text-[#1B3A6B]">A&O Interactive Services</h1>
              <p className="text-[#1B3A6B]/60 text-xs">Visit Report</p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <Image src="/perigee-logo.jpg" alt="Perigee" width={72} height={28} className="object-contain rounded" />
            <div className="h-6 w-px bg-gray-200" />
            <Image src="/stellr-logo.png" alt="Stellr" width={110} height={34} className="object-contain" />
            <div className="h-6 w-px bg-gray-200" />
            <div className="text-right">
              <p className="text-[#1B3A6B] text-xs font-semibold">{session?.name}</p>
              <p className="text-gray-400 text-xs">{session?.email}</p>
            </div>
            <button
              onClick={() => router.push('/')}
              className="text-gray-400 hover:text-[#1B3A6B] text-xs flex items-center gap-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Dashboard
            </button>
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

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-16 text-center">
            <div className="w-8 h-8 border-2 border-[#1B3A6B] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-500">Loading visit report data...</p>
          </div>
        )}

        {!loading && (
          <>
            {/* Upload alerts */}
            {uploadError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 mb-5">
                <p className="text-red-600 text-xs">{uploadError}</p>
              </div>
            )}
            {uploadSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2 mb-5">
                <p className="text-green-700 text-xs">{uploadSuccess}</p>
              </div>
            )}

            {/* Admin Upload Section */}
            {session?.isAdmin && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                {/* Control File Card */}
                <div
                  className={`bg-white rounded-xl border shadow-sm p-5 transition-colors ${
                    dragOver === 'control' ? 'border-[#1B3A6B] bg-blue-50/30' : 'border-gray-200'
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragOver('control'); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={handleDrop('control')}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[#1B3A6B]">Site Control File (Store Base)</h3>
                    {control && (
                      <button
                        onClick={() => handleReset('control')}
                        className="text-xs text-red-500 hover:text-red-700 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {control ? (
                    <div className="text-xs text-gray-500 space-y-1 mb-3">
                      <p><span className="font-medium text-gray-700">{control.stores.length}</span> stores across <span className="font-medium text-gray-700">{unique(control.stores.map(s => s.channel)).length}</span> channels</p>
                      <p>Updated {fmtTimestamp(control.updatedAt)} by {control.updatedBy}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mb-3">No control file uploaded — completion % will use visit data stores as base</p>
                  )}

                  <label className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1B3A6B] text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-[#152f5a] transition-colors">
                    {uploading === 'control' ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    )}
                    {control ? 'Replace Control File' : 'Upload Control File'}
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileInput('control')}
                      className="hidden"
                      disabled={uploading !== null}
                    />
                  </label>
                  <p className="text-[10px] text-gray-400 mt-2 text-center">
                    Excel with columns: Store Name, Store Code, Channel
                  </p>
                </div>

                {/* Visit Data Card */}
                <div
                  className={`bg-white rounded-xl border shadow-sm p-5 transition-colors ${
                    dragOver === 'data' ? 'border-[#1B3A6B] bg-blue-50/30' : 'border-gray-200'
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragOver('data'); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={handleDrop('data')}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[#1B3A6B]">Visit Data</h3>
                    {visitData && (
                      <button
                        onClick={() => handleReset('data')}
                        className="text-xs text-red-500 hover:text-red-700 transition-colors"
                      >
                        Reset All
                      </button>
                    )}
                  </div>

                  {visitData ? (
                    <div className="text-xs text-gray-500 space-y-1 mb-3">
                      <p><span className="font-medium text-gray-700">{visitData.visits.length}</span> total visits</p>
                      {visitData.visits.length > 0 && (() => {
                        const dates = visitData.visits.map(v => v.date).sort();
                        const channels = unique(visitData.visits.map(v => v.channel));
                        const stores = new Set(visitData.visits.map(v => v.storeCode)).size;
                        return (
                          <>
                            <p>{stores} unique stores, {channels.length} channels</p>
                            <p>Date range: {dates[0]} to {dates[dates.length - 1]}</p>
                          </>
                        );
                      })()}
                      <p>Updated {fmtTimestamp(visitData.updatedAt)} by {visitData.updatedBy}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mb-3">No visit data uploaded yet</p>
                  )}

                  <label className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1B3A6B] text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-[#152f5a] transition-colors">
                    {uploading === 'data' ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    )}
                    Upload Visit Data
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileInput('data')}
                      className="hidden"
                      disabled={uploading !== null}
                    />
                  </label>
                  <p className="text-[10px] text-gray-400 mt-2 text-center">
                    Perigee visits export — Channel, Store Code, Store Full Name, Check In Date
                  </p>
                </div>
              </div>
            )}

            {/* Empty state — no data at all */}
            {!hasData && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-16 text-center">
                <p className="text-xl font-semibold text-gray-700 mb-2">No data uploaded yet</p>
                <p className="text-gray-400 text-sm">
                  {session?.isAdmin
                    ? 'Upload visit data (Perigee export) above to get started. Optionally add a Site Control File for store base calculations.'
                    : 'An admin needs to upload visit data before the report is available.'}
                </p>
              </div>
            )}

            {/* Report — show when we have any data */}
            {hasData && (
              <>
                {/* Filters */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
                  <div className="flex flex-wrap items-end gap-4">
                    <MultiSelect
                      label="Channel"
                      items={allChannels}
                      selected={selChannels}
                      onChange={setSelChannels}
                    />
                    {filteredStoreLabels.length > 0 && (
                      <MultiSelect
                        label="Store"
                        items={filteredStoreLabels}
                        selected={selStores}
                        onChange={setSelStores}
                      />
                    )}
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Date From</label>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={e => setDateFrom(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Date To</label>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={e => setDateTo(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]"
                      />
                    </div>
                    <div className="ml-auto">
                      <button
                        onClick={clearFilters}
                        className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Clear Filters
                      </button>
                    </div>
                  </div>
                </div>

                {/* Channel Summary Table */}
                {channelSummary.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-700">Channel Summary</p>
                        <p className="text-xs text-gray-400">
                          {dateFrom} to {dateTo} ({weeksInRange(dateFrom, dateTo)} week{weeksInRange(dateFrom, dateTo) !== 1 ? 's' : ''})
                        </p>
                      </div>
                      {!control && (
                        <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                          No control file — using visit data stores as base
                        </span>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[#1B3A6B] text-white">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold">Channel</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold">Total Stores (Base)</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold">Visits in Period</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold">Contribution %</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold">Completion %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {channelSummary.map((row, idx) => {
                            const isTotal = row.channel === 'Total';
                            return (
                              <tr
                                key={row.channel}
                                className={`${isTotal ? 'bg-gray-50 font-bold' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} border-t border-gray-100`}
                              >
                                <td className="px-4 py-2 text-gray-800">{row.channel}</td>
                                <td className="px-4 py-2 text-right text-gray-700">{row.totalStores}</td>
                                <td className="px-4 py-2 text-right text-gray-700">{row.visits}</td>
                                <td className="px-4 py-2 text-right text-gray-700">{row.contribution.toFixed(1)}%</td>
                                <td className="px-4 py-2 text-right text-gray-700">
                                  {row.completion < 0 ? '—' : `${row.completion.toFixed(1)}%`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Store Visit Grid */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-700">
                      Store Visit Grid
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        {gridRows.length} stores, {dateCols.length} days
                      </span>
                    </p>
                  </div>
                  <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto' }}>
                    <table className="text-sm border-collapse w-full" style={{ minWidth: `${400 + dateCols.length * 70}px` }}>
                      <thead className="sticky top-0 z-20">
                        <tr className="bg-[#1B3A6B] text-white">
                          <th className="px-3 py-2.5 text-left text-xs font-semibold w-10">#</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold w-28">Channel</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold w-48">Store Name</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold w-24">Store Code</th>
                          {dateCols.map(d => (
                            <th key={d} className="px-2 py-2.5 text-center text-xs font-semibold whitespace-nowrap">
                              {fmtDate(d)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {gridRows.length === 0 ? (
                          <tr>
                            <td colSpan={4 + dateCols.length} className="px-6 py-12 text-center text-gray-400">
                              No stores match the current filters
                            </td>
                          </tr>
                        ) : (
                          gridRows.map((row, idx) => {
                            const hasAnyVisit = row.visitCount > 0;
                            const rowBg = !hasAnyVisit
                              ? 'bg-red-50/60'
                              : idx % 2 === 0
                                ? 'bg-white'
                                : 'bg-gray-50';
                            return (
                              <tr key={`${row.storeCode}-${idx}`} className={rowBg}>
                                <td className="px-3 py-2 text-xs text-gray-400">{idx + 1}</td>
                                <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{row.channel}</td>
                                <td className="px-3 py-2 text-gray-800 font-medium">{row.storeName}</td>
                                <td className="px-3 py-2 text-xs text-gray-600">{row.storeCode}</td>
                                {dateCols.map(d => (
                                  <td key={d} className="px-2 py-2 text-center">
                                    {row.visits[d] ? (
                                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold">
                                        ✓
                                      </span>
                                    ) : null}
                                  </td>
                                ))}
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
          </>
        )}
      </main>
    </div>
  );
}
