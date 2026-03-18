export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Pre-warm the SQL cache 3 seconds after server starts so the first user
  // doesn't hit the slow MySQL query.
  setTimeout(async () => {
    try {
      const { fetchAndCache } = await import('@/lib/sql-cache');

      const today      = new Date();
      const dateTo     = today.toISOString().split('T')[0];
      const dateFrom   = new Date(today.setDate(today.getDate() - 6))
                           .toISOString().split('T')[0];

      console.log(`[warmup] pre-warming cache for ${dateFrom} to ${dateTo}…`);
      await fetchAndCache(dateFrom, dateTo);
      console.log(`[warmup] cache ready`);
    } catch (e) {
      console.error('[warmup] failed:', e);
    }
  }, 3000);
}
