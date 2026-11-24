import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal, open, secretKey, SecretUnreadable } from './secret-box';
import { publicHostPolicy, loopbackPolicy, isPublicAddress, baseUrlOf, AddressRefused, siblingRequest } from './sibling-http';
import { parseCsv, readImport, barcodeDigest, normalizeBarcode, siblingScanResult, resolveColumns } from './external-tickets';
import { totalIssued, configurationCapacity } from './issued';
import { authorizeUrl, pkcePair, resourceOf, text } from './channel-client';
import { createHash } from 'node:crypto';

// §10 test 14 (crypto half; the DB half is in door.db.test.ts): a refresh token round-trips, the sealed form never holds it, a wrong key fails.
test('SecretBox: round-trip, no plain text in the sealed row, wrong key or wrong row fails', () => {
  const key = secretKey({ SESSION_SECRET: randomBytes(32).toString('hex') });
  const token = `mcp_rt_${randomBytes(32).toString('base64url')}`;
  const sealed = seal(key, 'channel:abc:refresh', token);
  assert.equal(open(key, 'channel:abc:refresh', sealed), token);
  const row = JSON.stringify(sealed);
  assert.ok(!row.includes(token) && !row.includes(token.slice(7, 30)) && !row.includes(Buffer.from(token).toString('base64')));
  assert.throws(() => open(secretKey({ SESSION_SECRET: randomBytes(32).toString('hex') }), 'channel:abc:refresh', sealed), SecretUnreadable);
  assert.throws(() => open(key, 'channel:other:refresh', sealed), SecretUnreadable, 'bound to its row');
  assert.throws(() => open(key, 'channel:abc:refresh', { ...sealed, ciphertext: Buffer.from('x' + token).toString('base64') }), SecretUnreadable);
});

test('SecretBox key: VENUE_SECRET_KEY hex wins; otherwise HKDF of SESSION_SECRET; too short refuses', () => {
  const hex = randomBytes(32).toString('hex');
  assert.equal(secretKey({ VENUE_SECRET_KEY: hex, SESSION_SECRET: 'z'.repeat(40) }).toString('hex'), hex);
  const s = 's'.repeat(40);
  assert.deepEqual(secretKey({ SESSION_SECRET: s }), secretKey({ SESSION_SECRET: s }));
  assert.notEqual(secretKey({ SESSION_SECRET: s }).toString('hex'), Buffer.from(s).subarray(0, 32).toString('hex'), 'derived, not the session secret itself');
  assert.throws(() => secretKey({ SESSION_SECRET: 'short' }));
});

// §10 test 13 (policy half): a private-address base URL is refused at connect time.
test('URL policy: public https only; private, loopback, link-local and plain http refused', () => {
  for (const bad of ['http://tickets.example.com', 'https://127.0.0.1', 'https://10.1.2.3', 'https://192.168.1.10', 'https://169.254.169.254', 'https://[::1]', 'https://[fd00::1]', 'https://localhost', 'https://box.local', 'https://user:pw@tickets.example.com', 'ftp://tickets.example.com'])
    assert.throws(() => baseUrlOf(bad, publicHostPolicy), AddressRefused, bad);
  assert.throws(() => baseUrlOf('https://tickets.example.com/events', publicHostPolicy), AddressRefused, 'no path');
  assert.equal(baseUrlOf(' https://Concerts.Openship.org/ ', publicHostPolicy), 'https://concerts.openship.org');
  for (const a of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1', '224.0.0.1']) assert.equal(isPublicAddress(a), false, a);
  for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(a), true, a);
  // The loopback policy reaches this machine only; it is never what product code passes.
  assert.equal(baseUrlOf('http://127.0.0.1:4100', loopbackPolicy), 'http://127.0.0.1:4100');
  assert.throws(() => baseUrlOf('https://tickets.example.com', loopbackPolicy), AddressRefused);
});

test('URL policy: a public name that resolves to a private address is refused at the socket', async () => {
  // localhost.localtest.me style names are not guaranteed offline; use a name that always resolves to loopback.
  await assert.rejects(siblingRequest({ ...publicHostPolicy, refuseUrl: () => null }, 'https://localhost', '/api/graphql'), AddressRefused);
  await assert.rejects(siblingRequest(publicHostPolicy, 'https://tickets.example.com', '/admin'), /Refusing to call/);
});

