


import { clearCookie } from '../../../../src/lib/auth';
import { json, route } from '../../../../src/lib/http';

export const POST = route(async () => 
  json(200, { ok: true }, { 'set-cookie': clearCookie() })
);
