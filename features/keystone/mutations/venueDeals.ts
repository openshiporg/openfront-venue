import { command, transition } from '../lib/transaction';
import { appendAuditEvent } from '../lib/audit';
import { canonicalDigest, digest, opaqueToken } from '../lib/guest-proof';
import { authorize, nextSettlementVersion, settlePromoterDeal } from './operators';
import { validateDealTerms, promoterStatement, type DealTerms, type StatementActuals } from '../lib/venue-deal';
import { FROZEN_SETTLEMENT } from '../lib/editors';
import type { Permission } from '../access';

/**
 * Venue deals (D5 to D7), bar totals (D6), promoter payments and the promoter settlement (D8).
 * Every write runs in `command`: one advisory lock, an idempotency key, explicit state checks and an audit row.
 */
type Ctx = { tx: any; input: any; actor: string | null };
function staff(operation: string, permission: Permission, lockOf: (input: any) => string, run: (c: Ctx) => Promise<any>) {
  return async (_: any, { input }: any, context: any) => {
    authorize(context, permission);
    if (!input?.idempotencyKey) throw new Error('Idempotency key required');
    return command(context, { operation, idempotencyKey: input.idempotencyKey, lock: lockOf(input), params: input }, tx => run({ tx, input, actor: context.session.itemId }));
  };
}
const audit = (tx: any, actor: string | null, action: string, list: string, id: string, after: any, reason = '') => appendAuditEvent(tx, actor, { action, targetList: list, targetId: id, after, reason });

const TERM_FIELDS = ['dealType', 'rentMode', 'rentCents', 'rentPercentBps', 'rentBase', 'rentBaseKind', 'coProMode', 'venueShareBps', 'contributedRevenues', 'barMode', 'barGuaranteeCents', 'barTiers', 'facilityFeeCents', 'ticketFeeShareBps', 'depositCents', 'depositDueAt', 'balanceDueAt', 'insuranceRequired', 'requiredLimitCents', 'issuer', 'notes'] as const;
function columns(terms: DealTerms) {
  const out: any = {};
  for (const k of TERM_FIELDS) out[k] = (terms as any)[k];
  out.depositDueAt = terms.depositDueAt ? new Date(terms.depositDueAt) : null;
  out.balanceDueAt = terms.balanceDueAt ? new Date(terms.balanceDueAt) : null;
  return out;
}
async function writeHouse(tx: any, dealId: string, terms: DealTerms) {
  await tx.houseExpense.deleteMany({ where: { venueDealId: dealId } });
  for (const h of terms.houseExpenses) await tx.houseExpense.create({ data: { venueDealId: dealId, label: h.label, category: h.category, basis: h.basis, role: h.role || '', amountCents: h.amountCents ?? null, rateCents: h.rateCents ?? null } });
}
/** The terms a promoter sees and accepts: the stored columns plus the house nut, as one canonical object. */
export async function dealTerms(tx: any, deal: any): Promise<DealTerms> {
  const house = await tx.houseExpense.findMany({ where: { venueDealId: deal.id }, orderBy: { createdAt: 'asc' } });
  return validateDealTerms({ ...deal, depositDueAt: deal.depositDueAt?.toISOString() || null, balanceDueAt: deal.balanceDueAt?.toISOString() || null, houseExpenses: house.map((h: any) => ({ label: h.label, category: h.category, basis: h.basis, role: h.role || undefined, amountCents: h.amountCents ?? undefined, rateCents: h.rateCents ?? undefined })) }, deal.version);
}

