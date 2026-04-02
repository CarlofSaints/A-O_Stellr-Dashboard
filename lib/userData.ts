import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  isAdmin: boolean;
}

const ENV_KEY    = 'AO_USERS_JSON';
const LOCAL_PATH = join(process.cwd(), 'data', 'users.json');
const TMP_FILE   = '/tmp/ao_users.json';

// In-memory cache so writes are immediately visible to subsequent reads
// (process.env is stale until the next deployment on Vercel)
let _cache: User[] | null = null;

export function loadUsers(): User[] {
  if (_cache) return _cache;

  // Vercel: try /tmp first (survives across requests in same container)
  if (process.env.VERCEL) {
    try {
      if (existsSync(TMP_FILE)) {
        _cache = JSON.parse(readFileSync(TMP_FILE, 'utf-8'));
        console.log(`[userData] Loaded ${_cache!.length} users from /tmp`);
        return _cache!;
      }
    } catch (err) {
      console.error('[userData] /tmp read failed:', err);
    }
  }

  const envRaw = process.env[ENV_KEY];
  if (envRaw) {
    try {
      _cache = JSON.parse(envRaw);
      // Seed /tmp so future requests in this container are fast
      if (process.env.VERCEL) {
        try { writeFileSync(TMP_FILE, envRaw); } catch {}
      }
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
  const value = JSON.stringify(users);

  // Vercel: always write to /tmp (container-level persistence)
  if (process.env.VERCEL) {
    try {
      writeFileSync(TMP_FILE, value);
      console.log(`[userData] Wrote ${users.length} users to /tmp`);
    } catch (err) {
      console.error('[userData] /tmp write failed:', err);
    }
  }

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
