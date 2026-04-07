'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { ParseResult, VisitRow, LoadedFile } from '@/lib/types';

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
}

interface IndexPayload {
  updatedAt: string;
  updatedBy: string;
  channels: ChannelSummary[];
}

function stripExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}

interface UploadReport {
  fileName: string;
  channels: { name: string; rows: number; added: number }[];
  error?: string;
}

export default function AdminDataPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState<IndexPayload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [reports, setReports] = useState<UploadReport[]>([]);
  const [resetting, setResetting] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const raw = localStorage.getItem('ao_session');
    if (!raw) { router.replace('/login'); return; }
    const s: Session = JSON.parse(raw);
    if (!s.isAdmin) { router.replace('/'); return; }
    setSession(s);
  }, [router]);

  const refreshIndex = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sp-cache', { cache: 'no-store' });
      const data = await res.json() as IndexPayload | null;
      setIndex(data?.channels?.length ? data : null);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    refreshIndex();
  }, [session, refreshIndex]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f => f.name.match(/\.xlsx?$/i));
    if (fileArray.length === 0) {
      setReports([{ fileName: '(none)', channels: [], error: 'Please upload .xlsx or .xls files' }]);
      return;
    }
    setUploading(true);
    setReports([]);
    const newReports: UploadReport[] = [];

    for (const file of fileArray) {
      const report: UploadReport = { fileName: file.name, channels: [] };
      try {
        // 1. Parse file
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/parse', { method: 'POST', body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Parse failed');
        const parsed = json as ParseResult;

        // 2. Split rows by their actual Channel value (FIX for the multi-channel bug)
        const rowsByChannel = new Map<string, VisitRow[]>();
        for (const row of parsed.rows) {
          const ch = String(row['Channel'] ?? '').trim() || stripExt(file.name);
          if (!rowsByChannel.has(ch)) rowsByChannel.set(ch, []);
          rowsByChannel.get(ch)!.push(row);
        }

        // 3. POST one channel at a time (server merges + dedupes by Visit UUID)
        for (const [channel, rows] of rowsByChannel) {
          const loadedFile: LoadedFile = {
            name: stripExt(file.name),
            fileName: file.name,
            rowCount: rows.length,
            headers: parsed.headers,
            imageColumns: parsed.imageColumns,
            rows,
            imageFolderName: parsed.imageFolderName ?? '',
            uploadedAt: new Date().toISOString(),
            uploadedBy: session?.name ?? 'Unknown',
            channel,
          };

          try {
            const postRes = await fetch('/api/sp-cache', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                updatedBy: session?.name ?? 'Unknown',
                channel,
                files: [loadedFile],
              }),
            });
            const postJson = await postRes.json();
            if (!postRes.ok) {
              throw new Error(postJson.error ?? 'Cache save failed');
            }
            report.channels.push({
              name: channel,
              rows: rows.length,
              added: postJson.added ?? 0,
            });
          } catch (err) {
            report.channels.push({
              name: channel,
              rows: rows.length,
              added: 0,
            });
            report.error = (report.error ? report.error + '; ' : '') + `${channel}: ${err instanceof Error ? err.message : 'unknown error'}`;
          }
        }
      } catch (e) {
        report.error = e instanceof Error ? e.message : 'Unknown error';
      }
      newReports.push(report);
    }

    setReports(newReports);
    setUploading(false);
    await refreshIndex();
  }, [session, refreshIndex]);

  const resetChannel = useCallback(async (channel: string) => {
    if (!confirm(`Reset "${channel}"? This will permanently delete all cached data for this channel. The raw Excel files are not affected.`)) return;
    setResetting(channel);
    try {
      const res = await fetch(`/api/sp-cache?channel=${encodeURIComponent(channel)}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(`Reset failed: ${json.error ?? res.statusText}`);
      }
      await refreshIndex();
    } catch (err) {
      alert(`Reset failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setResetting(null);
    }
  }, [refreshIndex]);

  const totalFiles = index?.channels.reduce((s, c) => s + c.fileCount, 0) ?? 0;
  const totalRows  = index?.channels.reduce((s, c) => s + c.rowCount, 0) ?? 0;

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#1B3A6B] text-white px-6 py-4 shadow-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold">Loaded Data</h1>
            <p className="text-blue-200 text-xs">A&O Interactive Services Dashboard</p>
          </div>
          <button onClick={() => router.push('/')} className="text-blue-200 hover:text-white text-sm flex items-center gap-1.5 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Upload zone */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">Upload Perigee Excel exports</p>
            <p className="text-xs text-gray-400 mt-0.5">Files are split per channel automatically — multi-channel files are supported.</p>
          </div>
          <div
            className={`p-12 text-center transition-colors ${dragOver ? 'bg-blue-50' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-[#1B3A6B] border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-600 font-medium">Parsing &amp; uploading…</p>
              </div>
            ) : (
              <>
                <div className="text-4xl mb-3">📊</div>
                <p className="text-base font-semibold text-gray-700 mb-1">Drop Excel files here</p>
                <p className="text-gray-400 text-xs mb-4">or click to browse for .xlsx files</p>
                <label className="cursor-pointer inline-flex items-center gap-2 bg-[#1B3A6B] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#152f5a] transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Choose Files
                  <input type="file" accept=".xlsx,.xls" multiple className="hidden"
                    onChange={e => { if (e.target.files) handleFiles(e.target.files); }} />
                </label>
              </>
            )}
          </div>
        </div>

        {/* Upload report */}
        {reports.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-700">Last upload</p>
            </div>
            <div className="divide-y divide-gray-100">
              {reports.map((r, i) => (
                <div key={i} className="px-4 py-3">
                  <p className="text-sm font-semibold text-gray-800">{r.fileName}</p>
                  {r.error && <p className="text-xs text-red-600 mt-1">{r.error}</p>}
                  {r.channels.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {r.channels.map((c, j) => (
                        <li key={j} className="text-xs text-gray-600 flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-[#1B3A6B]" />
                          <span className="font-medium text-gray-800">{c.name}</span>
                          <span className="text-gray-400">— {c.rows} row{c.rows !== 1 ? 's' : ''} parsed, {c.added} new (rest were duplicates)</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cache info */}
        {index && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <p className="text-sm text-gray-600">
              Last updated{' '}
              <span className="font-semibold text-gray-800">
                {new Date(index.updatedAt).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              {' '}by{' '}
              <span className="font-semibold text-gray-800">{index.updatedBy}</span>
            </p>
          </div>
        )}

        {/* Channels summary table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">
              Channels
              <span className="ml-2 text-xs font-normal text-gray-400">
                {index?.channels.length ?? 0} channel{(index?.channels.length ?? 0) !== 1 ? 's' : ''}
                {' '}&middot;{' '}
                {totalFiles.toLocaleString()} file{totalFiles !== 1 ? 's' : ''}
                {' '}&middot;{' '}
                {totalRows.toLocaleString()} total rows
              </span>
            </p>
          </div>
          {loading ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading...</div>
          ) : !index?.channels?.length ? (
            <div className="py-10 text-center text-gray-400 text-sm">No data loaded. Upload some Excel files above to get started.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Channel</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Files</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Total Rows</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 w-24">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {index.channels.map((ch, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{ch.name}</td>
                    <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{ch.fileCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{ch.rowCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => resetChannel(ch.name)}
                        disabled={resetting === ch.name}
                        className="text-xs text-red-500 border border-red-200 px-2 py-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {resetting === ch.name ? 'Resetting…' : 'Reset'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