/** Draft a deal for an event, or edit a draft. A sent or accepted deal cannot be edited: saving it makes version n+1 and supersedes it. */
export const saveVenueDeal = staff('saveVenueDeal', 'canManageVenueDeals', i => `deal-event:${i.eventId || i.dealId}`, async ({ tx, input, actor }) => {
  const existing = input.dealId ? await tx.venueDeal.findUnique({ where: { id: input.dealId } }) : null;
  if (input.dealId && !existing) throw new Error('Venue deal not found');
  const eventId = existing?.eventId || input.eventId;
  const event = eventId ? await tx.event.findUnique({ where: { id: eventId } }) : null;
  if (!event) throw new Error('Event required');
  if (['settled', 'cancelled'].includes(event.status)) throw new Error(`The event is ${event.status}`);
  const promoterId = input.promoterId || existing?.promoterId || event.promoterId || null;
  if (event.promoterId && promoterId !== event.promoterId) throw new Error('The deal must be with the promoter on the booked date');
  if (!promoterId) throw new Error('Choose the promoter');
  if (!(await tx.promoter.findUnique({ where: { id: promoterId } }))) throw new Error('Promoter not found');
  if (!event.promoterId) await tx.event.update({ where: { id: event.id }, data: { promoterId } });
  const hold = await tx.dateHold.findFirst({ where: { eventId: event.id } });
  if (existing && ['settled', 'cancelled', 'superseded'].includes(existing.status)) throw new Error(`A ${existing.status} deal cannot change; start a new one`);
  if (await tx.settlement.count({ where: { eventId: event.id, party: 'promoter', status: { in: FROZEN_SETTLEMENT } } })) throw new Error('The promoter settlement is signed; correct it with an approved adjustment');
  if (existing?.status === 'draft') {
    const terms = validateDealTerms(input.data, existing.version);
    const n = await tx.venueDeal.updateMany({ where: { id: existing.id, status: 'draft' }, data: { ...columns(terms), promoterId } });
    if (n.count !== 1) throw new Error('Deal changed; reload');
    await writeHouse(tx, existing.id, terms);
    await audit(tx, actor, 'saveVenueDeal', 'VenueDeal', existing.id, { version: existing.version });
    return { id: existing.id, status: 'draft', version: existing.version };
  }
  if (!existing && await tx.venueDeal.count({ where: { eventId: event.id, status: { in: ['draft', 'sent', 'accepted'] } } })) throw new Error('This event already has a live venue deal; revise it');
  const latest = await tx.venueDeal.findFirst({ where: { eventId: event.id }, orderBy: { version: 'desc' } });
  const version = (latest?.version || 0) + 1;
  const terms = validateDealTerms(input.data, version);
  // Supersede first: the database allows one live deal per event.
  if (existing) {
    const reason = String(input.reason || '').trim() || `Replaced by version ${version}`;
    await transition(tx, 'venueDeal', existing.id, existing.status, 'superseded', actor, reason, { publicTokenHash: null });
  }
  const row = await tx.venueDeal.create({ data: { ...columns(terms), version, status: 'draft', eventId: event.id, holdId: hold?.id || null, promoterId, previousVersionId: existing?.id || null } });
  await writeHouse(tx, row.id, terms);
  await audit(tx, actor, 'saveVenueDeal', 'VenueDeal', row.id, { version, previous: existing?.id || null });
  return { id: row.id, status: 'draft', version };
});

/** Send the draft: freeze its terms and hash, and return a copyable link. Sending again issues a new link and kills the old one. */
export const sendVenueDeal = staff('sendVenueDeal', 'canManageVenueDeals', i => `deal:${i.dealId}`, async ({ tx, input, actor }) => {
  const deal = await tx.venueDeal.findUnique({ where: { id: input.dealId } });
  if (!deal) throw new Error('Venue deal not found');
  if (!['draft', 'sent'].includes(deal.status)) throw new Error(deal.status === 'accepted' ? 'The promoter has accepted this deal; revise it to change terms' : `A ${deal.status} deal cannot be sent`);
  const terms = await dealTerms(tx, deal);
  if (terms.dealType === 'in_house') throw new Error('An in-house show has no promoter to accept; book the artist with an offer');
  const token = opaqueToken();
  const data = { terms, termsHash: canonicalDigest(terms), publicTokenHash: digest(token), sentAt: new Date() };
  if (deal.status === 'draft') await transition(tx, 'venueDeal', deal.id, 'draft', 'sent', actor, '', data);
  else { await tx.venueDeal.update({ where: { id: deal.id }, data }); await audit(tx, actor, 'sendVenueDeal', 'VenueDeal', deal.id, { resent: true }); }
  // The token is returned once; only its digest is stored. The idempotency replay returns the same link.
  return { id: deal.id, status: 'sent', path: `/deals/${token}`, termsHash: data.termsHash };
});

