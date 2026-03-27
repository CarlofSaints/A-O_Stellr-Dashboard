import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { loadUsers, saveUsers } from '@/lib/userData';
import { sendWelcomeEmail } from '@/lib/email';

// GET — list all users (no passwords)
export async function GET() {
  const users = loadUsers();
  return NextResponse.json(users.map(({ password: _p, ...u }) => u));
}

// POST — create user
export async function POST(req: NextRequest) {
  try {
    const { name, email, password, isAdmin, sendEmail } = await req.json();
    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Name, email and password required' }, { status: 400 });
    }

    const users = loadUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    const hashed  = await bcrypt.hash(password, 10);
    const newUser = {
      id:       Date.now().toString(),
      name:     name.trim(),
      email:    email.toLowerCase().trim(),
      password: hashed,
      isAdmin:  Boolean(isAdmin),
    };

    users.push(newUser);
    await saveUsers(users);

    if (sendEmail) {
      try { await sendWelcomeEmail(newUser.email, newUser.name, password); } catch (e) {
        console.error('[email] welcome failed:', e);
      }
    }

    const { password: _p, ...safe } = newUser;
    return NextResponse.json(safe, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
