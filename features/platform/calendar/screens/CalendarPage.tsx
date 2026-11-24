import { gql } from '../../lib/gql';
import { roleFlags } from '../../lib/guard';
import { day } from '../../lib/format';
import { Page, Row, Rows } from '../../components/ui-bits';
import { HoldActions } from '../components/HoldActions';
import { lapseReason } from '../../../keystone/lib/hold-rules';
import { PlaceHoldForm } from '../components/PlaceHoldForm';

const KIND: Record<string, string> = { show: 'Show', rental: 'Rental', private_event: 'Private event', internal: 'House' };
const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

export async function CalendarPage() {
  const can = await roleFlags('canManageEvents');
  const data = await gql(`{
    dateHolds(orderBy: [{ date: asc }, { rank: asc }], take: 200) { id date rank status kind notes releasedReason expiresAt challengeDeadline promoter { company } room { id name timezone } artist { name } event { id title } }
    rooms(orderBy: [{ name: asc }], take: 100) { id name city }
    promoters(orderBy: [{ company: asc }], take: 300) { id company }
    artists(orderBy: [{ name: asc }], take: 300) { id name }
    seatingCharts(where: { status: { equals: "published" } }, take: 200) { id name version room { id } }
  }`);
  const rooms = data.rooms.map((v: any) => ({ value: v.id, label: `${v.name}, ${v.city}` }));
  const promoters = data.promoters.map((p: any) => ({ value: p.id, label: p.company }));
  const artists = data.artists.map((a: any) => ({ value: a.id, label: a.name }));
  const chartsFor = (roomId?: string) => data.seatingCharts.filter((c: any) => c.room?.id === roomId).map((c: any) => ({ value: c.id, label: `${c.name} v${c.version}` }));
  const now = new Date();
  const groups = new Map<string, any[]>();
  for (const h of data.dateHolds) { const key = `${h.room?.name} · ${day(h.date)}`; groups.set(key, [...(groups.get(key) || []), h]); }
  return (
    <Page title="Calendar and holds" action={can.canManageEvents ? <PlaceHoldForm rooms={rooms} artists={artists} promoters={promoters} /> : null}>
      {[...groups.entries()].map(([key, holds]) => (
        <section key={key} className="space-y-2"><h2 className="text-sm font-medium">{key}</h2>
          <Rows>{holds.map((h) => {
            const lapsed = lapseReason(h, now);
            const status = lapsed ? 'released' : h.status;
            const who = h.artist?.name || h.promoter?.company || 'Open';
            const challengers = holds.filter((o) => o.rank > h.rank && o.status === 'held' && !lapseReason(o, now)).map((o) => ({ value: o.id, label: `${ordinal(o.rank)} hold: ${o.artist?.name || o.promoter?.company || 'Open'}` }));
            const meta = h.event ? h.event.title : lapsed ? lapsed : h.status === 'challenged' && h.challengeDeadline ? `Challenged. Confirm or release by ${new Date(h.challengeDeadline).toLocaleString()}` : h.status === 'released' ? h.releasedReason || 'Released' : `${KIND[h.kind] || h.kind}. Expires ${day(h.expiresAt)}`;
            return <Row key={h.id} title={`${ordinal(h.rank)} hold: ${who}`} status={status} meta={meta} right={h.event || lapsed || !can.canManageEvents ? null : <HoldActions holdId={h.id} status={h.status} kind={h.kind} charts={chartsFor(h.room?.id)} artist={h.artist?.name} challengers={challengers} />} />;
          })}</Rows>
        </section>
      ))}
      {!groups.size ? <Rows empty="No holds.">{[]}</Rows> : null}
    </Page>
  );
}
