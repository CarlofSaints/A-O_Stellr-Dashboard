import { NextResponse } from 'next/server';
import { loadUsers } from '@/lib/userData';

export async function GET() {
  const users = loadUsers();
  const envRaw = process.env.AO_USERS_JSON;
  return NextResponse.json({
    envVarSet: !!envRaw,
    envVarLength: envRaw?.length ?? 0,
    envVarValidJson: (() => { try { JSON.parse(envRaw ?? ''); return true; } catch { return false; } })(),
    userCount: users.length,
    emails: users.map(u => u.email),
  });
}
