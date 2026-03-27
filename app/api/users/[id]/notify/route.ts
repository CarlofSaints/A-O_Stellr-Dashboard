import { NextRequest, NextResponse } from 'next/server';
import { loadUsers } from '@/lib/userData';
import { sendLoginReminderEmail } from '@/lib/email';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const users = loadUsers();
    const user  = users.find(u => u.id === id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    await sendLoginReminderEmail(user.email, user.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[notify]', e);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
