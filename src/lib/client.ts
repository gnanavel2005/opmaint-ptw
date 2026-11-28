/* eslint-disable @typescript-eslint/no-explicit-any */
export async function api<T = any>(path: string, opts: { method?: string; json?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e: any = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status; e.code = data.code;
    throw e;
  }
  return data as T;
}
export const fmt = (d: string | Date) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const STATUS: Record<string, string> = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Pending approval', APPROVED: 'Approved', ACTIVE: 'Active', SUSPENDED: 'Suspended',
  REJECTED: 'Rejected', EXPIRED: 'Expired', CLOSED: 'Closed, not yet verified', CLOSED_VERIFIED: 'Closed and verified', CANCELLED: 'Cancelled',
};
export const ROLE: Record<string, string> = { REQUESTER: 'Requester', AREA_OWNER: 'Area Owner', SAFETY_OFFICER: 'Safety Officer', ADMIN: 'Admin', SYSTEM: 'System' };
export function timeLeft(to: string | Date, now = Date.now()) {
  const m = Math.floor((new Date(to).getTime() - now) / 60000);
  if (m <= 0) return 'expired';
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
}
