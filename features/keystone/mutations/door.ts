import { permissions, permissionRefusal, type Permission } from '../access';
import { command, transition } from '../lib/transaction';
import { appendAuditEvent } from '../lib/audit';
import { digest } from '../lib/guest-proof';
import { findIdempotencyAttempt } from '../utils/idempotency';
import { publicHostPolicy, SiblingUnreachable, AddressRefused, type UrlPolicy } from '../lib/sibling-http';
import { NeedsReconnect, siblingGraphQL, siblingPublicGraphQL, text, CHANNEL_LABEL } from '../lib/channel-client';
import { readImport, barcodeDigest, normalizeBarcode, last4, siblingScanResult, type ImportMapping } from '../lib/external-tickets';
import { issuedCounts } from '../lib/issued';
import { startConnection, completeConnection, checkConnection, disconnectConnection } from '../lib/channel-connect';

/**
 * One door for every seller (D3, D10, §4.6, §8.1, §8.2, W2, W6, W10, W11).
 * Exported functions that reach a sibling take the URL policy as an argument; every GraphQL resolver passes
 * `publicHostPolicy`. Sibling calls are never made inside a database transaction.
 */
const SCAN_OPEN = ['doors', 'in_progress'];
const CONNECTED = ['openfront_concerts', 'openfront_comedy_club'];

function need(context: any, ...any: Permission[]) {
  if (!context.session?.itemId) throw new Error('Please sign in');
  if (!any.some(p => permissions[p]({ session: context.session }))) throw new Error(permissionRefusal(any[0]));
  return String(context.session.itemId);
}
const keyOf = (input: any) => { const k = String(input?.idempotencyKey || '').trim(); if (!k) throw new Error('Idempotency key required'); return k; };
const placesAdmitted = async (tx: any, eventId: string) => (await tx.scanEvent.aggregate({ where: { eventId, result: 'admitted' }, _sum: { places: true } }))._sum.places || 0;

/* ------------------------------------------------------------------------------------------------ scanning */

type Scan = { eventId: string; code: string; gate: string };

function scanInput(input: any): Scan {
  const eventId = String(input?.eventId || '');
  if (!eventId) throw new Error('Choose the event');
  const code = String(input?.code ?? input?.token ?? input?.ticketCode ?? '').trim();
  if (!code) throw new Error('Scan or type a ticket code');
  if (code.length > 512) throw new Error('That code is too long to be a ticket');
  return { eventId, code, gate: String(input?.gate || 'Main').trim().slice(0, 40) || 'Main' };
}

/** The own ticket a scanned value names: a QR carries the 64-character secret, anything else is the printed code. */
async function ownTicket(tx: any, code: string) {
  if (/^[0-9a-f]{64}$/i.test(code)) {
    const byToken = await tx.ticket.findFirst({ where: { tokenHash: digest(code.toLowerCase()) } });
    if (byToken) return byToken;
  }
  return tx.ticket.findUnique({ where: { ticketCode: code.toUpperCase() } });
}

async function record(tx: any, data: any) {
  const scan = await tx.scanEvent.create({ data: { at: new Date(), places: 1, ...data } });
  return { id: scan.id, result: scan.result, source: scan.source, message: scan.message || '', places: scan.places, admitted: await placesAdmitted(tx, data.eventId) };
}

/** Local sources (own ticket, imported barcode) under the event lock. Returns null when the code is not ours. */
async function scanLocal(tx: any, s: Scan, actor: string, source: 'own' | 'will_call' = 'own', idChecked = false) {
  const event = await tx.event.findUnique({ where: { id: s.eventId } });
  if (!event) throw new Error('Event not found');
  const base = { eventId: s.eventId, gate: s.gate, scannedById: actor, idChecked, codeLast4: last4(s.code) };
  const ticket = await ownTicket(tx, s.code);
  if (ticket) {
    const result = ticket.eventId !== s.eventId ? 'wrong_event' : ['void', 'refunded', 'transferred'].includes(ticket.status) ? 'void' : ticket.status === 'checked_in' ? (event.allowReentry ? 'reentry' : 'duplicate') : 'admitted';
    if (result === 'admitted') {
      if (!SCAN_OPEN.includes(event.status)) throw new Error('Doors are not open');
      await transition(tx, 'ticket', ticket.id, 'valid', 'checked_in', actor);
    }
    return record(tx, { ...base, source, ticketId: ticket.id, result, codeLast4: String(ticket.ticketCode || '').slice(-4) });
  }
  const external = await tx.externalTicket.findFirst({ where: { eventId: s.eventId, barcodeHash: barcodeDigest(s.eventId, s.code) } });
  if (external) return admitExternal(tx, event, external, base, source === 'will_call' ? 'will_call' : 'external');
  return null;
}