test('OAuth client: PKCE S256 pair, and the authorize URL carries the RFC 8707 resource', () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  const u = new URL(authorizeUrl({ issuer: 'https://c.example', authorizationEndpoint: 'https://c.example/oauth/authorize', tokenEndpoint: '', registrationEndpoint: '', revocationEndpoint: '' }, 'mcp_cl_1', 'https://v.example/api/connections/callback', 'st', challenge));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('resource'), resourceOf('https://c.example'));
  assert.equal(u.searchParams.get('resource'), 'https://c.example/api/mcp-transport/http');
  assert.equal(text('<b>Doors</b> are   closed'), 'bDoors/b are closed', 'sibling text is never HTML');
});

// §10 test 10 (pure half).
test('Barcode import: CSV with quotes, mapping, normalisation, repeats and voids; never the raw barcode', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseCsv('\uFEFFBarcode;Name\nAB12;Ann\n'), [['Barcode', 'Name'], ['AB12', 'Ann']]);
  const csv = 'Ticket Barcode,Attendee Name,Ticket Type,Status\nRA-0001-7781,Ann Lee,GA,valid\nra00017781,Ann Lee,GA,valid\nRA-0002-1234,Bo,VIP,cancelled\n,Dee,GA,valid\nRA-0003-9999,Cy,GA,\n';
  const r = readImport('ev1', csv);
  assert.equal(r.rowCount, 5); assert.equal(r.rows.length, 3); assert.equal(r.repeated, 1); assert.equal(r.blank, 1);
  assert.deepEqual(r.rows.map(x => [x.last4, x.holderName, x.ticketType, x.voided]), [['7781', 'Ann Lee', 'GA', false], ['1234', 'Bo', 'VIP', true], ['9999', 'Cy', 'GA', false]]);
  assert.ok(!JSON.stringify(r).includes('RA00017781') && !JSON.stringify(r).includes('RA-0001'));
  assert.equal(r.rows[0].digest, barcodeDigest('ev1', 'ra 0001 7781'));
  assert.notEqual(barcodeDigest('ev1', 'RA00017781'), barcodeDigest('ev2', 'RA00017781'), 'per event');
  assert.equal(normalizeBarcode(' ab-12 34 '), 'AB1234');
  assert.throws(() => resolveColumns(['Name', 'Type'], null), /barcode/);
  assert.equal(resolveColumns(['Code ID', 'Who'], { barcode: 'code id', name: 'Who' }).barcode, 0);
  assert.throws(() => resolveColumns(['A'], { barcode: 'Missing' }), /no column named/);
  assert.throws(() => readImport('e', 'barcode\n'), /at least one ticket/);
});

test('Sibling scan answers map to the venue’s words; anything unexpected is never an admission', () => {
  assert.equal(siblingScanResult('openfront_concerts', 'admitted'), 'admitted');
  assert.equal(siblingScanResult('openfront_concerts', 'reentry'), 'reentry');
  assert.equal(siblingScanResult('openfront_comedy_club', 'wrong_show'), 'wrong_event');
  assert.equal(siblingScanResult('openfront_comedy_club', 'duplicate'), 'duplicate');
  for (const odd of ['Admitted', 'ok', '', null, undefined, 'reentry_comedy']) assert.notEqual(siblingScanResult('openfront_comedy_club', odd), 'admitted');
});

// §10 test 15 (pure half).
test('Total issued: own + comps + connected + imported + guest list against the configuration; warns exactly when over', () => {
  const at = (n: number) => totalIssued({ ownSold: 100, comps: 10, connectedSold: 0, imported: 30, guestList: n }, 150);
  assert.equal(at(10).total, 150); assert.equal(at(10).over, false);
  assert.equal(at(11).total, 151); assert.equal(at(11).over, true); assert.equal(at(11).overBy, 1);
  assert.equal(totalIssued({ ownSold: 0, comps: 0, connectedSold: 9, imported: 0, guestList: 0 }, 8).over, true);
  assert.equal(totalIssued({ ownSold: 999, comps: 0, connectedSold: 0, imported: 0, guestList: 0 }, 0).over, false, 'no capacity entered: no warning');
  assert.equal(configurationCapacity(500, [200, 250]), 450);
  assert.equal(configurationCapacity(400, [300, 250]), 400, 'never above the room');
  assert.equal(configurationCapacity(400, null), 400);
});
