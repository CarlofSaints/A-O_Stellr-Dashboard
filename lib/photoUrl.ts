/** Photo/signature links in exports: old Perigee, or Field Goose since the Oct 2026 move. */
export function isPhotoUrl(val: unknown): val is string {
  return typeof val === 'string' && /^https?:\/\/(live\.perigeeportal\.co\.za|www\.fieldgoose\.com)\//.test(val);
}

/**
 * Field Goose exports differ from Perigee's in two ways every screen trips on:
 * photo links are http:// (the server 301s to https) and dates are YYYY-MM-DD.
 * Rewrite both to the Perigee shapes the app was built on (https://, DD/MM/YYYY).
 */
export function normaliseCell<T>(val: T): T | string {
  if (typeof val !== 'string') return val;
  if (val.startsWith('http://www.fieldgoose.com/')) return 'https://' + val.slice('http://'.length);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : val;
}

/**
 * Heal a file stored before normaliseCell ran at upload: its http links were
 * never recognised as photos, so its photo columns must be re-detected too.
 */
export function normaliseFile<F extends { rows: Record<string, unknown>[]; imageColumns: string[] }>(f: F): F {
  const imageColumns = new Set(f.imageColumns);
  const rows = f.rows.map(r => {
    const out: Record<string, unknown> = {};
    for (const k in r) {
      out[k] = normaliseCell(r[k]);
      if (isPhotoUrl(out[k])) imageColumns.add(k);
    }
    return out;
  });
  return { ...f, rows, imageColumns: [...imageColumns] } as F;
}
