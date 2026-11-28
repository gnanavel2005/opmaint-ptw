import { json, route, requireUser, readBody, idParam } from '../../../../../src/lib/http';
import { perform } from '../../../../../src/lib/permits';
import { DomainError, type Action } from '../../../../../src/domain/stateMachine';

// 'expire' is deliberately not callable from the API: only the system (cron / lazy check) expires permits.
const ACTIONS = ['submit', 'approve', 'reject', 'activate', 'suspend', 'resume', 'close', 'verify', 'cancel'];

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const id = idParam((await ctx.params).id);
  const b = await readBody(req);
  if (!ACTIONS.includes(b.action)) throw new DomainError('VALIDATION', `Unknown action. Use one of: ${ACTIONS.join(', ')}`);
  const status = await perform(id, b.action as Action, user, { comment: b.comment, slot: b.slot, signature: b.signature });
  return json(200, { status });
});
