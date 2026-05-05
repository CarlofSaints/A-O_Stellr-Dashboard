import { get, put } from '@vercel/blob';

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const result = await get(key, { access: 'private', useCache: false });
    if (result && result.statusCode === 200) {
      const text = await new Response(result.stream).text();
      return JSON.parse(text) as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(key: string, data: T): Promise<void> {
  await put(key, JSON.stringify(data, null, 2), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}
