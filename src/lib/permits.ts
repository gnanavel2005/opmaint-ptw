/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PoolClient } from 'pg';
import { pool } from './db';
import { transition, availableActions, DomainError, type Action, type Actor, type Input, type PermitState } from '../domain/stateMachine';
import { PERMIT_TYPES, validateTypeData } from '../domain/permitTypes';

export const SYSTEM: Actor = { id: null, role: 'SYSTEM', areaIds: [] };
const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'EXPIRED', 'CLOSED', 'CLOSED_VERIFIED', 'CANCELLED'];

async function load(c: PoolClient, id: number, lock: boolean) {
  const { rows } = await c.query(`SELECT * FROM permits WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw new DomainError('NOT_FOUND', 'Permit not found');
  const ap = await c.query('SELECT slot,status FROM permit_approvals WHERE permit_id=$1', [id]);
  const r = rows[0];
  const state: PermitState = { status: r.status, requesterId: r.requester_id, areaId: r.area_id, plannedStart: r.planned_start, plannedEnd: r.planned_end, approvals: ap.rows };
  return { row: r, state };
}

/** The only way a permit changes state. One DB transaction, row locked, rules from the state machine, audit written. */
export async function perform(id: number, action: Action, actor: Actor, input: Input & { signature?: string } = {}) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { row, state } = await load(c, id, true);
    const now = new Date();
    if (action === 'submit') {
      const errs = validateTypeData(row.type, row.type_data);
      if (errs.length) throw new DomainError('VALIDATION', `Cannot submit: ${errs.join('; ')}`);
    }
    const r = transition(state, action, actor, now, input);
    if (action === 'submit')
      for (const slot of ['AREA_OWNER', 'SAFETY_OFFICER']) await c.query('INSERT INTO permit_approvals(permit_id,slot) VALUES($1,$2)', [id, slot]);
    if (r.slot)
      await c.query('UPDATE permit_approvals SET status=$3,approver_id=$4,comment=$5,signature=$6,decided_at=$7 WHERE permit_id=$1 AND slot=$2',
        [id, r.slot, r.slotStatus, actor.id, r.audit.comment ?? null, input.signature ?? null, now]);
    await c.query('UPDATE permits SET status=$2,completion_notes=COALESCE($3,completion_notes),updated_at=$4 WHERE id=$1',
      [id, r.to, action === 'close' ? r.audit.comment ?? null : null, now]);
    await c.query('INSERT INTO permit_audit_log(permit_id,actor_id,action,from_status,to_status,comment,at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, actor.id, action, r.audit.from, r.to, r.audit.comment ?? null, now]);
    await c.query('COMMIT');
    return r.to;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

/** Expires every non-terminal permit whose window has passed. Called lazily on reads and by the cron endpoint,
 *  so expiry works even when nobody has the browser open. */
export async function expireDue(): Promise<number> {
  const { rows } = await pool.query(`SELECT id FROM permits WHERE status IN ('PENDING_APPROVAL','APPROVED','ACTIVE','SUSPENDED') AND planned_end <= now()`);
  let n = 0;
  for (const r of rows) {
    try { await perform(r.id, 'expire', SYSTEM, { comment: 'Validity window passed' }); n++; }
    catch { /* another request expired it first */ }
  }
  return n;
}

export interface Filters { status?: string; type?: string; areaId?: number; from?: string; to?: string; pendingMine?: boolean }
export async function listPermits(actor: Actor, f: Filters) {
  await expireDue();
  const w: string[] = [], a: unknown[] = [];
  const p = (v: unknown) => { a.push(v); return `$${a.length}`; };
  if (f.status) {
    if (!STATUSES.includes(f.status)) throw new DomainError('VALIDATION', 'Unknown status');
    w.push(`p.status = ${p(f.status)}`);
  }
  if (f.type) w.push(`p.type = ${p(f.type)}`);
  if (f.areaId) w.push(`p.area_id = ${p(f.areaId)}`);
  if (f.from) w.push(`p.planned_end >= ${p(f.from)}`);
  if (f.to) w.push(`p.planned_start <= ${p(f.to)}`);
  if (f.pendingMine) {
    const pending = (slot: string) => `EXISTS (SELECT 1 FROM permit_approvals x WHERE x.permit_id=p.id AND x.status='PENDING'${slot})`;
    w.push(`p.status = 'PENDING_APPROVAL' AND p.requester_id <> ${p(actor.id)}`);
    if (actor.role === 'AREA_OWNER') w.push(`${pending(" AND x.slot='AREA_OWNER'")} AND p.area_id = ANY(${p(actor.areaIds)})`);
    else if (actor.role === 'SAFETY_OFFICER') w.push(pending(" AND x.slot='SAFETY_OFFICER'"));
    else if (actor.role === 'ADMIN') w.push(pending(''));
    else w.push('FALSE');
  }
  const { rows } = await pool.query(
    `SELECT p.id,p.permit_no,p.type,p.status,p.work_description,p.contractor,p.planned_start,p.planned_end,p.area_id,
            a.name AS area_name,pl.name AS plant_name,e.tag AS equipment_tag,u.name AS requester_name,
            (p.status='ACTIVE' AND p.planned_end <= now() + interval '2 hours') AS expiring_soon
       FROM permits p JOIN areas a ON a.id=p.area_id JOIN plants pl ON pl.id=a.plant_id
       LEFT JOIN equipment e ON e.id=p.equipment_id JOIN users u ON u.id=p.requester_id
      ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.planned_start DESC`, a);
  const s = await pool.query(`SELECT count(*) FILTER (WHERE status='ACTIVE')::int AS active,
      count(*) FILTER (WHERE status='ACTIVE' AND planned_end <= now() + interval '2 hours')::int AS expiring_soon FROM permits`);
  return { summary: s.rows[0], permits: rows };
}

export async function getPermit(actor: Actor, id: number) {
  await expireDue();
  const c = await pool.connect();
  try {
    const { row, state } = await load(c, id, false);
    const names = (await c.query(
      `SELECT a.name AS area_name,pl.name AS plant_name,e.tag AS equipment_tag,e.name AS equipment_name,u.name AS requester_name
         FROM areas a JOIN plants pl ON pl.id=a.plant_id LEFT JOIN equipment e ON e.id=$2 JOIN users u ON u.id=$3 WHERE a.id=$1`,
      [row.area_id, row.equipment_id, row.requester_id])).rows[0];
    const approvals = (await c.query(
      `SELECT x.slot,x.status,x.comment,x.signature,x.decided_at,u.name AS approver FROM permit_approvals x
         LEFT JOIN users u ON u.id=x.approver_id WHERE x.permit_id=$1 ORDER BY x.slot`, [id])).rows;
    const audit = (await c.query(
      `SELECT l.action,l.from_status,l.to_status,l.comment,l.at,COALESCE(u.name,'System') AS actor FROM permit_audit_log l
         LEFT JOIN users u ON u.id=l.actor_id WHERE l.permit_id=$1 ORDER BY l.at,l.id`, [id])).rows;
    return { permit: { ...row, ...names }, approvals, audit, actions: availableActions(state, actor, new Date()) };
  } finally { c.release(); }
}

export async function createPermit(actor: Actor, b: Record<string, any>) {
  if (actor.role !== 'REQUESTER' && actor.role !== 'ADMIN') throw new DomainError('FORBIDDEN', 'Only requesters can raise permits');
  const bad = (m: string) => new DomainError('VALIDATION', m);
  const str = (v: unknown, label: string) => { if (typeof v !== 'string' || !v.trim()) throw bad(`${label} is required`); return v.trim(); };
  const list = (v: unknown) => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map((x: string) => x.trim()) : [];
  if (!PERMIT_TYPES[b.type]) throw bad('Unknown permit type');
  const contractor = str(b.contractor, 'Contractor / team'), desc = str(b.workDescription, 'Work description');
  const start = new Date(b.plannedStart), end = new Date(b.plannedEnd);
  if (isNaN(+start) || isNaN(+end)) throw bad('Planned start and end are required');
  if (end <= start) throw bad('Planned end must be after planned start');
  const areaId = Number(b.areaId), equipmentId = b.equipmentId ? Number(b.equipmentId) : null;
  if (!Number.isInteger(areaId)) throw bad('Area is required');
  if (equipmentId) {
    const e = await pool.query('SELECT 1 FROM equipment WHERE id=$1 AND area_id=$2', [equipmentId, areaId]);
    if (!e.rows[0]) throw bad('Equipment does not belong to that area');
  }
  const precautions = (Array.isArray(b.precautions) ? b.precautions : [])
    .map((x: any) => ({ text: String(x?.text ?? '').trim(), done: !!x?.done })).filter((x: any) => x.text);
  const typeData = b.typeData && typeof b.typeData === 'object' ? b.typeData : {}; // drafts may be incomplete; checked on submit

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const ins = await c.query(
      `INSERT INTO permits(permit_no,type,requester_id,contractor,work_description,area_id,equipment_id,planned_start,planned_end,hazards,ppe,precautions,type_data)
       VALUES(md5(random()::text),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [b.type, actor.id, contractor, desc, areaId, equipmentId, start, end, list(b.hazards), list(b.ppe), JSON.stringify(precautions), JSON.stringify(typeData)]);
    const id = ins.rows[0].id as number;
    await c.query(`UPDATE permits SET permit_no='PTW-'||to_char(now(),'YYYY')||'-'||lpad(id::text,4,'0') WHERE id=$1`, [id]);
    await c.query(`INSERT INTO permit_audit_log(permit_id,actor_id,action,from_status,to_status) VALUES($1,$2,'create',NULL,'DRAFT')`, [id, actor.id]);
    await c.query('COMMIT');
    return id;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
