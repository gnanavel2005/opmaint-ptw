import { json, route, requireUser } from '../../../src/lib/http';

export const GET = route(async (req) => json(200, { user: await requireUser(req) }));
