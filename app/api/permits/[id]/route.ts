import { json, route, requireUser, idParam } from '../../../../src/lib/http';
import { getPermit } from '../../../../src/lib/permits';


export const GET = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  return json(200, await getPermit(user, idParam((await ctx.params).id)));
});
