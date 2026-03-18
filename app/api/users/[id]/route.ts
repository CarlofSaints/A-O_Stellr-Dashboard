import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sendPasswordResetEmail } from '@/lib/email';

interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  isAdmin: boolean;
}

const USERS_PATH = join(process.cwd(), 'data', 'users.json');

function getUsers(): User[] {
  try {
    return JSON.parse(readFileSync(USERS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

// PATCH — edit user or reset password
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body  = await req.json();
    const users = getUsers();
    const idx   = users.findIndex(u => u.id === id);
    if (idx === -1) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const user = users[idx];

    if (body.name  !== undefined) user.name    = String(body.name).trim();
    if (body.email !== undefined) user.email   = String(body.email).toLowerCase().trim();
    if (body.isAdmin !== undefined) user.isAdmin = Boolean(body.isAdmin);

    if (body.password) {
      user.password = await bcrypt.hash(body.password, 10);
      if (body.sendEmail) {
        try { await sendPasswordResetEmail(user.email, user.name, body.password); } catch (e) {
          console.error('[email] reset failed:', e);
        }
      }
    }

    users[idx] = user;
    writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));

    const { password: _p, ...safe } = user;
    return NextResponse.json(safe);
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE — remove user
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const users = getUsers();
  const idx   = users.findIndex(u => u.id === id);
  if (idx === -1) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  users.splice(idx, 1);
  writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  return NextResponse.json({ ok: true });
}
