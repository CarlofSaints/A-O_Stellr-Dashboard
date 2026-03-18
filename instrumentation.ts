export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  async function warmDefault() {
    try {
      const { fetchAndCache } = await import('@/lib/sql-cache');

      // Match the frontend's date calculation exactly (today - 7 days)
      const today    = new Date();
      const dateTo   = today.toISOString().split('T')[0];
      const sevenAgo = new Date(today);
      sevenAgo.setDate(today.getDate() - 7);
      const dateFrom = sevenAgo.toISOString().split('T')[0];

      console.log(`[warmup] refreshing cache for ${dateFrom} to ${dateTo}…`);
      await fetchAndCache(dateFrom, dateTo);
      console.log(`[warmup] cache ready`);
    } catch (e) {
      console.error('[warmup] failed:', e);
    }
  }

  // Warm on startup after 3 seconds
  setTimeout(warmDefault, 3000);

  // Refresh every 10 minutes so the cache never goes cold
  setInterval(warmDefault, 10 * 60 * 1000);
}
