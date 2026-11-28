import { Pool } from 'pg';

// One pool per server process (survives Next.js hot reload in dev).
const g = globalThis as unknown as { _pool?: Pool };
export const pool = g._pool ?? (g._pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }));