async function admitExternal(tx: any, event: any, external: any, base: any, source: string) {
  const result = external.status === 'void' ? 'void' : external.status === 'checked_in' ? 'duplicate' : 'admitted';
  if (result === 'admitted') {
    if (!SCAN_OPEN.includes(event.status)) throw new Error('Doors are not open');
    const cas = await tx.externalTicket.updateMany({ where: { id: external.id, status: 'valid' }, data: { status: 'checked_in', checkedInAt: new Date() } });
    if (cas.count !== 1) return record(tx, { ...base, source, externalTicketId: external.id, result: 'duplicate', codeLast4: external.barcodeLast4 });
  }
  return record(tx, { ...base, source, externalTicketId: external.id, result, codeLast4: external.barcodeLast4, message: result === 'void' ? text(external.voidReason || 'Voided by the seller') : '' });
}

/** The sibling's own door operation, as the connected account (§8.1). */
async function askSibling(prisma: any, policy: UrlPolicy, connection: any, externalEventId: string, s: Scan, siblingKey: string) {
  if (connection.kind === 'openfront_concerts') {
    const value = /^[0-9a-f]{64}$/i.test(s.code) ? { token: s.code.toLowerCase() } : { ticketCode: s.code.toUpperCase() };
    const r = await siblingGraphQL(prisma, connection, policy, 'mutation Scan($input: OperatorCommandInput!) { result: scanTicket(input: $input) }', { input: { idempotencyKey: siblingKey, eventId: externalEventId, gate: s.gate, ...value } });
    return { raw: r.data?.result?.result ?? null, message: r.errors[0]?.message || '' };
  }
  const r = await siblingGraphQL(prisma, connection, policy, 'mutation Scan($code: String!, $show: ID!, $key: String!) { result: checkInTicket(tokenOrCode: $code, showId: $show, method: "scan", idempotencyKey: $key) }', { code: s.code, show: externalEventId, key: siblingKey });
  const res = r.data?.result;
  const who = res?.result === 'duplicate' && res?.admittedAt ? `First admitted ${text(res.admittedAt, 40)}${res.admittedBy ? ` by ${text(res.admittedBy, 80)}` : ''}` : '';
  return { raw: res?.result ?? null, message: r.errors[0]?.message || who };
}

/**
 * scanTicket for every source (§4.6): own ticket → Concerts' checks; imported barcode → matched by its hash; connected
 * issuer → the sibling's scanTicket (Concerts) or checkInTicket (Comedy) with the venue's token. Every scan is one
 * ScanEvent, including codes nobody issued. An unreachable issuer is NEVER recorded as admitted.
 * The idempotency record keeps a digest of the scanned value, never the value.
 */
export async function scanAtDoor(context: any, input: any, policy: UrlPolicy) {
  const actor = need(context, 'canScanTickets');
  const idempotencyKey = keyOf(input);
  const s = scanInput(input);
  const params = { eventId: s.eventId, codeHash: digest(s.code), gate: s.gate };
  const run = (body: (tx: any) => Promise<any>) => command(context, { operation: 'scanTicket', idempotencyKey, lock: `event:${s.eventId}`, params }, body);

  const local = await run(async tx => {
    const done = await scanLocal(tx, s, actor);
    if (done) return done;
    const event = await tx.event.findUnique({ where: { id: s.eventId }, include: { connection: true } });
    if (CONNECTED.includes(event.issuer) && event.connection && event.externalEventId) return { pendingSibling: true };
    return record(tx, { eventId: s.eventId, gate: s.gate, scannedById: actor, source: 'own', result: 'not_found', codeLast4: last4(s.code), message: event.issuer === 'other' ? 'Not in the imported barcodes' : 'No ticket has that code' });
  });
  if (!local?.pendingSibling) return local;

  // Not ours: ask the issuer, outside any transaction. A replay of this key already has its answer stored.
  const existing = await findIdempotencyAttempt(context.prisma, { key: `${idempotencyKey}:sibling`, requestPath: 'scanTicket:sibling', requestParams: { ...params, actor } }).catch(() => null);
  if (existing?.recoveryPoint === 'completed') return existing.responseBody;
  const event = await context.prisma.event.findUnique({ where: { id: s.eventId }, include: { connection: true } });
  let outcome: { result: string; issuerResult: string; message: string };
  try {
    const answer = await askSibling(context.prisma, policy, event.connection, event.externalEventId, s, digest(`venue-scan\0${event.connection.id}\0${idempotencyKey}`));
    const result = answer.raw ? siblingScanResult(event.connection.kind, answer.raw) : /ticket not found/i.test(answer.message) ? 'not_found' : 'issuer_refused';
    outcome = { result, issuerResult: text(answer.raw || '', 40), message: text(answer.message) };
  } catch (e: any) {
    const why = e instanceof NeedsReconnect ? 'The connection to the seller must be reconnected; do not admit on this scan' : e instanceof SiblingUnreachable || e instanceof AddressRefused ? 'Seller not answering; do not admit on this scan' : 'Seller not answering; do not admit on this scan';
    outcome = { result: 'issuer_unreachable', issuerResult: '', message: why };
  }
  return command(context, { operation: 'scanTicket:sibling', idempotencyKey: `${idempotencyKey}:sibling`, lock: `event:${s.eventId}`, params }, tx =>
    record(tx, { eventId: s.eventId, gate: s.gate, scannedById: actor, source: 'connected', codeLast4: last4(s.code), ...outcome }));
}

