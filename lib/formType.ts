import type { FormType, LoadedFile } from './types';

/** Columns present on every Perigee export regardless of form — not questions. */
export const METADATA_COLS = new Set([
  'id', 'email', 'first name', 'last name', 'customer', 'channel', 'store',
  'store code', 'province', 'date', 'time', 'visit uuid', 'tag', 'sync date',
  'sync time', 'rep name',
]);

/** Share of non-blank question answers that must be numeric to call a file a
 *  count sheet. Observed: gift-card count exports 100%, stand forms ("how many
 *  till poles") 83%, merch forms 0% — so the gap is wide and 0.95 sits in it. */
const NUMERIC_THRESHOLD = 0.95;
/** Below this many question columns there isn't enough signal to reclassify. */
const MIN_COUNT_COLS = 3;
const CLASSIFY_SAMPLE_ROWS = 50;

/** Detect form type from marker headers (files stored before formType existed). */
export function detectFormType(headers: string[]): FormType {
  const set = new Set(headers.map(h => h.toLowerCase().trim()));
  if (set.has('stock on hand')) return 'stock-count';
  if (set.has('display stands identification')) return 'stand';
  return 'merch';
}

/**
 * Resolve a file's form type from its own content rather than trusting the tag.
 *
 * The upload-time detector keys on the filename ("merc count") and on marker
 * headers ("Stock On Hand"), and a count export that has neither lands in
 * 'merch'. Its SKU columns then merge into the merch column list and show up on
 * the merch grid. Content is the reliable signal: a count sheet is nothing but
 * numeric quantity columns and carries no photos, while a merch form is photo
 * and free-text questions.
 *
 * Only ever moves a file INTO 'stock-count', and never touches a tag a human set
 * (formTypeSource === 'manual') or one already claiming a non-merch type.
 *
 * Shared by the dashboard and the Data page so the two never disagree about
 * which grid a file belongs to.
 */
export function resolveFormType(f: LoadedFile): FormType {
  const tagged = f.formType ?? detectFormType(f.headers);
  if (f.formTypeSource === 'manual' || tagged !== 'merch') return tagged;

  const questions = f.headers.filter(h => !METADATA_COLS.has(h.toLowerCase().trim()));
  // Photos mean it is a merchandising form, whatever else it contains.
  if (questions.length < MIN_COUNT_COLS || f.imageColumns.length > 0) return tagged;

  let numeric = 0;
  let total = 0;
  for (const row of f.rows.slice(0, CLASSIFY_SAMPLE_ROWS)) {
    for (const h of questions) {
      const v = row[h];
      if (v === null || v === undefined || v === '') continue;
      total++;
      if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v).trim())) numeric++;
    }
  }
  if (total === 0) return tagged;
  return numeric / total >= NUMERIC_THRESHOLD ? 'stock-count' : tagged;
}
