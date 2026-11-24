import { gql } from '../../lib/gql';
import { Page, Row, Rows } from '../../components/ui-bits';
import { roleFlags } from '../../lib/guard';
import { RecordEditor, type FieldSpec } from '../../components/RecordEditor';

export async function ContactListPage() {
  const { canManageContacts } = await roleFlags('canManageContacts');
  const data = await gql(`{ artists(orderBy: [{ name: asc }], take: 200) { id name genreTags agentName agentEmail manager bio agency { id name } } agencies(orderBy: [{ name: asc }]) { id name artist_agency { id } } promoters(orderBy: [{ company: asc }], take: 300) { id company contactName email phone website notes } }`);
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
  const promoterFields: FieldSpec[] = [
    { name: 'company', label: 'Company', required: true, wide: true },
    { name: 'contactName', label: 'Contact' },
    { name: 'email', label: 'Email' },
    { name: 'phone', label: 'Phone' },
    { name: 'website', label: 'Website' },
    { name: 'notes', label: 'Notes', wide: true },
  ];
  const edit = (list: string, fields: FieldSpec[], row: any) => canManageContacts ? <RecordEditor list={list} id={row.id} values={row} fields={fields} trigger="Edit" title={`Edit ${row.name}`} /> : null;
  return (
    <Page title="Contacts">
      {canManageContacts ? <div className="flex flex-wrap items-start gap-2"><RecordEditor list="Artist" fields={artistFields} trigger="Add artist" title="New artist" /><RecordEditor list="Agency" fields={agencyFields} trigger="Add agency" title="New agency" /><RecordEditor list="Promoter" fields={promoterFields} trigger="Add promoter" title="New promoter" /></div> : null}
      <Rows empty="No artists.">{data.artists.map((a: any) => <Row key={a.id} title={a.name} meta={[a.genreTags, a.agency?.name || 'Independent', a.agentEmail].filter(Boolean).join(' · ')} right={edit('Artist', artistFields, a)} />)}</Rows>
      <h2 className="text-sm font-medium">Promoters</h2>
      <Rows empty="No promoters.">{data.promoters.map((p: any) => <Row key={p.id} title={p.company} meta={[p.contactName, p.email, p.phone].filter(Boolean).join(' · ')} right={canManageContacts ? <RecordEditor list="Promoter" id={p.id} values={p} fields={promoterFields} trigger="Edit" title={`Edit ${p.company}`} /> : null} />)}</Rows>
      <h2 className="text-sm font-medium">Agencies</h2>
      <Rows empty="No agencies.">{data.agencies.map((a: any) => <Row key={a.id} title={a.name} meta={`${a.artist_agency.length} artist${a.artist_agency.length === 1 ? '' : 's'}`} right={edit('Agency', agencyFields, a)} />)}</Rows>
    </Page>
  );
}
