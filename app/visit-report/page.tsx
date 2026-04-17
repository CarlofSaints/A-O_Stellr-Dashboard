'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import * as XLSX from 'xlsx';

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
  visitUuid: string;
}

interface DataPayload {
  updatedAt: string;
  updatedBy: string;
  visits: Visit[];
}

interface GridRow {
  storeName: string;
  storeCode: string;
  channel: string;
  visits: Record<string, boolean>;
  visitCount: number;
}

interface WeekCol {
  weekNum: number;
  monIso: string;
  sunIso: string;
  line1: string; // "WK-14"
  line2: string; // "06/04 - 12/04"
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))].sort();
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${days[d.getDay()]} ${dd}/${mm}`;
}

function makeDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    dates.push(isoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function isoDate(d: Date): string {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function currentWeekMon(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return isoDate(d);
}

function currentWeekSun(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? 0 : 7 - day));
  return isoDate(d);
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

/** First Monday of 2026 = Jan 5, 2026 */
const FIRST_MONDAY = new Date('2026-01-05T00:00:00').getTime();

/** Week number for a given ISO date (WK-1 = Jan 5–11 2026) */
function weekNumFor(isoStr: string): number {
  const d = new Date(isoStr + 'T00:00:00').getTime();
  return Math.floor((d - FIRST_MONDAY) / (7 * 86400000)) + 1;
}

/** Completion % → conditional format style */
function completionStyle(pct: number): React.CSSProperties {
  if (pct < 0) return {}; // sentinel for Total row
  if (pct >= 100) return { backgroundColor: '#15803d', color: '#fff' };    // green-700 (dark green)
  if (pct >= 80)  return { backgroundColor: '#22c55e', color: '#fff' };    // green-500
  if (pct >= 60)  return { backgroundColor: '#86efac', color: '#166534' }; // green-300 / green-800
  if (pct >= 40)  return { backgroundColor: '#fde68a', color: '#92400e' }; // amber-200 / amber-800
  if (pct >= 20)  return { backgroundColor: '#fca5a5', color: '#991b1b' }; // red-300 / red-800
  return { backgroundColor: '#dc2626', color: '#fff' };                     // red-600 (dark red)
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

// ─── Frozen-column cell styles ───────────────────────────────────────────────

const GRID_BORDER = '1px solid #e5e7eb'; // gray-200

type ColWidths = { num: number; ch: number; name: number; code: number };

function frozenOffsets(cw: ColWidths) {
  return [0, cw.num, cw.num + cw.ch, cw.num + cw.ch + cw.name];
}

function frozenWidths(cw: ColWidths) {
  return [cw.num, cw.ch, cw.name, cw.code];
}

/** Style for a frozen (sticky-left) cell */
function frozenCell(
  colIdx: number, cw: ColWidths, bg: string, isHeader: boolean,
): React.CSSProperties {
  const offsets = frozenOffsets(cw);
  const widths = frozenWidths(cw);
  return {
    position: 'sticky',
    left: offsets[colIdx],
    width: widths[colIdx],
    minWidth: widths[colIdx],
    maxWidth: widths[colIdx],
    zIndex: isHeader ? 30 : 10,
    backgroundColor: bg,
    borderRight: GRID_BORDER,
    borderBottom: GRID_BORDER,
    boxSizing: 'border-box',
    ...(colIdx === 3 ? { borderRightWidth: 2, borderRightColor: '#cbd5e1' } : {}), // heavier divider after last frozen col
  };
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

  // Resizable frozen column widths
  const [cw, setCw] = useState<ColWidths>({ num: 40, ch: 130, name: 260, code: 100 });
  const cwRef = useRef(cw);
  cwRef.current = cw;

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

  // ─── Column resize handler ──────────────────────────────────────────────────

  const startColResize = useCallback((key: keyof ColWidths, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = cwRef.current[key];

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(key === 'num' ? 30 : 60, startW + ev.clientX - startX);
      setCw(prev => ({ ...prev, [key]: newW }));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

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
      const res = await fetch(`/api/visit-report/${type}`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) { setUploadError(json.error ?? 'Upload failed'); return; }

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

  // ─── Download template ────────────────────────────────────────────────────

  const downloadTemplate = useCallback((type: 'control' | 'data') => {
    const headers = type === 'control'
      ? ['Channel', 'Store Name', 'Store Code']
      : ['Channel', 'Store Code', 'Store Full Name', 'Check In Date'];
    const blob = new Blob([headers.join(',') + '\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = type === 'control' ? 'Site Control File Template.csv' : 'Visit Data Template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ─── Derived: store universe (control-file-only when control exists) ─────

  const controlCodeSet = useMemo(() => {
    if (!control) return null; // no control file — include everything
    return new Set(control.stores.map(s => s.storeCode));
  }, [control]);

  const storeMap = useMemo(() => {
    const map = new Map<string, { storeName: string; channel: string }>();

    if (control) {
      // Control file is the base — only these stores appear in grids
      for (const s of control.stores) {
        map.set(s.storeCode, { storeName: s.storeName, channel: s.channel });
      }
      // Enrich with visit data names/channels (but don't add new stores)
      for (const v of visitData?.visits ?? []) {
        const existing = map.get(v.storeCode);
        if (existing) {
          if (v.storeName) existing.storeName = v.storeName;
          if (v.channel) existing.channel = v.channel;
        }
        // stores NOT in control file are excluded — they go to exceptions
      }
    } else {
      // No control file — visit data is the universe
      for (const v of visitData?.visits ?? []) {
        if (!map.has(v.storeCode)) {
          map.set(v.storeCode, {
            storeName: v.storeName || v.storeCode,
            channel: v.channel || 'Unknown',
          });
        }
      }
    }
    return map;
  }, [control, visitData]);

  // Exceptions: visits whose storeCode is NOT in the control file
  const exceptions = useMemo(() => {
    if (!controlCodeSet || !visitData) return [];
    return visitData.visits
      .filter(v => !controlCodeSet.has(v.storeCode))
      .map(v => ({
        channel: v.channel || 'Unknown',
        storeCode: v.storeCode,
        storeName: v.storeName || v.storeCode,
        visitUuid: v.visitUuid || '',
        date: v.date,
      }));
  }, [controlCodeSet, visitData]);

  const hasData = storeMap.size > 0;

  const allChannels = useMemo(
    () => unique([...storeMap.values()].map(s => s.channel)),
    [storeMap]
  );

  const filteredStoreLabels = useMemo(() => {
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);
    const labels: string[] = [];
    for (const [code, info] of storeMap) {
      if (chSet.has(info.channel)) labels.push(`${info.storeName} (${code})`);
    }
    return labels.sort();
  }, [storeMap, selChannels, allChannels]);

  // Date columns
  const dateCols = useMemo(
    () => dateFrom && dateTo ? makeDateRange(dateFrom, dateTo) : [],
    [dateFrom, dateTo]
  );

  // O(1) visit lookup
  const visitSet = useMemo(() => {
    const set = new Set<string>();
    for (const v of visitData?.visits ?? []) set.add(`${v.storeCode}|${v.date}`);
    return set;
  }, [visitData]);

  // Grid rows (daily)
  const gridRows = useMemo((): GridRow[] => {
    if (!hasData || dateCols.length === 0) return [];
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);
    const stSet = selStores.length > 0 && selStores.length < filteredStoreLabels.length
      ? new Set(selStores) : null;

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
      rows.push({ storeName: info.storeName, storeCode: code, channel: info.channel, visits, visitCount });
    }
    rows.sort((a, b) => a.channel.localeCompare(b.channel) || a.storeName.localeCompare(b.storeName));
    return rows;
  }, [hasData, storeMap, selChannels, selStores, allChannels, filteredStoreLabels.length, dateCols, visitSet]);

  // Channel summary
  const channelSummary = useMemo(() => {
    if (!hasData || dateCols.length === 0) return [];
    const weeks = weeksInRange(dateFrom, dateTo);
    const channelMap = new Map<string, { baseStores: number; visits: number }>();
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);

    if (control) {
      for (const s of control.stores) {
        if (!chSet.has(s.channel)) continue;
        const prev = channelMap.get(s.channel) ?? { baseStores: 0, visits: 0 };
        prev.baseStores++;
        channelMap.set(s.channel, prev);
      }
    }

    for (const row of gridRows) {
      const prev = channelMap.get(row.channel) ?? { baseStores: 0, visits: 0 };
      prev.visits += row.visitCount;
      if (!control) prev.baseStores++;
      channelMap.set(row.channel, prev);
    }

    if (control) {
      for (const row of gridRows) {
        const entry = channelMap.get(row.channel);
        if (entry && entry.baseStores === 0) {
          const storesInCh = gridRows.filter(r => r.channel === row.channel);
          entry.baseStores = new Set(storesInCh.map(r => r.storeCode)).size;
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
      { channel: 'Total', totalStores: totalBase, visits: totalVisits, contribution: 100, completion: -1 },
    ];
  }, [hasData, control, gridRows, dateCols, dateFrom, dateTo, selChannels, allChannels]);

  // ─── Week columns & week grid rows ─────────────────────────────────────────

  const weekCols = useMemo((): WeekCol[] => {
    if (!dateFrom || !dateTo) return [];
    const from = new Date(dateFrom + 'T00:00:00');
    const to = new Date(dateTo + 'T00:00:00');
    const firstMon = new Date(FIRST_MONDAY);

    // Monday of the week containing `from`
    const fromDay = from.getDay();
    const fromMon = new Date(from);
    fromMon.setDate(fromMon.getDate() - (fromDay === 0 ? 6 : fromDay - 1));

    // Sunday of the week containing `to`
    const toDay = to.getDay();
    const toSun = new Date(to);
    toSun.setDate(toSun.getDate() + (toDay === 0 ? 0 : 7 - toDay));

    const weeks: WeekCol[] = [];
    const d = new Date(fromMon);
    while (d <= toSun) {
      const mon = new Date(d);
      const sun = new Date(d);
      sun.setDate(sun.getDate() + 6);

      const wkNum = Math.floor((mon.getTime() - firstMon.getTime()) / (7 * 86400000)) + 1;
      const monDD = String(mon.getDate()).padStart(2, '0');
      const monMM = String(mon.getMonth() + 1).padStart(2, '0');
      const sunDD = String(sun.getDate()).padStart(2, '0');
      const sunMM = String(sun.getMonth() + 1).padStart(2, '0');

      weeks.push({
        weekNum: wkNum,
        monIso: isoDate(mon),
        sunIso: isoDate(sun),
        line1: `WK-${wkNum}`,
        line2: `${monDD}/${monMM} - ${sunDD}/${sunMM}`,
      });
      d.setDate(d.getDate() + 7);
    }
    return weeks;
  }, [dateFrom, dateTo]);

  // Map: storeCode → weekNum → visitCount
  const weekVisitMap = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const v of visitData?.visits ?? []) {
      const wk = weekNumFor(v.date);
      if (!map.has(v.storeCode)) map.set(v.storeCode, new Map());
      const sw = map.get(v.storeCode)!;
      sw.set(wk, (sw.get(wk) ?? 0) + 1);
    }
    return map;
  }, [visitData]);

  // Week grid rows — same stores as daily grid, with per-week counts
  const weekGridRows = useMemo(() => {
    if (!hasData || weekCols.length === 0) return [];
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);
    const stSet = selStores.length > 0 && selStores.length < filteredStoreLabels.length
      ? new Set(selStores) : null;

    const rows: { storeName: string; storeCode: string; channel: string; weekVisits: Record<number, number>; total: number }[] = [];
    for (const [code, info] of storeMap) {
      if (!chSet.has(info.channel)) continue;
      if (stSet && !stSet.has(`${info.storeName} (${code})`)) continue;
      const sw = weekVisitMap.get(code);
      const weekVisits: Record<number, number> = {};
      let total = 0;
      for (const wc of weekCols) {
        const cnt = sw?.get(wc.weekNum) ?? 0;
        weekVisits[wc.weekNum] = cnt;
        total += cnt;
      }
      rows.push({ storeName: info.storeName, storeCode: code, channel: info.channel, weekVisits, total });
    }
    rows.sort((a, b) => a.channel.localeCompare(b.channel) || a.storeName.localeCompare(b.storeName));
    return rows;
  }, [hasData, storeMap, selChannels, selStores, allChannels, filteredStoreLabels.length, weekCols, weekVisitMap]);

  // ─── Export to Excel ────────────────────────────────────────────────────────

  const exportToExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Channel Summary
    if (channelSummary.length > 0) {
      const csRows = channelSummary.map(r => ({
        'Channel': r.channel,
        'Total Stores (Base)': r.totalStores,
        'Visits in Period': r.visits,
        'Completion %': r.completion < 0 ? '' : `${r.completion.toFixed(1)}%`,
        'Contribution %': `${r.contribution.toFixed(1)}%`,
      }));
      const ws = XLSX.utils.json_to_sheet(csRows);
      // Auto-size columns
      ws['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Channel Summary');
    }

    // Sheet 2: Daily Visit Grid
    if (gridRows.length > 0 && dateCols.length > 0) {
      const headers = ['#', 'Channel', 'Store Name', 'Store Code', ...dateCols.map(d => fmtDate(d))];
      const data = gridRows.map((row, idx) => {
        const obj: Record<string, string | number> = {
          '#': idx + 1,
          'Channel': row.channel,
          'Store Name': row.storeName,
          'Store Code': row.storeCode,
        };
        for (const d of dateCols) {
          obj[fmtDate(d)] = row.visits[d] ? '✓' : '';
        }
        return obj;
      });
      const ws = XLSX.utils.json_to_sheet(data, { header: headers });
      ws['!cols'] = [
        { wch: 5 }, { wch: 18 }, { wch: 40 }, { wch: 14 },
        ...dateCols.map(() => ({ wch: 12 })),
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Daily Visit Grid');
    }

    // Sheet 3: Week Summary
    if (weekGridRows.length > 0 && weekCols.length > 0) {
      const wkHeaders = ['#', 'Channel', 'Store Name', 'Store Code', ...weekCols.map(wc => `${wc.line1} ${wc.line2}`)];
      const data = weekGridRows.map((row, idx) => {
        const obj: Record<string, string | number> = {
          '#': idx + 1,
          'Channel': row.channel,
          'Store Name': row.storeName,
          'Store Code': row.storeCode,
        };
        for (const wc of weekCols) {
          const cnt = row.weekVisits[wc.weekNum] ?? 0;
          obj[`${wc.line1} ${wc.line2}`] = cnt > 0 ? cnt : '';
        }
        return obj;
      });
      const ws = XLSX.utils.json_to_sheet(data, { header: wkHeaders });
      ws['!cols'] = [
        { wch: 5 }, { wch: 18 }, { wch: 40 }, { wch: 14 },
        ...weekCols.map(() => ({ wch: 18 })),
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Week Summary');
    }

    // Sheet 4: Exceptions
    if (exceptions.length > 0) {
      const exRows = exceptions.map((ex, idx) => ({
        '#': idx + 1,
        'Channel': ex.channel,
        'Site Code': ex.storeCode,
        'Store Name': ex.storeName,
        'Visit UUID': ex.visitUuid,
        'Date': ex.date,
      }));
      const ws = XLSX.utils.json_to_sheet(exRows);
      ws['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 14 }, { wch: 40 }, { wch: 38 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Exceptions');
    }

    // Generate filename with date range
    const fname = `Visit Report ${dateFrom} to ${dateTo}.xlsx`;
    XLSX.writeFile(wb, fname);
  }, [channelSummary, gridRows, dateCols, weekGridRows, weekCols, exceptions, dateFrom, dateTo]);

  // ─── Clear filters ────────────────────────────────────────────────────────

  const clearFilters = () => {
    setSelChannels([]);
    setSelStores([]);
    setDateFrom(currentWeekMon());
    setDateTo(currentWeekSun());
  };

  // ─── Row background helper (opaque for frozen cols) ────────────────────────

  const rowBg = (hasVisit: boolean, idx: number): string =>
    !hasVisit ? '#fef2f2' : idx % 2 === 0 ? '#ffffff' : '#f9fafb';

  const HEADER_BG = '#1B3A6B';

  if (!authChecked) return null;

  // ─── Resize handle element ──────────────────────────────────────────────────

  const resizeHandle = (key: keyof ColWidths) => (
    <div
      onMouseDown={(e) => startColResize(key, e)}
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/30"
      style={{ zIndex: 31 }}
    />
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ backgroundImage: "url('/stellr-bg.jpg')", backgroundSize: 'cover', backgroundAttachment: 'fixed', backgroundPosition: 'center' }}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 shadow-sm">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Image
              src="/ao-logo.png" alt="A&O" width={72} height={36} className="object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
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
            <button onClick={() => router.push('/')} className="text-gray-400 hover:text-[#1B3A6B] text-xs flex items-center gap-1 transition-colors">
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
                  className={`bg-white rounded-xl border shadow-sm p-5 transition-colors ${dragOver === 'control' ? 'border-[#1B3A6B] bg-blue-50/30' : 'border-gray-200'}`}
                  onDragOver={e => { e.preventDefault(); setDragOver('control'); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={handleDrop('control')}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[#1B3A6B]">Site Control File (Store Base)</h3>
                    {control && (
                      <button onClick={() => handleReset('control')} className="text-xs text-red-500 hover:text-red-700 transition-colors">
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
                    <input type="file" accept=".xlsx,.xls" onChange={handleFileInput('control')} className="hidden" disabled={uploading !== null} />
                  </label>
                  <div className="flex items-center justify-center mt-2 gap-1">
                    <p className="text-[10px] text-gray-400">Excel with columns: Channel, Store Name, Store Code</p>
                    <button type="button" onClick={() => downloadTemplate('control')} className="text-[10px] text-[#1B3A6B] hover:underline font-medium">
                      Download Template
                    </button>
                  </div>
                </div>

                {/* Visit Data Card */}
                <div
                  className={`bg-white rounded-xl border shadow-sm p-5 transition-colors ${dragOver === 'data' ? 'border-[#1B3A6B] bg-blue-50/30' : 'border-gray-200'}`}
                  onDragOver={e => { e.preventDefault(); setDragOver('data'); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={handleDrop('data')}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[#1B3A6B]">Visit Data</h3>
                    {visitData && (
                      <button onClick={() => handleReset('data')} className="text-xs text-red-500 hover:text-red-700 transition-colors">
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
                    <input type="file" accept=".xlsx,.xls" onChange={handleFileInput('data')} className="hidden" disabled={uploading !== null} />
                  </label>
                  <div className="flex items-center justify-center mt-2 gap-1">
                    <p className="text-[10px] text-gray-400">Perigee visits export — Channel, Store Code, Store Full Name, Check In Date</p>
                    <button type="button" onClick={() => downloadTemplate('data')} className="text-[10px] text-[#1B3A6B] hover:underline font-medium">
                      Download Template
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Empty state */}
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

            {/* ══════════════════ Report Section ══════════════════ */}
            {hasData && (
              <>
                {/* Filters */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
                  <div className="flex flex-wrap items-end gap-4">
                    <MultiSelect label="Channel" items={allChannels} selected={selChannels} onChange={setSelChannels} />
                    {filteredStoreLabels.length > 0 && (
                      <MultiSelect label="Store" items={filteredStoreLabels} selected={selStores} onChange={setSelStores} />
                    )}
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
                    <div className="ml-auto flex items-center gap-2">
                      <button onClick={clearFilters} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                        Clear Filters
                      </button>
                      <button onClick={exportToExcel} className="px-4 py-2 text-sm text-white bg-[#1B3A6B] rounded-lg hover:bg-[#152f5a] transition-colors flex items-center gap-1.5 font-medium">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export to Excel
                      </button>
                    </div>
                  </div>
                </div>

                {/* ──────── Channel Summary Table ──────── */}
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
                      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ backgroundColor: HEADER_BG, color: '#fff' }}>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>Channel</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>Total Stores (Base)</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>Visits in Period</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>Completion %</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold" style={{ borderBottom: GRID_BORDER }}>Contribution %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {channelSummary.map((row, idx) => {
                            const isTotal = row.channel === 'Total';
                            const bg = isTotal ? '#f9fafb' : idx % 2 === 0 ? '#ffffff' : '#f9fafb';
                            return (
                              <tr key={row.channel} style={{ backgroundColor: bg, fontWeight: isTotal ? 700 : 400 }}>
                                <td className="px-4 py-2 text-gray-800" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>{row.channel}</td>
                                <td className="px-4 py-2 text-right text-gray-700" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>{row.totalStores}</td>
                                <td className="px-4 py-2 text-right text-gray-700" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>{row.visits}</td>
                                <td className="px-4 py-2 text-right font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, ...completionStyle(row.completion) }}>
                                  {row.completion < 0 ? '—' : `${row.completion.toFixed(1)}%`}
                                </td>
                                <td className="px-4 py-2 text-right text-gray-700" style={{ borderBottom: GRID_BORDER }}>{row.contribution.toFixed(1)}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ──────── Store Visit Grid (Daily) ──────── */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-700">
                      Store Visit Grid
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        {gridRows.length} stores, {dateCols.length} days
                      </span>
                    </p>
                  </div>
                  <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto', position: 'relative' }}>
                    <table className="text-sm" style={{ borderCollapse: 'collapse', minWidth: `${cw.num + cw.ch + cw.name + cw.code + dateCols.length * 72}px` }}>
                      <thead className="sticky top-0" style={{ zIndex: 20 }}>
                        <tr>
                          {/* Frozen header cells */}
                          <th className="px-2 py-2.5 text-left text-xs font-semibold text-white relative" style={frozenCell(0, cw, HEADER_BG, true)}>
                            #
                            {resizeHandle('num')}
                          </th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-white relative" style={frozenCell(1, cw, HEADER_BG, true)}>
                            Channel
                            {resizeHandle('ch')}
                          </th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-white relative" style={frozenCell(2, cw, HEADER_BG, true)}>
                            Store Name
                            {resizeHandle('name')}
                          </th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-white relative" style={frozenCell(3, cw, HEADER_BG, true)}>
                            Store Code
                            {resizeHandle('code')}
                          </th>
                          {/* Scrollable date headers */}
                          {dateCols.map(d => (
                            <th key={d} className="px-2 py-2.5 text-center text-xs font-semibold whitespace-nowrap text-white"
                              style={{ backgroundColor: HEADER_BG, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: 72 }}>
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
                            const bg = rowBg(row.visitCount > 0, idx);
                            return (
                              <tr key={`${row.storeCode}-${idx}`}>
                                <td className="px-2 py-1.5 text-xs text-gray-400" style={frozenCell(0, cw, bg, false)}>{idx + 1}</td>
                                <td className="px-3 py-1.5 text-xs text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis" style={frozenCell(1, cw, bg, false)}>{row.channel}</td>
                                <td className="px-3 py-1.5 text-gray-800 font-medium overflow-hidden text-ellipsis" style={frozenCell(2, cw, bg, false)}>{row.storeName}</td>
                                <td className="px-3 py-1.5 text-xs text-gray-600" style={frozenCell(3, cw, bg, false)}>{row.storeCode}</td>
                                {dateCols.map(d => (
                                  <td key={d} className="px-2 py-1.5 text-center"
                                    style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: 72 }}>
                                    {row.visits[d] ? (
                                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
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

                {/* ──────── Week Summary Grid ──────── */}
                {weekCols.length > 0 && weekGridRows.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-semibold text-gray-700">
                        Week Summary
                        <span className="ml-2 text-xs font-normal text-gray-400">
                          {weekGridRows.length} stores, {weekCols.length} weeks
                        </span>
                      </p>
                    </div>
                    <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto', position: 'relative' }}>
                      <table className="text-sm" style={{ borderCollapse: 'collapse', minWidth: `${cw.num + cw.ch + cw.name + cw.code + weekCols.length * 90}px` }}>
                        <thead className="sticky top-0" style={{ zIndex: 20 }}>
                          <tr>
                            <th className="px-2 py-2.5 text-left text-xs font-semibold text-white relative" style={frozenCell(0, cw, HEADER_BG, true)}>
                              #
                            </th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white relative" style={frozenCell(1, cw, HEADER_BG, true)}>
                              Channel
                            </th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white relative" style={frozenCell(2, cw, HEADER_BG, true)}>
                              Store Name
                            </th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white relative" style={frozenCell(3, cw, HEADER_BG, true)}>
                              Store Code
                            </th>
                            {weekCols.map(wc => (
                              <th key={wc.weekNum} className="px-2 py-1.5 text-center text-xs font-semibold text-white whitespace-nowrap"
                                style={{ backgroundColor: HEADER_BG, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: 90 }}>
                                <div className="leading-tight">{wc.line1}</div>
                                <div className="text-[10px] font-normal opacity-80">{wc.line2}</div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {weekGridRows.map((row, idx) => {
                            const bg = rowBg(row.total > 0, idx);
                            return (
                              <tr key={`wk-${row.storeCode}-${idx}`}>
                                <td className="px-2 py-1.5 text-xs text-gray-400" style={frozenCell(0, cw, bg, false)}>{idx + 1}</td>
                                <td className="px-3 py-1.5 text-xs text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis" style={frozenCell(1, cw, bg, false)}>{row.channel}</td>
                                <td className="px-3 py-1.5 text-gray-800 font-medium overflow-hidden text-ellipsis" style={frozenCell(2, cw, bg, false)}>{row.storeName}</td>
                                <td className="px-3 py-1.5 text-xs text-gray-600" style={frozenCell(3, cw, bg, false)}>{row.storeCode}</td>
                                {weekCols.map(wc => {
                                  const cnt = row.weekVisits[wc.weekNum] ?? 0;
                                  return (
                                    <td key={wc.weekNum} className="px-2 py-1.5 text-center text-xs"
                                      style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: 90 }}>
                                      {cnt > 0 ? (
                                        <span className="inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold px-1.5">
                                          {cnt}
                                        </span>
                                      ) : null}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ──────── Exceptions Grid ──────── */}
                {exceptions.length > 0 && (
                  <div className="bg-white rounded-xl border border-amber-300 shadow-sm overflow-hidden mt-5">
                    <div className="px-4 py-3 border-b border-amber-200 bg-amber-50">
                      <p className="text-sm font-semibold text-amber-800">
                        Exceptions
                        <span className="ml-2 text-xs font-normal text-amber-600">
                          {exceptions.length} visits from stores not in the Site Control File
                        </span>
                      </p>
                    </div>
                    <div style={{ overflowX: 'auto', maxHeight: '50vh', overflowY: 'auto' }}>
                      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                        <thead className="sticky top-0" style={{ zIndex: 20 }}>
                          <tr style={{ backgroundColor: '#92400e', color: '#fff' }}>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>#</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>Channel</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>Site Code</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>Store Name</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>Visit UUID</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ borderBottom: GRID_BORDER }}>Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {exceptions.map((ex, idx) => {
                            const bg = idx % 2 === 0 ? '#ffffff' : '#fffbeb';
                            return (
                              <tr key={`ex-${idx}`}>
                                <td className="px-4 py-1.5 text-xs text-gray-400" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>{idx + 1}</td>
                                <td className="px-4 py-1.5 text-xs text-gray-700" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>{ex.channel}</td>
                                <td className="px-4 py-1.5 text-xs text-gray-700 font-mono" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>{ex.storeCode}</td>
                                <td className="px-4 py-1.5 text-xs text-gray-700" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>{ex.storeName}</td>
                                <td className="px-4 py-1.5 text-xs text-gray-500 font-mono" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER }}>{ex.visitUuid}</td>
                                <td className="px-4 py-1.5 text-xs text-gray-700" style={{ backgroundColor: bg, borderBottom: GRID_BORDER }}>{ex.date}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
