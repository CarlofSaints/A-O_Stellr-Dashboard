/** Photo/signature links in exports: old Perigee, or Field Goose since the Oct 2026 move. */
export function isPhotoUrl(val: unknown): val is string {
  return typeof val === 'string' && /^https:\/\/(live\.perigeeportal\.co\.za|www\.fieldgoose\.com)\//.test(val);
}
