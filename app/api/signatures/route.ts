import { NextRequest, NextResponse } from 'next/server';
import {
  parseSignatureRows,
  loadSignatures,
  saveSignatures,
  mergeSignatures,
} from '@/lib/signatureData';
import type { VisitRow } from '@/lib/types';

/** GET — return all signature records */
export async function GET() {
  try {
    const records = await loadSignatures();
    return NextResponse.json(records);
  } catch (err) {
    console.error('Signatures GET error:', err);
    return NextResponse.json({ error: 'Failed to load signatures' }, { status: 500 });
  }
}

/** POST — parse incoming rows and merge with existing signatures */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rows, headers, updatedBy } = body as {
      rows: VisitRow[];
      headers: string[];
      updatedBy?: string;
    };

    if (!rows || !headers) {
      return NextResponse.json(
        { error: 'Missing rows or headers' },
        { status: 400 },
      );
    }

    const incoming = parseSignatureRows(rows, headers);
    if (incoming.length === 0) {
      return NextResponse.json(
        { error: 'No valid signature records found in data' },
        { status: 400 },
      );
    }

    const existing = await loadSignatures();
    const merged = mergeSignatures(existing, incoming);
    await saveSignatures(merged);

    return NextResponse.json({
      imported: incoming.length,
      total: merged.length,
      updatedBy: updatedBy ?? 'unknown',
    });
  } catch (err) {
    console.error('Signatures POST error:', err);
    return NextResponse.json({ error: 'Failed to save signatures' }, { status: 500 });
  }
}

/** DELETE — clear all signature data */
export async function DELETE() {
  try {
    await saveSignatures([]);
    return NextResponse.json({ cleared: true });
  } catch (err) {
    console.error('Signatures DELETE error:', err);
    return NextResponse.json({ error: 'Failed to clear signatures' }, { status: 500 });
  }
}