export const cancelVenueDeal = staff('cancelVenueDeal', 'canManageVenueDeals', i => `deal:${i.dealId}`, async ({ tx, input, actor }) => {
  const deal = await tx.venueDeal.findUnique({ where: { id: input.dealId } });
  if (!deal) throw new Error('Venue deal not found');
  const reason = String(input.reason || '').trim();
  if (!reason) throw new Error('Say why the deal is cancelled');
  if (!['draft', 'sent', 'accepted'].includes(deal.status)) throw new Error(`A ${deal.status} deal cannot be cancelled`);
  if (await tx.settlement.count({ where: { venueDealId: deal.id, status: { in: FROZEN_SETTLEMENT } } })) throw new Error('The promoter settlement is signed');
  await transition(tx, 'venueDeal', deal.id, deal.status, 'cancelled', actor, reason, { cancelReason: reason, publicTokenHash: null });
  return { id: deal.id, status: 'cancelled' };
});

async function byToken(prisma: any, token: string) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  return prisma.venueDeal.findUnique({ where: { publicTokenHash: digest(token) }, include: { promoter: true, event: { include: { room: true } } } });
}
/** What the promoter's link shows: the frozen terms, the room and date, payments, and the statement once it is final. Nothing else. */
export async function viewVenueDeal(_: any, { token }: any, context: any) {
  const deal = await byToken(context.prisma, token);
  if (!deal) throw new Error('This link is no longer valid. Ask the venue for a new one.');
  const payments = await context.prisma.promoterPayment.findMany({ where: { venueDealId: deal.id }, orderBy: { createdAt: 'asc' } });
  const final = await context.prisma.settlement.findFirst({ where: { venueDealId: deal.id, party: 'promoter', status: 'final' }, orderBy: { version: 'desc' }, include: { settlementLine_settlement: { orderBy: { createdAt: 'asc' } } } });
  const store = await context.prisma.storeSettings.findFirst({ orderBy: { createdAt: 'asc' } });
  return {
    id: deal.id, status: deal.status, version: deal.version, terms: deal.terms, termsHash: deal.termsHash, acceptedByName: deal.acceptedByName, acceptedAt: deal.acceptedAt ? new Date(deal.acceptedAt).toISOString() : null,
    venue: store?.name || 'Openfront Venue', promoter: deal.promoter?.company || '',
    event: deal.event ? { title: deal.event.title, showAt: deal.event.showAt, doorsAt: deal.event.doorsAt, room: deal.event.room?.name || '', timezone: deal.event.room?.timezone || 'UTC' } : null,
    payments: payments.map((p: any) => ({ direction: p.direction, kind: p.kind, amountCents: p.amountCents, method: p.method, at: new Date(p.createdAt).toISOString() })),
    settlement: final ? { balanceCents: final.balanceDuePromoterCents, lines: final.settlementLine_settlement.filter((l: any) => l.kind !== 'rounding').map((l: any) => ({ kind: l.kind, label: l.label, amountCents: l.amountCents, rule: l.rule })) } : null,
  };
}

/** The promoter accepts by typed name. The stored hash must still match the terms they were shown; a superseded link cannot accept. */
export async function acceptVenueDeal(_: any, { token, name, termsHash, idempotencyKey }: any, context: any) {
  if (!idempotencyKey) throw new Error('Idempotency key required');
  const typed = String(name || '').trim();
  if (typed.length < 2) throw new Error('Type your full name to accept');
  const deal = await byToken(context.prisma, token);
  if (!deal) throw new Error('This link is no longer valid. Ask the venue for a new one.');
  return command(context, { operation: 'acceptVenueDeal', idempotencyKey, lock: `deal:${deal.id}`, params: { dealId: deal.id, name: typed, termsHash } }, async tx => {
    const fresh = await tx.venueDeal.findUnique({ where: { id: deal.id } });
    if (fresh.publicTokenHash !== digest(token)) throw new Error('This link is no longer valid. Ask the venue for a new one.');
    if (fresh.status === 'accepted') throw new Error('This deal is already accepted');
    if (fresh.status !== 'sent') throw new Error(`This deal is ${fresh.status}`);
    if (canonicalDigest(fresh.terms) !== fresh.termsHash) throw new Error('The terms no longer match their record. Ask the venue to send them again.');
    if (termsHash && termsHash !== fresh.termsHash) throw new Error('These terms changed after you opened them. Reload and read them again.');
    await transition(tx, 'venueDeal', deal.id, 'sent', 'accepted', null, `Accepted by ${typed}`, { acceptedByName: typed, acceptedAt: new Date() });
    return { id: deal.id, status: 'accepted', termsHash: fresh.termsHash };
  });
}

