'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import type { FormType, VisitRow, LoadedFile, SignatureRecord } from '@/lib/types';

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
  formTypes?: FormType[];
}

interface IndexPayload {
  updatedAt: string;
  updatedBy: string;
  channels: ChannelSummary[];
}

interface ChannelData {
  files: LoadedFile[];
}

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
  return 'Unknown';
}

export default function PdfDownloadPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  // Data state
  const [channels, setChannels] = useState<string[]>([]);
  const [allFiles, setAllFiles] = useState<LoadedFile[]>([]);
  const [signatures, setSignatures] = useState<SignatureRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [selChannel, setSelChannel] = useState('');
  const [selFormName, setSelFormName] = useState('');
  const [selStore, setSelStore] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // PDF generation state
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('ao_session');
    if (!raw) { router.replace('/login'); return; }
    setSession(JSON.parse(raw));
  }, [router]);

  // Load data on mount
  useEffect(() => {
    if (!session) return;
    setLoading(true);

    Promise.all([
      fetch('/api/sp-cache', { cache: 'no-store' })
        .then(r => r.json())
        .then(async (data: IndexPayload | null) => {
          if (!data?.channels?.length) return;
          const channelNames = data.channels.map(c => c.name);
          setChannels(channelNames);

          // Load all channel data
          const results = await Promise.all(
            channelNames.map(ch =>
              fetch(`/api/sp-cache?channel=${encodeURIComponent(ch)}`, { cache: 'no-store' })
                .then(r => r.json() as Promise<ChannelData>)
                .catch(() => ({ files: [] } as ChannelData))
            )
          );
          setAllFiles(results.flatMap(r => r?.files ?? []));
        })
        .catch(() => {}),
      fetch('/api/signatures', { cache: 'no-store' })
        .then(r => r.json())
        .then((sigs: SignatureRecord[]) => {
          if (Array.isArray(sigs)) setSignatures(sigs);
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [session]);

  // All rows with signature injection
  const allRows = useMemo(() => {
    const rows: VisitRow[] = [];
    const sigMap = new Map(signatures.map(s => [s.visitUuid, s]));

    for (const file of allFiles) {
      for (const row of file.rows) {
        const enriched: VisitRow = { ...row, _fileName: file.fileName ?? file.name };
        const uuid = String(row['Visit UUID'] ?? '').trim();
        if (uuid) {
          const sig = sigMap.get(uuid);
          if (sig) {
            enriched['Manager Name'] = sig.managerName;
            enriched['Signature'] = sig.signatureUrl;
          }
        }
        rows.push(enriched);
      }
    }
    return rows;
  }, [allFiles, signatures]);

  // Unique form names from signature data
  const formNames = useMemo(() => {
    const names = new Set<string>();
    for (const sig of signatures) {
      for (const fn of sig.formNames) names.add(fn);
    }
    // Also use file names as fallback form identifiers
    for (const f of allFiles) {
      const name = f.name || f.fileName?.replace(/\.[^/.]+$/, '');
      if (name) names.add(name);
    }
    return [...names].sort();
  }, [signatures, allFiles]);

  // Unique stores
  const stores = useMemo(() => {
    const s = new Set<string>();
    for (const row of allRows) {
      const store = String(row['Store Name'] ?? row['Store'] ?? row['Customer'] ?? '').trim();
      if (store) s.add(store);
    }
    return [...s].sort();
  }, [allRows]);

  // Image columns from files
  const imageColumns = useMemo(() => {
    const cols = new Set<string>();
    for (const f of allFiles) {
      for (const ic of f.imageColumns) cols.add(ic);
    }
    return [...cols];
  }, [allFiles]);

  // All headers from files
  const allHeaders = useMemo(() => {
    const h = new Set<string>();
    for (const f of allFiles) {
      for (const hdr of f.headers) h.add(hdr);
    }
    return [...h];
  }, [allFiles]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return allRows.filter(row => {
      // Channel filter
      if (selChannel) {
        const ch = String(row['Channel'] ?? '').trim();
        if (ch !== selChannel) return false;
      }

      // Store filter
      if (selStore) {
        const store = String(row['Store Name'] ?? row['Store'] ?? row['Customer'] ?? '').trim();
        if (store !== selStore) return false;
      }

      // Date filter
      const dateStr = String(row['Date'] ?? '').trim();
      const d = parseDMY(dateStr);
      if (d) {
        if (dateFrom && d < new Date(dateFrom)) return false;
        if (dateTo) {
          const to = new Date(dateTo);
          to.setHours(23, 59, 59, 999);
          if (d > to) return false;
        }
      }

      // Form name filter
      if (selFormName) {
        const uuid = String(row['Visit UUID'] ?? '').trim();
        const sig = signatures.find(s => s.visitUuid === uuid);
        const matchesSignatureForm = sig?.formNames.includes(selFormName);
        const matchesFileName = String(row['_fileName'] ?? '').replace(/\.[^/.]+$/, '') === selFormName;
        if (!matchesSignatureForm && !matchesFileName) return false;
      }

      return true;
    });
  }, [allRows, selChannel, selStore, dateFrom, dateTo, selFormName, signatures]);

  // Generate PDF for a single row
  const generatePdf = useCallback(async (row: VisitRow, rowIndex: number) => {
    const rowId = String(row['Visit UUID'] ?? rowIndex);
    setGenerating(rowId);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 15;
      const contentW = pageW - margin * 2;
      let y = margin;

      // Header
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(27, 58, 107); // #1B3A6B
      doc.text('A&O Interactive Services', margin, y);
      y += 8;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text('Field Survey Report', margin, y);
      y += 3;
      doc.setDrawColor(27, 58, 107);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + contentW, y);
      y += 8;

      // Metadata block
      const store = String(row['Store Name'] ?? row['Store'] ?? row['Customer'] ?? '').trim();
      const channel = String(row['Channel'] ?? '').trim();
      const date = String(row['Date'] ?? '').trim();
      const rep = getRepName(row);
      const province = String(row['Province'] ?? '').trim();

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      const metaFields = [
        ['Store', store],
        ['Channel', channel],
        ['Date', date],
        ['Rep', rep],
        ['Province', province],
      ].filter(([, v]) => v);

      for (const [label, value] of metaFields) {
        doc.setFont('helvetica', 'bold');
        doc.text(`${label}:`, margin, y);
        doc.setFont('helvetica', 'normal');
        doc.text(String(value), margin + 30, y);
        y += 6;
      }
      y += 4;

      // Data fields table
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(27, 58, 107);
      doc.text('Form Data', margin, y);
      y += 6;

      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);

      const skipCols = new Set([
        'id', 'email', 'visit uuid', 'sync date', 'sync time', 'tag',
        'first name', 'last name', 'store code', 'rep name', 'time',
        'customer', 'channel', 'store name', 'store', 'date', 'province',
      ]);

      for (const h of allHeaders) {
        if (skipCols.has(h.toLowerCase())) continue;
        if (imageColumns.includes(h)) continue;
        if (h === 'Manager Name' || h === 'Signature') continue;

        const val = row[h];
        if (val === null || val === undefined || val === '') continue;

        // Check page overflow
        if (y > 270) {
          doc.addPage();
          y = margin;
        }

        doc.setFont('helvetica', 'bold');
        const labelLines = doc.splitTextToSize(h, 55);
        doc.text(labelLines, margin, y);
        doc.setFont('helvetica', 'normal');
        const valLines = doc.splitTextToSize(String(val), contentW - 60);
        doc.text(valLines, margin + 58, y);
        y += Math.max(labelLines.length, valLines.length) * 4 + 2;
      }

      // Photos
      const photoUrls: string[] = [];
      for (const ic of imageColumns) {
        if (ic === 'Signature') continue;
        const val = row[ic];
        if (val && typeof val === 'string' && val.startsWith('https://')) {
          photoUrls.push(val);
        }
      }

      if (photoUrls.length > 0) {
        doc.addPage();
        y = margin;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(27, 58, 107);
        doc.text('Survey Photos', margin, y);
        y += 8;

        for (const photoUrl of photoUrls) {
          try {
            const res = await fetch(`/api/pdf-image?url=${encodeURIComponent(photoUrl)}`);
            if (!res.ok) continue;
            const { base64 } = await res.json();
            if (!base64) continue;

            if (y > 60) {
              doc.addPage();
              y = margin;
            }

            doc.addImage(base64, 'JPEG', margin, y, contentW, 0);
            // Estimate image height (assume roughly 3:4 aspect ratio)
            y += contentW * 0.75 + 8;
          } catch {
            // Skip failed images
          }
        }
      }

      // Signature section
      const managerName = String(row['Manager Name'] ?? '').trim();
      const sigUrl = String(row['Signature'] ?? '').trim();
      if (managerName || sigUrl) {
        doc.addPage();
        y = margin;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(27, 58, 107);
        doc.text('Manager Signature', margin, y);
        y += 8;

        if (managerName) {
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);
          doc.text('Manager Name:', margin, y);
          doc.setFont('helvetica', 'normal');
          doc.text(managerName, margin + 40, y);
          y += 10;
        }

        if (sigUrl && sigUrl.startsWith('https://')) {
          try {
            const res = await fetch(`/api/pdf-image?url=${encodeURIComponent(sigUrl)}`);
            if (res.ok) {
              const { base64 } = await res.json();
              if (base64) {
                doc.addImage(base64, 'JPEG', margin, y, 80, 0);
                y += 50;
              }
            }
          } catch {
            // Skip failed signature image
          }
        }
      }

      // Footer
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Generated from A&O Dashboard on ${new Date().toLocaleDateString('en-ZA')}`,
        margin,
        doc.internal.pageSize.getHeight() - 10,
      );

      // Download
      const fileName = [store, channel, date].filter(Boolean).join(' - ') || 'form-report';
      doc.save(`${fileName}.pdf`);
    } catch (err) {
      console.error('PDF generation error:', err);
      alert(`PDF generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGenerating(null);
    }
  }, [allHeaders, imageColumns]);

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#1B3A6B] text-white px-6 py-4 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Image src="/ao-logo.png" alt="A&O" width={60} height={30} className="object-contain brightness-200" />
            <div>
              <h1 className="text-base font-bold">Download Form PDF</h1>
              <p className="text-blue-200 text-xs">A&O Interactive Services Dashboard</p>
            </div>
          </div>
          <button onClick={() => router.push('/')} className="text-blue-200 hover:text-white text-sm flex items-center gap-1.5 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">Filters</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {/* Form Name */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Form Name</label>
              <select
                value={selFormName}
                onChange={e => setSelFormName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30"
              >
                <option value="">All Forms</option>
                {formNames.map(fn => (
                  <option key={fn} value={fn}>{fn}</option>
                ))}
              </select>
            </div>

            {/* Channel */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Channel</label>
              <select
                value={selChannel}
                onChange={e => setSelChannel(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30"
              >
                <option value="">All Channels</option>
                {channels.map(ch => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            </div>

            {/* Store */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Store</label>
              <select
                value={selStore}
                onChange={e => setSelStore(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30"
              >
                <option value="">All Stores</option>
                {stores.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Date From */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30"
              />
            </div>
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-16 text-center">
            <div className="w-8 h-8 border-2 border-[#1B3A6B] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-500">Loading data...</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-16 text-center">
            <p className="text-sm text-gray-400">No records match your filters. Try adjusting your selection.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">
                {filteredRows.length} record{filteredRows.length !== 1 ? 's' : ''} found
              </p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">#</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Store</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Channel</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Rep</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Date</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Photos</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Signature</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 w-28">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.slice(0, 200).map((row, i) => {
                    const store = String(row['Store Name'] ?? row['Store'] ?? row['Customer'] ?? '').trim();
                    const channel = String(row['Channel'] ?? '').trim();
                    const date = String(row['Date'] ?? '').trim();
                    const rep = getRepName(row);
                    const hasSig = !!(row['Manager Name']);
                    const photoCount = imageColumns.filter(ic =>
                      ic !== 'Signature' && row[ic] && typeof row[ic] === 'string' && String(row[ic]).startsWith('https://')
                    ).length;
                    const rowId = String(row['Visit UUID'] ?? i);

                    return (
                      <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 text-gray-400 tabular-nums text-xs">{i + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800">{store || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{channel || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{rep}</td>
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{date || '—'}</td>
                        <td className="px-4 py-2.5 text-center">
                          {photoCount > 0 ? (
                            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">
                              {photoCount}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {hasSig ? (
                            <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
                              Yes
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => generatePdf(row, i)}
                            disabled={generating !== null}
                            className="text-xs font-semibold text-white bg-[#1B3A6B] px-3 py-1.5 rounded-lg hover:bg-[#152f5a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {generating === rowId ? 'Generating...' : 'Download PDF'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredRows.length > 200 && (
              <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400 text-center">
                Showing first 200 of {filteredRows.length} records. Use filters to narrow results.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
