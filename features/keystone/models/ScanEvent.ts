import { list, graphql } from '@keystone-6/core';
import { text, integer, checkbox, json, select, relationship, timestamp, virtual } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { readAccess, commandAccess, catalogAccess, permissions } from '../access';

export const ScanEvent = list({
 access: readAccess('canScanTickets', 'canManageOrders', 'canIssueRefunds'),
 
 fields: {
  gate: text({}),
  at: timestamp(),
  // §4.6: one row per scan, from any source. For a connected issuer the sibling's own result and message are kept verbatim.
  source: select({ type: 'string', options: ['own', 'connected', 'external', 'guest_list', 'will_call'], defaultValue: 'own', access: { create: () => false, update: () => false } }),
  result: select({ type: 'string', options: ['admitted', 'duplicate', 'reentry', 'wrong_event', 'void', 'not_found', 'issuer_refused', 'issuer_unreachable'], defaultValue: 'admitted', access: { create: () => false, update: () => false } }),
  issuerResult: text({ access: { create: () => false, update: () => false } }),
  message: text({ access: { create: () => false, update: () => false } }),
  codeLast4: text({ access: { create: () => false, update: () => false } }),
  places: integer({ defaultValue: 1, access: { create: () => false, update: () => false } }),
  idChecked: checkbox({ defaultValue: false, access: { create: () => false, update: () => false } }),
  externalTicket: relationship({ ref: 'ExternalTicket.scanEvent_externalTicket', many: false, access: { create: () => false, update: () => false } }),
  guestListEntry: relationship({ ref: 'GuestListEntry.scanEvent_guestListEntry', many: false, access: { create: () => false, update: () => false } }),
  ticket: relationship({ ref: 'Ticket.scanEvent_ticket', many: false }),
  event: relationship({ ref: 'Event.scanEvent_event', many: false }),
  scannedBy: relationship({ ref: 'User.scanEvent_scannedBy', many: false }),
  ...trackingFields,
 }
});
