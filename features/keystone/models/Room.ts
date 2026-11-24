import { list, graphql } from '@keystone-6/core';
import { image, text, integer, checkbox, json, select, relationship, timestamp, virtual } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { commandAccess, catalogAccessFor, permissions } from '../access';

/** A room the venue owns or leases. Each keeps its own address and time zone; capacity is the licensed occupant load. */
export const Room = list({
 access: catalogAccessFor('canManageRooms'),
 
 fields: {
  name: text({}),
  city: text({}),
  timezone: text({}),
  address: text({}),
  photo: image({ storage: 'my_images' }),
  contact: text({}),
  capacity: integer({ defaultValue: 0 }),
  defaultFacilityFeeCents: integer({ defaultValue: 0 }),
  taxBps: integer({ defaultValue: 0 }),
  description: text({ ui: { displayMode: 'textarea' } }),
  accessibilityNotes: text({ ui: { displayMode: 'textarea' } }),
  loadInNotes: text({ ui: { displayMode: 'textarea' } }),
  seatingChart_room: relationship({ ref: 'SeatingChart.room', many: true }),
  event_room: relationship({ ref: 'Event.room', many: true }),
  dateHold_room: relationship({ ref: 'DateHold.room', many: true }),
  currencyCode: text({ defaultValue: 'USD', validation: { match: { regex: /^[A-Z]{3}$/, explanation: 'ISO 4217 currency code' } } }),
  ...trackingFields,
 }
});
