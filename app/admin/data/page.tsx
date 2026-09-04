'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { FormType, ParseResult, VisitRow, LoadedFile } from '@/lib/types';
import { resolveFormType } from '@/lib/formType';

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
  formType?: FormType;
  channels: { name: string; rows: number; added: number; discarded?: boolean }[];
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
  const [formTypeOverride, setFormTypeOverride] = useState<FormType | 'auto'>('auto');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [channelFiles, setChannelFiles] = useState<Record<string, LoadedFile[]>>({});
  const [filesLoading, setFilesLoading] = useState<string | null>(null);
  const [retagging, setRetagging] = useState<string | null>(null);
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
        // Apply form type override if set
        const effectiveFormType = formTypeOverride !== 'auto' ? formTypeOverride : parsed.formType;
        report.formType = effectiveFormType;

        // Signature forms go to a separate API
        if (effectiveFormType === 'signature') {
          try {
            const postRes = await fetch('/api/signatures', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                rows: parsed.rows,
                headers: parsed.headers,
                updatedBy: session?.name ?? 'Unknown',
              }),
            });
            const postJson = await postRes.json();
            if (!postRes.ok) {
              throw new Error(postJson.error ?? 'Signature save failed');
            }
            report.channels.push({
              name: 'Signatures',
              rows: parsed.rows.length,
              added: postJson.imported ?? 0,
            });
          } catch (err) {
            report.error = err instanceof Error ? err.message : 'unknown error';
          }
        } else {
          // 2. Split rows by their actual Channel value (FIX for the multi-channel bug)
          const rowsByChannel = new Map<string, VisitRow[]>();
          for (const row of parsed.rows) {
            const ch = String(row['Channel'] ?? '').trim() || stripExt(file.name);
            if (!rowsByChannel.has(ch)) rowsByChannel.set(ch, []);
            rowsByChannel.get(ch)!.push(row);
          }

          // 3. POST one channel at a time (server merges + dedupes by Visit UUID + formType)
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
              formType: effectiveFormType,
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
                discarded: (postJson.emptied?.length ?? 0) > 0,
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

  // ─── Per-channel file list + form-type retag ───────────────────────────────
  // Upload-time detection keys on the filename and on marker headers, and a form
  // carrying neither is filed as Merch — its columns then appear on the merch
  // grid. Re-uploading to correct that needs the original Excel, so the tag is
  // editable here instead.
  const toggleChannelFiles = useCallback(async (channel: string) => {
    setExpanded(prev => (prev === channel ? null : channel));
    if (channelFiles[channel]) return; // already fetched
    setFilesLoading(channel);
    try {
      const res = await fetch(`/api/sp-cache?channel=${encodeURIComponent(channel)}`, { cache: 'no-store' });
      const data = await res.json() as { files?: LoadedFile[] };
      setChannelFiles(prev => ({ ...prev, [channel]: data?.files ?? [] }));
    } catch {
      setChannelFiles(prev => ({ ...prev, [channel]: [] }));
    } finally {
      setFilesLoading(null);
    }
  }, [channelFiles]);

  const retagFile = useCallback(async (channel: string, name: string, formType: FormType) => {
    setRetagging(`${channel}|${name}`);
    try {
      const res = await fetch('/api/sp-cache', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, name, formType, updatedBy: session?.name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Could not change the form type: ${json.error ?? res.statusText}`);
        return;
      }
      setChannelFiles(prev => ({
        ...prev,
        [channel]: (prev[channel] ?? []).map(f =>
          f.name === name ? { ...f, formType, formTypeSource: 'manual' as const } : f
        ),
      }));
      await refreshIndex();
    } catch (err) {
      alert(`Could not change the form type: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setRetagging(null);
    }
  }, [session, refreshIndex]);

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

        {/* Form type selector */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-3">
            <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">Form Type:</label>
            <select
              value={formTypeOverride}
              onChange={e => setFormTypeOverride(e.target.value as FormType | 'auto')}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30 focus:border-[#1B3A6B]"
            >
              <option value="auto">Auto-detect</option>
              <option value="merch">Merch Form</option>
              <option value="stock-count">Stock Count Form</option>
              <option value="stand">Stand Form</option>
              <option value="signature">Signature Form</option>
            </select>
            {formTypeOverride !== 'auto' && (
              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                Override active — will treat uploads as {FORM_TYPE_LABELS[formTypeOverride]}
              </span>
            )}
          </div>
        </div>

        {/* Upload zone */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">Upload Perigee Excel exports</p>
            <p className="text-xs text-gray-400 mt-0.5">Files are split per channel automatically — multi-channel files are supported.</p>
            <div className="mt-2 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-blue-700">
                <span className="font-semibold">No need to download images to SharePoint.</span>{' '}
                Just upload the raw Perigee Excel export — form images will load directly from Perigee.
              </p>
            </div>
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
                  <p className="text-sm font-semibold text-gray-800">
                    {r.fileName}
                    {r.formType && (
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        ({FORM_TYPE_LABELS[r.formType]})
                      </span>
                    )}
                  </p>
                  {r.error && <p className="text-xs text-red-600 mt-1">{r.error}</p>}
                  {r.channels.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {r.channels.map((c, j) => (
                        <li key={j} className="text-xs text-gray-600 flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-[#1B3A6B]" />
                          <span className="font-medium text-gray-800">{c.name}</span>
                          {c.discarded ? (
                            <span className="text-amber-700 font-medium">
                              — {c.rows} row{c.rows !== 1 ? 's' : ''} parsed, NOTHING STORED. Every row is already held under this form type, so the file was not saved. Check the form type selector above (a count sheet filed as Merch collides with the weekly raw export).
                            </span>
                          ) : (
                            <span className="text-gray-400">— {c.rows} row{c.rows !== 1 ? 's' : ''} parsed, {c.added} new{c.rows !== c.added ? `, ${c.rows - c.added} already held` : ''}</span>
                          )}
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
                  <Fragment key={i}>
                    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800">
                        <button
                          type="button"
                          onClick={() => toggleChannelFiles(ch.name)}
                          className="flex items-center gap-1.5 hover:text-[#1B3A6B] transition-colors"
                          aria-expanded={expanded === ch.name}
                        >
                          <span className="text-gray-400 text-[10px] w-2">{expanded === ch.name ? '▼' : '▶'}</span>
                          {ch.name}
                        </button>
                      </td>
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
                    {expanded === ch.name && (
                      <tr className="border-b border-gray-50">
                        <td colSpan={4} className="px-4 py-3 bg-gray-50/60">
                          {filesLoading === ch.name ? (
                            <p className="text-xs text-gray-400 py-2">Loading files…</p>
                          ) : !channelFiles[ch.name]?.length ? (
                            <p className="text-xs text-gray-400 py-2">No files stored for this channel.</p>
                          ) : (
                            <>
                              <p className="text-[11px] text-gray-500 mb-2">
                                Form type decides which grid a file&apos;s columns appear on. Change it here if a
                                file was filed under the wrong form — the change applies immediately, no re-upload.
                              </p>
                              <div className="space-y-1.5">
                                {channelFiles[ch.name].map(f => (
                                  <div key={f.name} className="flex items-center gap-3 text-xs">
                                    <span className="flex-1 truncate text-gray-700" title={f.name}>{f.name}</span>
                                    <span className="text-gray-400 tabular-nums w-20 text-right">
                                      {f.rowCount.toLocaleString()} rows
                                    </span>
                                    <select
                                      value={resolveFormType(f)}
                                      disabled={retagging === `${ch.name}|${f.name}`}
                                      onChange={e => retagFile(ch.name, f.name, e.target.value as FormType)}
                                      className="px-2 py-1 border border-gray-300 rounded bg-white text-xs focus:outline-none focus:border-[#1B3A6B] disabled:opacity-50"
                                    >
                                      {(Object.keys(FORM_TYPE_LABELS) as FormType[]).map(ft => (
                                        <option key={ft} value={ft}>{FORM_TYPE_LABELS[ft]}</option>
                                      ))}
                                    </select>
                                    {/* Say so when the stored tag was overridden, rather than
                                        quietly showing a type the file isn't actually saved as. */}
                                    <span
                                      className={`w-20 text-[10px] ${
                                        resolveFormType(f) !== (f.formType ?? 'merch')
                                          ? 'text-amber-600' : 'text-gray-400'
                                      }`}
                                      title={
                                        resolveFormType(f) !== (f.formType ?? 'merch')
                                          ? `Stored as ${FORM_TYPE_LABELS[f.formType ?? 'merch']}; reclassified from the file's own content. Pick a type here to make it stick.`
                                          : undefined
                                      }
                                    >
                                      {retagging === `${ch.name}|${f.name}`
                                        ? 'Saving…'
                                        : f.formTypeSource === 'manual' ? 'set'
                                        : resolveFormType(f) !== (f.formType ?? 'merch') ? 'auto-fixed'
                                        : 'auto'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
