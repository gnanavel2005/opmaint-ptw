import { json, route } from '../../../../src/lib/http';
import { expireDue } from '../../../../src/lib/permits';
import { DomainError } from '../../../../src/domain/stateMachine';


// Hit by a scheduler (Vercel Cron / cron-job.org) with header "Authorization: Bearer <CRON_SECRET>".
export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) throw new DomainError('FORBIDDEN', 'Bad cron secret');
  return json(200, { expired: await expireDue() });
});
