import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const users = getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  users.splice(idx, 1);
  writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  return NextResponse.json({ ok: true });
}
