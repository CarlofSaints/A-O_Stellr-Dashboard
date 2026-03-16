import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';

interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  isAdmin: boolean;
}

function getUsers(): User[] {
  try {
    const raw = readFileSync(join(process.cwd(), 'data', 'users.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const users = getUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Return user without password
    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
    });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
