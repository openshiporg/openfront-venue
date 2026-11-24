import { gql } from '../../lib/gql';
import { label } from '../../lib/format';
import { ActionButton } from '../../components/ActionButton';
import { Page, Row, Rows } from '../../components/ui-bits';
import { roleFlags } from '../../lib/guard';
import { RecordEditor, type FieldSpec } from '../../components/RecordEditor';

const TZ: [string, string][] = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London'].map((z) => [z, z.replace(/_/g, ' ')]);
const fields: FieldSpec[] = [
  { name: 'name', label: 'Name', required: true, wide: true },
  { name: 'city', label: 'City', required: true },
  { name: 'timezone', label: 'Time zone', kind: 'select', options: TZ, required: true },
  { name: 'address', label: 'Address', wide: true },
  { name: 'contact', label: 'Contact', wide: true },
  { name: 'capacity', label: 'Licensed capacity', kind: 'int', required: true },
  { name: 'defaultFacilityFeeCents', label: 'Facility fee ($)', kind: 'money' },
  { name: 'taxBps', label: 'Tax rate (%)', kind: 'percent' },
  { name: 'description', label: 'Public description', wide: true },
  { name: 'accessibilityNotes', label: 'Accessibility', wide: true },
  { name: 'loadInNotes', label: 'Load-in notes', wide: true },
];

export async function RoomListPage() {
  const { canManageRooms } = await roleFlags('canManageRooms');
  const data = await gql(`{ rooms(orderBy: [{ name: asc }]) { id name city timezone address contact capacity defaultFacilityFeeCents taxBps description accessibilityNotes loadInNotes seatingChart_room { id name version status chartSection_chart(orderBy: [{ sort: asc }]) { id name kind capacity } } } }`);
  return (
    <Page title="Rooms and configurations">
      {canManageRooms ? <RecordEditor list="Room" fields={fields} values={{ timezone: 'America/Los_Angeles' }} trigger="Add room" title="New room" /> : null}
      <Rows empty="No rooms.">
        {data.rooms.map((v: any) => <Row key={v.id} title={v.name} meta={`${v.city} · licensed capacity ${v.capacity}`} right={<>{canManageRooms ? <RecordEditor list="Room" id={v.id} values={v} fields={fields} trigger="Edit" title={`Edit ${v.name}`} /> : null}{v.seatingChart_room.map((c: any) => <div key={c.id}>{c.name} v{c.version} <span className="font-mono text-xs uppercase tracking-wide">{label(c.status)}</span> {c.status === 'draft' ? <ActionButton command="publishSeatingChart" input={{ seatingChartId: c.id }}>Publish chart</ActionButton> : null}: {c.chartSection_chart.map((s: any) => `${s.name} ${s.kind === 'ga' ? 'GA' : 'reserved'} ${s.capacity}`).join(', ')}</div>)}</>} />)}
      </Rows>
    </Page>
  );
}
