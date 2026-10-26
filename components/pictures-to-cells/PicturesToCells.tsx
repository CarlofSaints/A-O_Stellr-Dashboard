'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Photo, Thumb } from './core';
import type { LogEntry } from './server';

// Chrome/Edge folder access. Not in TypeScript's DOM lib yet.
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
};
declare global {
  interface Window { showDirectoryPicker?: (o?: { mode?: 'readwrite'; id?: string }) => Promise<DirHandle> }
}

// The chosen folder is remembered per browser in IndexedDB (a folder handle can't go in localStorage).
function idb<T>(fn: (s: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode = 'readonly'): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('pictures-to-cells', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction('kv', mode).objectStore('kv'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | ArrayBuffer) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(data);
  await w.close();
}

/** Downscale a photo to fit the cell (2x for sharpness) so the workbook stays small. */
async function thumb(blob: Blob, box: { w: number; h: number }): Promise<Thumb> {
  const img = await createImageBitmap(blob);
  // Canvas is the cell's shape, photo centred on white: the picture covers the whole cell
  // (and the link text under it) without stretching or cropping the photo.
  const canvas = document.createElement('canvas');
  canvas.width = box.w * 2;
  canvas.height = box.h * 2;
  const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // also stops a transparent PNG going black as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  img.close();
  const out = await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('resize failed'))), 'image/jpeg', 0.85));
  return { buffer: await out.arrayBuffer(), width: canvas.width, height: canvas.height };
}

type Mode = 'folder' | 'excel';

/**
 * Pictures to Cells. `imageUrl` turns a Field Goose link into one this app can fetch
 * (FG sends no CORS headers, so it must go through the app's own image proxy).
 * `logApi` is the route mounting server.ts's logRoute; `access` must match that app's Blob store;
 * `headers` carries the app's sign-in to it.
 */
