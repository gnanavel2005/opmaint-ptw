import { describe, it, expect } from 'vitest';
import { transition, availableActions, DomainError, Actor, PermitState, Status } from '../src/domain/stateMachine';
import { PERMIT_TYPES, validateTypeData } from '../src/domain/permitTypes';

const start = new Date('2026-01-01T08:00:00Z'), end = new Date('2026-01-01T16:00:00Z');
const noon = new Date('2026-01-01T12:00:00Z');
const REQ: Actor = { id: 1, role: 'REQUESTER', areaIds: [] };
const OWNER: Actor = { id: 2, role: 'AREA_OWNER', areaIds: [10] };
const OTHER_OWNER: Actor = { id: 3, role: 'AREA_OWNER', areaIds: [20] };
const SO: Actor = { id: 4, role: 'SAFETY_OFFICER', areaIds: [] };
const SYS: Actor = { id: null, role: 'SYSTEM', areaIds: [] };
const permit = (status: Status, over: Partial<PermitState> = {}): PermitState => ({
  status, requesterId: 1, areaId: 10, plannedStart: start, plannedEnd: end,
  approvals: [{ slot: 'AREA_OWNER', status: 'PENDING' }, { slot: 'SAFETY_OFFICER', status: 'PENDING' }], ...over,
});
const allApproved = [{ slot: 'AREA_OWNER' as const, status: 'APPROVED' as const }, { slot: 'SAFETY_OFFICER' as const, status: 'APPROVED' as const }];
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'NO_ERROR'; };

describe('lifecycle', () => {
  it('rejects illegal transitions', () => {
    expect(code(() => transition(permit('DRAFT'), 'activate', REQ, noon))).toBe('ILLEGAL_TRANSITION');
    expect(code(() => transition(permit('CLOSED_VERIFIED'), 'cancel', REQ, noon, { comment: 'x' }))).toBe('ILLEGAL_TRANSITION');
  });
  it('needs every approver before APPROVED', () => {
    const first = transition(permit('PENDING_APPROVAL'), 'approve', OWNER, noon, { slot: 'AREA_OWNER' });
    expect(first.to).toBe('PENDING_APPROVAL');
    const p = permit('PENDING_APPROVAL', { approvals: [{ slot: 'AREA_OWNER', status: 'APPROVED' }, { slot: 'SAFETY_OFFICER', status: 'PENDING' }] });
    expect(transition(p, 'approve', SO, noon, { slot: 'SAFETY_OFFICER' }).to).toBe('APPROVED');
  });
  it('cannot activate while approvals are missing, or before planned start', () => {
    expect(code(() => transition(permit('APPROVED'), 'activate', REQ, noon))).toBe('NOT_ALL_APPROVED');
    const early = new Date('2026-01-01T07:00:00Z');
    expect(code(() => transition(permit('APPROVED', { approvals: allApproved }), 'activate', REQ, early))).toBe('TOO_EARLY');
    expect(transition(permit('APPROVED', { approvals: allApproved }), 'activate', REQ, noon).to).toBe('ACTIVE');
  });
  it('expired permits can never be reactivated', () => {
    const late = new Date('2026-01-01T17:00:00Z');
    expect(code(() => transition(permit('ACTIVE'), 'expire', SYS, noon))).toBe('NOT_EXPIRED');
    expect(code(() => transition(permit('ACTIVE'), 'expire', SO, late))).toBe('FORBIDDEN');
    expect(transition(permit('ACTIVE'), 'expire', SYS, late).to).toBe('EXPIRED');
    expect(code(() => transition(permit('EXPIRED'), 'activate', SO, noon))).toBe('ILLEGAL_TRANSITION');
    expect(code(() => transition(permit('EXPIRED'), 'resume', SO, noon))).toBe('ILLEGAL_TRANSITION');
    expect(code(() => transition(permit('APPROVED', { approvals: allApproved }), 'activate', REQ, late))).toBe('WINDOW_PASSED');
  });
  it('suspend is safety-officer only and needs a reason', () => {
    expect(code(() => transition(permit('ACTIVE'), 'suspend', REQ, noon, { comment: 'gas alarm' }))).toBe('FORBIDDEN');
    expect(code(() => transition(permit('ACTIVE'), 'suspend', SO, noon))).toBe('COMMENT_REQUIRED');
    expect(transition(permit('ACTIVE'), 'suspend', SO, noon, { comment: 'gas alarm' }).to).toBe('SUSPENDED');
  });
  it('close by requester needs notes; only a safety officer verifies', () => {
    expect(code(() => transition(permit('ACTIVE'), 'close', REQ, noon))).toBe('COMMENT_REQUIRED');
    expect(transition(permit('ACTIVE'), 'close', REQ, noon, { comment: 'done' }).to).toBe('CLOSED');
    expect(code(() => transition(permit('ACTIVE'), 'close', { id: 9, role: 'REQUESTER', areaIds: [] }, noon, { comment: 'done' }))).toBe('FORBIDDEN');
    expect(code(() => transition(permit('CLOSED'), 'verify', REQ, noon))).toBe('FORBIDDEN');
    expect(transition(permit('CLOSED'), 'verify', SO, noon).to).toBe('CLOSED_VERIFIED');
  });
});