/** Will-call (W6.4): admit a ticket found by search, with the holder's ID checked. */
export async function admitWillCall(_: any, { input }: any, context: any) {
  const actor = need(context, 'canScanTickets');
  const idempotencyKey = keyOf(input);
  if (input?.idChecked !== true) throw new Error('Check the holder’s ID before admitting at will-call');
  const ticketId = input?.ticketId ? String(input.ticketId) : null;
  const externalTicketId = input?.externalTicketId ? String(input.externalTicketId) : null;
  if (!ticketId === !externalTicketId) throw new Error('Choose one ticket');
  const row = ticketId ? await context.prisma.ticket.findUnique({ where: { id: ticketId } }) : await context.prisma.externalTicket.findUnique({ where: { id: externalTicketId! } });
  if (!row?.eventId) throw new Error('Ticket not found');
  return command(context, { operation: 'admitWillCall', idempotencyKey, lock: `event:${row.eventId}`, params: { ticketId, externalTicketId, idChecked: true, gate: input.gate || 'Will-call' } }, async tx => {
    const event = await tx.event.findUnique({ where: { id: row.eventId } });
    const base = { eventId: row.eventId, gate: String(input.gate || 'Will-call').slice(0, 40), scannedById: actor, idChecked: true };
    if (externalTicketId) return admitExternal(tx, event, await tx.externalTicket.findUnique({ where: { id: externalTicketId } }), base, 'will_call');
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId! } });
    const result = ['void', 'refunded', 'transferred'].includes(ticket.status) ? 'void' : ticket.status === 'checked_in' ? (event.allowReentry ? 'reentry' : 'duplicate') : 'admitted';
    if (result === 'admitted') { if (!SCAN_OPEN.includes(event.status)) throw new Error('Doors are not open'); await transition(tx, 'ticket', ticket.id, 'valid', 'checked_in', actor, 'will-call, ID checked'); }
    return record(tx, { ...base, source: 'will_call', ticketId: ticket.id, result, codeLast4: String(ticket.ticketCode || '').slice(-4) });
  });
}

/* ------------------------------------------------------------------------------------------------ guest list */

export async function addGuestListEntry(_: any, { input }: any, context: any) {
  const actor = need(context, 'canManageEvents', 'canManageOrders');
  const idempotencyKey = keyOf(input);
  const name = String(input?.name || '').trim().slice(0, 160);
  const plusOnes = input?.plusOnes == null ? 0 : Number(input.plusOnes);
  const addedFor = String(input?.addedFor || 'house');
  if (!name) throw new Error('Name required');
  if (!Number.isSafeInteger(plusOnes) || plusOnes < 0 || plusOnes > 20) throw new Error('Plus-ones must be 0 to 20');
  if (!['artist', 'promoter', 'house'].includes(addedFor)) throw new Error('Choose artist, promoter or house');
  const params = { eventId: input.eventId, name, plusOnes, addedFor, note: String(input.note || '').trim().slice(0, 500) };
  return command(context, { operation: 'addGuestListEntry', idempotencyKey, lock: `event:${input.eventId}`, params }, async tx => {
    const event = await tx.event.findUnique({ where: { id: input.eventId } });
    if (!event) throw new Error('Event not found');
    if (['completed', 'settling', 'settled', 'cancelled'].includes(event.status)) throw new Error('This event is over');
    const row = await tx.guestListEntry.create({ data: { ...params, addedById: actor, status: 'listed' } });
    await appendAuditEvent(tx, actor, { action: 'guest_list.added', targetList: 'GuestListEntry', targetId: row.id, after: params });
    return { id: row.id, status: row.status, places: 1 + plusOnes };
  });
}

