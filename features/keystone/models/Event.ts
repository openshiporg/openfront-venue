import { list, graphql } from '@keystone-6/core';
import { image, text, integer, checkbox, json, select, relationship, timestamp, virtual } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { commandAccess, catalogAccess, permissions, canReadGross } from '../access';
import { ISSUERS } from '../lib/venue-deal';
import { issuedCounts } from '../lib/issued';
const setByCommand = { access: { create: () => false, update: () => false } };

export const Event = list({
 access: catalogAccess,
 
 fields: {
  title: text({}),
  presaleCode: text({ access: { read: () => false, create: () => false, update: () => false } }),
  image: text({}),
  photo: image({ storage: 'my_images' }),
  description: text({}),
  isCoPro: checkbox({ defaultValue: false }),
  allowReentry: checkbox({ defaultValue: false }),
  doorsAt: timestamp(),
  showAt: timestamp(),
  curfewAt: timestamp(),
  announceAt: timestamp(),
  onSaleAt: timestamp(),
  presaleAt: timestamp(),
  refundWindowEndsAt: timestamp(),
  status: select({ type: 'string', options: ['hold', 'announced', 'presale', 'on_sale', 'sold_out', 'doors', 'in_progress', 'completed', 'settling', 'settled', 'cancelled', 'postponed'], defaultValue: 'hold', access: { update: () => false } }),
  ageRestriction: select({ type: 'string', options: ['all_ages', '16', '18', '21'], defaultValue: 'all_ages', access: { update: () => false } }),
  room: relationship({ ref: 'Room.event_room', many: false }),
  seatingChart: relationship({ ref: 'SeatingChart.event_seatingChart', many: false }),
  // The staff user who booked the date. The outside promoter or renter is `promoter`, a Promoter record from the hold.
  bookedBy: relationship({ ref: 'User.event_bookedBy', many: false }),
  promoter: relationship({ ref: 'Promoter.event_promoter', many: false }),
  eventArtist_event: relationship({ ref: 'EventArtist.event', many: true }),
  dateHold_event: relationship({ ref: 'DateHold.event', many: true }),
  offer_event: relationship({ ref: 'Offer.event', many: true }),
  eventExpense_event: relationship({ ref: 'EventExpense.event', many: true }),
  priceLevel_event: relationship({ ref: 'PriceLevel.event', many: true }),
  seatInventory_event: relationship({ ref: 'SeatInventory.event', many: true }),
  productionHold_event: relationship({ ref: 'ProductionHold.event', many: true }),
  inventoryHold_event: relationship({ ref: 'InventoryHold.event', many: true }),
  promoCode_event: relationship({ ref: 'PromoCode.event', many: true }),
  ticketOrder_event: relationship({ ref: 'TicketOrder.event', many: true }),
  ticket_event: relationship({ ref: 'Ticket.event', many: true }),
  scanEvent_event: relationship({ ref: 'ScanEvent.event', many: true }),
  merchSales_event: relationship({ ref: 'MerchSales.event', many: true }),
  barSales_event: relationship({ ref: 'BarSales.event', many: true }),
  settlement_event: relationship({ ref: 'Settlement.event', many: true }),
  venueDeal_event: relationship({ ref: 'VenueDeal.event', many: true }),
  document_event: relationship({ ref: 'Document.event', many: true }),
  // D3: who sells tickets for this night. Set with setEventIssuer only.
  issuer: select({ type: 'string', options: ISSUERS.map(value => ({ label: value.replace(/_/g, ' '), value })), defaultValue: 'own', ...setByCommand }),
  connection: relationship({ ref: 'ChannelConnection.event_connection', many: false, ...setByCommand }),
  externalEventId: text({ ...setByCommand }),
  externalEventTitle: text({ ...setByCommand }),
  externalUrl: text({ ...setByCommand }),
  externalSellerName: text({ ...setByCommand }),
  // The connected issuer's sold count from the last live read, kept so the door still shows a number when the seller is not answering.
  connectedSold: integer({ defaultValue: 0, ...setByCommand }),
  connectedSoldAt: timestamp({ ...setByCommand }),
  externalTicketBatch_event: relationship({ ref: 'ExternalTicketBatch.event', many: true, ...setByCommand }),
  externalTicket_event: relationship({ ref: 'ExternalTicket.event', many: true, ...setByCommand }),
  guestListEntry_event: relationship({ ref: 'GuestListEntry.event', many: true, ...setByCommand }),
  // D15: everyone let in or entitled to come in, from every seller, against the configuration's capacity.
  totalIssued: virtual({ field: graphql.field({ type: graphql.Int, async resolve(item: any, args, context) { return (await issuedCounts(context.prisma, item.id)).total; } }) }),
  sold: virtual({ field: graphql.field({ type: graphql.Int, async resolve(item, args, context) { const r = await context.prisma.priceLevel.aggregate({ where: { eventId: item.id }, _sum: { sold: true } }); return r._sum.sold ?? 0; } }) }),
  held: virtual({ field: graphql.field({ type: graphql.Int, async resolve(item, args, context) { const r = await context.prisma.priceLevel.aggregate({ where: { eventId: item.id }, _sum: { held: true } }); return r._sum.held ?? 0; } }) }),
  kills: virtual({ field: graphql.field({ type: graphql.Int, async resolve(item, args, context) { return context.prisma.seatInventory.count({ where: { eventId: item.id, ...{status: 'killed'} } }); } }) }),
  // Ticket revenue: not for door staff.
  gross: virtual({ access: { read: canReadGross }, ui: { listView: { fieldMode: (a: any) => canReadGross(a) ? 'read' : 'hidden' }, itemView: { fieldMode: (a: any) => canReadGross(a) ? 'read' : 'hidden' } }, field: graphql.field({ type: graphql.Int, async resolve(item, args, context) { const result = await context.prisma.ticketOrder.aggregate({ where: { eventId: item.id, status: 'paid', hiddenAt: null }, _sum: { totalCents: true } }); return result._sum.totalCents ?? 0; } }) }),
  open: virtual({ field: graphql.field({ type: graphql.Int, async resolve(item, args, context) { const levels = await context.prisma.priceLevel.findMany({ where: { eventId: item.id } }); return levels.reduce((n: number, l: { capacity: number; sold: number; held: number; productionHeld: number }) => n + l.capacity - l.sold - l.held - l.productionHeld, 0); } }) }),
  ...trackingFields,
 }
});
