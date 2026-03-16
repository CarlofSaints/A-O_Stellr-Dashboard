'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { ParseResult, VisitRow } from '@/lib/types';

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
  const [fileData, setFileData] = useState<ParseResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [selChannels, setSelChannels] = useState<string[]>([]);
  const [selProvinces, setSelProvinces] = useState<string[]>([]);
  const [selReps, setSelReps] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const allChannels = useMemo(
    () => unique((fileData?.rows ?? []).map(r => String(r['Channel'] ?? '').trim()).filter(Boolean)),
    [fileData]
  );
  const allProvinces = useMemo(
    () => unique((fileData?.rows ?? []).map(r => String(r['Province'] ?? '').trim()).filter(Boolean)),
    [fileData]
  );
  const allReps = useMemo(
    () => unique((fileData?.rows ?? []).map(r => getRepName(r))),
    [fileData]
  );

  useEffect(() => {
    setSelChannels(allChannels);
    setSelProvinces(allProvinces);
    setSelReps(allReps);
  }, [allChannels, allProvinces, allReps]);

  const filteredRows = useMemo(() => {
    if (!fileData) return [];
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;

    return fileData.rows.filter(row => {
      const channel = String(row['Channel'] ?? '').trim();
      const province = String(row['Province'] ?? '').trim();
      const rep = getRepName(row);

      if (selChannels.length > 0 && selChannels.length < allChannels.length && !selChannels.includes(channel)) return false;
      if (selProvinces.length > 0 && selProvinces.length < allProvinces.length && !selProvinces.includes(province)) return false;
      if (selReps.length > 0 && selReps.length < allReps.length && !selReps.includes(rep)) return false;

      if (fromDate || toDate) {
        const rowDate = parseDMY(String(row['Date'] ?? ''));
        if (rowDate) {
          if (fromDate && rowDate < fromDate) return false;
          if (toDate && rowDate > toDate) return false;
        }
      }
      return true;
    });
  }, [fileData, selChannels, selProvinces, selReps, dateFrom, dateTo, allChannels.length, allProvinces.length, allReps.length]);

  const kpis = useMemo(() => ({
    stores: new Set(filteredRows.map(r => String(r['Store'] ?? '').trim()).filter(Boolean)).size,
    surveys: new Set(filteredRows.map(r => String(r['Visit UUID'] ?? '').trim()).filter(Boolean)).size,
    reps: new Set(filteredRows.map(r => getRepName(r))).size,
    channels: new Set(filteredRows.map(r => String(r['Channel'] ?? '').trim()).filter(Boolean)).size,
    provinces: new Set(filteredRows.map(r => String(r['Province'] ?? '').trim()).filter(Boolean)).size,
  }), [filteredRows]);

  const tableHeaders = useMemo(() => {
    if (!fileData) return [];
    const nonImage = fileData.headers.filter(h => !fileData.imageColumns.includes(h));
    return [...nonImage, ...fileData.imageColumns];
  }, [fileData]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      setError('Please upload an Excel file (.xlsx or .xls)');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/parse', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Parse failed');
      setFileData(json as ParseResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setUploading(false);
    }
  }, []);

  const clearFilters = () => {
    setSelChannels(allChannels);
    setSelProvinces(allProvinces);
    setSelReps(allReps);
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#1B3A6B] text-white px-6 py-4 shadow-md">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-white/15 rounded-lg flex items-center justify-center text-xs font-bold tracking-tight">
              A&O
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight">A&O Interactive Services</h1>
              <p className="text-blue-200 text-xs">Field Survey Dashboard</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-blue-300 text-xs">Powered by</p>
            <p className="text-white text-sm font-semibold">Perigee</p>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6">

        {/* Upload Zone */}
        {!fileData && (
          <div
            className={`border-2 border-dashed rounded-2xl p-16 text-center transition-colors ${
              dragOver ? 'border-[#1B3A6B] bg-blue-50' : 'border-gray-300 bg-white'
            }`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-[#1B3A6B] border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-600 font-medium">Parsing file…</p>
              </div>
            ) : (
              <>
                <div className="text-5xl mb-4">📊</div>
                <p className="text-xl font-semibold text-gray-700 mb-2">Drop your Perigee Excel export here</p>
                <p className="text-gray-400 text-sm mb-6">or click to browse for a .xlsx file</p>
                <label className="cursor-pointer inline-flex items-center gap-2 bg-[#1B3A6B] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#152f5a] transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Choose File
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  />
                </label>
                {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}
              </>
            )}
          </div>
        )}

        {/* Dashboard */}
        {fileData && (
          <>
            {/* Filter Bar */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
              <div className="flex flex-wrap items-end gap-4">
                <MultiSelect label="Channel" items={allChannels} selected={selChannels} onChange={setSelChannels} />
                <MultiSelect label="Province" items={allProvinces} selected={selProvinces} onChange={setSelProvinces} />
                <MultiSelect label="Rep" items={allReps} selected={selReps} onChange={setSelReps} />
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
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={clearFilters}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Clear Filters
                  </button>
                  <button
                    onClick={() => { setFileData(null); setError(null); }}
                    className="px-4 py-2 text-sm text-white bg-[#1B3A6B] rounded-lg hover:bg-[#152f5a] transition-colors"
                  >
                    Upload New File
                  </button>
                </div>
              </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
              <KpiCard label="Stores Visited" value={kpis.stores} icon="🏪" />
              <KpiCard label="Surveys Completed" value={kpis.surveys} icon="📋" />
              <KpiCard label="Reps Active" value={kpis.reps} icon="👤" />
              <KpiCard label="Channels" value={kpis.channels} icon="📡" />
              <KpiCard label="Provinces" value={kpis.provinces} icon="🗺️" />
            </div>

            {/* Data Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">
                  Survey Results
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {filteredRows.length} of {fileData.rows.length} rows
                  </span>
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#1B3A6B] text-white">
                      <th className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap sticky left-0 bg-[#1B3A6B] z-10">#</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">Rep</th>
                      {tableHeaders.map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={tableHeaders.length + 2} className="px-6 py-12 text-center text-gray-400">
                          No results match the current filters
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row, idx) => {
                        const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                        return (
                          <tr key={idx} className={rowBg}>
                            <td className={`px-3 py-2 text-xs text-gray-400 sticky left-0 z-10 ${rowBg}`}>
                              {idx + 1}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-800">
                              {getRepName(row)}
                            </td>
                            {tableHeaders.map(h => {
                              const val = row[h];
                              const isImage = fileData.imageColumns.includes(h);

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
                                <td key={h} className="px-3 py-2 max-w-[180px]">
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

      {/* Lightbox */}
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