export async function removeGuestListEntry(_: any, { input }: any, context: any) {
  const actor = need(context, 'canManageEvents', 'canManageOrders');
  const idempotencyKey = keyOf(input);
  const row0 = await context.prisma.guestListEntry.findUnique({ where: { id: String(input?.guestListEntryId || '') } });
  if (!row0) throw new Error('Guest-list entry not found');
  return command(context, { operation: 'removeGuestListEntry', idempotencyKey, lock: `event:${row0.eventId}`, params: { guestListEntryId: row0.id, reason: input.reason || '' } }, async tx => {
    const row = await tx.guestListEntry.findUnique({ where: { id: row0.id } });
    if (row.admittedCount > 0) throw new Error('Someone on this entry is already in; it cannot be removed');
    await transition(tx, 'guestListEntry', row.id, 'listed', 'removed', actor, String(input.reason || '').trim());
    return { id: row.id, status: 'removed' };
  });
}

/** Admit people on a guest-list entry: each place once (an entry with 2 plus-ones admits up to 3). */
export async function admitGuestListEntry(_: any, { input }: any, context: any) {
  const actor = need(context, 'canScanTickets');
  const idempotencyKey = keyOf(input);
  const quantity = input?.quantity == null ? 1 : Number(input.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 21) throw new Error('Admit 1 or more people');
  const row0 = await context.prisma.guestListEntry.findUnique({ where: { id: String(input?.guestListEntryId || '') } });
  if (!row0) throw new Error('Guest-list entry not found');
  return command(context, { operation: 'admitGuestListEntry', idempotencyKey, lock: `event:${row0.eventId}`, params: { guestListEntryId: row0.id, quantity, gate: input.gate || 'Main' } }, async tx => {
    const event = await tx.event.findUnique({ where: { id: row0.eventId } });
    const row = await tx.guestListEntry.findUnique({ where: { id: row0.id } });
    const base = { eventId: row.eventId, gate: String(input.gate || 'Main').slice(0, 40), scannedById: actor, source: 'guest_list', guestListEntryId: row.id, places: quantity };
    const left = 1 + row.plusOnes - row.admittedCount;
    if (row.status === 'removed') return record(tx, { ...base, result: 'void', message: 'Removed from the guest list' });
    if (quantity > left) return record(tx, { ...base, result: 'duplicate', message: left ? `Only ${left} of ${1 + row.plusOnes} places left on this entry` : `All ${1 + row.plusOnes} places on this entry are used` });
    if (!SCAN_OPEN.includes(event.status)) throw new Error('Doors are not open');
    const cas = await tx.guestListEntry.updateMany({ where: { id: row.id, admittedCount: row.admittedCount, status: { not: 'removed' } }, data: { admittedCount: { increment: quantity }, status: 'checked_in' } });
    if (cas.count !== 1) throw new Error('This entry changed; try again');
    return { ...(await record(tx, { ...base, result: 'admitted' })), left: left - quantity };
  });
}

/* ------------------------------------------------------------------------------------------------ outside tickets */

