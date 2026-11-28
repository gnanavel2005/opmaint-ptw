'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Shell } from '../../../src/components/ui';
import { api } from '../../../src/lib/client';
import type { Field, PermitType } from '../../../src/domain/permitTypes';

type Lookups = {
  areas: { id: number; name: string; plant_name: string }[];
  equipment: { id: number; area_id: number; tag: string; name: string }[];
  types: Record<string, PermitType>;
};

const listValues = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

export default function NewPermitPage() {
  return <Shell>{user => <NewPermit user={user} />}</Shell>;
}

function NewPermit({ user }: { user: { role: string } }) {
  const router = useRouter();
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [type, setType] = useState('');
  const [areaId, setAreaId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [typeValues, setTypeValues] = useState<Record<string, string>>({});
  const [contractor, setContractor] = useState('');
  const [description, setDescription] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [hazards, setHazards] = useState('');
  const [ppe, setPpe] = useState('');
  const [precautions, setPrecautions] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Lookups>('/api/lookups').then(setLookups).catch((e: Error) => setErr(e.message));
  }, []);

  if (user.role !== 'REQUESTER' && user.role !== 'ADMIN') {
    return <><Link href="/">← All permits</Link><p className="err" role="alert">Only requesters and admins can raise permits.</p></>;
  }

  const permitType = lookups?.types[type];
  const equipment = lookups?.equipment.filter(item => String(item.area_id) === areaId) ?? [];

  function fieldControl(field: Field) {
    const value = typeValues[field.key] ?? '';
    const update = (next: string) => setTypeValues(current => ({ ...current, [field.key]: next }));
    const required = field.required;
    if (field.kind === 'select') {
      return <select required={required} value={value} onChange={e => update(e.target.value)}>
        <option value="">Select…</option>
        {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
      </select>;
    }
    if (field.kind === 'bool') {
      return <select required={required} value={value} onChange={e => update(e.target.value)}>
        <option value="">Select…</option><option value="true">Yes</option><option value="false">No</option>
      </select>;
    }
    if (field.kind === 'list') {
      return <textarea required={required} rows={2} value={value} onChange={e => update(e.target.value)} placeholder="Separate items with commas" />;
    }
    return <input
      type={field.kind === 'number' ? 'number' : field.kind === 'datetime' ? 'datetime-local' : 'text'}
      required={required}
      min={field.kind === 'number' ? field.min : undefined}
      max={field.kind === 'number' ? field.max : undefined}
      step={field.kind === 'number' ? 'any' : undefined}
      value={value}
      onChange={e => update(e.target.value)}
    />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (!permitType) throw new Error('Choose a permit type');
      const typeData = Object.fromEntries(permitType.fields.flatMap((field): [string, unknown][] => {
        const value = typeValues[field.key] ?? '';
        if (!value) return [];
        if (field.kind === 'number') return [[field.key, Number(value)]];
        if (field.kind === 'bool') return [[field.key, value === 'true']];
        if (field.kind === 'list') return [[field.key, listValues(value)]];
        if (field.kind === 'datetime') return [[field.key, new Date(value).toISOString()]];
        return [[field.key, value]];
      }));
      const created = await api<{ id: number }>('/api/permits', {
        method: 'POST',
        json: {
          type, areaId, equipmentId: equipmentId || undefined, contractor, workDescription: description,
          plannedStart: new Date(plannedStart).toISOString(), plannedEnd: new Date(plannedEnd).toISOString(),
          hazards: listValues(hazards), ppe: listValues(ppe),
          precautions: precautions.split('\n').map(text => text.trim()).filter(Boolean).map(text => ({ text, done: false })),
          typeData,
        },
      });
      router.push(`/permits/${created.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <Link href="/">← All permits</Link>
      <h1>New permit</h1>
      {!lookups && !err && <p className="muted">Loading form…</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {lookups && (
        <form className="card form" onSubmit={submit}>
          <label>Permit type
            <select required value={type} onChange={e => { setType(e.target.value); setTypeValues({}); }}>
              <option value="">Select a permit type…</option>
              {Object.entries(lookups.types).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
            </select>
          </label>
          <label>Area
            <select required value={areaId} onChange={e => { setAreaId(e.target.value); setEquipmentId(''); }}>
              <option value="">Select an area…</option>
              {lookups.areas.map(area => <option key={area.id} value={area.id}>{area.plant_name} → {area.name}</option>)}
            </select>
          </label>
          <label>Equipment (optional)
            <select value={equipmentId} onChange={e => setEquipmentId(e.target.value)} disabled={!areaId}>
              <option value="">None</option>
              {equipment.map(item => <option key={item.id} value={item.id}>{item.tag} — {item.name}</option>)}
            </select>
          </label>
          <label>Contractor / team
            <input required value={contractor} onChange={e => setContractor(e.target.value)} />
          </label>
          <label>Work description
            <textarea required rows={3} value={description} onChange={e => setDescription(e.target.value)} />
          </label>
          <div className="row">
            <label>Planned start<input required type="datetime-local" value={plannedStart} onChange={e => setPlannedStart(e.target.value)} /></label>
            <label>Planned end<input required type="datetime-local" value={plannedEnd} onChange={e => setPlannedEnd(e.target.value)} /></label>
          </div>
          {permitType && <>
            <h2>{permitType.label} details</h2>
            {permitType.fields.map(field => <label key={field.key}>{field.label}{field.unit ? ` (${field.unit})` : ''}{field.required ? ' *' : ' (optional)'}
              {fieldControl(field)}
            </label>)}
          </>}
          <label>Hazards (comma-separated)
            <input value={hazards} onChange={e => setHazards(e.target.value)} />
          </label>
          <label>PPE required (comma-separated)
            <input value={ppe} onChange={e => setPpe(e.target.value)} />
          </label>
          <label>Precautions (one per line)
            <textarea rows={3} value={precautions} onChange={e => setPrecautions(e.target.value)} />
          </label>
          <div className="row">
            <Link className="btn ghost" href="/">Cancel</Link>
            <button className="btn primary" disabled={busy || !lookups}>{busy ? 'Creating…' : 'Create permit'}</button>
          </div>
        </form>
      )}
    </>
  );
}
