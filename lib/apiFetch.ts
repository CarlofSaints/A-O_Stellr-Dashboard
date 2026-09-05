'use client';

/**
 * Every call to this app's API carries the caller's id.
 *
 * The routes authorise on the `x-user-id` header, and no page used to send it —
 * which is why `/api/users` happily answered an unauthenticated GET with all 11
 * accounts. Use `apiFetch` instead of `fetch` for anything under /api/, so a new
 * call site cannot quietly go out unauthenticated.
 *
 * Read straight from localStorage rather than React state: a fetch that fires
 * before the session lands in state must still carry the header.
 */
export function userIdHeader(): Record<string, string> {
  try {
    const raw = localStorage.getItem('ao_session');
    if (!raw) return {};
    const id = (JSON.parse(raw) as { id?: string | number } | null)?.id;
    return id !== undefined && id !== null ? { 'x-user-id': String(id) } : {};
  } catch {
    return {};
  }
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  // Headers(), not object spread: some call sites pass a Headers instance and
  // spreading one yields {}, which would drop their Content-Type.
  const headers = new Headers(init.headers);
  const id = userIdHeader()['x-user-id'];
  if (id) headers.set('x-user-id', id);
  return fetch(input, { ...init, headers });
}