/** W11: import another seller's barcode export. The CSV is never stored (it holds the raw barcodes); the idempotency record keeps its digest. */
export async function importExternalTickets(_: any, { input }: any, context: any) {
  const actor = need(context, 'canManageEvents');
  const idempotencyKey = keyOf(input);
  const sellerName = String(input?.sellerName || '').trim().slice(0, 120);
  if (!sellerName) throw new Error('Name the seller');
  const mapping = (input?.mapping && typeof input.mapping === 'object' ? input.mapping : null) as Partial<ImportMapping> | null;
  const csv = String(input?.csv || '');
  const parsed = readImport(String(input?.eventId || ''), csv, mapping);
  const params = { eventId: input.eventId, sellerName, csvDigest: digest(csv), mapping, filename: String(input.filename || '').slice(0, 200) };
  return command(context, { operation: 'importExternalTickets', idempotencyKey, lock: `event:${input.eventId}`, params }, async tx => {
    const event = await tx.event.findUnique({ where: { id: input.eventId } });
    if (!event) throw new Error('Event not found');
    if (['settled', 'cancelled'].includes(event.status)) throw new Error('This event is closed');
    const digests = parsed.rows.map(r => r.digest);
    const existing = new Map<string, any>();
    for (let i = 0; i < digests.length; i += 1000) for (const t of await tx.externalTicket.findMany({ where: { eventId: event.id, barcodeHash: { in: digests.slice(i, i + 1000) } }, select: { id: true, barcodeHash: true, status: true } })) existing.set(t.barcodeHash, t);
    const batch = await tx.externalTicketBatch.create({ data: { eventId: event.id, sellerName, filename: params.filename, importedById: actor, importedAt: new Date(), rowCount: parsed.rowCount } });
    const fresh = parsed.rows.filter(r => !existing.has(r.digest));
    for (let i = 0; i < fresh.length; i += 1000) {
      await tx.externalTicket.createMany({ data: fresh.slice(i, i + 1000).map(r => ({ batchId: batch.id, eventId: event.id, barcodeHash: r.digest, barcodeLast4: r.last4, holderName: r.holderName, ticketType: r.ticketType, status: r.voided ? 'void' : 'valid', voidReason: r.voided ? `Void in ${sellerName}’s export` : '' })), skipDuplicates: true });
    }
    // A status column can void a barcode imported before; one already admitted stays admitted (the door decided).
    const toVoid = parsed.rows.filter(r => r.voided && existing.get(r.digest)?.status === 'valid').map(r => existing.get(r.digest).id);
    if (toVoid.length) await tx.externalTicket.updateMany({ where: { id: { in: toVoid }, status: 'valid' }, data: { status: 'void', voidReason: `Void in ${sellerName}’s later export` } });
    const added = fresh.length;
    const result = { batchId: batch.id, rowCount: parsed.rowCount, added, alreadyImported: parsed.rows.length - added, voided: toVoid.length, blank: parsed.blank, repeatedInFile: parsed.repeated };
    await tx.externalTicketBatch.update({ where: { id: batch.id }, data: { addedCount: added, skippedCount: parsed.rowCount - added, voidedCount: toVoid.length } });
    if (event.issuer === 'own') await tx.event.update({ where: { id: event.id }, data: { externalSellerName: event.externalSellerName || sellerName } });
    await appendAuditEvent(tx, actor, { action: 'external_tickets.imported', targetList: 'ExternalTicketBatch', targetId: batch.id, after: result });
    return result;
  });
}

export async function voidExternalTicket(_: any, { input }: any, context: any) {
  const actor = need(context, 'canManageEvents');
  const idempotencyKey = keyOf(input);
  const reason = String(input?.reason || '').trim();
  if (!reason) throw new Error('Say why the ticket is void');
  const row0 = await context.prisma.externalTicket.findUnique({ where: { id: String(input?.externalTicketId || '') } });
  if (!row0) throw new Error('Outside ticket not found');
  return command(context, { operation: 'voidExternalTicket', idempotencyKey, lock: `event:${row0.eventId}`, params: { externalTicketId: row0.id, reason } }, async tx => {
    await transition(tx, 'externalTicket', row0.id, 'valid', 'void', actor, reason, { voidReason: reason.slice(0, 300) });
    return { id: row0.id, status: 'void' };
  });
}

/* ------------------------------------------------------------------------------------------------ search and counts */

/** W6.4, shaped like Comedy's doorBoard: the door's events, the chosen one with its counts, and what the term finds across own tickets, the guest list and imported tickets. */
export async function doorSearch(_: any, args: { eventId?: string; term?: string }, context: any) {
  need(context, 'canScanTickets', 'canManageOrders');
  const db = context.prisma;
  const events = await db.event.findMany({ where: { status: { in: ['on_sale', 'sold_out', 'doors', 'in_progress', 'completed'] }, showAt: { gte: new Date(Date.now() - 12 * 3600000) } }, orderBy: { showAt: 'asc' }, take: 20, select: { id: true, title: true, showAt: true, status: true, issuer: true } });
  const current = (args.eventId ? await db.event.findUnique({ where: { id: args.eventId }, select: { id: true, title: true, showAt: true, doorsAt: true, status: true, issuer: true, externalSellerName: true, connection: { select: { kind: true, status: true, siblingName: true } } } }) : null) || events[0] || null;
  if (!current) return { events, event: null, issued: null, found: { tickets: [], guests: [], external: [] } };
  const term = String(args.term || '').trim().slice(0, 80);
  const like = { contains: term, mode: 'insensitive' as const };
  const [issued, admitted, tickets, guests, external] = await Promise.all([
    issuedCounts(db, current.id),
    db.scanEvent.aggregate({ where: { eventId: current.id, result: 'admitted' }, _sum: { places: true } }),
    term ? db.ticket.findMany({ where: { eventId: current.id, OR: [{ holderName: like }, { holderEmail: like }, { ticketCode: like }, { order: { OR: [{ orderNumber: like }, { guestName: like }, { guestEmail: like }] } }] }, orderBy: { holderName: 'asc' }, take: 25, select: { id: true, ticketCode: true, status: true, holderName: true, holderEmail: true, order: { select: { orderNumber: true, guestName: true, status: true } }, seatInventory: { select: { seat: { select: { label: true } } } } } }) : [],
    db.guestListEntry.findMany({ where: { eventId: current.id, status: { not: 'removed' }, ...(term ? { OR: [{ name: like }, { note: like }] } : {}) }, orderBy: { name: 'asc' }, take: term ? 25 : 200, select: { id: true, name: true, plusOnes: true, admittedCount: true, addedFor: true, note: true, status: true } }),
    term ? db.externalTicket.findMany({ where: { eventId: current.id, OR: [{ holderName: like }, { barcodeLast4: { equals: normalizeBarcode(term).slice(-4) } }] }, orderBy: { holderName: 'asc' }, take: 25, select: { id: true, holderName: true, ticketType: true, barcodeLast4: true, status: true, batch: { select: { sellerName: true } } } }) : [],
  ]);
  return { events, event: { ...current, admitted: admitted._sum.places || 0 }, issued, found: { tickets, guests, external } };
}

