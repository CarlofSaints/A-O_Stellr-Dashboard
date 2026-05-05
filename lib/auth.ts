import { loadUsers } from './userData';

export async function requireAdmin(req: Request): Promise<boolean> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return false;
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  return user?.isAdmin === true;
}

export function noCacheHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  };
}
