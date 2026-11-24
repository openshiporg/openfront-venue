import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementCsv, statementPdf, settlementExportDoc } from './statement-export';

const settlement = {
  party: 'promoter', version: 3, status: 'final', hash: 'abcdef0123456789abcdef', balanceDuePromoterCents: 410000,
  approvals: { signed_promoter: { at: '2027-05-02T01:00:00Z' }, final: { at: '2027-05-02T02:00:00Z' } },
  event: { title: 'Rental (night)', showAt: '2027-05-02T03:00:00Z', room: { name: 'Main Room' } }, venueDeal: { promoter: { company: 'Lantern Live' } },
  settlementLine_settlement: [
    { kind: 'rent', label: 'Rent', amountCents: 250000, rule: 'Flat rent $2,500.00' },
    { kind: 'bar_guarantee_shortfall', label: 'Bar guarantee shortfall', amountCents: 120000, rule: 'Guarantee $5,000.00 less net bar $3,800.00' },
    { kind: 'deposit', label: 'Deposits paid', amountCents: -50000, rule: '=HYPERLINK("x")' },
    { kind: 'rounding', label: 'Rent', amountCents: 0, rule: '' },
  ],
};

test('CSV export: one row per line plus the total, rounding left out, formulas neutralised', () => {
  const csv = statementCsv(settlementExportDoc(settlement, 'Openfront Venue'));
  const rows = csv.trim().split('\r\n');
  assert.equal(rows[0], 'Openfront Venue: promoter settlement');
  assert.ok(rows.includes('Rent,rent,"Flat rent $2,500.00",2500.00'));
  assert.ok(rows.some(r => r.startsWith('Deposits paid,deposit,"\'=HYPERLINK(""x"")",-500.00')));
  assert.equal(rows.at(-1), 'Balance owed by the promoter,,,4100.00');
  assert.equal(rows.filter(r => r.startsWith('Rent,')).length, 1);
});

test('PDF export: a valid PDF 1.4 with an xref pointing at each object, the lines and the balance', () => {
  const pdf = statementPdf(settlementExportDoc(settlement, 'Openfront Venue'));
  const s = pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4\n')); assert.ok(s.trimEnd().endsWith('%%EOF'));
  const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
  const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  offsets.forEach((o, i) => assert.equal(s.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.match(s, /\(Rental \\\(night\\\), 2027-05-02, Main Room\) Tj/);
  assert.match(s, /\(\$4,100\.00\) Tj/);
  assert.match(s, /\(Bar guarantee shortfall\) Tj/);
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index! + m[0].length;
    assert.equal(s.slice(start + Number(m[1]), start + Number(m[1]) + 9), 'endstream');
  }
});

test('a long statement runs onto more pages', () => {
  const many = { ...settlement, settlementLine_settlement: Array.from({ length: 80 }, (_, i) => ({ kind: 'house_expense', label: `Line ${i}`, amountCents: 100, rule: 'x '.repeat(80) })) };
  const s = statementPdf(settlementExportDoc(many, 'Openfront Venue')).toString('latin1');
  const count = Number(/\/Count (\d+)/.exec(s)![1]);
  assert.ok(count > 2);
  assert.match(s, new RegExp(`Page ${count} of ${count}`));
});