/** D15 for staff: total issued from every seller. For a connected issuer the sold count is read live and kept; if the seller is not answering the last read is used and marked. */
export async function eventIssued(_: any, args: { eventId: string }, context: any, policy: UrlPolicy = publicHostPolicy) {
  need(context, 'canAccessDashboard');
  const event = await context.prisma.event.findUnique({ where: { id: args.eventId }, include: { connection: true } });
  if (!event) throw new Error('Event not found');
  let live: { fresh: boolean; message: string } = { fresh: true, message: '' };
  if (CONNECTED.includes(event.issuer) && event.connection && event.externalEventId) {
    try {
      const sold = await siblingSold(context.prisma, policy, event.connection, event.externalEventId);
      await context.prisma.event.update({ where: { id: event.id }, data: { connectedSold: sold, connectedSoldAt: new Date() } });
    } catch (e: any) {
      live = { fresh: false, message: `${CHANNEL_LABEL[event.connection.kind as keyof typeof CHANNEL_LABEL]} not answering; showing the count read ${event.connectedSoldAt ? event.connectedSoldAt.toISOString() : 'never'} (${text(e?.message, 120)})` };
    }
  }
  return { ...(await issuedCounts(context.prisma, event.id)), issuer: event.issuer, ...live };
}

async function siblingSold(prisma: any, policy: UrlPolicy, connection: any, externalEventId: string): Promise<number> {
  const q = connection.kind === 'openfront_concerts' ? 'query($id: ID!) { item: event(where: { id: $id }) { sold } }' : 'query($id: ID!) { item: show(where: { id: $id }) { sold: soldCount } }';
  const r = await siblingGraphQL(prisma, connection, policy, q, { id: externalEventId });
  const sold = r.data?.item?.sold;
  if (!Number.isSafeInteger(sold) || sold < 0) throw new SiblingUnreachable(r.errors[0]?.message || 'The seller did not return a sold count');
  return sold;
}

/* ------------------------------------------------------------------------------------------------ issuer and connections */

export async function channelEvents(_: any, args: { connectionId: string }, context: any, policy: UrlPolicy = publicHostPolicy) {
  need(context, 'canManageEvents', 'canManageConnections');
  const connection = await context.prisma.channelConnection.findUnique({ where: { id: args.connectionId } });
  if (!connection) throw new Error('Connection not found');
  const concerts = connection.kind === 'openfront_concerts';
  const staff = concerts
    ? '{ items: events(where: { status: { in: ["announced", "presale", "on_sale", "sold_out", "doors", "in_progress", "postponed"] } }, orderBy: [{ showAt: asc }], take: 100) { id title status at: showAt sold } }'
    : '{ items: shows(where: { status: { in: [on_sale, sold_out, doors_open, in_progress] } }, orderBy: [{ startsAt: asc }], take: 100) { id title status at: startsAt sold: soldCount } }';
  const r = await siblingGraphQL(context.prisma, connection, policy, staff);
  let items = r.data?.items;
  if (!Array.isArray(items)) {
    // The connected role cannot list staff records: fall back to what is on sale publicly.
    const pub = await siblingPublicGraphQL(policy, connection.issuer, concerts ? '{ items: eventsOnSale }' : '{ items: showsOnSale }');
    items = Array.isArray(pub.data?.items) ? pub.data.items.map((e: any) => ({ id: e.id, title: e.title, status: e.status || 'on_sale', at: e.showAt || e.startsAt, sold: null })) : [];
    if (!items.length && (r.errors[0] || pub.errors[0])) throw new Error(`The seller refused the event list: ${(r.errors[0] || pub.errors[0]).message}`);
  }
  return items.map((e: any) => ({ id: String(e.id), title: text(e.title, 200), status: text(e.status, 30), at: e.at || null, sold: Number.isSafeInteger(e.sold) ? e.sold : null, url: `${connection.issuer}/${concerts ? 'events' : 'shows'}/${encodeURIComponent(String(e.id))}` }));
}