const cents = (v: any, label: string, min = 0) => { const n = Number(v ?? 0); if (!Number.isSafeInteger(n) || n < min) throw new Error(`${label} must be whole cents${min > 0 ? ' above zero' : ', 0 or more'}`); return n; };

/** Bar totals at close (D6) from the POS report: gross, comps, voids, tax → net. Refused once the promoter settlement is signed. */
export const recordBarSales = staff('recordBarSales', 'canManageSettlements', i => `event:${i.eventId}`, async ({ tx, input, actor }) => {
  const event = await tx.event.findUnique({ where: { id: input.eventId } });
  if (!event) throw new Error('Event not found');
  if (await tx.settlement.count({ where: { eventId: event.id, status: { in: FROZEN_SETTLEMENT } } })) throw new Error('Settlement is signed; bar totals are frozen');
  const d = input.data || {};
  const gross = cents(d.grossCents, 'Bar gross'), comps = cents(d.compsCents, 'Comps'), voids = cents(d.voidsCents, 'Voids'), tax = cents(d.taxCents, 'Tax');
  const net = gross - comps - voids - tax;
  if (net < 0) throw new Error('Comps, voids and tax cannot exceed the bar gross');
  if (d.reportId) { const doc = await tx.document.findUnique({ where: { id: d.reportId } }); if (!doc || (doc.eventId && doc.eventId !== event.id)) throw new Error('Report not found for this event'); }
  const data = { grossCents: gross, compsCents: comps, voidsCents: voids, taxCents: tax, netCents: net, reportId: d.reportId || undefined, recordedById: actor };
  const existing = await tx.barSales.findFirst({ where: { eventId: event.id } });
  const row = existing ? await tx.barSales.update({ where: { id: existing.id }, data }) : await tx.barSales.create({ data: { ...data, eventId: event.id } });
  await audit(tx, actor, 'recordBarSales', 'BarSales', row.id, { grossCents: gross, netCents: net }, existing ? 'Corrected' : '');
  return { id: row.id, netCents: net };
});

/** A deposit or balance from the promoter, or a payout to them. Needs a method and a reference; recorded once per key. */
export const recordPromoterPayment = staff('recordPromoterPayment', 'canManageSettlements', i => `deal:${i.dealId}`, async ({ tx, input, actor }) => {
  const deal = await tx.venueDeal.findUnique({ where: { id: input.dealId } });
  if (!deal) throw new Error('Venue deal not found');
  if (!['sent', 'accepted', 'settled'].includes(deal.status)) throw new Error('Record payments on a sent or accepted deal');
  const d = input.data || {};
  const direction = d.direction === 'out' ? 'out' : 'in';
  const kind = ['deposit', 'balance', 'payout'].includes(d.kind) ? d.kind : direction === 'out' ? 'payout' : 'deposit';
  if ((direction === 'out') !== (kind === 'payout')) throw new Error('A payout goes out; a deposit or balance comes in');
  const method = ['cash', 'cheque', 'transfer', 'card'].includes(d.method) ? d.method : null;
  if (!method) throw new Error('Choose cash, cheque, transfer or card');
  const reference = String(d.reference || '').trim();
  if (reference.length < 3) throw new Error('Payment reference required');
  const amountCents = cents(d.amountCents, 'Amount', 1);
  if (kind === 'deposit') {
    const paid = (await tx.promoterPayment.aggregate({ where: { venueDealId: deal.id, kind: 'deposit' }, _sum: { amountCents: true } }))._sum.amountCents || 0;
    if (deal.depositCents && paid + amountCents > deal.depositCents) throw new Error(`That is more than the agreed deposit ($${((deal.depositCents - paid) / 100).toFixed(2)} left)`);
  }
  const row = await tx.promoterPayment.create({ data: { venueDealId: deal.id, direction, kind, amountCents, method, reference, recordedById: actor, idempotencyKey: input.idempotencyKey, currencyCode: deal.currencyCode } });
  const final = await tx.settlement.findFirst({ where: { venueDealId: deal.id, party: 'promoter', status: 'final' }, orderBy: { version: 'desc' } });
  let remaining: number | null = null;
  if (final && kind !== 'deposit') {
    // A final statement's balance moves toward zero: money in reduces what the promoter owes, a payout what the venue owes.
    const signed = direction === 'in' ? -amountCents : amountCents;
    const due = final.balanceDuePromoterCents || 0;
    const left = due + signed;
    remaining = left;
    if ((due > 0 && (direction !== 'in' || left < 0)) || (due < 0 && (direction !== 'out' || left > 0)) || due === 0) throw new Error('That payment is more than the balance, or in the wrong direction');
    await tx.settlement.update({ where: { id: final.id }, data: { balanceDuePromoterCents: remaining } });
    await tx.settlementLine.create({ data: { settlementId: final.id, kind: 'payment', label: `${direction === 'in' ? 'Paid by promoter' : 'Paid to promoter'} ${reference}`, amountCents: signed, rule: `${method} ${reference}`, sourceRef: row.id } });
    if (left === 0) await settlePromoterDeal(tx, final, actor);
  }
  await audit(tx, actor, 'recordPromoterPayment', 'PromoterPayment', row.id, { direction, kind, amountCents, method, reference });
  return { id: row.id, remainingCents: remaining };
});

