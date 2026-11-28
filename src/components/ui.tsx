'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ROLE, STATUS, timeLeft } from '../lib/client';

export const Badge = ({ status }: { status: string }) => <span className={`badge ${status}`}>{STATUS[status] ?? status}</span>;

export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const soon = new Date(to).getTime() - now <= 2 * 3600e3;
  return <span className={`cd${soon ? ' soon' : ''}`}>⏱ {timeLeft(to, now)}</span>;
}

/** Page frame: loads the current user (redirects to /login if not signed in) and shows the header. */
export function Shell({ children }: { children: (user: any) => ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();
  useEffect(() => { api('/api/me').then(r => setUser(r.user)).catch(() => router.replace('/login')); }, [router]);
  if (!user) return <p className="muted pad">Loading…</p>;
  const canCreate = user.role === 'REQUESTER' || user.role === 'ADMIN';
  return (
    <>
      <header className="top">
        <Link href="/" className="brand">PermitDesk</Link>
        <nav>{canCreate && <Link href="/permits/new" className="btn sm primary">+ New permit</Link>}</nav>
        <div className="who">
          <span><b>{user.name}</b><small>{ROLE[user.role]}</small></span>
          <button className="btn ghost sm" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); router.replace('/login'); }}>Log out</button>
        </div>
      </header>
      <main className="wrap">{children(user)}</main>
    </>
  );
}
