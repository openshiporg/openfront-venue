import { list } from '@keystone-6/core';
import { text, integer, checkbox, json, select, relationship, timestamp } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { readAccess } from '../access';
import { DEAL_TYPES, RENT_MODES, RENT_BASES, CO_PRO_MODES, BAR_MODES, BAR_TIER_METHODS, ISSUERS } from '../lib/venue-deal';

const opts = (l: readonly string[]) => l.map(v => ({ label: v.replace(/_/g, ' '), value: v }));
const locked = { create: () => false, update: () => false };

/**
 * How the venue is paid for one booked date (D5 to D7). Written only through saveVenueDeal and the deal commands;
 * a sent or accepted version is frozen, and a change makes version n+1. The promoter accepts through a token link.
 */
export const VenueDeal = list({
  access: readAccess('canManageVenueDeals', 'canManageSettlements'),
  fields: {
    event: relationship({ ref: 'Event.venueDeal_event', many: false }),
    hold: relationship({ ref: 'DateHold.venueDeal_hold', many: false }),
    promoter: relationship({ ref: 'Promoter.venueDeal_promoter', many: false }),
    version: integer({ defaultValue: 1, access: locked }),
    status: select({ type: 'string', options: opts(['draft', 'sent', 'accepted', 'settled', 'cancelled', 'superseded']), defaultValue: 'draft', access: locked }),
    dealType: select({ type: 'string', options: opts(DEAL_TYPES), defaultValue: 'rental', access: locked }),
    rentMode: select({ type: 'string', options: opts(RENT_MODES), defaultValue: 'flat', access: locked }),
    rentCents: integer({ defaultValue: 0, access: locked }),
    rentPercentBps: integer({ defaultValue: 0, access: locked }),
    rentBase: text({ access: locked }),
    rentBaseKind: select({ type: 'string', options: opts(RENT_BASES), defaultValue: 'net_of_tax_and_fees', access: locked }),
    coProMode: select({ type: 'string', options: opts(CO_PRO_MODES), defaultValue: 'upside', access: locked }),
    venueShareBps: integer({ defaultValue: 0, access: locked }),
    contributedRevenues: json({ access: locked }),
    barMode: select({ type: 'string', options: opts(BAR_MODES), defaultValue: 'none', access: locked }),
    barGuaranteeCents: integer({ defaultValue: 0, access: locked }),
    barTiers: json({ access: locked }),
    barTierMethod: select({ type: 'string', options: opts(BAR_TIER_METHODS), defaultValue: 'bracket', access: locked }),
    facilityFeeCents: integer({ defaultValue: 0, access: locked }),
    ticketFeeShareBps: integer({ defaultValue: 0, access: locked }),
    depositCents: integer({ defaultValue: 0, access: locked }),
    depositDueAt: timestamp({ access: locked }),
    balanceDueAt: timestamp({ access: locked }),
    insuranceRequired: checkbox({ defaultValue: true, access: locked }),
    requiredLimitCents: integer({ defaultValue: 100000000, access: locked }),
    issuer: select({ type: 'string', options: opts(ISSUERS), defaultValue: 'own', access: locked }),
    notes: text({ ui: { displayMode: 'textarea' }, access: locked }),
    terms: json({ access: locked }),
    termsHash: text({ access: locked }),
    acceptedByName: text({ access: locked }),
    acceptedAt: timestamp({ access: locked }),
    sentAt: timestamp({ access: locked }),
    cancelReason: text({ access: locked }),
    // The link token is shown once to staff; only its digest is stored, and it is never readable.
    publicTokenHash: text({ isIndexed: 'unique', db: { isNullable: true }, access: { read: () => false, create: () => false, update: () => false } }),
    previousVersion: relationship({ ref: 'VenueDeal.nextVersions', many: false, access: locked }),
    nextVersions: relationship({ ref: 'VenueDeal.previousVersion', many: true, access: locked }),
    houseExpense_venueDeal: relationship({ ref: 'HouseExpense.venueDeal', many: true, access: locked }),
    promoterPayment_venueDeal: relationship({ ref: 'PromoterPayment.venueDeal', many: true, access: locked }),
    settlement_venueDeal: relationship({ ref: 'Settlement.venueDeal', many: true, access: locked }),
    document_venueDeal: relationship({ ref: 'Document.venueDeal', many: true }),
    currencyCode: text({ defaultValue: 'USD', access: locked }),
    ...trackingFields,
  },
});

/** One line of the house nut on a deal: flat, or the clocked hours of a staff role × a rate. Written with the deal. */
export const HouseExpense = list({
  access: readAccess('canManageVenueDeals', 'canManageSettlements'),
  fields: {
    venueDeal: relationship({ ref: 'VenueDeal.houseExpense_venueDeal', many: false }),
    label: text({}),
    category: select({ type: 'string', options: opts(['security', 'stagehands', 'sound', 'lights', 'cleaning', 'insurance', 'box_office', 'other']), defaultValue: 'other' }),
    basis: select({ type: 'string', options: opts(['flat', 'from_shifts']), defaultValue: 'flat' }),
    role: text({}),
    amountCents: integer({}),
    rateCents: integer({}),
    ...trackingFields,
  },
});

/** Money between the venue and a promoter: a deposit or balance in, or a payout out. Recorded at the desk with a reference. */
export const PromoterPayment = list({
  access: readAccess('canManageSettlements', 'canManageVenueDeals'),
  fields: {
    venueDeal: relationship({ ref: 'VenueDeal.promoterPayment_venueDeal', many: false }),
    direction: select({ type: 'string', options: opts(['in', 'out']), defaultValue: 'in' }),
    kind: select({ type: 'string', options: opts(['deposit', 'balance', 'payout']), defaultValue: 'deposit' }),
    amountCents: integer({ defaultValue: 0 }),
    method: select({ type: 'string', options: opts(['cash', 'cheque', 'transfer', 'card']), defaultValue: 'transfer' }),
    reference: text({}),
    recordedBy: relationship({ ref: 'User.promoterPayment_recordedBy', many: false }),
    idempotencyKey: text({ isIndexed: 'unique', db: { isNullable: true }, access: { read: () => false } }),
    currencyCode: text({ defaultValue: 'USD' }),
    ...trackingFields,
  },
});