/** Actuals for the statement, from records: own box office orders, or the promoter's figures entered with a file; bar; shifts; deposits. */
async function actualsFor(tx: any, deal: any, entered: any): Promise<StatementActuals> {
  const eventId = deal.eventId;
  const own = deal.issuer === 'own';
  const orders = own ? await tx.ticketOrder.findMany({ where: { eventId, hiddenAt: null, status: { in: ['paid', 'partially_refunded', 'comp'] } }, include: { ticketOrderLine_order: true } }) : [];
  const bar = await tx.barSales.findFirst({ where: { eventId } });
  const shifts = tx.shift ? await tx.shift.findMany({ where: { eventId, status: { not: 'cancelled' } } }) : [];
  const deposits = (await tx.promoterPayment.aggregate({ where: { venueDealId: deal.id, kind: 'deposit', direction: 'in' }, _sum: { amountCents: true } }))._sum.amountCents || 0;
  const e = entered || {};
  const num = (v: any, label: string) => cents(v, label);
  return {
    ticketGrossCents: own ? orders.reduce((n: number, o: any) => n + (o.totalCents || 0) - (o.refundedCents || 0), 0) : num(e.ticketGrossCents, 'Ticket gross'),
    taxCents: own ? orders.reduce((n: number, o: any) => n + (o.taxCents || 0), 0) : num(e.taxCents, 'Tax'),
    serviceFeesCents: own ? orders.reduce((n: number, o: any) => n + (o.serviceFeesCents || 0), 0) : 0,
    facilityFeesCents: own ? orders.reduce((n: number, o: any) => n + (o.facilityFeesCents || 0), 0) : 0,
    ticketsSold: own ? orders.filter((o: any) => o.status !== 'comp').reduce((n: number, o: any) => n + o.ticketOrderLine_order.reduce((a: number, l: any) => a + (l.quantity || 0), 0), 0) : num(e.ticketsSold, 'Tickets sold'),
    venueHoldsTicketMoney: own,
    outsideServiceFeesCents: own ? 0 : num(e.outsideServiceFeesCents, 'Seller service fees'),
    netBarCents: bar?.netCents || 0,
    showExpensesCents: num(e.showExpensesCents, 'Show costs'),
    shifts: (shifts || []).map((s: any) => ({ role: s.role, clockIn: s.clockIn, clockOut: s.clockOut, rateCents: s.rateCents })),
    depositsPaidCents: deposits,
  };
}

/** Preview the statement for a deal with given or recorded actuals; writes nothing. */
export async function quoteVenueDeal(_: any, { dealId, actuals }: any, context: any) {
  authorize(context, 'canManageVenueDeals');
  const deal = await context.prisma.venueDeal.findUnique({ where: { id: dealId } });
  if (!deal) throw new Error('Venue deal not found');
  const terms = deal.terms ? validateDealTerms({ ...deal.terms }, deal.version) : await dealTerms(context.prisma, deal);
  if (terms.dealType === 'in_house') return { lines: [], balanceCents: 0, note: 'An in-house show settles through the artist settlement' };
  return promoterStatement(terms, await actualsFor(context.prisma, deal, actuals));
}

/**
 * The promoter/renter statement (D8) from the accepted deal and the night's actuals. A draft or reviewed statement is replaced
 * by recomputing; a signed one is frozen. Lines add up to the balance or nothing is written.
 */
