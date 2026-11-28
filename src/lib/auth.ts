import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from './db';
import type { Actor } from '../domain/stateMachine';

export type User = Actor & { id: number; email: string; name: string };

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET is missing or too short (.env.local)');
  return s;
};
const sign = (v: string) => crypto.createHmac('sha256', secret()).update(v).digest('base64url');

/** Signed session cookie: "<userId>.<expiryMs>.<hmac>". Stateless, tamper-proof, HttpOnly. */
export function makeCookie(userId: number): string {
  const v = `${userId}.${Date.now() + 8 * 3600e3}`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `session=${v}.${sign(v)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure}`;
}
export const clearCookie = () => 'session=; HttpOnly; Path=/; Max-Age=0';

export async function verifyLogin(email: string, password: string) {
  const { rows } = await pool.query('SELECT id,email,name,role,password_hash FROM users WHERE lower(email)=lower($1)', [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return null;
  return { id: u.id as number, email: u.email as string, name: u.name as string, role: u.role as string };
}

export async function currentUser(req: Request): Promise<User | null> {
  const m = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.get('cookie') ?? '');
  if (!m) return null;
  const [id, exp, sig] = m[1].split('.');
  const expected = sign(`${id}.${exp}`);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (!(Date.now() < Number(exp))) return null;
  const { rows } = await pool.query(
    `SELECT u.id,u.email,u.name,u.role,
            COALESCE(array_agg(ua.area_id) FILTER (WHERE ua.area_id IS NOT NULL), '{}') AS area_ids
       FROM users u LEFT JOIN user_areas ua ON ua.user_id=u.id WHERE u.id=$1 GROUP BY u.id`, [Number(id)]);
  const u = rows[0];
  return u ? { id: u.id, email: u.email, name: u.name, role: u.role, areaIds: u.area_ids } : null;
}
