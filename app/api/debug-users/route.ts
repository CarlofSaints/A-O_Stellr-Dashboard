import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, unauthorized } from '@/lib/auth';
import { loadUsers } from '@/lib/userData';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return unauthorized();

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