/** W2.1: who sells tickets for this night. Changing away from the own box office is refused once own tickets are sold. */
export async function setEventIssuer(_: any, { input }: any, context: any, policy: UrlPolicy = publicHostPolicy) {
  const actor = need(context, 'canManageEvents');
  const idempotencyKey = keyOf(input);
  const issuer = String(input?.issuer || '');
  if (!['own', 'other', ...CONNECTED].includes(issuer)) throw new Error('Choose who sells the tickets');
  let data: any = { issuer, connectionId: null, externalEventId: '', externalEventTitle: '', externalUrl: '', externalSellerName: '', connectedSold: 0, connectedSoldAt: null };
  if (issuer === 'other') {
    const name = String(input.sellerName || '').trim().slice(0, 120);
    if (!name) throw new Error('Name the seller');
    const url = String(input.url || '').trim();
    if (url) { let u: URL; try { u = new URL(url); } catch { throw new Error('The seller link must be a full https address'); } if (u.protocol !== 'https:') throw new Error('The seller link must start with https://'); }
    data = { ...data, externalSellerName: name, externalUrl: url };
  }
  if (CONNECTED.includes(issuer)) {
    const connection = await context.prisma.channelConnection.findUnique({ where: { id: String(input.connectionId || '') } });
    if (!connection || connection.kind !== issuer) throw new Error('Choose a connection to that kind of deployment');
    if (connection.status !== 'connected') throw new Error('That connection must be reconnected first');
    const externalEventId = String(input.externalEventId || '').trim();
    if (!externalEventId) throw new Error('Choose the event at the seller');
    // Read the sibling's event now, outside the transaction, so the link names a real event.
    const listed = (await channelEvents(null, { connectionId: connection.id }, context, policy)).find((e: any) => e.id === externalEventId);
    if (!listed) throw new Error('That event is not listed at the seller');
    data = { ...data, connectionId: connection.id, externalEventId, externalEventTitle: listed.title, externalUrl: listed.url, externalSellerName: connection.siblingName || CHANNEL_LABEL[issuer as keyof typeof CHANNEL_LABEL], connectedSold: listed.sold ?? 0, connectedSoldAt: listed.sold == null ? null : new Date() };
  }
  return command(context, { operation: 'setEventIssuer', idempotencyKey, lock: `event:${input.eventId}`, params: { eventId: input.eventId, issuer, connectionId: input.connectionId || null, externalEventId: input.externalEventId || null, sellerName: input.sellerName || null, url: input.url || null } }, async tx => {
    const event = await tx.event.findUnique({ where: { id: input.eventId } });
    if (!event) throw new Error('Event not found');
    if (['completed', 'settling', 'settled', 'cancelled'].includes(event.status)) throw new Error('The seller cannot change after the show');
    if (issuer !== 'own' && event.issuer === 'own') {
      const sold = await tx.ticket.count({ where: { eventId: event.id, status: { in: ['valid', 'checked_in'] }, order: { status: { not: 'comp' } } } });
      if (sold) throw new Error(`The box office has already sold ${sold} ticket${sold === 1 ? '' : 's'} for this event; refund them before handing it to another seller`);
      if (await tx.inventoryHold.count({ where: { eventId: event.id, status: 'active' } })) throw new Error('Customers are checking out for this event right now; try again in a few minutes');
    }
    await tx.event.update({ where: { id: event.id }, data });
    await appendAuditEvent(tx, actor, { action: 'event.issuer_set', targetList: 'Event', targetId: event.id, before: { issuer: event.issuer, externalEventId: event.externalEventId }, after: { issuer, externalEventId: data.externalEventId, sellerName: data.externalSellerName } });
    return { id: event.id, issuer, externalSellerName: data.externalSellerName, externalUrl: data.externalUrl, externalEventTitle: data.externalEventTitle };
  });
}

