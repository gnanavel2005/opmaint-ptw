// Permit type registry. Adding "Excavation" = add one entry here. No new table, form or route.
export type Field = {
  key: string; label: string;
  kind: 'text' | 'number' | 'select' | 'bool' | 'list' | 'datetime';
  required: boolean; options?: string[]; min?: number; max?: number; unit?: string;
};
export interface PermitType { label: string; fields: Field[] }

const f = (key: string, label: string, kind: Field['kind'], extra: Partial<Field> = {}): Field =>
  ({ key, label, kind, required: true, ...extra });

export const PERMIT_TYPES: Record<string, PermitType> = {
  HOT_WORK: { label: 'Hot Work', fields: [
    f('workType', 'Type of hot work', 'select', { options: ['welding', 'grinding', 'cutting', 'soldering'] }),
    f('fireWatch', 'Fire watch assigned', 'text'),
    f('extinguisherType', 'Fire extinguisher type present', 'select', { options: ['CO2', 'DCP', 'Foam', 'Water'] }),
    f('combustiblesClearedRadiusM', 'Combustibles cleared radius', 'number', { min: 0, unit: 'm' }),
    f('gasLelPct', 'Gas test LEL', 'number', { min: 0, max: 100, unit: '%' }),
    f('gasO2Pct', 'Gas test O₂', 'number', { min: 0, max: 100, unit: '%' }),
    f('gasTestTime', 'Gas test time', 'datetime'),
  ]},
  CONFINED_SPACE: { label: 'Confined Space Entry', fields: [
    f('spaceId', 'Space ID', 'text'), f('entryPoint', 'Entry point', 'text'),
    f('o2Pct', 'O₂', 'number', { min: 0, max: 100, unit: '%' }),
    f('lelPct', 'LEL', 'number', { min: 0, max: 100, unit: '%' }),
    f('h2sPpm', 'H₂S', 'number', { min: 0, unit: 'ppm' }),
    f('coPpm', 'CO', 'number', { min: 0, unit: 'ppm' }),
    f('testTime', 'Atmospheric test time', 'datetime'),
    f('standbyAttendant', 'Standby attendant', 'text'), f('rescuePlan', 'Rescue plan', 'text'),
    f('ventilationMethod', 'Ventilation method', 'select', { options: ['natural', 'forced air', 'extraction'] }),
    f('entryExitLog', 'Entry/exit log', 'list', { required: false }),
  ]},
  WORKING_AT_HEIGHT: { label: 'Working at Height', fields: [
    f('heightM', 'Height', 'number', { min: 0.1, unit: 'm' }),
    f('accessMethod', 'Access method', 'select', { options: ['scaffold', 'ladder', 'MEWP', 'rope'] }),
    f('fallArrest', 'Fall arrest equipment', 'text'),
    f('anchorPointChecked', 'Anchor point checked', 'bool'),
    f('barricadingBelow', 'Barricading below', 'bool'),
  ]},
  ELECTRICAL_LOTO: { label: 'Electrical / Isolation (LOTO)', fields: [
    f('equipmentTag', 'Equipment tag', 'text'), f('voltageLevel', 'Voltage level', 'text'),
    f('isolationPoints', 'Isolation points', 'list'), f('lockNumbers', 'Lock numbers', 'list'),
    f('tagNumbers', 'Tag numbers', 'list'), f('earthingApplied', 'Earthing applied', 'bool'),
    f('testedDeadBy', 'Tested dead by', 'text'),
  ]},
};

/** Returns a list of human-readable errors; empty list = valid. Runs on the server. */
export function validateTypeData(type: string, data: Record<string, unknown>): string[] {
  const t = PERMIT_TYPES[type];
  if (!t) return [`Unknown permit type: ${type}`];
  const errs: string[] = [];
  for (const fd of t.fields) {
    const v = data[fd.key];
    if (v === undefined || v === null || v === '') { if (fd.required) errs.push(`${fd.label} is required`); continue; }
    switch (fd.kind) {
      case 'text': if (typeof v !== 'string') errs.push(`${fd.label} must be text`); break;
      case 'bool': if (typeof v !== 'boolean') errs.push(`${fd.label} must be yes/no`); break;
      case 'datetime': if (typeof v !== 'string' || isNaN(Date.parse(v))) errs.push(`${fd.label} must be a date/time`); break;
      case 'select': if (!fd.options!.includes(v as string)) errs.push(`${fd.label} must be one of ${fd.options!.join(', ')}`); break;
      case 'list':
        if (!Array.isArray(v) || !v.every(x => typeof x === 'string') || (fd.required && v.length === 0))
          errs.push(`${fd.label} must be a non-empty list`);
        break;
      case 'number':
        if (typeof v !== 'number' || !isFinite(v)) errs.push(`${fd.label} must be a number`);
        else if ((fd.min !== undefined && v < fd.min) || (fd.max !== undefined && v > fd.max))
          errs.push(`${fd.label} is out of range`);
        break;
    }
  }
  return errs;
}
