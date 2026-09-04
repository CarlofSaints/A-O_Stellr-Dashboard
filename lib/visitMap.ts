/**
 * One shared mapper and de-duplicator for Perigee visit rows.
 *
 * The cron poll and the manual import each carried their own copy of
 * `mapPerigeeVisit`, and the copies had drifted: the cron read no `Store Code`
 * field at all and recovered the code by splitting `Store Full Name` on its last
 * " - ", while the manual route read `Store Code` directly and kept the combined
 * name. Same store, two spellings in the same file. Both now call this.
 */

export interface Visit {
  storeCode: string;
  storeName: string;
  channel: string;
  date: string; // YYYY-MM-DD
  visitUuid: string;
  /** Rep who did the visit. Optional: visits stored before this field existed
   *  don't have it, and the de-dupe below is written to cope with that. */
  user?: string;
}

/** Fields observed on a live /api/visits row, 4 Sep 2026:
 *  "Store Name": "GAME VOSLOORUS", "Store Code": "G127",
 *  "Store Full Name": "GAME VOSLOORUS - G127", "store": same as Full Name,
 *  "Channel": "GAME", "startDateFull": "2026-08-27 14:07:11",
 *  "startDate": "27/08" (no year — never use it alone), "Username", "userGuid".
 *  There is no lowercase `storeCode` and no `storeName`. */
export function mapPerigeeVisit(row: Record<string, unknown>): Visit {
  const str = (key: string) => String(row[key] ?? '').trim();

  // Prefer the dedicated code field; fall back to splitting the combined name
  // for any older/other response shape that only carries "NAME - CODE".
  const rawStore = str('store') || str('Store Full Name') || str('storeName') || str('place') || '';
  let storeName = str('Store Name') || rawStore;
  let storeCode = str('Store Code') || str('storeCode') || '';

  if (!storeCode && rawStore.includes(' - ')) {
    const lastDash = rawStore.lastIndexOf(' - ');
    storeName = rawStore.substring(0, lastDash).trim();
    storeCode = rawStore.substring(lastDash + 3).trim();
  }
  // Keep the name clean even when it arrived as "NAME - CODE".
  if (storeCode && storeName.endsWith(` - ${storeCode}`)) {
    storeName = storeName.slice(0, -(storeCode.length + 3)).trim();
  }

  const channel = str('channel') || str('Channel') || '';

  let date = '';
  const startDateFull = str('startDateFull');
  if (startDateFull && startDateFull.includes(' ')) {
    date = startDateFull.split(' ')[0];
  } else {
    date = str('checkInDate') || str('startDate') || str('date') || '';
  }
  const dmyMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (dmyMatch) {
    date = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }

  const visitUuid = str('visitGuid') || str('visitsGuid') || str('guid') || str('visitId') || '';
  const user = str('Username') || str('userGuid') || '';

  return { storeCode, storeName, channel, date, visitUuid, user };
}

/** A visit is worth storing only if we can place it on the grid. */
export function isUsableVisit(v: Visit): boolean {
  return Boolean(v.storeCode && v.date);
}

const norm = (s: string | undefined) => (s ?? '').trim().toUpperCase();

/** Perigee's own identity for the visit. Present on effectively every row. */
function uuidKey(v: Visit): string | null {
  const u = norm(v.visitUuid);
  return u ? `uuid:${u}` : null;
}

/** Fallback identity when a row has no GUID: one visit per store, per day, PER
 *  REP. It used to be store+day alone, which silently threw away every genuine
 *  second visit to a store on the same day — 9,366 stored visits contained not
 *  one store/day pair with a count above 1. */
function compKey(v: Visit): string {
  return `comp:${norm(v.storeCode)}|${v.date}|${norm(v.user)}`;
}

/** Store+day only, used to protect the pre-GUID rows — see selectNewVisits. */
function legacyKey(v: Visit): string {
  return `legacy:${norm(v.storeCode)}|${v.date}`;
}

/**
 * Pick the rows from `incoming` that we don't already hold. Handles duplicates
 * inside the incoming batch too (Perigee repeats a GUID across pages).
 *
 * A GUID decides on its own — two different GUIDs are two different visits,
 * whatever else they share. Only a row with no GUID falls back to
 * store + day + rep.
 */
export function selectNewVisits(existing: Visit[], incoming: Visit[]): Visit[] {
  const uuidSeen = new Set<string>();
  const compSeen = new Set<string>();
  // Rows imported before Perigee GUIDs were captured (58 of them, all
  // 2026-05-26). Re-polling that date returns the same visits, now WITH GUIDs,
  // so the GUID check alone would happily store them a second time. Block an
  // incoming row when a GUID-less row already sits on that store and day.
  const legacySeen = new Set<string>();

  for (const v of existing) {
    const uk = uuidKey(v);
    if (uk) uuidSeen.add(uk);
    else legacySeen.add(legacyKey(v));
    compSeen.add(compKey(v));
  }

  const out: Visit[] = [];
  for (const v of incoming) {
    const uk = uuidKey(v);
    if (uk) {
      if (uuidSeen.has(uk)) continue;
      if (legacySeen.has(legacyKey(v))) continue;
    } else if (compSeen.has(compKey(v))) {
      continue;
    }

    if (uk) uuidSeen.add(uk);
    compSeen.add(compKey(v));
    out.push(v);
  }
  return out;
}
