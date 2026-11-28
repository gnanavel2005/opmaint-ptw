// Seed: 5 users (one requester, two area owners, one safety officer, one admin), 2 plants, 4 areas, 6 equipment, 11 permits across every status.
// Run: npx tsx scripts/seed.ts   (needs DATABASE_URL in .env.local)
import { config } from 'dotenv';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { validateTypeData } from '../src/domain/permitTypes';
config({ path: '.env.local' });

const H = 3600e3, MIN = 60e3, now = Date.now();
const at = (hours: number) => new Date(now + hours * H);
const iso = (hours: number) => at(hours).toISOString();

const TYPE_DATA: Record<string, () => Record<string, unknown>> = {
  HOT_WORK: () => ({ workType: 'welding', fireWatch: 'Ravi Kumar', extinguisherType: 'DCP', combustiblesClearedRadiusM: 10, gasLelPct: 0, gasO2Pct: 20.9, gasTestTime: iso(-3) }),
  CONFINED_SPACE: () => ({ spaceId: 'V-102', entryPoint: 'Top manway M1', o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 2, testTime: iso(-3), standbyAttendant: 'Suresh', rescuePlan: 'Tripod and winch, rescue team on standby', ventilationMethod: 'forced air', entryExitLog: [] }),
  WORKING_AT_HEIGHT: () => ({ heightM: 8, accessMethod: 'scaffold', fallArrest: 'Full body harness with lanyard', anchorPointChecked: true, barricadingBelow: true }),
  ELECTRICAL_LOTO: () => ({ equipmentTag: 'P-101', voltageLevel: '415 V', isolationPoints: ['MCC-3 feeder 7', 'Local isolator'], lockNumbers: ['L-114', 'L-115'], tagNumbers: ['T-220'], earthingApplied: true, testedDeadBy: 'Murugan (Electrician)' }),
};
const HAZARDS: Record<string, string[]> = {
  HOT_WORK: ['Fire', 'Flammable vapour'], CONFINED_SPACE: ['Toxic gas', 'Low oxygen'],
  WORKING_AT_HEIGHT: ['Fall from height', 'Falling objects'], ELECTRICAL_LOTO: ['Electric shock', 'Stored energy'],
};
const PRECAUTIONS: Record<string, string[]> = {
  HOT_WORK: ['Isolate the line', 'Test the atmosphere', 'Fire extinguisher and fire watch present', 'Remove combustibles within 10 m'],
  CONFINED_SPACE: ['Isolate and blank all lines', 'Test atmosphere before entry', 'Standby attendant at entry', 'Rescue equipment ready'],
  WORKING_AT_HEIGHT: ['Inspect scaffold tag', 'Anchor point checked', 'Barricade area below', 'No work in high wind'],
  ELECTRICAL_LOTO: ['Isolate and lock out', 'Test dead', 'Apply earthing', 'Tag every isolation point'],
};
const PPE: Record<string, string[]> = {
  HOT_WORK: ['Helmet', 'Safety shoes', 'Welding shield', 'Gloves'], CONFINED_SPACE: ['Helmet', 'Safety shoes', 'Gas monitor', 'Harness'],
  WORKING_AT_HEIGHT: ['Helmet', 'Safety shoes', 'Full body harness'], ELECTRICAL_LOTO: ['Helmet', 'Safety shoes', 'Insulated gloves'],
};

type Who = 'req' | 'own' | 'own2' | 'so' | 'adm' | 'sys';
type Step = [action: string, to: string, who: Who, comment?: string];
const sub: Step = ['submit', 'PENDING_APPROVAL', 'req'];
const ownOk: Step = ['approve', 'PENDING_APPROVAL', 'own', 'Area isolated and safe to proceed'];
const own2Ok: Step = ['approve', 'PENDING_APPROVAL', 'own2', 'Area isolated and safe to proceed'];
const soOk: Step = ['approve', 'APPROVED', 'so', 'Site inspected, precautions verified'];
const act: Step = ['activate', 'ACTIVE', 'req'];
const close: Step = ['close', 'CLOSED', 'req', 'Work complete, area cleaned'];

