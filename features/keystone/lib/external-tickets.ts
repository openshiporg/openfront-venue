import { createHash } from 'node:crypto';

/**
 * Another seller's barcode export (§8.2, W11), after Universe "Import External Attendees", Spektrix "Ticket Barcode
 * Imports", Ticketsolve and RA Scan: columns barcode, name, ticket type and optionally status, mapped per seller.
 * Only a SHA-256 of each barcode (salted with the event) and its last four characters are kept; never the barcode.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20000;

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, a leading BOM. Also reads semicolon- or tab-separated exports. */
export function parseCsv(input: string): string[][] {
  const textIn = input.replace(/^\uFEFF/, '');
  const firstLine = textIn.split(/\r?\n/, 1)[0] || '';
  const count = (ch: string) => (firstLine.match(new RegExp(`\\${ch}`, 'g')) || []).length;
  const sep = [',', ';', '\t'].map(ch => [ch, count(ch)] as const).sort((a, b) => b[1] - a[1])[0][1] > 0 ? [',', ';', '\t'].map(ch => [ch, count(ch)] as const).sort((a, b) => b[1] - a[1])[0][0] : ',';
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false; let i = 0;
  while (i < textIn.length) {
    const c = textIn[i];
    if (quoted) {
      if (c === '"') { if (textIn[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === sep) { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') { row.push(field); field = ''; if (row.some(v => v.trim() !== '')) rows.push(row); row = []; i += c === '\r' && textIn[i + 1] === '\n' ? 2 : 1; continue; }
    field += c; i++;
  }
  if (quoted) throw new Error('The file has an unclosed quote');
  row.push(field); if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

export type ImportMapping = { barcode: string; name?: string; type?: string; status?: string };

const GUESS: Record<keyof ImportMapping, RegExp> = {
  barcode: /^(barcode|bar code|ticket barcode|ticket code|code|qr|qr code|ticket number|ticket id|scan code)$/i,
  name: /^(name|attendee|attendee name|holder|holder name|customer|customer name|full name|guest)$/i,
  type: /^(type|ticket type|tier|ticket class|price type|level|ticket)$/i,
  status: /^(status|ticket status|state)$/i,
};

/** The column for each field: the mapping named by staff, else a header that matches the usual export names. */
export function resolveColumns(header: string[], mapping: Partial<ImportMapping> | null | undefined) {
  const norm = header.map(h => h.trim());
  const find = (key: keyof ImportMapping) => {
    const named = mapping?.[key]?.trim();
    if (named) { const i = norm.findIndex(h => h.toLowerCase() === named.toLowerCase()); if (i < 0) throw new Error(`The file has no column named “${named}”`); return i; }
    return norm.findIndex(h => GUESS[key].test(h));
  };
  const columns = { barcode: find('barcode'), name: find('name'), type: find('type'), status: find('status') };
  if (columns.barcode < 0) throw new Error('Choose which column holds the barcode');
  return columns;
}

/** Scanners and people type the same barcode differently: trim, drop spaces and dashes, upper-case. */
export function normalizeBarcode(raw: string): string {
  return String(raw || '').trim().replace(/[\s-]+/g, '').toUpperCase();
}
export function barcodeDigest(eventId: string, raw: string): string {
  return createHash('sha256').update(`venue-barcode\0${eventId}\0${normalizeBarcode(raw)}`).digest('hex');
}
export const last4 = (raw: string) => normalizeBarcode(raw).slice(-4);

/** A status cell meaning the seller cancelled the ticket. */
export const VOID_STATUS = /^(void|voided|cancel+ed|refunded|invalid|revoked|deleted|transferred)$/i;

export type ImportRow = { digest: string; last4: string; holderName: string; ticketType: string; voided: boolean };

export function readImport(eventId: string, csv: string, mapping?: Partial<ImportMapping> | null): { rows: ImportRow[]; rowCount: number; blank: number; repeated: number } {
  if (typeof csv !== 'string' || !csv.trim()) throw new Error('The file is empty');
  if (Buffer.byteLength(csv) > MAX_IMPORT_BYTES) throw new Error('Barcode files can be at most 5 MB');
  const table = parseCsv(csv);
  if (table.length < 2) throw new Error('The file needs a header row and at least one ticket');
  if (table.length - 1 > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} tickets at a time`);
  const cols = resolveColumns(table[0], mapping);
  const seen = new Map<string, ImportRow>(); let blank = 0; let repeated = 0;
  for (const cells of table.slice(1)) {
    const code = normalizeBarcode(cells[cols.barcode] || '');
    if (code.length < 4 || code.length > 256) { blank++; continue; }
    const row: ImportRow = {
      digest: barcodeDigest(eventId, code), last4: code.slice(-4),
      holderName: cols.name >= 0 ? String(cells[cols.name] || '').trim().slice(0, 200) : '',
      ticketType: cols.type >= 0 ? String(cells[cols.type] || '').trim().slice(0, 120) : '',
      voided: cols.status >= 0 && VOID_STATUS.test(String(cells[cols.status] || '').trim()),
    };
    const prior = seen.get(row.digest);
    // A later row for the same barcode wins only when it voids it (a seller export lists the cancellation after the sale).
    if (prior) { repeated++; if (row.voided) prior.voided = true; continue; }
    seen.set(row.digest, row);
  }
  return { rows: [...seen.values()], rowCount: table.length - 1, blank, repeated };
}

/** A sibling's scan answer in the venue's words (§4.6). Anything not plainly an admission is never an admission. */
export function siblingScanResult(kind: 'openfront_concerts' | 'openfront_comedy_club', raw: unknown): 'admitted' | 'reentry' | 'duplicate' | 'wrong_event' | 'void' | 'issuer_refused' {
  const r = String(raw || '');
  if (r === 'admitted') return 'admitted';
  if (r === 'reentry' && kind === 'openfront_concerts') return 'reentry';
  if (r === 'duplicate') return 'duplicate';
  if (r === 'wrong_event' || r === 'wrong_show') return 'wrong_event';
  if (r === 'void') return 'void';
  return 'issuer_refused';
}