export default function PicturesToCells({ imageUrl, logApi, access = 'private', headers = () => ({}), accent = '#1B3A6B' }: {
  imageUrl: (url: string) => string;
  logApi: string;
  access?: 'public' | 'private';
  headers?: () => Record<string, string>;
  accent?: string;
}) {
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [logError, setLogError] = useState('');
  // Pages pass a fresh function each render; a ref keeps loadLog from re-running every render.
  const headersRef = useRef(headers);
  headersRef.current = headers;

  const loadLog = useCallback(async () => {
    try {
      const res = await fetch(logApi, { headers: headersRef.current(), cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLog(await res.json());
      setLogError('');
    } catch (e) {
      setLogError(`Could not load the log (${e instanceof Error ? e.message : e}).`);
    }
  }, [logApi]);

  useEffect(() => { loadLog(); }, [loadLog]);

  async function downloadExcel(entry: LogEntry) {
    try {
      const res = await fetch(`${logApi}?file=${encodeURIComponent(entry.excelPath!)}`, { headers: headersRef.current() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = entry.excelName || 'pictures.xlsx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) {
      setLogError(`Could not download that file (${e instanceof Error ? e.message : e}).`);
    }
  }

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>('excel');
  const [rowHeight, setRowHeight] = useState(100);
  const [colWidth, setColWidth] = useState(30);
  const [dir, setDir] = useState<DirHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<Photo[]>([]);
  const [dragging, setDragging] = useState(false);
  const supported = typeof window !== 'undefined' && !!window.showDirectoryPicker;

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { setError('That is not an Excel (.xlsx) file.'); return; }
    setError(''); setStatus(''); setFailed([]);
    setFile(f);
  }

  useEffect(() => {
    idb<DirHandle | undefined>(s => s.get('dir')).then(h => h && setDir(h)).catch(() => {});
  }, []);

  async function chooseFolder() {
    try {
      const h = await window.showDirectoryPicker!({ mode: 'readwrite', id: 'pictures-to-cells' });
      setDir(h);
      await idb(s => s.put(h, 'dir'), 'readwrite').catch(() => {});
    } catch { /* picker cancelled */ }
  }

  async function run() {
    if (!file || !dir) return;
    setError(''); setFailed([]);
    // Must be asked first, while the click still counts as the user's gesture.
    if ((await dir.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
        (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      setError('The browser was not allowed to save into that folder. Click Run again and choose Allow.');
      return;
    }
    setBusy(true);
    try {
      const [{ default: ExcelJS }, core] = await Promise.all([import('exceljs'), import('./core')]);
      setStatus('Reading the file…');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      const p = core.plan(ws);
      if (!p.photos.length) throw new Error('No Field Goose photo links found in this file.');
      const out = await dir.getDirectoryHandle(p.folderName, { create: true });
      // Excel caps row height at 409 pt and column width at 255.
      const sizes = { rowHeight: Math.min(409, Math.max(20, rowHeight || 100)), colWidth: Math.min(255, Math.max(5, colWidth || 30)) };
      const box = core.cellPx(sizes);

      const thumbs = new Map<Photo, Thumb>();
      const bad: Photo[] = [];
      let done = 0;
      const queue = [...p.photos];
      // 4 at a time: fast enough, and gentle on the proxy.
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let photo = queue.shift(); photo; photo = queue.shift()) {
          try {
            const res = await fetch(imageUrl(photo.url));
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            if (!blob.type.startsWith('image/')) throw new Error('not a picture');
            await writeFile(out, photo.fileName, blob);
            if (mode === 'excel') thumbs.set(photo, await thumb(blob, box));
          } catch {
            bad.push(photo);
          }
          setStatus(`Saving pictures… ${++done} of ${p.photos.length}`);
        }
      }));

      let excelName = '';
      let excelBuf: ArrayBuffer | null = null;
      if (mode === 'excel') {
        setStatus('Building the Excel file…');
        core.buildWorkbook(wb, ws, p, thumbs, sizes);
        excelName = `${file.name.replace(/\.xlsx$/i, '')} - pictures.xlsx`;
        excelBuf = await wb.xlsx.writeBuffer() as ArrayBuffer;
        await writeFile(out, excelName, excelBuf);
      }
      setFailed(bad);
      // The browser only knows the chosen folder's name, not its full path on the PC.
      const path = `${dir.name}\\${p.folderName}`;
      const saved = p.photos.length - bad.length;
      const summary = `Done. ${saved} of ${p.photos.length} pictures saved to "${path}"` + (excelName ? `, with "${excelName}".` : '.');

      // Log the run. The files are already saved, so a log failure is reported, never thrown.
      setStatus(excelBuf ? 'Saving a copy of the Excel file for the log…' : 'Logging the run…');
      try {
        let excelPath = '';
        if (excelBuf) {
          const { upload } = await import('@vercel/blob/client');
          const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          excelPath = (await upload(`pictures-to-cells/files/${excelName}`, new Blob([excelBuf], { type: xlsx }), {
            access, contentType: xlsx, handleUploadUrl: logApi, headers: headersRef.current(),
          })).pathname;
        }
        const res = await fetch(logApi, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headersRef.current() },
          body: JSON.stringify({ mode, path, photos: p.photos.length, saved, excelPath, excelName }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus(summary);
        loadLog();
      } catch (e) {
        setStatus(summary);
        setError(`The files are saved, but the run could not be logged (${e instanceof Error ? e.message : e}).`);
      }
    } catch (e) {
      setStatus('');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const input = 'border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2';

  return (
    <div className="space-y-6">
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5 max-w-3xl">
      <div>
        <h2 className="text-lg font-bold" style={{ color: accent }}>Pictures to Cells</h2>
        <p className="text-sm text-gray-500">Load a Field Goose export. Every photo is saved to your folder, and can be put into the Excel file as a picture you can click to open in Field Goose.</p>
      </div>

      {!supported && (
        <p className="text-sm text-red-600">This needs Google Chrome or Microsoft Edge (other browsers can&apos;t save into a folder).</p>
      )}

      <div>
        <span className="block text-xs font-medium text-gray-500 mb-1">1. Field Goose Excel export</span>
        <label
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files[0]); }}
          className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded-xl px-4 py-8 text-center cursor-pointer transition-colors ${dragging ? 'bg-blue-50 border-blue-400' : 'border-gray-300 hover:bg-gray-50'}`}
        >
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6h.1a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {file
            ? <span className="text-sm font-semibold" style={{ color: accent }}>{file.name} <span className="font-normal text-gray-400">(click or drop to change)</span></span>
            : <span className="text-sm text-gray-600"><span className="font-semibold" style={{ color: accent }}>Click to choose</span> or drag and drop the Excel file here</span>}
          <input type="file" accept=".xlsx" onChange={e => pickFile(e.target.files?.[0])} className="sr-only" />
        </label>
      </div>

      <div>
        <span className="block text-xs font-medium text-gray-500 mb-1">2. Save into this folder (remembered for next time). Works in Google Chrome or Microsoft Edge only.</span>
        <div className="flex gap-2">
          <input readOnly value={dir?.name ?? ''} placeholder="No folder chosen" className={`${input} flex-1`} />
          <button type="button" onClick={chooseFolder} disabled={!supported || busy}
            className="px-4 py-2 rounded-lg text-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
            {dir ? 'Change folder' : 'Choose folder'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">For SharePoint, choose the SharePoint folder that is synced to your PC (it shows in File Explorer under your company name).</p>
      </div>

      <div className="flex gap-4">
        <label>
          <span className="block text-xs font-medium text-gray-500 mb-1">Row height</span>
          <input type="number" min={20} max={409} value={rowHeight || ''} onChange={e => setRowHeight(Number(e.target.value))} className={`${input} w-28`} />
        </label>
        <label>
          <span className="block text-xs font-medium text-gray-500 mb-1">Column width</span>
          <input type="number" min={5} max={255} value={colWidth || ''} onChange={e => setColWidth(Number(e.target.value))} className={`${input} w-28`} />
        </label>
      </div>

      <div className="flex gap-2">
        <select value={mode} onChange={e => setMode(e.target.value as Mode)} disabled={busy} className={input}>
          <option value="excel">Save pictures and add to Excel file</option>
          <option value="folder">Save pictures to folder only</option>
        </select>
        <button type="button" onClick={run} disabled={!file || !dir || busy}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
          {busy ? 'Working…' : 'Put pictures into cells'}
        </button>
      </div>

      {status && <p className="text-sm text-gray-700">{status}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {failed.length > 0 && (
        <div className="text-sm text-amber-700">
          <p>{failed.length} picture(s) could not be downloaded. Their links stay in the Excel file:</p>
          <ul className="list-disc ml-5">{failed.map(f => <li key={f.fileName}>{f.fileName}</li>)}</ul>
        </div>
      )}
    </div>

    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-3">
      <h2 className="text-base font-bold" style={{ color: accent }}>Log</h2>
      {logError && <p className="text-sm text-red-600">{logError}</p>}
      {log === null && !logError && <p className="text-sm text-gray-400">Loading…</p>}
      {log?.length === 0 && <p className="text-sm text-gray-400">No runs yet.</p>}
      {!!log?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Downloaded</th>
                <th className="py-2 pr-4 font-medium">Path</th>
                <th className="py-2 font-medium">Excel file</th>
              </tr>
            </thead>
            <tbody>
              {log.map(e => (
                <tr key={e.at + e.user} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{new Date(e.at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className="py-2 pr-4">{e.user}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {e.mode === 'excel' ? 'Images and Excel' : 'Images only'}
                    <span className="text-gray-400"> ({e.saved} of {e.photos})</span>
                  </td>
                  <td className="py-2 pr-4 break-all">{e.path}</td>
                  <td className="py-2">
                    {e.excelPath
                      ? <button type="button" onClick={() => downloadExcel(e)} className="font-semibold underline" style={{ color: accent }}>Download</button>
                      : <span className="text-gray-400">None</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </div>
  );
}
