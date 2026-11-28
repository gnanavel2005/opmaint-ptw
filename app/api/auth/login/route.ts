import { verifyLogin, makeCookie } from '../../../../src/lib/auth';
import { json, route, readBody } from '../../../../src/lib/http';
import { DomainError } from '../../../../src/domain/stateMachine';

export const POST = route(async (req) => {
  const b = await readBody(req);
  const user = await verifyLogin(String(b.email ?? ''), String(b.password ?? ''));
  if (!user) throw new DomainError('UNAUTHENTICATED', 'Wrong email or password');
  return json(200, { user }, { 'set-cookie': makeCookie(user.id) });
});
