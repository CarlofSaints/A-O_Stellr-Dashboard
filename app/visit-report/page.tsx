'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

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
  status?: string; // ACTIVE, CLOSED, NOT IN CYCLE, or LINKED
  uid?: string;    // Links duplicate stores together — same UID = same store
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
  status: string;
  visits: Record<string, boolean>;
  visitCount: number;
}

interface StoreGroup {
  storeName: string;
  storeCodes: string[];
  channel: string;
  status: string;
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

function firstOfMonth(): string {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function today(): string {
  return isoDate(new Date());
}

function weeksInRange(from: string, to: string): number {
  const f = new Date(from + 'T00:00:00');
  const t = new Date(to + 'T00:00:00');
  const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
  return Math.ceil(days / 7);
}

function monthsInRange(from: string, to: string): number {
  const f = new Date(from + 'T00:00:00');
  const t = new Date(to + 'T00:00:00');
  return (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()) + 1;
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

/** Deduplicate control-file stores within each channel.
 *  Two entries in the same channel are the "same store" if they share:
 *  - the same UID (explicit linking for duplicates), OR
 *  - the same store code, OR
 *  - the same store name (case-insensitive)
 *  Uses union-find to handle transitive matches.
 *  LINKED stores are merged into the master (ACTIVE/CLOSED) entry. */
function deduplicateStores(stores: CtrlStore[]): StoreGroup[] {
  const byChannel = new Map<string, CtrlStore[]>();
  for (const s of stores) {
    if (!byChannel.has(s.channel)) byChannel.set(s.channel, []);
    byChannel.get(s.channel)!.push(s);
  }

  const result: StoreGroup[] = [];

  for (const [channel, entries] of byChannel) {
    const parent = entries.map((_, i) => i);

    const find = (x: number): number => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const unite = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    // Group by UID first (highest priority — explicit linking)
    const byUid = new Map<string, number>();
    for (let i = 0; i < entries.length; i++) {
      const uid = (entries[i].uid ?? '').trim();
      if (uid) {
        if (byUid.has(uid)) unite(i, byUid.get(uid)!);
        else byUid.set(uid, i);
      }
    }

    // Then by name and code (existing logic)
    const byName = new Map<string, number>();
    const byCode = new Map<string, number>();

    for (let i = 0; i < entries.length; i++) {
      const nameKey = entries[i].storeName.toLowerCase().trim();
      const codeKey = entries[i].storeCode.trim();

      if (nameKey) {
        if (byName.has(nameKey)) unite(i, byName.get(nameKey)!);
        else byName.set(nameKey, i);
      }
      if (codeKey) {
        if (byCode.has(codeKey)) unite(i, byCode.get(codeKey)!);
        else byCode.set(codeKey, i);
      }
    }

    const groups = new Map<number, number[]>();
    for (let i = 0; i < entries.length; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(i);
    }

    for (const indices of groups.values()) {
      const codes = [...new Set(indices.map(i => entries[i].storeCode))];
      // Prefer the name from the master (non-LINKED) entry
      const masterIdx = indices.find(i => (entries[i].status ?? 'ACTIVE').toUpperCase() !== 'LINKED');
      const name = masterIdx !== undefined ? entries[masterIdx].storeName : entries[indices[0]].storeName;
      // Status from the master entry; LINKED is never the group status
      const nonLinkedStatuses = indices
        .map(i => (entries[i].status ?? 'ACTIVE').toUpperCase())
        .filter(s => s !== 'LINKED');
      const status = nonLinkedStatuses.includes('CLOSED') ? 'CLOSED'
        : nonLinkedStatuses.includes('NOT IN CYCLE') ? 'NOT IN CYCLE'
        : nonLinkedStatuses.includes('ACTIVE') ? 'ACTIVE'
        : 'LINKED'; // only if ALL entries are LINKED (edge case — no master defined yet)
      result.push({ storeName: name, storeCodes: codes, channel, status });
    }
  }

  return result;
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

type ColWidths = { num: number; ch: number; name: number; code: number; st: number };
type CsWidths = { ch: number; stores: number; visits: number; compl: number; contrib: number };
type ExWidths = { num: number; ch: number; code: number; name: number; uuid: number; date: number; action: number };

function frozenOffsets(cw: ColWidths) {
  return [0, cw.num, cw.num + cw.ch, cw.num + cw.ch + cw.name, cw.num + cw.ch + cw.name + cw.code];
}

function frozenWidths(cw: ColWidths) {
  return [cw.num, cw.ch, cw.name, cw.code, cw.st];
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
    ...(colIdx === 4 ? { borderRightWidth: 2, borderRightColor: '#cbd5e1' } : {}), // heavier divider after last frozen col
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
  const [selStatuses, setSelStatuses] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);

  // Track whether we've applied the initial status default
  const statusDefaultApplied = useRef(false);

  // Drag-drop highlight
  const [dragOver, setDragOver] = useState<'control' | 'data' | null>(null);

  // Email report state
  const [emailMode, setEmailMode] = useState(false);
  const [emailAddresses, setEmailAddresses] = useState('');
  const [emailing, setEmailing] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sizeConfirm, setSizeConfirm] = useState<{ sizeMB: string; base64: string; fname: string } | null>(null);

  // Resizable frozen column widths
  const [cw, setCw] = useState<ColWidths>({ num: 40, ch: 130, name: 260, code: 100, st: 80 });
  const cwRef = useRef(cw);
  cwRef.current = cw;

  // Channel Summary column widths
  const [csCw, setCsCw] = useState<CsWidths>({ ch: 180, stores: 160, visits: 150, compl: 130, contrib: 130 });

  // Exceptions column widths
  const [exCw, setExCw] = useState<ExWidths>({ num: 40, ch: 150, code: 120, name: 280, uuid: 300, date: 100, action: 120 });

  // Add-to-control state (exception rows) — keyed by row index string
  const [addingRow, setAddingRow] = useState<string | null>(null); // row key currently saving
  const [openDropdown, setOpenDropdown] = useState<string | null>(null); // row key with dropdown open
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [linkUid, setLinkUid] = useState(''); // UID input for LINKED status
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const addToControl = useCallback(async (rowKey: string, storeName: string, storeCode: string, channel: string, status: string, uid?: string) => {
    setOpenDropdown(null);
    setLinkUid('');
    setAddingRow(rowKey);
    try {
      const res = await fetch('/api/visit-report/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeName, storeCode, channel, status, ...(uid ? { uid } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setUploadError(data.error ?? 'Failed to add store');
        return;
      }
      const uidNote = uid ? ` (UID: ${uid})` : '';
      setUploadSuccess(`Store "${storeName}" (${storeCode}) added to Control File as ${status}${uidNote}`);
      await loadData();
    } catch {
      setUploadError('Failed to add store — network error');
    } finally {
      setAddingRow(null);
    }
  }, [loadData]);

  // Close add-to-control dropdown on outside click
  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setOpenDropdown(null);
      setLinkUid('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openDropdown]);

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

  // Generic column resize — pass the current width and a setter
  const startGenericResize = useCallback((startW: number, apply: (w: number) => void, min: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => apply(Math.max(min, startW + ev.clientX - startX));
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
      ? ['Channel', 'Store Name', 'Store Code', 'Status', 'UID']
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

  // Deduplicated store groups — within each channel, stores sharing
  // the same code OR same name (case-insensitive) are merged into one group.
  const storeGroups = useMemo((): StoreGroup[] => {
    if (control) {
      const groups = deduplicateStores(control.stores);
      // Fill in missing names from visit data
      if (visitData) {
        const visitNameMap = new Map<string, string>();
        for (const v of visitData.visits) {
          if (v.storeName && !visitNameMap.has(v.storeCode)) {
            visitNameMap.set(v.storeCode, v.storeName);
          }
        }
        for (const g of groups) {
          if (!g.storeName) {
            for (const code of g.storeCodes) {
              const vName = visitNameMap.get(code);
              if (vName) { g.storeName = vName; break; }
            }
          }
        }
      }
      return groups;
    }
    // No control file — visit data is the universe (one group per storeCode)
    const seen = new Map<string, StoreGroup>();
    for (const v of visitData?.visits ?? []) {
      if (!seen.has(v.storeCode)) {
        seen.set(v.storeCode, {
          storeName: v.storeName || v.storeCode,
          storeCodes: [v.storeCode],
          channel: v.channel || 'Unknown',
          status: 'ACTIVE',
        });
      }
    }
    return [...seen.values()];
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

  // Filter exceptions by selected channels
  const filteredExceptions = useMemo(() => {
    if (exceptions.length === 0) return [];
    if (selChannels.length === 0) return exceptions; // no filter = show all
    const chSet = new Set(selChannels);
    return exceptions.filter(ex => chSet.has(ex.channel));
  }, [exceptions, selChannels]);

  const hasData = storeGroups.length > 0;

  const allChannels = useMemo(
    () => unique(storeGroups.map(g => g.channel)),
    [storeGroups]
  );

  const allStatuses = useMemo(
    () => unique(storeGroups.map(g => g.status)),
    [storeGroups]
  );

  // Default to showing only ACTIVE stores when multiple statuses exist
  useEffect(() => {
    if (!statusDefaultApplied.current && allStatuses.length > 1 && allStatuses.includes('ACTIVE')) {
      setSelStatuses(['ACTIVE']);
      statusDefaultApplied.current = true;
    }
  }, [allStatuses]);

  const filteredStoreLabels = useMemo(() => {
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);
    const stSet = selStatuses.length > 0 ? new Set(selStatuses) : null;
    const labels: string[] = [];
    for (const g of storeGroups) {
      if (!chSet.has(g.channel)) continue;
      if (stSet && !stSet.has(g.status)) continue;
      labels.push(`${g.storeName} (${g.storeCodes[0]})`);
    }
    return labels.sort();
  }, [storeGroups, selChannels, allChannels, selStatuses]);

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

  // Grid rows (daily) — one row per deduplicated store group
  const gridRows = useMemo((): GridRow[] => {
    if (!hasData || dateCols.length === 0) return [];
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);
    const statusSet = selStatuses.length > 0 ? new Set(selStatuses) : null;
    const stSet = selStores.length > 0 && selStores.length < filteredStoreLabels.length
      ? new Set(selStores) : null;

    const rows: GridRow[] = [];
    for (const g of storeGroups) {
      if (!chSet.has(g.channel)) continue;
      if (statusSet && !statusSet.has(g.status)) continue;
      if (stSet && !stSet.has(`${g.storeName} (${g.storeCodes[0]})`)) continue;
      const visits: Record<string, boolean> = {};
      let visitCount = 0;
      for (const d of dateCols) {
        const has = g.storeCodes.some(code => visitSet.has(`${code}|${d}`));
        visits[d] = has;
        if (has) visitCount++;
      }
      rows.push({
        storeName: g.storeName,
        storeCode: g.storeCodes.join(' / '),
        channel: g.channel,
        status: g.status,
        visits,
        visitCount,
      });
    }
    rows.sort((a, b) => a.channel.localeCompare(b.channel) || a.storeName.localeCompare(b.storeName));
    return rows;
  }, [hasData, storeGroups, selChannels, selStores, selStatuses, allChannels, filteredStoreLabels.length, dateCols, visitSet]);

  // Channel summary — base store count from deduplicated groups
  const channelSummary = useMemo(() => {
    if (!hasData || dateCols.length === 0) return [];
    const months = monthsInRange(dateFrom, dateTo);
    const channelMap = new Map<string, { baseStores: number; visits: number }>();
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);

    const statusSet = selStatuses.length > 0 ? new Set(selStatuses) : null;

    if (control) {
      // Base count from deduplicated groups (independent of store filter)
      for (const g of storeGroups) {
        if (!chSet.has(g.channel)) continue;
        if (statusSet && !statusSet.has(g.status)) continue;
        const prev = channelMap.get(g.channel) ?? { baseStores: 0, visits: 0 };
        prev.baseStores++;
        channelMap.set(g.channel, prev);
      }
    }

    for (const row of gridRows) {
      const prev = channelMap.get(row.channel) ?? { baseStores: 0, visits: 0 };
      prev.visits += row.visitCount;
      if (!control) prev.baseStores++;
      channelMap.set(row.channel, prev);
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
        completion: stats.baseStores * months > 0
          ? (stats.visits / (stats.baseStores * months)) * 100
          : 0,
      }));

    return [
      ...rows,
      { channel: 'Total', totalStores: totalBase, visits: totalVisits, contribution: 100, completion: -1 },
    ];
  }, [hasData, control, storeGroups, gridRows, dateCols, dateFrom, dateTo, selChannels, selStatuses, allChannels]);

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

  // Week grid rows — one row per deduplicated store group, with per-week counts
  const weekGridRows = useMemo(() => {
    if (!hasData || weekCols.length === 0) return [];
    const chSet = selChannels.length > 0 ? new Set(selChannels) : new Set(allChannels);
    const statusSet = selStatuses.length > 0 ? new Set(selStatuses) : null;
    const stSet = selStores.length > 0 && selStores.length < filteredStoreLabels.length
      ? new Set(selStores) : null;

    const rows: { storeName: string; storeCode: string; channel: string; status: string; weekVisits: Record<number, number>; total: number }[] = [];
    for (const g of storeGroups) {
      if (!chSet.has(g.channel)) continue;
      if (statusSet && !statusSet.has(g.status)) continue;
      if (stSet && !stSet.has(`${g.storeName} (${g.storeCodes[0]})`)) continue;
      // Aggregate week visits across all codes in the group
      const weekVisits: Record<number, number> = {};
      let total = 0;
      for (const wc of weekCols) {
        let cnt = 0;
        for (const code of g.storeCodes) {
          const sw = weekVisitMap.get(code);
          cnt += sw?.get(wc.weekNum) ?? 0;
        }
        weekVisits[wc.weekNum] = cnt;
        total += cnt;
      }
      rows.push({ storeName: g.storeName, storeCode: g.storeCodes.join(' / '), channel: g.channel, status: g.status, weekVisits, total });
    }
    rows.sort((a, b) => a.channel.localeCompare(b.channel) || a.storeName.localeCompare(b.storeName));
    return rows;
  }, [hasData, storeGroups, selChannels, selStores, selStatuses, allChannels, filteredStoreLabels.length, weekCols, weekVisitMap]);

  // ─── Build workbook (shared by download + email) ────────────────────────────

  const buildWorkbookBuffer = useCallback(async (): Promise<ArrayBuffer> => {
    const wb = new ExcelJS.Workbook();
    const redFont: Partial<ExcelJS.Font> = { color: { argb: 'FFDC2626' }, bold: true };
    const redFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
    const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
    const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };

    // Sheet 1: Channel Summary
    if (channelSummary.length > 0) {
      const ws = wb.addWorksheet('Channel Summary');
      ws.columns = [
        { header: 'Channel', key: 'channel', width: 20 },
        { header: 'Total Stores (Base)', key: 'stores', width: 18 },
        { header: 'Visits in Period', key: 'visits', width: 16 },
        { header: 'Completion %', key: 'completion', width: 14 },
        { header: 'Contribution %', key: 'contribution', width: 14 },
      ];
      ws.getRow(1).font = headerFont;
      ws.getRow(1).fill = headerFill;
      for (const r of channelSummary) {
        ws.addRow({
          channel: r.channel,
          stores: r.totalStores,
          visits: r.visits,
          completion: r.completion < 0 ? '' : `${r.completion.toFixed(1)}%`,
          contribution: `${r.contribution.toFixed(1)}%`,
        });
      }
    }

    // Sheet 2: Daily Visit Grid
    if (gridRows.length > 0 && dateCols.length > 0) {
      const ws = wb.addWorksheet('Daily Visit Grid');
      const dateHeaders = dateCols.map(d => fmtDate(d));
      ws.columns = [
        { header: '#', key: 'num', width: 5 },
        { header: 'Channel', key: 'channel', width: 18 },
        { header: 'Store Name', key: 'storeName', width: 40 },
        { header: 'Store Code', key: 'storeCode', width: 14 },
        { header: 'Status', key: 'status', width: 10 },
        ...dateHeaders.map(h => ({ header: h, key: h, width: 12 })),
      ];
      ws.getRow(1).font = headerFont;
      ws.getRow(1).fill = headerFill;
      gridRows.forEach((row, idx) => {
        const obj: Record<string, string | number> = {
          num: idx + 1,
          channel: row.channel,
          storeName: row.storeName,
          storeCode: row.storeCode,
          status: row.status,
        };
        for (const d of dateCols) obj[fmtDate(d)] = row.visits[d] ? '\u2713' : '';
        ws.addRow(obj);
      });
    }

    // Sheet 3: Week Summary (with red highlighting for zero-total stores)
    if (weekGridRows.length > 0 && weekCols.length > 0) {
      const ws = wb.addWorksheet('Week Summary');
      const wkKeys = weekCols.map(wc => `${wc.line1} ${wc.line2}`);
      ws.columns = [
        { header: '#', key: 'num', width: 5 },
        { header: 'Channel', key: 'channel', width: 18 },
        { header: 'Store Name', key: 'storeName', width: 40 },
        { header: 'Store Code', key: 'storeCode', width: 14 },
        { header: 'Status', key: 'status', width: 10 },
        ...wkKeys.map(k => ({ header: k, key: k, width: 18 })),
        { header: 'Total', key: 'total', width: 8 },
      ];
      ws.getRow(1).font = headerFont;
      ws.getRow(1).fill = headerFill;
      weekGridRows.forEach((row, idx) => {
        const obj: Record<string, string | number> = {
          num: idx + 1,
          channel: row.channel,
          storeName: row.storeName,
          storeCode: row.storeCode,
          status: row.status,
        };
        for (const wc of weekCols) {
          const cnt = row.weekVisits[wc.weekNum] ?? 0;
          obj[`${wc.line1} ${wc.line2}`] = cnt > 0 ? cnt : '';
        }
        obj.total = row.total;
        const xlRow = ws.addRow(obj);
        if (row.total === 0) {
          // Red font on Store Name cell (col 3)
          xlRow.getCell(3).font = redFont;
          xlRow.getCell(3).fill = redFill;
          // Red font + fill on Total cell (last col)
          const totalCol = 5 + weekCols.length + 1; // num,channel,storeName,storeCode,status + weeks + total
          xlRow.getCell(totalCol).font = redFont;
          xlRow.getCell(totalCol).fill = redFill;
        }
      });
    }

    // Sheet 4: Exceptions (filtered by channel selection)
    if (filteredExceptions.length > 0) {
      const ws = wb.addWorksheet('Exceptions');
      ws.columns = [
        { header: '#', key: 'num', width: 5 },
        { header: 'Channel', key: 'channel', width: 18 },
        { header: 'Site Code', key: 'siteCode', width: 14 },
        { header: 'Store Name', key: 'storeName', width: 40 },
        { header: 'Visit UUID', key: 'visitUuid', width: 38 },
        { header: 'Date', key: 'date', width: 12 },
      ];
      ws.getRow(1).font = headerFont;
      ws.getRow(1).fill = headerFill;
      filteredExceptions.forEach((ex, idx) => {
        ws.addRow({
          num: idx + 1,
          channel: ex.channel,
          siteCode: ex.storeCode,
          storeName: ex.storeName,
          visitUuid: ex.visitUuid,
          date: ex.date,
        });
      });
    }

    return wb.xlsx.writeBuffer();
  }, [channelSummary, gridRows, dateCols, weekGridRows, weekCols, filteredExceptions]);

  const reportFilename = `Visit Report ${dateFrom} to ${dateTo}.xlsx`;

  // ─── Export to Excel (download) ────────────────────────────────────────────

  const exportToExcel = useCallback(async () => {
    const buf = await buildWorkbookBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFilename;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildWorkbookBuffer, reportFilename]);

  // ─── Email report ──────────────────────────────────────────────────────────

  const sendEmailReport = useCallback(async (overrideBase64?: string) => {
    const trimmed = emailAddresses.trim();
    if (!trimmed) { setEmailResult({ ok: false, msg: 'Enter at least one email address' }); return; }

    const emails = trimmed.split(',').map(e => e.trim()).filter(Boolean);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const bad = emails.filter(e => !emailRe.test(e));
    if (bad.length > 0) { setEmailResult({ ok: false, msg: `Invalid email(s): ${bad.join(', ')}` }); return; }

    // Build XLSX buffer
    let base64 = overrideBase64 ?? '';
    if (!overrideBase64) {
      const buf = await buildWorkbookBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      base64 = btoa(binary);
    }

    // Check file size — warn if > 3 MB
    const sizeBytes = (base64.length * 3) / 4; // approximate decoded size
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
    if (!overrideBase64 && sizeBytes > 3 * 1024 * 1024) {
      setSizeConfirm({ sizeMB, base64, fname: reportFilename });
      return;
    }

    setEmailing(true);
    setEmailResult(null);
    try {
      const res = await fetch('/api/visit-report/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails,
          filename: reportFilename,
          xlsxBase64: base64,
          senderName: session?.name ?? 'Unknown',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEmailResult({ ok: false, msg: json.error ?? 'Send failed' });
      } else {
        setEmailResult({ ok: true, msg: `Report sent to ${json.sentTo} recipient${json.sentTo > 1 ? 's' : ''} (${json.sizeMB} MB)` });
        setEmailAddresses('');
        setEmailMode(false);
      }
    } catch {
      setEmailResult({ ok: false, msg: 'Network error — could not send email' });
    } finally {
      setEmailing(false);
    }
  }, [emailAddresses, buildWorkbookBuffer, reportFilename, session]);

  // ─── Clear filters ────────────────────────────────────────────────────────

  const clearFilters = () => {
    setSelChannels([]);
    setSelStores([]);
    setSelStatuses([]);
    setDateFrom(firstOfMonth());
    setDateTo(today());
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

  const genericHandle = (w: number, apply: (v: number) => void, min = 60) => (
    <div
      onMouseDown={(e) => startGenericResize(w, apply, min, e)}
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
            <Image src="/stellr-logo.png" alt="Stellr" width={44} height={44} className="object-contain" />
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
                      <p><span className="font-medium text-gray-700">{storeGroups.length}</span> unique stores ({control.stores.length} rows) across <span className="font-medium text-gray-700">{unique(control.stores.map(s => s.channel)).length}</span> channels</p>
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
                    <p className="text-[10px] text-gray-400">Excel with columns: Channel, Store Name, Store Code, Status, UID</p>
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
                    {allStatuses.length > 1 && (
                      <MultiSelect label="Status" items={allStatuses} selected={selStatuses} onChange={setSelStatuses} />
                    )}
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

                  {/* Email Report Section */}
                  <div className="border-t border-gray-100 mt-3 pt-3">
                    <div className="flex items-start gap-3">
                      <label className="flex items-center gap-2 cursor-pointer shrink-0 pt-0.5">
                        <input
                          type="checkbox"
                          checked={emailMode}
                          onChange={(e) => { setEmailMode(e.target.checked); setEmailResult(null); setSizeConfirm(null); }}
                          className="w-4 h-4 rounded border-gray-300 text-[#1B3A6B] focus:ring-[#1B3A6B]"
                        />
                        <span className="text-sm font-medium text-gray-700">Email this report</span>
                      </label>
                      {emailMode && (
                        <div className="flex-1 flex items-center gap-2 flex-wrap">
                          <input
                            type="text"
                            value={emailAddresses}
                            onChange={(e) => setEmailAddresses(e.target.value)}
                            placeholder="email@example.com, another@example.com"
                            className="flex-1 min-w-[240px] px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#1B3A6B] placeholder:text-gray-400"
                          />
                          <button
                            onClick={() => sendEmailReport()}
                            disabled={emailing || !emailAddresses.trim()}
                            className="px-4 py-1.5 text-sm text-white bg-[#1B3A6B] rounded-lg hover:bg-[#152f5a] transition-colors flex items-center gap-1.5 font-medium disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                          >
                            {emailing ? (
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            )}
                            {emailing ? 'Sending...' : 'Send'}
                          </button>
                        </div>
                      )}
                    </div>
                    {emailResult && (
                      <div className={`mt-2 text-xs px-3 py-1.5 rounded-lg ${emailResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {emailResult.msg}
                      </div>
                    )}
                  </div>
                </div>

                {/* ──────── Channel Summary Table ──────── */}
                {channelSummary.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-700">Channel Summary</p>
                        <p className="text-xs text-gray-400">
                          {dateFrom} to {dateTo} ({monthsInRange(dateFrom, dateTo)} month{monthsInRange(dateFrom, dateTo) !== 1 ? 's' : ''}, target: 1 visit/store/month)
                        </p>
                      </div>
                      {!control && (
                        <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                          No control file — using visit data stores as base
                        </span>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="text-sm" style={{ borderCollapse: 'collapse', minWidth: csCw.ch + csCw.stores + csCw.visits + csCw.compl + csCw.contrib }}>
                        <thead>
                          <tr style={{ backgroundColor: HEADER_BG, color: '#fff' }}>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold relative" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: csCw.ch, width: csCw.ch }}>
                              Channel
                              {genericHandle(csCw.ch, w => setCsCw(p => ({ ...p, ch: w })))}
                            </th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold relative" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: csCw.stores, width: csCw.stores }}>
                              Total Stores (Base)
                              {genericHandle(csCw.stores, w => setCsCw(p => ({ ...p, stores: w })))}
                            </th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold relative" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: csCw.visits, width: csCw.visits }}>
                              Visits in Period
                              {genericHandle(csCw.visits, w => setCsCw(p => ({ ...p, visits: w })))}
                            </th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold relative" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: csCw.compl, width: csCw.compl }}>
                              Completion %
                              {genericHandle(csCw.compl, w => setCsCw(p => ({ ...p, compl: w })))}
                            </th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold relative" style={{ borderBottom: GRID_BORDER, minWidth: csCw.contrib, width: csCw.contrib }}>
                              Contribution %
                              {genericHandle(csCw.contrib, w => setCsCw(p => ({ ...p, contrib: w })))}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {channelSummary.map((row, idx) => {
                            const isTotal = row.channel === 'Total';
                            const bg = isTotal ? '#f9fafb' : idx % 2 === 0 ? '#ffffff' : '#f9fafb';
                            return (
                              <tr key={row.channel} style={{ backgroundColor: bg, fontWeight: isTotal ? 700 : 400 }}>
                                <td className="px-4 py-2 text-gray-800" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: csCw.ch }}>{row.channel}</td>
                                <td className="px-4 py-2 text-center text-gray-700" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: csCw.stores }}>{row.totalStores}</td>
                                <td className="px-4 py-2 text-center text-gray-700" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: csCw.visits }}>{row.visits}</td>
                                <td className="px-4 py-2 text-center font-semibold" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: csCw.compl, ...completionStyle(row.completion) }}>
                                  {row.completion < 0 ? '—' : `${row.completion.toFixed(1)}%`}
                                </td>
                                <td className="px-4 py-2 text-center text-gray-700" style={{ borderBottom: GRID_BORDER, minWidth: csCw.contrib }}>{row.contribution.toFixed(1)}%</td>
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
                    <table className="text-sm" style={{ borderCollapse: 'collapse', minWidth: `${cw.num + cw.ch + cw.name + cw.code + cw.st + dateCols.length * 72}px` }}>
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
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-white relative" style={frozenCell(4, cw, HEADER_BG, true)}>
                            Status
                            {resizeHandle('st')}
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
                            <td colSpan={5 + dateCols.length} className="px-6 py-12 text-center text-gray-400">
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
                                <td className="px-3 py-1.5 text-xs" style={frozenCell(4, cw, bg, false)}>
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${row.status === 'CLOSED' ? 'bg-red-100 text-red-700' : row.status === 'NOT IN CYCLE' ? 'bg-gray-100 text-gray-600' : row.status === 'LINKED' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                                    {row.status}
                                  </span>
                                </td>
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
                      <table className="text-sm" style={{ borderCollapse: 'collapse', minWidth: `${cw.num + cw.ch + cw.name + cw.code + cw.st + weekCols.length * 90 + 70}px` }}>
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
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white relative" style={frozenCell(4, cw, HEADER_BG, true)}>
                              Status
                            </th>
                            {weekCols.map(wc => (
                              <th key={wc.weekNum} className="px-2 py-1.5 text-center text-xs font-semibold text-white whitespace-nowrap"
                                style={{ backgroundColor: HEADER_BG, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: 90 }}>
                                <div className="leading-tight">{wc.line1}</div>
                                <div className="text-[10px] font-normal opacity-80">{wc.line2}</div>
                              </th>
                            ))}
                            <th className="px-3 py-2.5 text-center text-xs font-semibold text-white"
                              style={{ backgroundColor: HEADER_BG, borderBottom: GRID_BORDER, minWidth: 70 }}>
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {weekGridRows.map((row, idx) => {
                            const bg = rowBg(row.total > 0, idx);
                            const isZero = row.total === 0;
                            return (
                              <tr key={`wk-${row.storeCode}-${idx}`}>
                                <td className="px-2 py-1.5 text-xs text-gray-400" style={frozenCell(0, cw, bg, false)}>{idx + 1}</td>
                                <td className="px-3 py-1.5 text-xs text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis" style={frozenCell(1, cw, bg, false)}>{row.channel}</td>
                                <td className="px-3 py-1.5 font-medium overflow-hidden text-ellipsis" style={{ ...frozenCell(2, cw, bg, false), ...(isZero ? { color: '#dc2626', fontWeight: 700 } : { color: '#1f2937' }) }}>{row.storeName}</td>
                                <td className="px-3 py-1.5 text-xs text-gray-600" style={frozenCell(3, cw, bg, false)}>{row.storeCode}</td>
                                <td className="px-3 py-1.5 text-xs" style={frozenCell(4, cw, bg, false)}>
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${row.status === 'CLOSED' ? 'bg-red-100 text-red-700' : row.status === 'NOT IN CYCLE' ? 'bg-gray-100 text-gray-600' : row.status === 'LINKED' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                                    {row.status}
                                  </span>
                                </td>
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
                                <td className="px-3 py-1.5 text-center text-xs font-bold"
                                  style={{ backgroundColor: isZero ? '#fef2f2' : bg, color: isZero ? '#dc2626' : '#1B3A6B', borderBottom: GRID_BORDER, minWidth: 70 }}>
                                  {row.total}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ──────── Exceptions Grid ──────── */}
                {filteredExceptions.length > 0 && (
                  <div className="bg-white rounded-xl border border-amber-300 shadow-sm overflow-hidden mt-5">
                    <div className="px-4 py-3 border-b border-amber-200 bg-amber-50">
                      <p className="text-sm font-semibold text-amber-800">
                        Exceptions
                        <span className="ml-2 text-xs font-normal text-amber-600">
                          {filteredExceptions.length} visits from {new Set(filteredExceptions.map(e => e.storeCode)).size} unique stores not in the Site Control File
                        </span>
                      </p>
                    </div>
                    <div style={{ overflowX: 'auto', maxHeight: '50vh', overflowY: 'auto' }}>
                      <table className="text-sm" style={{ borderCollapse: 'collapse', minWidth: exCw.num + exCw.ch + exCw.code + exCw.name + exCw.uuid + exCw.date + exCw.action }}>
                        <thead className="sticky top-0" style={{ zIndex: 20 }}>
                          <tr style={{ backgroundColor: '#92400e', color: '#fff' }}>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold relative" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.num, width: exCw.num }}>
                              #
                              {genericHandle(exCw.num, w => setExCw(p => ({ ...p, num: w })), 30)}
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold relative" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.ch, width: exCw.ch }}>
                              Channel
                              {genericHandle(exCw.ch, w => setExCw(p => ({ ...p, ch: w })))}
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold relative" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.code, width: exCw.code }}>
                              Site Code
                              {genericHandle(exCw.code, w => setExCw(p => ({ ...p, code: w })))}
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold relative" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.name, width: exCw.name }}>
                              Store Name
                              {genericHandle(exCw.name, w => setExCw(p => ({ ...p, name: w })))}
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold relative" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.uuid, width: exCw.uuid }}>
                              Visit UUID
                              {genericHandle(exCw.uuid, w => setExCw(p => ({ ...p, uuid: w })))}
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold relative" style={{ borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.date, width: exCw.date }}>
                              Date
                              {genericHandle(exCw.date, w => setExCw(p => ({ ...p, date: w })))}
                            </th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold" style={{ borderBottom: GRID_BORDER, minWidth: exCw.action, width: exCw.action }}>
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredExceptions.map((ex, idx) => {
                            const bg = idx % 2 === 0 ? '#ffffff' : '#fffbeb';
                            const rowKey = `${ex.storeCode}-${idx}`;
                            const isSaving = addingRow === rowKey;
                            const isDropdownOpen = openDropdown === rowKey;
                            return (
                              <tr key={`ex-${idx}`}>
                                <td className="px-4 py-1.5 text-xs text-gray-400" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.num }}>{idx + 1}</td>
                                <td className="px-4 py-1.5 text-xs text-gray-700" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.ch }}>{ex.channel}</td>
                                <td className="px-4 py-1.5 text-xs text-gray-700 font-mono" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.code }}>{ex.storeCode}</td>
                                <td className="px-4 py-1.5 text-xs text-gray-700" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.name }}>{ex.storeName}</td>
                                <td className="px-4 py-1.5 text-xs text-gray-500 font-mono" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.uuid }}>{ex.visitUuid}</td>
                                <td className="px-4 py-1.5 text-xs text-gray-700" style={{ backgroundColor: bg, borderRight: GRID_BORDER, borderBottom: GRID_BORDER, minWidth: exCw.date }}>{ex.date}</td>
                                <td className="px-2 py-1.5 text-center" style={{ backgroundColor: bg, borderBottom: GRID_BORDER, minWidth: exCw.action }}>
                                  {isSaving ? (
                                    <span className="inline-block w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        if (isDropdownOpen) { setOpenDropdown(null); return; }
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                        setDropdownPos({ top: rect.bottom + 4, left: rect.left });
                                        setOpenDropdown(rowKey);
                                      }}
                                      className="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors text-xs font-bold"
                                      title="Add to Control File"
                                    >
                                      +
                                    </button>
                                  )}
                                </td>
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

      {/* Add-to-control dropdown portal (rendered outside scroll container) */}
      {openDropdown && (() => {
        const dashIdx = openDropdown.lastIndexOf('-');
        const exIdx = Number(openDropdown.substring(dashIdx + 1));
        const ex = filteredExceptions[exIdx];
        if (!ex) return null;
        return (
          <div
            ref={dropdownRef}
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[180px]"
            style={{ top: dropdownPos.top, left: dropdownPos.left }}
          >
            {(['ACTIVE', 'CLOSED', 'NOT IN CYCLE'] as const).map(st => (
              <button
                key={st}
                type="button"
                onClick={() => addToControl(openDropdown, ex.storeName, ex.storeCode, ex.channel, st)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 text-gray-700"
              >
                {st}
              </button>
            ))}
            <div className="border-t border-gray-100 mt-1 pt-1 px-3 pb-2">
              <p className="text-[10px] font-semibold text-purple-600 mb-1">LINKED (duplicate)</p>
              <input
                type="text"
                value={linkUid}
                onChange={e => setLinkUid(e.target.value)}
                placeholder="Enter UID to link to..."
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-purple-500 mb-1.5"
                onClick={e => e.stopPropagation()}
              />
              <button
                type="button"
                disabled={!linkUid.trim()}
                onClick={() => addToControl(openDropdown, ex.storeName, ex.storeCode, ex.channel, 'LINKED', linkUid.trim())}
                className={`w-full text-left px-2 py-1.5 text-xs rounded font-medium ${linkUid.trim() ? 'bg-purple-50 text-purple-700 hover:bg-purple-100' : 'bg-gray-50 text-gray-400 cursor-not-allowed'}`}
              >
                Add as LINKED
              </button>
            </div>
          </div>
        );
      })()}

      {/* Size warning modal */}
      {sizeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-800">Large file warning</p>
                <p className="text-sm text-gray-500">This report is <strong>{sizeConfirm.sizeMB} MB</strong></p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              You're about to email a file of {sizeConfirm.sizeMB} MB. Large attachments may be slow to deliver or blocked by some mail servers. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSizeConfirm(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { const b64 = sizeConfirm.base64; setSizeConfirm(null); sendEmailReport(b64); }}
                className="px-4 py-2 text-sm text-white bg-[#1B3A6B] rounded-lg hover:bg-[#152f5a] transition-colors font-medium"
              >
                Send anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
