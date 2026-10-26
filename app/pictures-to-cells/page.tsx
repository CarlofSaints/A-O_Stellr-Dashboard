'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import PicturesToCells from '@/components/pictures-to-cells/PicturesToCells';
import { userIdHeader } from '@/lib/apiFetch';

export default function PicturesToCellsPage() {
  const router = useRouter();
  const [session, setSession] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('ao_session');
    if (!raw) { router.replace('/login'); return; }
    setSession(JSON.parse(raw));
  }, [router]);

  if (!session) return null;

  return (
    <div className="min-h-screen" style={{ backgroundImage: "url('/stellr-bg.jpg')", backgroundSize: 'cover', backgroundAttachment: 'fixed', backgroundPosition: 'center' }}>
      <header className="bg-white border-b border-gray-200 px-6 py-3 shadow-sm">
        <div className="w-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Image src="/ao-logo.png" alt="A&O" width={72} height={36} className="object-contain" />
            <div>
              <h1 className="text-base font-bold leading-tight text-[#1B3A6B]">A&O Interactive Services</h1>
              <p className="text-[#1B3A6B]/60 text-xs">Pictures to Cells</p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right">
              <p className="text-[#1B3A6B] text-xs font-semibold">{session.name}</p>
              <p className="text-gray-400 text-xs">{session.email}</p>
            </div>
            <button onClick={() => router.push('/')} className="text-gray-400 hover:text-[#1B3A6B] text-xs flex items-center gap-1 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Dashboard
            </button>
          </div>
        </div>
      </header>
      <main className="w-full px-6 py-6">
        <PicturesToCells imageUrl={url => `/api/image?url=${encodeURIComponent(url)}`} logApi="/api/pictures-to-cells" headers={userIdHeader} />
      </main>
    </div>
  );
}
