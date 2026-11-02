'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/visit-report', label: 'Visit Report' },
  { href: '/pdf-download', label: 'PDF Download' },
  { href: '/pictures-to-cells', label: 'Pictures to Cells' },
];
const ADMIN_ITEMS = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/data', label: 'Data' },
  { href: '/admin/settings', label: 'Settings' },
];

// Burger button + slide-in menu, placed in every page header.
export default function SideNav() {
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    try { setIsAdmin(!!JSON.parse(localStorage.getItem('ao_session') ?? '{}').isAdmin); } catch { /* no session */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const signOut = () => {
    localStorage.removeItem('ao_session');
    router.replace('/login');
  };

  const link = (i: { href: string; label: string }) => (
    <Link
      key={i.href}
      href={i.href}
      onClick={() => setOpen(false)}
      className={`block px-5 py-2.5 text-sm transition-colors ${pathname === i.href ? 'bg-[#1B3A6B] text-white font-semibold' : 'text-gray-700 hover:bg-[#1B3A6B]/10'}`}
    >
      {i.label}
    </Link>
  );

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="p-1.5 rounded hover:bg-black/10 transition-colors">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-[1000]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <nav className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col py-4" aria-label="Main menu">
            <div className="flex items-center justify-between px-5 pb-4 mb-2 border-b border-gray-200">
              <span className="text-sm font-bold text-[#1B3A6B]">A&O Menu</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="text-gray-400 hover:text-[#1B3A6B] text-xl leading-none">×</button>
            </div>
            {ITEMS.map(link)}
            {isAdmin && (
              <>
                <p className="px-5 pt-4 pb-1 text-[10px] uppercase tracking-wider text-gray-400">Admin</p>
                {ADMIN_ITEMS.map(link)}
              </>
            )}
            <button onClick={signOut} className="mt-auto mx-5 text-left text-sm text-gray-500 hover:text-[#1B3A6B] py-2 border-t border-gray-200">Sign Out</button>
          </nav>
        </div>
      )}
    </>
  );
}
