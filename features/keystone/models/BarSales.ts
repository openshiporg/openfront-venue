import { list, graphql } from '@keystone-6/core';
import { text, integer, checkbox, json, select, relationship, timestamp, virtual } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { readAccess } from '../access';

export const BarSales = list({
 graphql: { plural: 'BarSalesRecords' },
 access: readAccess('canManageSettlements'),
 
 fields: {
  // Entered at close from the bar POS report (D6). Net = gross − comps − voids − tax. Written only by recordBarSales.
  grossCents: integer({ defaultValue: 0, access: { create: () => false, update: () => false } }),
  compsCents: integer({ defaultValue: 0, access: { create: () => false, update: () => false } }),
  voidsCents: integer({ defaultValue: 0, access: { create: () => false, update: () => false } }),
  taxCents: integer({ defaultValue: 0, access: { create: () => false, update: () => false } }),
  netCents: integer({ defaultValue: 0, access: { create: () => false, update: () => false } }),
  promoterShareBps: integer({ defaultValue: 0, access: { create: () => false, update: () => false } }),
  report: relationship({ ref: 'Document.barSales', many: false }),
  recordedBy: relationship({ ref: 'User.barSales_recordedBy', many: false, access: { create: () => false, update: () => false } }),
  event: relationship({ ref: 'Event.barSales_event', many: false }),
  currencyCode: text({ defaultValue: 'USD', validation: { match: { regex: /^[A-Z]{3}$/, explanation: 'ISO 4217 currency code' } } }),
  ...trackingFields,
 }
});
