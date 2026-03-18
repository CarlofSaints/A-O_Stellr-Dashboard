export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Single warmup 3 seconds after startup — no repeated interval
  // (repeated intervals stack up slow MySQL queries and starve the pool)
  setTimeout(async () => {
    try {
      const { fetchAndCache } = await import('@/lib/sql-cache');

      const today    = new Date();
      const dateTo   = today.toISOString().split('T')[0];
      const sevenAgo = new Date(today);
      sevenAgo.setDate(today.getDate() - 7);
      const dateFrom = sevenAgo.toISOString().split('T')[0];

      console.log(`[warmup] pre-warming cache for ${dateFrom} to ${dateTo}…`);
      await fetchAndCache(dateFrom, dateTo);
      console.log(`[warmup] cache ready`);
    } catch (e) {
      console.error('[warmup] failed:', e);
    }
  }, 3000);
}