/** W2.2, public: the connected seller's live all-in prices and sold-out state, read on request. Never who bought. */
export async function connectedAvailability(_: any, args: { eventId: string }, context: any, policy: UrlPolicy = publicHostPolicy) {
  const event = await context.prisma.event.findUnique({ where: { id: args.eventId }, include: { connection: { select: { kind: true, issuer: true, status: true } } } });
  if (!event || !['announced', 'presale', 'on_sale', 'sold_out', 'postponed'].includes(event.status)) throw new Error('Event unavailable');
  const base = { eventId: event.id, issuer: event.issuer, sellerName: event.externalSellerName || null, url: event.externalUrl || null };
  if (!CONNECTED.includes(event.issuer) || !event.connection || !event.externalEventId) return { ...base, live: false, levels: [], soldOut: null };
  try {
    if (event.connection.kind === 'openfront_concerts') {
      const r = await siblingPublicGraphQL(policy, event.connection.issuer, 'query($id: ID!) { a: eventAvailability(eventId: $id) }', { id: event.externalEventId });
      const levels = (r.data?.a?.levels || []).map((l: any) => ({ name: text(l.name, 80), allInCents: (l.priceCents || 0) + (l.feeCents || 0) + (l.facilityFeeCents || 0), currencyCode: text(l.currencyCode || 'USD', 3), soldOut: (l.capacity || 0) - (l.sold || 0) - (l.held || 0) - (l.productionHeld || 0) <= 0 }));
      return { ...base, live: true, status: text(r.data?.a?.event?.status, 30), levels, soldOut: levels.length ? levels.every((l: any) => l.soldOut) : null };
    }
    const r = await siblingPublicGraphQL(policy, event.connection.issuer, 'query($id: ID!) { a: showAvailability(showId: $id) }', { id: event.externalEventId });
    const levels = (r.data?.a?.tiers || []).filter((t: any) => t.status !== 'hidden').map((t: any) => ({ name: text(t.name, 80), allInCents: (t.priceCents || 0) + (t.feeCents || 0), currencyCode: 'USD', soldOut: (t.capacity || 0) - (t.sold || 0) - (t.held || 0) <= 0 }));
    return { ...base, live: true, status: text(r.data?.a?.status, 30), levels, soldOut: levels.length ? levels.every((l: any) => l.soldOut) : r.data?.a?.status === 'sold_out' };
  } catch {
    return { ...base, live: false, levels: [], soldOut: null, message: 'Prices are on the seller’s page' };
  }
}

const redirectUriFor = (context: any) => {
  const h = context.req?.headers || {};
  const get = (n: string) => { const v = h[n]; return Array.isArray(v) ? v[0] : v || null; };
  const host = String(get('x-forwarded-host') || get('host') || '').split(',')[0].trim();
  if (!host) throw new Error('Start the connection from the dashboard');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = String(get('x-forwarded-proto') || (local ? 'http' : 'https')).split(',')[0].trim() === 'http' ? 'http' : 'https';
  return `${proto}://${host}/api/connections/callback`;
};

export async function startChannelConnection(_: any, { input }: any, context: any) {
  const actor = need(context, 'canManageConnections');
  const settings = await context.prisma.storeSettings.findFirst({ select: { name: true } }).catch(() => null);
  try {
    return await startConnection(context.prisma, publicHostPolicy, { kind: String(input?.kind || ''), baseUrl: String(input?.baseUrl || ''), redirectUri: redirectUriFor(context), userId: actor, connectionId: input?.connectionId || null, venueName: settings?.name || undefined });
  } catch (e: any) {
    if (e instanceof AddressRefused || e instanceof SiblingUnreachable) throw new Error(e.message);
    throw e;
  }
}
export async function checkChannelConnection(_: any, { input }: any, context: any) {
  need(context, 'canManageConnections');
  return checkConnection(context.prisma, publicHostPolicy, String(input?.connectionId || ''));
}
export async function disconnectChannel(_: any, { input }: any, context: any) {
  const actor = need(context, 'canManageConnections');
  return disconnectConnection(context.prisma, publicHostPolicy, String(input?.connectionId || ''), actor);
}
export { completeConnection };

/** W6.2: after the venue opens doors, open them at a connected Concerts too when the connected role allows. */
export async function openSiblingDoors(prisma: any, eventId: string, policy: UrlPolicy = publicHostPolicy) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { connection: true } });
  if (!event || event.issuer !== 'openfront_concerts' || !event.connection || !event.externalEventId) return null;
  try {
    const r = await siblingGraphQL(prisma, event.connection, policy, 'mutation($input: OperatorCommandInput!) { result: advanceEvent(input: $input) }', { input: { idempotencyKey: digest(`venue-doors\0${event.id}\0${event.externalEventId}`), eventId: event.externalEventId, status: 'doors' } });
    if (r.data?.result?.status === 'doors') return { opened: true, message: 'Doors are open at Openfront Concerts too' };
    return { opened: false, message: `The promoter must open doors in their Concerts: ${r.errors[0]?.message || 'the connected role cannot'}` };
  } catch (e: any) {
    return { opened: false, message: `The promoter must open doors in their Concerts (${text(e?.message, 120)})` };
  }
}
