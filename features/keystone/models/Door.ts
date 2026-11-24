import { list } from '@keystone-6/core';
import { text, integer, select, relationship, timestamp } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { readAccess } from '../access';
import { CHANNEL_KINDS } from '../lib/channel-client';

const fixed = { access: { create: () => false, update: () => false } };
const opts = (values: readonly string[]) => values.map(value => ({ label: value.replace(/_/g, ' '), value }));
const commandOnly = (...readers: Parameters<typeof readAccess>) => ({ operation: { ...readAccess(...readers).operation, create: () => false, update: () => false, delete: () => false } });

/** Sealed small secrets (a sibling's refresh token, a pending PKCE verifier). Server only: never in GraphQL or the Admin UI. */
export const SecretBox = list({
  access: { operation: { query: () => false, create: () => false, update: () => false, delete: () => false } },
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    key: text({ isIndexed: 'unique', validation: { isRequired: true } }),
    ciphertext: text({ validation: { isRequired: true } }),
    iv: text({ validation: { isRequired: true } }),
    authTag: text({ validation: { isRequired: true } }),
    keyVersion: integer({ defaultValue: 1 }),
    rotatedAt: timestamp(),
    ...trackingFields,
  },
});

/**
 * The venue's OAuth connection to a sibling Openfront deployment (§4.16): pending → connected → needs_reconnect →
 * disconnected. Tokens are never columns here: the refresh token is sealed in SecretBox under `channel:<id>:refresh`.
 */
export const ChannelConnection = list({
  access: commandOnly('canManageConnections', 'canManageEvents', 'canScanTickets'),
  fields: {
    kind: select({ type: 'string', options: opts(CHANNEL_KINDS), validation: { isRequired: true }, ...fixed }),
    baseUrl: text({ ...fixed }),
    issuer: text({ ...fixed }),
    clientId: text({ ...fixed }),
    siblingName: text({ ...fixed }),
    siblingUserLabel: text({ ...fixed }),
    scopes: text({ ...fixed }),
    status: select({ type: 'string', options: opts(['pending', 'connected', 'needs_reconnect', 'disconnected']), defaultValue: 'pending', ...fixed }),
    stateHash: text({ isIndexed: true, access: { read: () => false, create: () => false, update: () => false } }),
    pendingExpiresAt: timestamp({ ...fixed }),
    startedBy: relationship({ ref: 'User.channelConnection_startedBy', many: false, ...fixed }),
    connectedAt: timestamp({ ...fixed }),
    lastUsedAt: timestamp({ ...fixed }),
    lastRefreshedAt: timestamp({ ...fixed }),
    lastError: text({ ...fixed }),
    event_connection: relationship({ ref: 'Event.connection', many: true, ...fixed }),
    ...trackingFields,
  },
});

/** One import of another seller's barcode export (§8.2). The CSV itself is never kept: it holds the raw barcodes. */
export const ExternalTicketBatch = list({
  access: commandOnly('canManageEvents', 'canScanTickets'),
  fields: {
    event: relationship({ ref: 'Event.externalTicketBatch_event', many: false, ...fixed }),
    sellerName: text({ ...fixed }),
    filename: text({ ...fixed }),
    importedBy: relationship({ ref: 'User.externalTicketBatch_importedBy', many: false, ...fixed }),
    importedAt: timestamp({ ...fixed }),
    rowCount: integer({ defaultValue: 0, ...fixed }),
    addedCount: integer({ defaultValue: 0, ...fixed }),
    skippedCount: integer({ defaultValue: 0, ...fixed }),
    voidedCount: integer({ defaultValue: 0, ...fixed }),
    externalTicket_batch: relationship({ ref: 'ExternalTicket.batch', many: true, ...fixed }),
    ...trackingFields,
  },
});

/** A ticket sold by another seller (§4.8): valid → checked_in, or void. Only a SHA-256 of the barcode and its last four characters are kept. */
export const ExternalTicket = list({
  access: commandOnly('canManageEvents', 'canScanTickets'),
  fields: {
    batch: relationship({ ref: 'ExternalTicketBatch.externalTicket_batch', many: false, ...fixed }),
    event: relationship({ ref: 'Event.externalTicket_event', many: false, ...fixed }),
    barcodeHash: text({ access: { read: () => false, create: () => false, update: () => false } }),
    barcodeLast4: text({ ...fixed }),
    holderName: text({ ...fixed }),
    ticketType: text({ ...fixed }),
    status: select({ type: 'string', options: opts(['valid', 'checked_in', 'void']), defaultValue: 'valid', ...fixed }),
    checkedInAt: timestamp({ ...fixed }),
    voidReason: text({ ...fixed }),
    scanEvent_externalTicket: relationship({ ref: 'ScanEvent.externalTicket', many: true, ...fixed }),
    ...trackingFields,
  },
});

/** A name on the door list (§4.9): admits up to 1 + plusOnes, once per place; listed → checked_in, or removed. */
export const GuestListEntry = list({
  access: commandOnly('canManageEvents', 'canManageOrders', 'canScanTickets'),
  fields: {
    event: relationship({ ref: 'Event.guestListEntry_event', many: false, ...fixed }),
    name: text({ ...fixed }),
    plusOnes: integer({ defaultValue: 0, ...fixed }),
    admittedCount: integer({ defaultValue: 0, ...fixed }),
    addedFor: select({ type: 'string', options: opts(['artist', 'promoter', 'house']), defaultValue: 'house', ...fixed }),
    note: text({ ...fixed }),
    status: select({ type: 'string', options: opts(['listed', 'checked_in', 'removed']), defaultValue: 'listed', ...fixed }),
    addedBy: relationship({ ref: 'User.guestListEntry_addedBy', many: false, ...fixed }),
    scanEvent_guestListEntry: relationship({ ref: 'ScanEvent.guestListEntry', many: true, ...fixed }),
    ...trackingFields,
  },
});
