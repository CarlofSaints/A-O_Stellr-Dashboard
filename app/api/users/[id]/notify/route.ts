import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sendLoginReminderEmail } from '@/lib/email';

const USERS_PATH = join(process.cwd(), 'data', 'users.json');

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const users = JSON.parse(readFileSync(USERS_PATH, 'utf-8'));
    const user  = users.find((u: { id: string }) => u.id === id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    await sendLoginReminderEmail(user.email, user.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[notify]', e);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