const specs = [
  { type: 'HOT_WORK', area: 'fab', equip: 'FAB-01', desc: 'Weld support bracket onto pipe rack', who: 'Sharma Fabricators', s: 20, e: 28, ago: 0.5, flow: [] as Step[] },
  { type: 'WORKING_AT_HEIGHT', area: 'boiler', equip: 'BLR-01', desc: 'Replace insulation cladding on boiler top deck', who: 'Kumar Scaffolding', s: 3, e: 9, ago: 0.5, flow: [sub] },
  { type: 'ELECTRICAL_LOTO', area: 'pump', equip: 'PMP-101', desc: 'Replace motor starter on pump P-101', who: 'Volt Electricals', s: 4, e: 10, ago: 0.5, flow: [sub, ownOk] },
  { type: 'CONFINED_SPACE', area: 'boiler', equip: 'BLR-02', desc: 'Inspect and clean feed water tank', who: 'Aqua Services', s: 2, e: 8, ago: 0.5, flow: [sub, ownOk, soOk] },
  { type: 'HOT_WORK', area: 'boiler', equip: 'BLR-01', desc: 'Grind and weld steam line flange', who: 'Sharma Fabricators', s: -2, e: 6, ago: 2, flow: [sub, ownOk, soOk, act] },
  { type: 'ELECTRICAL_LOTO', area: 'pump', equip: 'PMP-102', desc: 'Megger test and terminal tightening on P-102 motor', who: 'Volt Electricals', s: -5, e: 1.5, ago: 5, flow: [sub, ownOk, soOk, act] },
  { type: 'CONFINED_SPACE', area: 'tank', equip: 'TNK-201', desc: 'Internal inspection of storage tank', who: 'Aqua Services', s: -3, e: 5, ago: 1, flow: [sub, own2Ok, soOk, act, ['suspend', 'SUSPENDED', 'so', 'Gas alarm in adjacent unit'] as Step] },
  { type: 'HOT_WORK', area: 'tank', equip: 'TNK-201', desc: 'Cut and weld drain nozzle', who: 'Sharma Fabricators', s: 5, e: 12, ago: 3, flow: [sub, ['reject', 'REJECTED', 'so', 'Gas test missing, retest and resubmit'] as Step] },
  { type: 'WORKING_AT_HEIGHT', area: 'boiler', equip: 'BLR-01', desc: 'Paint structural steel on boiler platform', who: 'Kumar Scaffolding', s: -10, e: -2, ago: 1.5, flow: [sub, ownOk, soOk, act, close] },
  { type: 'ELECTRICAL_LOTO', area: 'pump', equip: 'PMP-101', desc: 'Replace motor bearings on P-101', who: 'Volt Electricals', s: -52, e: -44, ago: 40, flow: [sub, ownOk, soOk, act, close, ['verify', 'CLOSED_VERIFIED', 'so', 'Area inspected, permit closed'] as Step] },
  { type: 'HOT_WORK', area: 'fab', equip: 'FAB-01', desc: 'Cut and weld handrail', who: 'Sharma Fabricators', s: -30, e: -16, ago: 16, flow: [sub, own2Ok, soOk, act, ['expire', 'EXPIRED', 'sys', 'Validity window passed'] as Step] },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing in .env.local');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
    if (rows[0].n > 0) {
      console.log('Already seeded. To reseed run in Neon SQL Editor: DROP SCHEMA public CASCADE; CREATE SCHEMA public; then run db/schema.sql again.');
      return;
    }
    await db.query('BEGIN');
    const one = async (sql: string, args: unknown[]) => (await db.query(sql, args)).rows[0].id as number;

    const hash = await bcrypt.hash('Demo@1234', 10);
    const user = (email: string, name: string, role: string) =>
      one('INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id', [email, name, hash, role]);
    const U: Record<Who, number | null> = {
      req: await user('requester@demo.com', 'Arun (Requester)', 'REQUESTER'),
      own: await user('owner@demo.com', 'Meena (Area Owner)', 'AREA_OWNER'),
      own2: await user('owner2@demo.com', 'Divya (Area Owner)', 'AREA_OWNER'),
      so: await user('safety@demo.com', 'Karthik (Safety Officer)', 'SAFETY_OFFICER'),
      adm: await user('admin@demo.com', 'Admin', 'ADMIN'),
      sys: null,
    };

    const plant = (name: string) => one('INSERT INTO plants(name) VALUES($1) RETURNING id', [name]);
    const area = (p: number, name: string) => one('INSERT INTO areas(plant_id,name) VALUES($1,$2) RETURNING id', [p, name]);
    const p1 = await plant('Chennai Refinery Unit'), p2 = await plant('Ennore Packaging Plant');
    const A: Record<string, number> = {
      boiler: await area(p1, 'Boiler House'), pump: await area(p1, 'Pump Station'),
      tank: await area(p2, 'Tank Farm'), fab: await area(p2, 'Fabrication Shop'),
    };
    // Meena owns the permit's Fabrication Shop area; Divya owns Tank Farm.
    for (const a of ['boiler', 'pump', 'fab']) await db.query('INSERT INTO user_areas(user_id,area_id) VALUES($1,$2)', [U.own, A[a]]);
    await db.query('INSERT INTO user_areas(user_id,area_id) VALUES($1,$2)', [U.own2, A.tank]);

    const equip = (a: string, tag: string, name: string) =>
      one('INSERT INTO equipment(area_id,tag,name) VALUES($1,$2,$3) RETURNING id', [A[a], tag, name]).then(id => [tag, id] as const);
    const E = Object.fromEntries([
      await equip('boiler', 'BLR-01', 'Boiler 1'), await equip('boiler', 'BLR-02', 'Feed water tank'),
      await equip('pump', 'PMP-101', 'Transfer pump P-101'), await equip('pump', 'PMP-102', 'Transfer pump P-102'),
      await equip('tank', 'TNK-201', 'Storage tank 201'), await equip('fab', 'FAB-01', 'Pipe rack'),
    ]);

    let n = 0;
    for (const sp of specs) {
      const typeData = TYPE_DATA[sp.type]();
      const errs = validateTypeData(sp.type, typeData);
      if (errs.length) throw new Error(`Seed permit invalid: ${errs.join('; ')}`);
      const status = sp.flow.length ? sp.flow[sp.flow.length - 1][1] : 'DRAFT';
      const closeStep = sp.flow.find(f => f[0] === 'close');
      const id = await one(
        `INSERT INTO permits(permit_no,type,status,requester_id,contractor,work_description,area_id,equipment_id,
           planned_start,planned_end,hazards,ppe,precautions,type_data,completion_notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [`PTW-2026-${String(++n).padStart(4, '0')}`, sp.type, status, U.req, sp.who, sp.desc, A[sp.area], E[sp.equip],
         at(sp.s), at(sp.e), HAZARDS[sp.type], PPE[sp.type],
         JSON.stringify(PRECAUTIONS[sp.type].map(text => ({ text, done: status !== 'DRAFT' && status !== 'PENDING_APPROVAL' }))),
         JSON.stringify(typeData), closeStep?.[3] ?? null]);

      // Audit trail: one entry per step, spaced 20 minutes apart, the last one `ago` hours ago.
      const lastAt = now - sp.ago * H;
      const total = sp.flow.length;
      const when = (i: number) => new Date(lastAt - (total - i) * 20 * MIN);
      const audit = (act: string, from: string | null, to: string, by: number | null, comment: string | null | undefined, t: Date) =>
        db.query('INSERT INTO permit_audit_log(permit_id,actor_id,action,from_status,to_status,comment,at) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [id, by, act, from, to, comment ?? null, t]);
      await audit('create', null, 'DRAFT', U.req, null, when(-1));
      let prev = 'DRAFT';
      const slots: Record<string, { status: string; by: number | null; comment?: string; at?: Date }> = {
        AREA_OWNER: { status: 'PENDING', by: null }, SAFETY_OFFICER: { status: 'PENDING', by: null },
      };
      for (let i = 0; i < total; i++) {
        const [action, to, who, comment] = sp.flow[i];
        await audit(action, prev, to, U[who], comment, when(i));
        if (action === 'approve' || action === 'reject') {
          const slot = who === 'so' ? 'SAFETY_OFFICER' : 'AREA_OWNER';
          slots[slot] = { status: action === 'approve' ? 'APPROVED' : 'REJECTED', by: U[who], comment, at: when(i) };
        }
        prev = to;
      }
      if (total) for (const [slot, s] of Object.entries(slots))
        await db.query('INSERT INTO permit_approvals(permit_id,slot,status,approver_id,comment,decided_at) VALUES($1,$2,$3,$4,$5,$6)',
          [id, slot, s.status, s.by, s.comment ?? null, s.at ?? null]);
    }
    await db.query('COMMIT');
    console.log(`Seeded: 5 users, 2 plants, 4 areas, 6 equipment, ${specs.length} permits.`);
    console.log('Login (all passwords: Demo@1234): requester@demo.com, owner@demo.com, owner2@demo.com, safety@demo.com, admin@demo.com');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
