import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { loadUsers, saveUsers } from '@/lib/userData';

// PATCH — edit user or reset password
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  console.log(`[PATCH /api/users/${id}] received`);
  try {
    const body  = await req.json();
    const users = loadUsers();
    const idx   = users.findIndex(u => u.id === id);
    if (idx === -1) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const user = users[idx];

    if (body.name    !== undefined) user.name    = String(body.name).trim();
    if (body.email   !== undefined) user.email   = String(body.email).toLowerCase().trim();
    if (body.isAdmin !== undefined) user.isAdmin = Boolean(body.isAdmin);

    if (body.password) {
      user.password = await bcrypt.hash(body.password, 10);
      if (body.sendEmail) {
        try {
          const { sendPasswordResetEmail } = await import('@/lib/email');
          await sendPasswordResetEmail(user.email, user.name, body.password);
          console.log(`[PATCH] password reset email sent to ${user.email}`);
        } catch (e) {
          console.error('[PATCH] email failed (non-fatal):', e);
        }
      }
    }

    users[idx] = user;
    await saveUsers(users);

    const { password: _p, ...safe } = user;
    console.log(`[PATCH /api/users/${id}] success`);
    return NextResponse.json(safe);
  } catch (e) {
    console.error(`[PATCH /api/users/${id}] error:`, e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE — remove user
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const users  = loadUsers();
  const idx    = users.findIndex(u => u.id === id);
  if (idx === -1) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  users.splice(idx, 1);
  await saveUsers(users);
  return NextResponse.json({ ok: true });
}
