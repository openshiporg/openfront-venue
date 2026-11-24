import { list } from '@keystone-6/core';
import { text, relationship } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { catalogAccessFor } from '../access';

/** An outside promoter or renter who brings a show to a room. Deals, holds and certificates hang off it. */
export const Promoter = list({
  access: catalogAccessFor('canManageContacts'),
  fields: {
    company: text({ validation: { isRequired: true } }),
    contactName: text({}),
    email: text({ validation: { match: { regex: /^$|^[^@\s]+@[^@\s]+\.[^@\s]+$/, explanation: 'Enter an email address' } } }),
    phone: text({}),
    website: text({}),
    notes: text({ ui: { displayMode: 'textarea' } }),
    dateHold_promoter: relationship({ ref: 'DateHold.promoter', many: true }),
    inquiry_promoter: relationship({ ref: 'Inquiry.promoter', many: true }),
    venueDeal_promoter: relationship({ ref: 'VenueDeal.promoter', many: true }),
    event_promoter: relationship({ ref: 'Event.promoter', many: true }),
    document_promoter: relationship({ ref: 'Document.promoter', many: true }),
    ...trackingFields,
  },
});