export const buildPromoterSettlement = staff('buildPromoterSettlement', 'canManageSettlements', i => `event:${i.eventId}`, async ({ tx, input, actor }) => {
  const event = await tx.event.findUnique({ where: { id: input.eventId } });
  if (!event || !['completed', 'settling', 'settled'].includes(event.status)) throw new Error('The show must be over before it settles');
  const deal = await tx.venueDeal.findFirst({ where: { eventId: event.id, status: { in: ['accepted', 'settled'] } }, orderBy: { version: 'desc' } });
  if (!deal) throw new Error('An accepted venue deal is required');
  if (!deal.terms || canonicalDigest(deal.terms) !== deal.termsHash) throw new Error('Accepted deal terms hash mismatch');
  const terms = validateDealTerms({ ...deal.terms }, deal.version);
  if (terms.dealType === 'in_house') throw new Error('An in-house show settles through the artist settlement');
  const old = await tx.settlement.findFirst({ where: { eventId: event.id, party: 'promoter', version: { gt: 0 } }, orderBy: { version: 'desc' } });
  if (old && FROZEN_SETTLEMENT.includes(old.status)) throw new Error('The promoter settlement is signed; correct it with an approved adjustment');
  if (deal.issuer !== 'own' && input.data?.statementId) {
    const doc = await tx.document.findUnique({ where: { id: input.data.statementId } });
    if (!doc) throw new Error('Promoter statement file not found');
  }
  if (deal.issuer !== 'own' && !input.data?.statementId) throw new Error('Attach the promoter ticket statement (or the seller report) for a show sold elsewhere');
  const actuals = await actualsFor(tx, deal, input.data);
  const st = promoterStatement(terms, actuals);
  const snapshot = { party: 'promoter', eventId: event.id, venueDealId: deal.id, termsHash: deal.termsHash, actuals: { ...actuals, shifts: actuals.shifts.length }, lines: st.lines, balanceCents: st.balanceCents, statementId: input.data?.statementId || null };
  const hash = canonicalDigest(snapshot);
  const row = await tx.settlement.create({ data: {
    eventId: event.id, venueDealId: deal.id, party: 'promoter', status: 'draft', version: await nextSettlementVersion(tx, event.id), previousVersionId: old?.id || null,
    ticketGrossCents: actuals.ticketGrossCents, taxCents: actuals.taxCents, ticketFeesCents: actuals.serviceFeesCents + actuals.facilityFeesCents, paidCount: actuals.ticketsSold,
    netBoxOfficeCents: st.netBoxOfficeCents, totalExpensesCents: st.houseExpensesCents, depositsPaidCents: actuals.depositsPaidCents,
    balanceDuePromoterCents: st.balanceCents, computedSnapshot: snapshot, hash, approvals: {}, currencyCode: deal.currencyCode,
  } });
  for (const l of st.lines) await tx.settlementLine.create({ data: { settlementId: row.id, kind: l.kind, label: l.label, amountCents: l.amountCents, rule: l.rule, sourceRef: deal.id, currencyCode: deal.currencyCode } });
  for (const l of st.lines.filter(x => x.remainder)) await tx.settlementLine.create({ data: { settlementId: row.id, kind: 'rounding', label: l.label, amountCents: 0, roundingRemainder: l.remainder, rule: 'Fraction of a cent left by flooring', sourceRef: deal.id } });
  const written = await tx.settlementLine.aggregate({ where: { settlementId: row.id }, _sum: { amountCents: true } });
  if ((written._sum.amountCents || 0) !== st.balanceCents) throw new Error('Settlement lines do not reconcile to the balance');
  if (old && ['draft', 'reviewed'].includes(old.status)) await transition(tx, 'settlement', old.id, old.status, 'void', actor, 'Superseded by recomputation');
  if (event.status === 'completed') await transition(tx, 'event', event.id, 'completed', 'settling', actor, 'Settlement computed');
  await audit(tx, actor, 'buildPromoterSettlement', 'Settlement', row.id, { hash, balanceCents: st.balanceCents });
  return { id: row.id, status: 'draft', hash, balanceCents: st.balanceCents };
});

export const venueDealMutations = { saveVenueDeal, sendVenueDeal, cancelVenueDeal, recordBarSales, recordPromoterPayment, buildPromoterSettlement };
