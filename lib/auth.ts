import { NextResponse } from 'next/server';
import { loadUsers } from './userData';

export async function requireAdmin(req: Request): Promise<boolean> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return false;
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  return user?.isAdmin === true;
}

/**
 * Any signed-in user. Read endpoints take this; anything that writes, deletes,
 * or exposes the user list takes requireAdmin instead.
 *
 * Until 5 Sep 2026 almost no route checked either: an unauthenticated GET of
 * /api/users returned all 11 accounts and its POST would create one, so anyone
 * with the URL could make themselves an admin. The image proxies deliberately
 * stay open — they are used as <img src>, which cannot send a header.
 */
export async function requireUser(req: Request): Promise<boolean> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return false;
  return loadUsers().some(u => u.id === userId);
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function noCacheHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  };
}
