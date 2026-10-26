import { logRoute } from '@/components/pictures-to-cells/server';
import { loadUsers } from '@/lib/userData';

export const { GET, POST } = logRoute({
  access: 'private',
  user: async req => {
    const u = loadUsers().find(x => x.id === req.headers.get('x-user-id'));
    return u ? `${u.name} (${u.email})` : null;
  },
});
