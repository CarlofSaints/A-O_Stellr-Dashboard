import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
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

function saveUsers(users: User[]) {
  writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

// GET — list all users (admin only, no passwords)
export async function GET() {
  const users = getUsers();
  return NextResponse.json(users.map(({ password: _p, ...u }) => u));
}

// POST — create user (admin only)
export async function POST(req: NextRequest) {
  try {
    const { name, email, password, isAdmin } = await req.json();
    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Name, email and password required' }, { status: 400 });
    }

    const users = getUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 10);
    const newUser: User = {
      id: Date.now().toString(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashed,
      isAdmin: Boolean(isAdmin),
    };

    users.push(newUser);
    saveUsers(users);

    const { password: _p, ...safe } = newUser;
    return NextResponse.json(safe, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
