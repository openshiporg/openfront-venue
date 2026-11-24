import { gql } from '../../lib/gql';
import { Page, Row, Rows } from '../../components/ui-bits';
import { roleFlags } from '../../lib/guard';
import { RecordEditor, type FieldSpec } from '../../components/RecordEditor';

export async function ContactListPage() {
  const { canManageArtists } = await roleFlags('canManageArtists');
  const data = await gql(`{ artists(orderBy: [{ name: asc }], take: 200) { id name genreTags agentName agentEmail manager bio agency { id name } } agencies(orderBy: [{ name: asc }]) { id name artist_agency { id } } }`);
  const artistFields: FieldSpec[] = [
    { name: 'name', label: 'Name', required: true, wide: true },
    { name: 'genreTags', label: 'Genres', hint: 'comma separated', wide: true },
    { name: 'agency', label: 'Agency', kind: 'relation', options: data.agencies.map((a: any) => [a.id, a.name]) },
    { name: 'manager', label: 'Manager' },
    { name: 'agentName', label: 'Agent' },
    { name: 'agentEmail', label: 'Agent email' },
    { name: 'bio', label: 'Bio', wide: true },
  ];
  const agencyFields: FieldSpec[] = [
    { name: 'name', label: 'Name', required: true, wide: true },
  ];
  const edit = (list: string, fields: FieldSpec[], row: any) => canManageArtists ? <RecordEditor list={list} id={row.id} values={row} fields={fields} trigger="Edit" title={`Edit ${row.name}`} /> : null;
  return (
    <Page title="Contacts">
      {canManageArtists ? <div className="flex flex-wrap items-start gap-2"><RecordEditor list="Artist" fields={artistFields} trigger="Add artist" title="New artist" /><RecordEditor list="Agency" fields={agencyFields} trigger="Add agency" title="New agency" /></div> : null}
      <Rows empty="No artists.">{data.artists.map((a: any) => <Row key={a.id} title={a.name} meta={[a.genreTags, a.agency?.name || 'Independent', a.agentEmail].filter(Boolean).join(' · ')} right={edit('Artist', artistFields, a)} />)}</Rows>
      <h2 className="text-sm font-medium">Agencies</h2>
      <Rows empty="No agencies.">{data.agencies.map((a: any) => <Row key={a.id} title={a.name} meta={`${a.artist_agency.length} artist${a.artist_agency.length === 1 ? '' : 's'}`} right={edit('Agency', agencyFields, a)} />)}</Rows>
    </Page>
  );
}