describe('permissions', () => {
  it('nobody approves their own permit, whatever their role', () => {
    const own = permit('PENDING_APPROVAL', { requesterId: 4 });
    expect(code(() => transition(own, 'approve', SO, noon, { slot: 'SAFETY_OFFICER' }))).toBe('SELF_APPROVAL');
    const adminOwn = permit('PENDING_APPROVAL', { requesterId: 5 });
    expect(code(() => transition(adminOwn, 'approve', { id: 5, role: 'ADMIN', areaIds: [] }, noon, { slot: 'AREA_OWNER' }))).toBe('SELF_APPROVAL');
  });
  it('area owner approves only their own area; requester approves nothing', () => {
    expect(code(() => transition(permit('PENDING_APPROVAL'), 'approve', OTHER_OWNER, noon, { slot: 'AREA_OWNER' }))).toBe('FORBIDDEN');
    expect(code(() => transition(permit('PENDING_APPROVAL'), 'approve', { id: 7, role: 'REQUESTER', areaIds: [] }, noon, { slot: 'AREA_OWNER' }))).toBe('FORBIDDEN');
  });
  it('rejection needs a reason', () => {
    expect(code(() => transition(permit('PENDING_APPROVAL'), 'reject', SO, noon, { slot: 'SAFETY_OFFICER' }))).toBe('COMMENT_REQUIRED');
    expect(transition(permit('PENDING_APPROVAL'), 'reject', SO, noon, { slot: 'SAFETY_OFFICER', comment: 'no gas test' }).to).toBe('REJECTED');
  });
  it('UI buttons match the rules', () => {
    expect(availableActions(permit('DRAFT'), REQ, noon)).toEqual(['submit', 'cancel']);
    expect(availableActions(permit('ACTIVE'), REQ, noon)).not.toContain('suspend');
    expect(availableActions(permit('ACTIVE'), SO, noon)).toContain('suspend');
  });
});

describe('permit type registry', () => {
  it('validates type-specific fields on the server', () => {
    expect(validateTypeData('HOT_WORK', {}).length).toBeGreaterThan(5);
    expect(validateTypeData('HOT_WORK', { workType: 'welding', fireWatch: 'Ravi', extinguisherType: 'DCP',
      combustiblesClearedRadiusM: 10, gasLelPct: 0, gasO2Pct: 20.9, gasTestTime: '2026-01-01T08:00:00Z' })).toEqual([]);
    expect(validateTypeData('NOPE', {})).toEqual(['Unknown permit type: NOPE']);
  });
  it('a new type is one registry entry', () => {
    PERMIT_TYPES.EXCAVATION = { label: 'Excavation', fields: [{ key: 'depthM', label: 'Depth', kind: 'number', required: true, min: 0.1 }] };
    expect(validateTypeData('EXCAVATION', { depthM: 2 })).toEqual([]);
    expect(validateTypeData('EXCAVATION', {})).toEqual(['Depth is required']);
    delete PERMIT_TYPES.EXCAVATION;
  });
});
