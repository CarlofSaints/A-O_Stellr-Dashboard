'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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

export default function AdminDataPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState<IndexPayload | null>(null);
  const router = useRouter();

  useEffect(() => {
    const raw = localStorage.getItem('ao_session');
    if (!raw) { router.replace('/login'); return; }
    const s: Session = JSON.parse(raw);
    if (!s.isAdmin) { router.replace('/'); return; }
    setSession(s);
  }, [router]);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    fetch('/api/sp-cache', { cache: 'no-store' })
      .then(r => r.json())
      .then((data: IndexPayload | null) => {
        if (data?.channels?.length) {
          setIndex(data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

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
            <div className="py-10 text-center text-gray-400 text-sm">No data loaded. Upload data from the dashboard first.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Channel</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Files</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Total Rows</th>
                </tr>
              </thead>
              <tbody>
                {index.channels.map((ch, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{ch.name}</td>
                    <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{ch.fileCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{ch.rowCount.toLocaleString()}</td>
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
