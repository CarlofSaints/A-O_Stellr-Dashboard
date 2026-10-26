// Self-check: npx tsx components/pictures-to-cells/core.check.ts <export.xlsx> [out.xlsx]
// Plans the file, downloads up to 3 real photos, writes the formatted workbook.
import assert from 'node:assert';
import ExcelJS from 'exceljs';
import { plan, buildWorkbook, isoDate, safeName, photoUrl, type Photo, type Thumb } from './core';

assert.equal(isoDate('2026-10-22'), '2026-10-22');
assert.equal(isoDate('3/9/2026'), '2026-09-03');
assert.equal(safeName('PNP: A/B? '), 'PNP- A-B-');
assert.equal(photoUrl('http://www.fieldgoose.com/system/x'), 'https://www.fieldgoose.com/system/x');
assert.equal(photoUrl('Yes'), null);

(async () => {
  const [src, out] = process.argv.slice(2);
  if (!src) return console.log('helpers ok (pass a file to check the rest)');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(src);
  const ws = wb.worksheets[0];
  const p = plan(ws);
  console.log('folder', p.folderName, '| photos', p.photos.length, '| photo cols', p.photoCols.length);
  console.log(p.photos.slice(0, 3).map(x => x.fileName));
  assert.equal(new Set(p.photos.map(x => x.fileName)).size, p.photos.length, 'file names must be unique');

  const thumbs = new Map<Photo, Thumb>();
  for (const photo of p.photos.slice(0, 3)) {
    const res = await fetch(photo.url);
    assert.ok(res.ok, `download ${res.status}`);
    thumbs.set(photo, { buffer: await res.arrayBuffer(), width: 4, height: 3 });
  }
  buildWorkbook(wb, ws, p, thumbs, { rowHeight: 100, colWidth: 30 });
  if (out) { await wb.xlsx.writeFile(out); console.log('wrote', out); }
})();
