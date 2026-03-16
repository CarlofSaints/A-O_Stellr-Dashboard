'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

interface Session {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export default function AdminUsersPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', password: '', isAdmin: false });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const router = useRouter();

  useEffect(() => {
    const raw = localStorage.getItem('ao_session');
    if (!raw) { router.replace('/login'); return; }
    const s: Session = JSON.parse(raw);
    if (!s.isAdmin) { router.replace('/'); return; }
    setSession(s);
  }, [router]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) fetchUsers();
  }, [session, fetchUsers]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? 'Failed to create user'); return; }
      setForm({ name: '', email: '', password: '', isAdmin: false });
      fetchUsers();
    } catch {
      setFormError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete user "${name}"?`)) return;
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    fetchUsers();
  };

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#1B3A6B] text-white px-6 py-4 shadow-md">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold">User Management</h1>
            <p className="text-blue-200 text-xs">A&O Interactive Services Dashboard</p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="text-blue-200 hover:text-white text-sm flex items-center gap-1.5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Add User */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">Add New User</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]"
                  placeholder="Jane Smith"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]"
                  placeholder="jane@example.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 items-end">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]"
                  placeholder="••••••••"
                />
              </div>
              <div className="flex items-center gap-3 pb-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.isAdmin}
                    onChange={e => setForm(f => ({ ...f, isAdmin: e.target.checked }))}
                    className="w-4 h-4 accent-[#1B3A6B]"
                  />
                  <span className="text-sm text-gray-700">Admin access</span>
                </label>
              </div>
            </div>

            {formError && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="bg-[#1B3A6B] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#152f5a] transition-colors disabled:opacity-60"
            >
              {saving ? 'Adding…' : 'Add User'}
            </button>
          </form>
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">
              Current Users
              <span className="ml-2 text-xs font-normal text-gray-400">{users.length} total</span>
            </p>
          </div>
          {loading ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Name</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Email</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Role</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500"></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-800">{u.name}</td>
                    <td className="px-4 py-3 text-gray-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${u.isAdmin ? 'bg-blue-100 text-[#1B3A6B]' : 'bg-gray-100 text-gray-600'}`}>
                        {u.isAdmin ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.id !== session.id && (
                        <button
                          onClick={() => handleDelete(u.id, u.name)}
                          className="text-red-400 hover:text-red-600 text-xs font-medium transition-colors"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
