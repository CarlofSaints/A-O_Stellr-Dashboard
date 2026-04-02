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

type Modal =
  | { type: 'edit';  user: UserRecord }
  | { type: 'reset'; user: UserRecord }
  | null;

const INPUT = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]';
const BTN   = 'bg-[#1B3A6B] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#152f5a] transition-colors disabled:opacity-60';

export default function AdminUsersPage() {
  const [session, setSession]         = useState<Session | null>(null);
  const [users, setUsers]             = useState<UserRecord[]>([]);
  const [loading, setLoading]         = useState(true);
  const [addForm, setAddForm]         = useState({ name: '', email: '', password: '', isAdmin: false, sendEmail: false });
  const [addSaving, setAddSaving]     = useState(false);
  const [addError, setAddError]       = useState('');
  const [modal, setModal]             = useState<Modal>(null);
  const [editForm, setEditForm]       = useState({ name: '', email: '', isAdmin: false });
  const [resetForm, setResetForm]     = useState({ password: '', sendEmail: true });
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError]   = useState('');
  const [notifying, setNotifying]     = useState<string | null>(null);
  const [toast, setToast]             = useState('');
  const [showAddPw, setShowAddPw]     = useState(false);
  const [showResetPw, setShowResetPw] = useState(false);
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
      const res = await fetch('/api/users', { cache: 'no-store' });
      setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (session) fetchUsers(); }, [session, fetchUsers]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  // ── Add user ─────────────────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddSaving(true); setAddError('');
    try {
      const res  = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(addForm) });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error ?? 'Failed to create user'); return; }
      setAddForm({ name: '', email: '', password: '', isAdmin: false, sendEmail: false });
      fetchUsers();
      showToast('User added' + (addForm.sendEmail ? ' — welcome email sent' : ''));
    } catch {
      setAddError('Network error');
    } finally {
      setAddSaving(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    fetchUsers();
    showToast(`${name} removed`);
  };

  // ── Edit modal ───────────────────────────────────────────────────────────────
  const openEdit = (u: UserRecord) => {
    setEditForm({ name: u.name, email: u.email, isAdmin: u.isAdmin });
    setModalError(''); setModal({ type: 'edit', user: u });
  };

  const handleEditSave = async () => {
    if (!modal || modal.type !== 'edit') return;
    setModalSaving(true); setModalError('');
    try {
      const res  = await fetch(`/api/users/${modal.user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm) });
      const data = await res.json();
      if (!res.ok) { setModalError(data.error ?? 'Failed to save'); return; }
      setModal(null); fetchUsers(); showToast('User updated');
    } catch {
      setModalError('Network error');
    } finally {
      setModalSaving(false);
    }
  };

  // ── Reset password modal ─────────────────────────────────────────────────────
  const openReset = (u: UserRecord) => {
    setResetForm({ password: '', sendEmail: true });
    setShowResetPw(false);
    setModalError(''); setModal({ type: 'reset', user: u });
  };

  const handleResetSave = async () => {
    if (!modal || modal.type !== 'reset') return;
    if (!resetForm.password) { setModalError('Password is required'); return; }
    setModalSaving(true); setModalError('');
    try {
      const res  = await fetch(`/api/users/${modal.user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: resetForm.password, sendEmail: resetForm.sendEmail }) });
      const data = await res.json();
      if (!res.ok) { setModalError(data.error ?? 'Failed to reset'); return; }
      setModal(null);
      showToast('Password reset' + (resetForm.sendEmail ? ' — email sent to user' : ''));
    } catch {
      setModalError('Network error');
    } finally {
      setModalSaving(false);
    }
  };

  // ── Notify ───────────────────────────────────────────────────────────────────
  const handleNotify = async (u: UserRecord) => {
    setNotifying(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}/notify`, { method: 'POST' });
      if (!res.ok) throw new Error();
      showToast(`Login reminder sent to ${u.email}`);
    } catch {
      showToast('Failed to send email');
    } finally {
      setNotifying(null);
    }
  };

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-[#1B3A6B] text-white px-6 py-4 shadow-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold">User Management</h1>
            <p className="text-blue-200 text-xs">A&O Interactive Services Dashboard</p>
          </div>
          <button onClick={() => router.push('/')} className="text-blue-200 hover:text-white text-sm flex items-center gap-1.5 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Add User */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">Add New User</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
                <input type="text" value={addForm.name} required onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} className={INPUT} placeholder="Jane Smith" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
                <input type="email" value={addForm.email} required onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} className={INPUT} placeholder="jane@example.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Password</label>
                <div className="relative">
                  <input type={showAddPw ? 'text' : 'password'} value={addForm.password} required onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} className={INPUT + ' pr-10'} placeholder="••••••••" />
                  <button type="button" onClick={() => setShowAddPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showAddPw
                      ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    }
                  </button>
                </div>
              </div>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={addForm.isAdmin} onChange={e => setAddForm(f => ({ ...f, isAdmin: e.target.checked }))} className="w-4 h-4 accent-[#1B3A6B]" />
                  <span className="text-sm text-gray-700">Admin access</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={addForm.sendEmail} onChange={e => setAddForm(f => ({ ...f, sendEmail: e.target.checked }))} className="w-4 h-4 accent-[#1B3A6B]" />
                  <span className="text-sm text-gray-700">Send welcome email</span>
                </label>
              </div>
            </div>
            {addError && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{addError}</p>}
            <button type="submit" disabled={addSaving} className={BTN}>{addSaving ? 'Adding…' : 'Add User'}</button>
          </form>
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
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
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{u.name}</td>
                    <td className="px-4 py-3 text-gray-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${u.isAdmin ? 'bg-blue-100 text-[#1B3A6B]' : 'bg-gray-100 text-gray-600'}`}>
                        {u.isAdmin ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-4">
                        <button onClick={() => openEdit(u)} className="text-gray-400 hover:text-[#1B3A6B] text-xs font-medium transition-colors">
                          Edit
                        </button>
                        <button onClick={() => openReset(u)} className="text-gray-400 hover:text-amber-600 text-xs font-medium transition-colors">
                          Reset PW
                        </button>
                        <button onClick={() => handleNotify(u)} disabled={notifying === u.id} className="text-gray-400 hover:text-emerald-600 text-xs font-medium transition-colors disabled:opacity-40">
                          {notifying === u.id ? 'Sending…' : 'Notify'}
                        </button>
                        {u.id !== session.id && (
                          <button onClick={() => handleDelete(u.id, u.name)} className="text-red-400 hover:text-red-600 text-xs font-medium transition-colors">
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </main>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">

            {modal.type === 'edit' && (
              <>
                <h3 className="text-sm font-bold text-gray-800">Edit User — {modal.user.name}</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
                    <input type="text" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className={INPUT} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
                    <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className={INPUT} />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={editForm.isAdmin} onChange={e => setEditForm(f => ({ ...f, isAdmin: e.target.checked }))} className="w-4 h-4 accent-[#1B3A6B]" />
                    <span className="text-sm text-gray-700">Admin access</span>
                  </label>
                </div>
              </>
            )}

            {modal.type === 'reset' && (
              <>
                <h3 className="text-sm font-bold text-gray-800">Reset Password — {modal.user.name}</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">New Password</label>
                    <div className="relative">
                      <input type={showResetPw ? 'text' : 'password'} value={resetForm.password} onChange={e => setResetForm(f => ({ ...f, password: e.target.value }))} className={INPUT + ' pr-10'} placeholder="••••••••" />
                      <button type="button" onClick={() => setShowResetPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showResetPw
                          ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                          : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        }
                      </button>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={resetForm.sendEmail} onChange={e => setResetForm(f => ({ ...f, sendEmail: e.target.checked }))} className="w-4 h-4 accent-[#1B3A6B]" />
                    <span className="text-sm text-gray-700">Email new password to user</span>
                  </label>
                </div>
              </>
            )}

            {modalError && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{modalError}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium transition-colors">
                Cancel
              </button>
              <button onClick={modal.type === 'edit' ? handleEditSave : handleResetSave} disabled={modalSaving} className={BTN}>
                {modalSaving ? 'Saving…' : 'Save'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-800 text-white text-sm px-4 py-3 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}

    </div>
  );
}
