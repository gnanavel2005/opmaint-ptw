import { pool } from '../../../src/lib/db';
import { json, route, requireUser } from '../../../src/lib/http';
import { PERMIT_TYPES } from '../../../src/domain/permitTypes';


// Reference data for filters and forms: areas, equipment and the permit type registry.
export const GET = route(async (req) => {
  await requireUser(req);
  const areas = await pool.query('SELECT a.id,a.name,p.name AS plant_name FROM areas a JOIN plants p ON p.id=a.plant_id ORDER BY p.name,a.name');
  const equipment = await pool.query('SELECT id,area_id,tag,name FROM equipment ORDER BY tag');
  return json(200, { areas: areas.rows, equipment: equipment.rows, types: PERMIT_TYPES });
});
