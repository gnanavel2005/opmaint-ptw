'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Shell, Badge, Countdown } from '../../../src/components/ui';
import { api, fmt, ROLE } from '../../../src/lib/client';

const ACTION: Record<string, { label: string; need: boolean; cls: string; hint: string }> = {
  submit: { label: 'Submit for approval', need: false, cls: 'primary', hint: 'The permit goes to the area owner and the safety officer.' },
  approve: { label: 'Approve', need: false, cls: 'primary', hint: 'Add a comment if you want. Check the precautions and readings first.' },
  reject: { label: 'Reject', need: true, cls: 'danger', hint: 'A reason is required.' },
  activate: { label: 'Start work (activate)', need: false, cls: 'primary', hint: 'Work may only happen inside the approved time window.' },
  suspend: { label: 'Suspend work now', need: true, cls: 'danger', hint: 'Work stops immediately. Say why (gas alarm, shift handover, emergency).' },
  resume: { label: 'Resume work', need: false, cls: 'primary', hint: 'Confirm conditions are safe again.' },
  close: { label: 'Mark work complete', need: true, cls: 'primary', hint: 'Describe what was done and the state of the area.' },
  verify: { label: 'Verify area and close out', need: false, cls: 'primary', hint: 'Confirm you inspected the area and it is clean and safe.' },
  cancel: { label: 'Cancel permit', need: true, cls: 'danger', hint: 'A reason is required.' },
};
const VERB: Record<string, string> = {
  create: 'created the permit (draft)', submit: 'submitted the permit for approval', approve: 'approved the permit', reject: 'rejected the permit',
  activate: 'started work (permit active)', suspend: 'suspended the permit', resume: 'resumed the permit', expire: 'expired automatically',
  close: 'marked the work complete', verify: 'verified the area and closed out the permit', cancel: 'cancelled the permit',
};
const SLOT: Record<string, string> = { AREA_OWNER: 'Area owner', SAFETY_OFFICER: 'Safety officer' };

// Suspense: useParams() is runtime data, so Next.js 16 (Cache Components) wants a boundary around it.
export default function PermitPage() { return <Suspense fallback={<p className="muted pad">Loading…</p>}><Shell>{user => <Detail user={user} />}</Shell></Suspense>; }

