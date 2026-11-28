import { json, route, requireUser, readBody } from '../../../src/lib/http';
import { listPermits, createPermit } from '../../../src/lib/permits';


export const GET = route(async (req) => {
  const user = await requireUser(req);
  const q = new URL(req.url).searchParams;
  return json(200, await listPermits(user, {
    status: q.get('status') || undefined, type: q.get('type') || undefined,
    areaId: q.get('area') ? Number(q.get('area')) : undefined,
    from: q.get('from') || undefined, to: q.get('to') || undefined,
    pendingMine: q.get('pendingMine') === '1',
  }));
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  return json(201, { id: await createPermit(user, await readBody(req)) });
});
