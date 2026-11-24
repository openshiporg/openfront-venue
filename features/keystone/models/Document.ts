import { list } from '@keystone-6/core';
import { text, select, relationship, file } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { permissions } from '../access';

const staffWithFiles = (args: any) => ['canManageEvents', 'canManageVenueDeals', 'canManageSettlements', 'canManageAdvance', 'canManageInsurance', 'canManagePrivateEvents']
  .some(p => (permissions as any)[p](args));

/** A stored file: a rider, contract, certificate, bar POS report, promoter statement or barcode import. Private to staff. */
export const Document = list({
  access: { operation: { query: staffWithFiles, create: staffWithFiles, update: staffWithFiles, delete: () => false } },
  fields: {
    title: text({ validation: { isRequired: true } }),
    kind: select({ type: 'string', options: ['rider', 'contract', 'insurance', 'pos_report', 'promoter_statement', 'barcode_import', 'other'].map(v => ({ label: v.replace(/_/g, ' '), value: v })), defaultValue: 'other' }),
    file: file({ storage: 'my_files' }),
    event: relationship({ ref: 'Event.document_event', many: false }),
    venueDeal: relationship({ ref: 'VenueDeal.document_venueDeal', many: false }),
    promoter: relationship({ ref: 'Promoter.document_promoter', many: false }),
    barSales: relationship({ ref: 'BarSales.report', many: false }),
    uploadedBy: relationship({ ref: 'User.document_uploadedBy', many: false, access: { create: () => false, update: () => false } }),
    ...trackingFields,
  },
  hooks: {
    resolveInput: { create: ({ resolvedData, context }) => ({ ...resolvedData, uploadedBy: context.session?.itemId ? { connect: { id: context.session.itemId } } : undefined }) },
  },
});
