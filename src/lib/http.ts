import { DomainError } from '../domain/stateMachine';
import { currentUser, type User } from './auth';

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, SELF_APPROVAL: 403, NOT_FOUND: 404,
  ILLEGAL_TRANSITION: 409, NOT_PENDING: 409, NOT_ALL_APPROVED: 409, TOO_EARLY: 409, WINDOW_PASSED: 409, NOT_EXPIRED: 409,
  COMMENT_REQUIRED: 400, SLOT_REQUIRED: 400, VALIDATION: 400,
};
export const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Wraps a handler so domain errors become clear JSON errors with the right HTTP status. */
export function route<C = unknown>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try { return await fn(req, ctx); }
    catch (e) {
      if (e instanceof DomainError) return json(STATUS[e.code] ?? 400, { error: e.message, code: e.code });
      console.error(e);
      return json(500, { error: 'Internal server error' });
    }
  };
}
export async function requireUser(req: Request): Promise<User> {
  const u = await currentUser(req);
  if (!u) throw new DomainError('UNAUTHENTICATED', 'Please log in');
  return u;
}
export async function readBody(req: Request): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try { const b = await req.json(); if (b && typeof b === 'object') return b; } catch { /* fall through */ }
  throw new DomainError('VALIDATION', 'Request body must be a JSON object');
}
export const idParam = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new DomainError('NOT_FOUND', 'Permit not found');
  return n;
};