function Detail({ user }: { user: any }) {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<any>(null), [lk, setLk] = useState<any>(null), [err, setErr] = useState(''), [act, setAct] = useState('');
  const load = useCallback(() => { api(`/api/permits/${id}`).then(setD).catch(e => setErr(e.message)); }, [id]);
  useEffect(() => { load(); api('/api/lookups').then(setLk).catch(() => {}); }, [load]);

  if (err) return <><Link href="/">← All permits</Link><p className="err" role="alert">{err}</p></>;
  if (!d || !lk) return <p className="muted">Loading…</p>;
  const { permit: p, approvals, audit } = d;
  const type = lk.types[p.type];
  const actions: string[] = d.actions.filter((a: string) => ACTION[a]);
  const start = new Date(p.planned_start), end = new Date(p.planned_end);
  const showVal = (f: any, v: any) => v === undefined || v === null || v === '' ? '–' : f.kind === 'bool' ? (v ? 'Yes' : 'No') : f.kind === 'list' ? (v.length ? v.join(', ') : '–') : f.kind === 'datetime' ? fmt(v) : `${v}${f.unit ? ' ' + f.unit : ''}`;

  return (
    <>
      <Link href="/">← All permits</Link>
      <div className="head">
        <div><h1>{p.permit_no}</h1><div className="ptype">{type?.label ?? p.type}</div></div>
        <Badge status={p.status} />
      </div>

      {p.status === 'ACTIVE' && <div className="banner ok">Work is authorised until {fmt(end)}. <Countdown to={p.planned_end} /></div>}
      {p.status === 'APPROVED' && start > new Date() && <div className="banner info">Approved. Work can only start at {fmt(start)}.</div>}
      {p.status === 'SUSPENDED' && <div className="banner bad">SUSPENDED. All work must stop until a safety officer resumes this permit.</div>}
      {p.status === 'EXPIRED' && <div className="banner bad">This permit has expired and cannot be reactivated. Raise a new permit to continue work.</div>}

      <section className="card">
        <h2>Job</h2>
        <p>{p.work_description}</p>
        <dl className="kv">
          <dt>Requester</dt><dd>{p.requester_name}</dd>
          <dt>Contractor / team</dt><dd>{p.contractor}</dd>
          <dt>Location</dt><dd>{p.plant_name} → {p.area_name}{p.equipment_tag ? ` → ${p.equipment_tag} (${p.equipment_name})` : ''}</dd>
          <dt>Planned window</dt><dd>{fmt(start)} to {fmt(end)}</dd>
          <dt>Hazards</dt><dd>{p.hazards.length ? p.hazards.map((h: string) => <span key={h} className="chip bad">{h}</span>) : '–'}</dd>
          <dt>PPE required</dt><dd>{p.ppe.length ? p.ppe.map((h: string) => <span key={h} className="chip">{h}</span>) : '–'}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>{type?.label} details</h2>
        <dl className="kv">{type?.fields.map((f: any) => <div key={f.key} className="kvrow"><dt>{f.label}</dt><dd>{showVal(f, p.type_data?.[f.key])}</dd></div>)}</dl>
        <h3>Precautions</h3>
        <ul className="checks">{p.precautions.length ? p.precautions.map((x: any, i: number) => <li key={i} className={x.done ? 'done' : ''}>{x.done ? '☑' : '☐'} {x.text}</li>) : <li>None listed</li>}</ul>
      </section>

      <section className="card">
        <h2>Approvals</h2>
        {approvals.length === 0 && <p className="muted">Not submitted yet. Approvals are requested when the permit is submitted.</p>}
        {approvals.map((a: any) => (
          <div key={a.slot} className="appr">
            <div className="row"><b>{SLOT[a.slot]}</b><span className={`chip ${a.status}`}>{a.status.toLowerCase()}</span></div>
            {a.approver && <small>{a.approver}{a.decided_at ? `, ${fmt(a.decided_at)}` : ''}</small>}
            {a.comment && <q>{a.comment}</q>}
            {a.signature && <img src={a.signature} alt="Signature" className="sig" />}
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Audit trail</h2>
        <ol className="timeline">
          {audit.map((e: any, i: number) => (
            <li key={i} className={e.to_status}>
              <div className="when">{fmt(e.at)}</div>
              <div><b>{e.actor}</b> {VERB[e.action] ?? e.action}</div>
              {e.from_status && e.to_status && e.from_status !== e.to_status && <div className="move"><Badge status={e.from_status} /> → <Badge status={e.to_status} /></div>}
              {e.comment && <q>{e.comment}</q>}
            </li>
          ))}
        </ol>
      </section>

      {actions.length > 0 && (
        <div className="actions" role="group" aria-label="Actions">
          {actions.map(a => <button key={a} className={`btn ${ACTION[a].cls}`} onClick={() => setAct(a)}>{ACTION[a].label}</button>)}
        </div>
      )}
      {act && <ActionDialog act={act} permit={p} approvals={approvals} user={user} onClose={() => setAct('')} onDone={() => { setAct(''); load(); }} />}
    </>
  );
}

function ActionDialog({ act, permit, approvals, user, onClose, onDone }: any) {
  const cfg = ACTION[act];
  const slots: string[] = approvals
    .filter((a: any) => a.status === 'PENDING' && (user.role === 'ADMIN' || (user.role === a.slot && (a.slot === 'SAFETY_OFFICER' || (user.areaIds || []).includes(permit.area_id)))))
    .map((a: any) => a.slot);
  const [slot, setSlot] = useState(slots[0] ?? ''), [comment, setComment] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try { await api(`/api/permits/${permit.id}/transition`, { method: 'POST', json: { action: act, comment, slot: slot || undefined } }); onDone(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="dt">
      <div className="dlg">
        <h2 id="dt">{cfg.label}</h2>
        <p className="muted">{cfg.hint}</p>
        {(act === 'approve' || act === 'reject') && slots.length > 1 && (
          <label>Acting as<select value={slot} onChange={e => setSlot(e.target.value)}>{slots.map(s => <option key={s} value={s}>{SLOT[s]} ({ROLE[user.role]})</option>)}</select></label>
        )}
        <label>{cfg.need ? 'Comment (required)' : 'Comment (optional)'}<textarea rows={4} value={comment} onChange={e => setComment(e.target.value)} /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row">
          <button className="btn ghost" onClick={onClose}>Back</button>
          <button className={`btn ${cfg.cls}`} disabled={busy || (cfg.need && !comment.trim())} onClick={go}>{busy ? 'Working…' : cfg.label}</button>
        </div>
      </div>
    </div>
  );
}
