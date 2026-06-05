import { readJson, writeJson } from './blob';
import type { SignatureRecord, VisitRow } from './types';

const BLOB_KEY = 'dashboard-signatures.json';

/** Headers that contain "Which forms did you complete?" data */
function isFormNameHeader(h: string): boolean {
  return /which forms did you complete/i.test(h);
}

/** Parse signature records from raw Excel rows + headers */
export function parseSignatureRows(
  rows: VisitRow[],
  headers: string[],
): SignatureRecord[] {
  // Find key column indices by header name (case-insensitive)
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  const visitUuidIdx = lowerHeaders.findIndex(h => h === 'visit uuid');
  const managerIdx = lowerHeaders.findIndex(h => h === "manager's name and surname");
  const signatureIdx = lowerHeaders.findIndex(h => h === 'signature');
  const storeIdx = lowerHeaders.findIndex(h =>
    h === 'store name' || h === 'store' || h === 'customer',
  );
  const storeCodeIdx = lowerHeaders.findIndex(h =>
    h === 'store code' || h === 'storecode',
  );
  const channelIdx = lowerHeaders.findIndex(h => h === 'channel');
  const dateIdx = lowerHeaders.findIndex(h => /date/i.test(h));
  const repIdx = lowerHeaders.findIndex(h =>
    h === 'first name' || h === 'email',
  );
  const lastNameIdx = lowerHeaders.findIndex(h => h === 'last name');

  // Indices of all "Which forms did you complete?" columns
  const formNameIndices = headers
    .map((h, i) => (isFormNameHeader(h) ? i : -1))
    .filter(i => i >= 0);

  if (visitUuidIdx < 0 || managerIdx < 0 || signatureIdx < 0) {
    return [];
  }

  const records: SignatureRecord[] = [];

  for (const row of rows) {
    const visitUuid = String(row[headers[visitUuidIdx]] ?? '').trim();
    const managerName = String(row[headers[managerIdx]] ?? '').trim();
    const signatureUrl = String(row[headers[signatureIdx]] ?? '').trim();

    if (!visitUuid || !managerName) continue;

    // Collect form names from all "Which forms" columns, split on pipe
    const formNames: string[] = [];
    for (const idx of formNameIndices) {
      const val = String(row[headers[idx]] ?? '').trim();
      if (val) {
        for (const name of val.split('|')) {
          const trimmed = name.trim();
          if (trimmed && !formNames.includes(trimmed)) {
            formNames.push(trimmed);
          }
        }
      }
    }

    const firstName = repIdx >= 0 ? String(row[headers[repIdx]] ?? '').trim() : '';
    const lastName = lastNameIdx >= 0 ? String(row[headers[lastNameIdx]] ?? '').trim() : '';
    const rep = [firstName, lastName].filter(Boolean).join(' ');

    records.push({
      visitUuid,
      managerName,
      signatureUrl,
      formNames,
      store: storeIdx >= 0 ? String(row[headers[storeIdx]] ?? '').trim() : '',
      storeCode: storeCodeIdx >= 0 ? String(row[headers[storeCodeIdx]] ?? '').trim() : '',
      channel: channelIdx >= 0 ? String(row[headers[channelIdx]] ?? '').trim() : '',
      date: dateIdx >= 0 ? String(row[headers[dateIdx]] ?? '').trim() : '',
      rep,
    });
  }

  return records;
}

/** Load all signature records from blob storage */
export async function loadSignatures(): Promise<SignatureRecord[]> {
  return readJson<SignatureRecord[]>(BLOB_KEY, []);
}

/** Save signature records to blob storage */
export async function saveSignatures(records: SignatureRecord[]): Promise<void> {
  await writeJson(BLOB_KEY, records);
}

/** Merge incoming signatures with existing ones. Incoming wins on duplicate visitUuid. */
export function mergeSignatures(
  existing: SignatureRecord[],
  incoming: SignatureRecord[],
): SignatureRecord[] {
  const map = new Map<string, SignatureRecord>();
  for (const rec of existing) {
    map.set(rec.visitUuid, rec);
  }
  for (const rec of incoming) {
    map.set(rec.visitUuid, rec);
  }
  return Array.from(map.values());
}
