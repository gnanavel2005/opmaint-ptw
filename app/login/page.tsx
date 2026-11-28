'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../src/lib/client';

const DEMO = [['Requester', 'requester@demo.com'], ['Area Owner', 'owner@demo.com'], ['Safety Officer', 'safety@demo.com'], ['Admin', 'admin@demo.com']];

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/api/auth/login', { method: 'POST', json: { email, password } }); router.replace('/'); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  return (
    <div className="loginbox">
      <h1>PermitDesk</h1>
      <p className="muted">Permit to Work for plant maintenance</p>
      <form onSubmit={submit} className="card form">
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
      </form>
      <div className="card">
        <b>Demo accounts</b> <span className="muted">(password for all: Demo@1234)</span>
        <div className="chips">{DEMO.map(([n, m]) => <button key={m} className="btn ghost sm" onClick={() => { setEmail(m); setPassword('Demo@1234'); }}>{n}</button>)}</div>
      </div>
    </div>
  );
}
