import { list, graphql } from '@keystone-6/core';
import { text, integer, checkbox, json, select, relationship, timestamp, virtual } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { catalogAccess } from '../access';

export const DateHold = list({
 access: catalogAccess,
 
 fields: {
  rankKey: text({ isIndexed: 'unique', db: { isNullable: true } }),
  rank: integer({ defaultValue: 0 }),
  date: timestamp(),
  expiresAt: timestamp(),
  status: select({ type: 'string', options: ['held', 'challenged', 'confirmed', 'released'], defaultValue: 'held', access: { create: () => false, update: () => false } }),
  kind: select({ type: 'string', options: ['show', 'rental', 'private_event', 'internal'], defaultValue: 'show', validation: { isRequired: true }, access: { update: () => false } }),
  challengeDeadline: timestamp({ access: { create: () => false, update: () => false } }),
  challengedBy: relationship({ ref: 'DateHold.challenges', many: false }),
  challenges: relationship({ ref: 'DateHold.challengedBy', many: true }),
  notes: text({ ui: { displayMode: 'textarea' } }),
  releasedReason: text({ access: { create: () => false, update: () => false } }),
  promoter: relationship({ ref: 'Promoter.dateHold_promoter', many: false }),
  venueDeal_hold: relationship({ ref: 'VenueDeal.hold', many: true }),
  room: relationship({ ref: 'Room.dateHold_room', many: false }),
  artist: relationship({ ref: 'Artist.dateHold_artist', many: false }),
  agency: relationship({ ref: 'Agency.dateHold_agency', many: false }),
  event: relationship({ ref: 'Event.dateHold_event', many: false }),
  ...trackingFields,
 }
});
