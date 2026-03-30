import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  isAdmin: boolean;
}

const ENV_KEY   = 'AO_USERS_JSON';
const LOCAL_PATH = join(process.cwd(), 'data', 'users.json');

// In-memory cache so writes are immediately visible to subsequent reads
// (process.env is stale until the next deployment on Vercel)
let _cache: User[] | null = null;

export function loadUsers(): User[] {
  if (_cache) return _cache;

  const envRaw = process.env[ENV_KEY];
  if (envRaw) {
    try {
      _cache = JSON.parse(envRaw);
      return _cache!;
    } catch { /* fall through */ }
  }
  try {
    _cache = JSON.parse(readFileSync(LOCAL_PATH, 'utf-8'));
    return _cache!;
  } catch {
    return [];
  }
}

export async function saveUsers(users: User[]): Promise<void> {
  _cache = users; // update in-memory immediately

  const value     = JSON.stringify(users);
  const projectId = process.env.VERCEL_PROJECT_ID;
  const token     = process.env.VERCEL_TOKEN;
  const teamId    = process.env.VERCEL_TEAM_ID;

  if (!projectId || !token) {
    // Local dev fallback — write to file
    try { mkdirSync(join(process.cwd(), 'data'), { recursive: true }); } catch { /* exists */ }
    writeFileSync(LOCAL_PATH, JSON.stringify(users, null, 2));
    return;
  }

  const qs   = teamId ? `?teamId=${teamId}` : '';
  const base = `https://api.vercel.com/v9/projects/${projectId}`;

  const listRes  = await fetch(`${base}/env${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listData = await listRes.json() as { envs?: Array<{ id: string; key: string }> };
  const entry    = listData.envs?.find(e => e.key === ENV_KEY);

  if (entry) {
    await fetch(`${base}/env/${entry.id}${qs}`, {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ value, target: ['production', 'preview', 'development'] }),
    });
  } else {
    await fetch(`${base}/env${qs}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key: ENV_KEY, value, type: 'encrypted', target: ['production', 'preview', 'development'] }),
    });
  }
}
