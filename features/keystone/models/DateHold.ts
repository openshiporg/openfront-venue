import { list, graphql } from '@keystone-6/core';
import { text, integer, checkbox, json, select, relationship, timestamp, virtual } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { commandAccess, catalogAccess, permissions } from '../access';

export const DateHold = list({
 access: catalogAccess,
 
 fields: {
  rankKey: text({ isIndexed: 'unique', db: { isNullable: true } }),
  rank: integer({ defaultValue: 0 }),
  date: timestamp(),
  expiresAt: timestamp(),
  status: select({ type: 'string', options: ['held', 'challenged', 'confirmed', 'released'], defaultValue: 'held', access: { update: () => false } }),
  room: relationship({ ref: 'Room.dateHold_room', many: false }),
  artist: relationship({ ref: 'Artist.dateHold_artist', many: false }),
  agency: relationship({ ref: 'Agency.dateHold_agency', many: false }),
  event: relationship({ ref: 'Event.dateHold_event', many: false }),
  ...trackingFields,
 }
});
