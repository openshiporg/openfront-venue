import { list } from '@keystone-6/core';
import { text, integer, checkbox, select, relationship, timestamp } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { permissions } from '../access';

/**
 * A request from outside: a promoter or agent asking for a show date, or a client asking for a private event.
 * Anyone can submit one through `submitInquiry`; only staff read or work them. Status moves through `workInquiry`.
 */
export const Inquiry = list({
  access: { operation: { query: permissions.canManageInquiries, create: () => false, update: () => false, delete: () => false } },
  fields: {
    kind: select({ type: 'string', options: ['show', 'private_event'], defaultValue: 'show', validation: { isRequired: true }, access: { update: () => false } }),
    name: text({ validation: { isRequired: true } }),
    email: text({ validation: { isRequired: true } }),
    phone: text({}),
    company: text({}),
    dateWanted: timestamp({}),
    flexibleDates: checkbox({ defaultValue: false }),
    room: relationship({ ref: 'Room.inquiry_room', many: false }),
    guests: integer({}),
    eventType: text({}),
    budgetCents: integer({}),
    message: text({ ui: { displayMode: 'textarea' } }),
    status: select({ type: 'string', options: ['new', 'in_progress', 'won', 'lost'], defaultValue: 'new', access: { update: () => false } }),
    lostReason: text({}),
    source: text({}),
    promoter: relationship({ ref: 'Promoter.inquiry_promoter', many: false }),
    handledBy: relationship({ ref: 'User.inquiry_handledBy', many: false }),
    ...trackingFields,
  },
});
