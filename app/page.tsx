'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell, Badge, Countdown } from '../src/components/ui';
import { api, fmt } from '../src/lib/client';

const EMPTY = { status: '', type: '', area: '', from: '', to: '', pendingMine: false };

export default function Home() { return <Shell>{user => <Dashboard user={user} />}</Shell>; }

function Dashboard({ user }: { user: any }) {
  const [lk, setLk] = useState<any>(null), [f, setF] = useState(EMPTY), [data, setData] = useState<any>(null), [live, setLive] = useState<any>(null), [err, setErr] = useState('');
  const approver = ['AREA_OWNER', 'SAFETY_OFFICER', 'ADMIN'].includes(user.role);

  useEffect(() => { api('/api/lookups').then(setLk).catch(e => setErr(e.message)); }, []);
  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (f.status) q.set('status', f.status);
    if (f.type) q.set('type', f.type);
    if (f.area) q.set('area', f.area);
    if (f.from) q.set('from', `${f.from}T00:00:00`);
    if (f.to) q.set('to', `${f.to}T23:59:59`);
    if (f.pendingMine) q.set('pendingMine', '1');
    api(`/api/permits?${q}`).then(setData).catch(e => setErr(e.message));
    api('/api/permits?status=ACTIVE').then(setLive).catch(() => {});
  }, [f]);
  useEffect(() => { load(); }, [load]);
  const set = (k: string, v: any) => setF({ ...f, [k]: v });

  return (
    <>
      <h1>Permits</h1>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="tiles">
        <button className="tile live" onClick={() => setF({ ...EMPTY, status: 'ACTIVE' })}><b>{data?.summary.active ?? '–'}</b><span>Active right now</span></button>
        <button className="tile warn" onClick={() => setF({ ...EMPTY, status: 'ACTIVE' })}><b>{data?.summary.expiring_soon ?? '–'}</b><span>Expiring within 2 hours</span></button>
        {approver && <button className="tile" onClick={() => setF({ ...EMPTY, pendingMine: true })}><b>✔</b><span>My approvals pending</span></button>}
      </div>

      {live?.permits.length > 0 && (
        <section><h2>Active now</h2>
          <div className="list">{live.permits.map((p: any) => <PCard key={p.id} p={p} types={lk?.types} />)}</div></section>
      )}

      <h2>All permits</h2>
      <div className="filters card">
        <label>Status<select value={f.status} onChange={e => set('status', e.target.value)}><option value="">All</option>
          {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'EXPIRED', 'CLOSED', 'CLOSED_VERIFIED', 'CANCELLED'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}</select></label>
        <label>Type<select value={f.type} onChange={e => set('type', e.target.value)}><option value="">All</option>
          {lk && Object.entries(lk.types).map(([k, t]: any) => <option key={k} value={k}>{t.label}</option>)}</select></label>
        <label>Area<select value={f.area} onChange={e => set('area', e.target.value)}><option value="">All</option>
          {lk?.areas.map((a: any) => <option key={a.id} value={a.id}>{a.plant_name} → {a.name}</option>)}</select></label>
        <label>From<input type="date" value={f.from} onChange={e => set('from', e.target.value)} /></label>
        <label>To<input type="date" value={f.to} onChange={e => set('to', e.target.value)} /></label>
        {approver && <label className="check"><input type="checkbox" checked={f.pendingMine} onChange={e => set('pendingMine', e.target.checked)} /> My approvals pending</label>}
        <button className="btn ghost sm" onClick={() => setF(EMPTY)}>Clear filters</button>
      </div>
      <div className="list">
        {data?.permits.map((p: any) => <PCard key={p.id} p={p} types={lk?.types} />)}
        {data && data.permits.length === 0 && <p className="muted">No permits match these filters.</p>}
      </div>
    </>
  );
}

function PCard({ p, types }: { p: any; types: any }) {
  return (
    <Link href={`/permits/${p.id}`} className={`pcard${p.expiring_soon ? ' soon' : ''}`}>
      <div className="row"><b>{p.permit_no}</b><Badge status={p.status} /></div>
      <div className="ptype">{types?.[p.type]?.label ?? p.type}</div>
      <p>{p.work_description}</p>
      <small>{p.plant_name} → {p.area_name}{p.equipment_tag ? ` → ${p.equipment_tag}` : ''}</small>
      <small>{fmt(p.planned_start)} to {fmt(p.planned_end)}</small>
      {p.status === 'ACTIVE' && <Countdown to={p.planned_end} />}
    </Link>
  );
}
