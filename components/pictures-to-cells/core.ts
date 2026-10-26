/**
 * Pictures to Cells: the pure part (no React, no browser APIs), so it can be
 * checked in Node and copied unchanged into another client's app.
 * Copy the whole `components/pictures-to-cells` folder; it imports nothing from the app.
 */
import type ExcelJS from 'exceljs';

// Own copy rather than the app's lib/photoUrl so the folder stays portable.
const PHOTO_URL = /^https?:\/\/(www\.fieldgoose\.com|live\.perigeeportal\.co\.za)\//;

/** A cell's text, whether it holds a plain string, a hyperlink or rich text. */
export function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('hyperlink' in v && v.hyperlink) return String(v.hyperlink);
    if ('richText' in v) return v.richText.map(t => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
  }
  return String(v).trim();
}

export function photoUrl(v: ExcelJS.CellValue): string | null {
  const s = cellText(v);
  return PHOTO_URL.test(s) ? s.replace(/^http:/, 'https:') : null;
}

/** FG exports dates as 2026-10-22; Perigee and re-saved files as 22/10/2026 or a real date. */
export function isoDate(v: ExcelJS.CellValue): string {
  const s = cellText(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : '';
}

/** Windows refuses \ / : * ? " < > | in file names, and trailing dots or spaces. */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
}

export interface Photo { row: number; col: number; url: string; fileName: string }
export interface Plan { folderName: string; photos: Photo[]; photoCols: number[] }

/** The generic fields every FG form export carries, whatever the questions are. */
const NAME_FIELDS = ['Last Name', 'Customer', 'Channel', 'Store', 'Date'];

export function plan(ws: ExcelJS.Worksheet): Plan {
  const header = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => { if (!header.has(cellText(c.value))) header.set(cellText(c.value), col); });
  const missing = NAME_FIELDS.filter(f => !header.has(f));
  if (missing.length) throw new Error(`This file has no ${missing.join(', ')} column. Use the Field Goose form export as downloaded.`);

  const used = new Map<string, number>();
  const photos: Photo[] = [];
  const photoCols = new Set<number>();
  const dates: string[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const field = (f: string) => cellText(row.getCell(header.get(f)!).value);
    const date = isoDate(row.getCell(header.get('Date')!).value);
    if (date) dates.push(date);
    // Store first so sorting the folder by name groups each store's photos together.
    const base = safeName([field('Store'), field('Last Name'), field('Customer'), field('Channel'), date].join('_'));
    row.eachCell((c, col) => {
      const url = photoUrl(c.value);
      if (!url) return;
      // One visit has many photos under the same name: number them.
      // Keyed lower-case: Windows and SharePoint treat Smith_PNP and smith_PnP as one file.
      const key = base.toLowerCase();
      const n = (used.get(key) ?? 0) + 1;
      used.set(key, n);
      photos.push({ row: r, col, url, fileName: `${base}_${n}.jpg` });
      photoCols.add(col);
    });
  }
  dates.sort();
  return { folderName: dates[0] ?? new Date().toISOString().slice(0, 10), photos, photoCols: [...photoCols] };
}

export interface Thumb { buffer: ArrayBuffer; width: number; height: number }
export interface Sizes { rowHeight: number; colWidth: number }

/** Excel column width (characters) and row height (points) in pixels, at 96 dpi. */
export const cellPx = (s: Sizes) => ({ w: Math.round(s.colWidth * 7 + 5), h: Math.round(s.rowHeight * 4 / 3) });

/** Put each thumb over its cell, link it to the FG photo, then format the sheet. */
export function buildWorkbook(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, p: Plan, thumbs: Map<Photo, Thumb>, sizes: Sizes) {
  const { w, h } = cellPx(sizes);
  const pad = 2;
  for (const col of p.photoCols) ws.getColumn(col).width = sizes.colWidth;
  for (const photo of p.photos) {
    // The link stays in the cell too, so it still works if the picture is deleted.
    ws.getCell(photo.row, photo.col).value = { text: photo.url, hyperlink: photo.url };
    ws.getCell(photo.row, photo.col).font = { color: { argb: 'FFFFFFFF' } }; // hidden behind the picture, no peeking edges
    ws.getRow(photo.row).height = sizes.rowHeight;
    const t = thumbs.get(photo);
    if (!t) continue;
    const scale = Math.min((w - pad * 2) / t.width, (h - pad * 2) / t.height);
    const iw = Math.round(t.width * scale), ih = Math.round(t.height * scale);
    const imageId = wb.addImage({ buffer: t.buffer as ExcelJS.Buffer, extension: 'jpeg' });
    // Native offsets in EMU (9525 per px) to centre it; ExcelJS mis-scales fractional col/row.
    const EMU = 9525;
    ws.addImage(imageId, {
      tl: { nativeCol: photo.col - 1, nativeColOff: Math.round((w - iw) / 2) * EMU, nativeRow: photo.row - 1, nativeRowOff: Math.round((h - ih) / 2) * EMU } as unknown as ExcelJS.Anchor,
      ext: { width: iw, height: ih },
      editAs: 'oneCell',
      hyperlinks: { hyperlink: photo.url, tooltip: 'Open in Field Goose' },
    });
  }

  ws.views = [{ state: 'normal', ...ws.views[0], showGridLines: false } as ExcelJS.WorksheetView];
  const border: Partial<ExcelJS.Borders> = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  const cols = ws.columnCount;
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= cols; c++) ws.getCell(r, c).border = border;
  }
  ws.getRow(1).eachCell({ includeEmpty: true }, c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
  });
}
