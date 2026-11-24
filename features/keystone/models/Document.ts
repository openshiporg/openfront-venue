import { list } from '@keystone-6/core';
import { text, select, relationship, integer } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { permissions } from '../access';
import { DOCUMENT_KINDS } from '../lib/documents';

export const staffWithFiles = (args: any) => ['canManageEvents', 'canManageVenueDeals', 'canManageSettlements', 'canManageAdvance', 'canManageInsurance', 'canManagePrivateEvents']
  .some(p => (permissions as any)[p](args));
const fixed = { access: { create: () => false, update: () => false } };

/**
 * A stored file: a rider, contract, certificate, bar POS report, promoter statement or barcode import. Private to staff.
 * The bytes live in this row (base64, never exposed to GraphQL), so uploads work on every deployment with no storage
 * service to set up. Files come in through POST /api/documents and go out through GET /api/documents/<id>.
 */
export const Document = list({
  access: { operation: { query: staffWithFiles, create: () => false, update: staffWithFiles, delete: () => false } },
  fields: {
    title: text({ validation: { isRequired: true } }),
    kind: select({ type: 'string', options: DOCUMENT_KINDS.map(v => ({ label: v.replace(/_/g, ' '), value: v })), defaultValue: 'other', ...fixed }),
    filename: text({ ...fixed }),
    mimeType: text({ ...fixed }),
    sizeBytes: integer({ defaultValue: 0, ...fixed }),
    sha256: text({ ...fixed }),
    content: text({ graphql: { omit: true } }),
    event: relationship({ ref: 'Event.document_event', many: false, ...fixed }),
    venueDeal: relationship({ ref: 'VenueDeal.document_venueDeal', many: false, ...fixed }),
    promoter: relationship({ ref: 'Promoter.document_promoter', many: false, ...fixed }),
    barSales: relationship({ ref: 'BarSales.report', many: false }),
    uploadedBy: relationship({ ref: 'User.document_uploadedBy', many: false, ...fixed }),
    ...trackingFields,
  },
});
