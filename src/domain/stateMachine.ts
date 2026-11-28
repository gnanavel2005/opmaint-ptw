// Pure, framework-free state machine. API routes call transition() inside a DB transaction
// (SELECT ... FOR UPDATE on the permit row), then persist `to`, the approval change and the audit entry.
export type Status = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED'
  | 'EXPIRED' | 'CLOSED' | 'CLOSED_VERIFIED' | 'CANCELLED';
export type Action = 'submit' | 'approve' | 'reject' | 'activate' | 'suspend' | 'resume' | 'expire'
  | 'close' | 'verify' | 'cancel';
export type Role = 'REQUESTER' | 'AREA_OWNER' | 'SAFETY_OFFICER' | 'ADMIN' | 'SYSTEM';
export type Slot = 'AREA_OWNER' | 'SAFETY_OFFICER';
export interface Actor { id: number | null; role: Role; areaIds: number[] }
export interface Approval { slot: Slot; status: 'PENDING' | 'APPROVED' | 'REJECTED' }
export interface PermitState {
  status: Status; requesterId: number; areaId: number; plannedStart: Date; plannedEnd: Date; approvals: Approval[];
}
export interface Input { comment?: string; slot?: Slot }
export interface Result {
  to: Status; slot?: Slot; slotStatus?: 'APPROVED' | 'REJECTED';
  audit: { action: Action; actorId: number | null; from: Status; to: Status; comment?: string; at: Date };
}

export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const fail = (code: string, msg: string): never => { throw new DomainError(code, msg); };

const T: Record<Action, { from: Status[]; to?: Status }> = {
  submit:   { from: ['DRAFT'], to: 'PENDING_APPROVAL' },
  approve:  { from: ['PENDING_APPROVAL'] },                 // to = APPROVED only when every slot approved
  reject:   { from: ['PENDING_APPROVAL'], to: 'REJECTED' },
  activate: { from: ['APPROVED'], to: 'ACTIVE' },
  suspend:  { from: ['ACTIVE'], to: 'SUSPENDED' },
  resume:   { from: ['SUSPENDED'], to: 'ACTIVE' },
  expire:   { from: ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED'], to: 'EXPIRED' },
  close:    { from: ['ACTIVE'], to: 'CLOSED' },
  verify:   { from: ['CLOSED'], to: 'CLOSED_VERIFIED' },
  cancel:   { from: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED'], to: 'CANCELLED' },
};

export function transition(p: PermitState, action: Action, actor: Actor, now: Date, input: Input = {}): Result {
  const rule = T[action];
  if (!rule.from.includes(p.status)) fail('ILLEGAL_TRANSITION', `Cannot ${action} a permit that is ${p.status}`);

  const priv = actor.role === 'SAFETY_OFFICER' || actor.role === 'ADMIN';
  const own = actor.id !== null && actor.id === p.requesterId;
  const allow = (ok: boolean, msg: string) => { if (!ok) fail('FORBIDDEN', msg); };
  const comment = input.comment?.trim() || undefined;
  const needComment = (what: string) => { if (!comment) fail('COMMENT_REQUIRED', `${what} is required`); };
  const expired = now >= p.plannedEnd;

  let to = rule.to as Status;
  let slot: Slot | undefined;
  let slotStatus: Result['slotStatus'];

  switch (action) {
    case 'submit': allow(own || actor.role === 'ADMIN', 'Only the requester can submit'); break;
    case 'approve':
    case 'reject': {
      if (own) fail('SELF_APPROVAL', 'You cannot approve or reject your own permit');
      slot = input.slot ?? fail('SLOT_REQUIRED', 'Approval slot is required');
      const a = p.approvals.find(x => x.slot === slot);
      if (!a || a.status !== 'PENDING') fail('NOT_PENDING', 'No pending approval for that slot');
      allow(actor.role === slot && (slot === 'SAFETY_OFFICER' || actor.areaIds.includes(p.areaId)),
        'You are not an approver for this permit');
      if (expired) fail('WINDOW_PASSED', 'Validity window has passed; raise a new permit');
      if (action === 'reject') { needComment('A rejection reason'); slotStatus = 'REJECTED'; }
      else {
        slotStatus = 'APPROVED';
        to = p.approvals.filter(x => x.slot !== slot).every(x => x.status === 'APPROVED') ? 'APPROVED' : 'PENDING_APPROVAL';
      }
      break;
    }
    case 'activate':
      allow(own || priv, 'Only the requester or a safety officer can activate');
      if (!p.approvals.length || !p.approvals.every(x => x.status === 'APPROVED')) fail('NOT_ALL_APPROVED', 'Every approver must approve first');
      if (now < p.plannedStart) fail('TOO_EARLY', 'Planned start time has not been reached');
      if (expired) fail('WINDOW_PASSED', 'Validity window has passed; raise a new permit');
      break;
    case 'suspend': allow(priv, 'Only a safety officer can suspend'); needComment('A suspension reason'); break;
    case 'resume':
      allow(priv, 'Only a safety officer can resume');
      if (expired) fail('WINDOW_PASSED', 'Permit has expired; raise a new permit');
      break;
    case 'expire':
      allow(actor.role === 'SYSTEM', 'Expiry is system-only');
      if (!expired) fail('NOT_EXPIRED', 'Validity window has not passed');
      break;
    case 'close': allow(own || priv, 'Only the requester or a safety officer can close'); needComment('Completion notes'); break;
    case 'verify': allow(priv, 'Only a safety officer can verify closure'); break;
    case 'cancel': allow(own || priv, 'Not allowed to cancel this permit'); needComment('A cancellation reason'); break;
  }
  return { to, slot, slotStatus, audit: { action, actorId: actor.id, from: p.status, to, comment, at: now } };
}

/** For reads: a permit past its window is EXPIRED even if the cron job has not run yet. */
export function effectiveStatus(p: PermitState, now: Date): Status {
  return (['PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED'] as Status[]).includes(p.status) && now >= p.plannedEnd ? 'EXPIRED' : p.status;
}

/** Which buttons to show this user. Uses the same rules as transition(), so UI and API cannot drift. */
export function availableActions(p: PermitState, actor: Actor, now: Date): Action[] {
  const pending = p.approvals.filter(x => x.status === 'PENDING').map(x => x.slot);
  return (Object.keys(T) as Action[]).filter(act => {
    const tries: (Slot | undefined)[] = act === 'approve' || act === 'reject' ? pending : [undefined];
    return tries.some(slot => {
      try { transition(p, act, actor, now, { comment: '-', slot }); return true; } catch { return false; }
    });
  });
}
