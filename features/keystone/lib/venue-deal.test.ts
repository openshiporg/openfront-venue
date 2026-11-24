import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDealTerms, rentFor, barShortfall, barCommission, coProShare, shiftCost, promoterStatement, type StatementActuals } from './venue-deal';

const actuals = (over: Partial<StatementActuals> = {}): StatementActuals => ({
  ticketGrossCents: 0, taxCents: 0, serviceFeesCents: 0, facilityFeesCents: 0, ticketsSold: 0, venueHoldsTicketMoney: false,
  outsideServiceFeesCents: 0, netBarCents: 0, showExpensesCents: 0, shifts: [], depositsPaidCents: 0, ...over,
});

test('rent: flat, versus (greater of) and plus, in exact cents with Concerts rounding', () => {
  assert.equal(rentFor({ rentMode: 'flat', rentCents: 250000, rentPercentBps: 0 }, 9_999_999).cents, 250000);
  // Versus: $2,500 vs 15% of $12,345.67 = $1,851.85 (floor) → $2,500; vs 15% of $20,000.01 = $3,000.00 → $3,000.00
  assert.equal(rentFor({ rentMode: 'versus', rentCents: 250000, rentPercentBps: 1500 }, 1234567).cents, 250000);
  const high = rentFor({ rentMode: 'versus', rentCents: 250000, rentPercentBps: 1500 }, 2000001);
  assert.equal(high.cents, 300000); assert.equal(high.remainder, 1500);
  // Plus: $1,000 + 10% of $5,555.55 = $1,000 + $555.55 (floor of 555.555)
  const plus = rentFor({ rentMode: 'plus', rentCents: 100000, rentPercentBps: 1000 }, 555555);
  assert.equal(plus.cents, 155555); assert.equal(plus.remainder, 5000);
  assert.match(plus.rule, /\$1,000\.00 plus 10% of \$5,555\.55/);
});

test('bar guarantee: $5,000 guarantee and $3,800 net bills $1,200; nothing when met', () => {
  assert.equal(barShortfall(500000, 380000), 120000);
  assert.equal(barShortfall(500000, 500000), 0);
  assert.equal(barShortfall(500000, 712345), 0);
  assert.equal(barShortfall(500000, -100), 500000);
});

test('bar split: tiers apply to net bar at each threshold, like brackets', () => {
  const tiers = [{ fromCents: 0, bps: 0 }, { fromCents: 500000, bps: 1000 }, { fromCents: 1000000, bps: 1500 }];
  assert.equal(barCommission(tiers, 400000).cents, 0);
  assert.equal(barCommission(tiers, 500000).cents, 0);
  assert.equal(barCommission(tiers, 800000).cents, 30000); // 10% of $3,000
  assert.equal(barCommission(tiers, 1200000).cents, 50000 + 30000); // 10% of $5,000 + 15% of $2,000
  assert.equal(barCommission([{ fromCents: 100000, bps: 2000 }], 100033).cents, 6); // 20% of 33 cents = 6.6 → 6
});

test('co-pro: upside only never makes the venue share negative; up and down shares a loss', () => {
  assert.equal(coProShare('upside', 3000, 1000000).cents, 300000);
  assert.equal(coProShare('upside', 3000, -1000000).cents, 0);
  assert.equal(coProShare('up_and_down', 3000, -1000000).cents, -300000);
  assert.equal(coProShare('up_and_down', 3333, -1).cents, -1); // floor, as Concerts' percentage
});

test('house expenses from shifts use clocked minutes × rate', () => {
  const shifts = [
    { clockIn: '2027-05-01T18:00:00Z', clockOut: '2027-05-01T23:30:00Z', rateCents: 2500 }, // 5.5 h
    { clockIn: '2027-05-01T19:00:00Z', clockOut: '2027-05-01T19:20:00Z', rateCents: 3000 }, // 20 min
    { clockIn: '2027-05-01T19:00:00Z', clockOut: null, rateCents: 9999 }, // not clocked out: counts nothing
  ];
  assert.deepEqual(shiftCost(shifts), { cents: 13750 + 1000, minutes: 350 });
  assert.deepEqual(shiftCost(shifts, 7500), { cents: 43750, minutes: 350 });
});

test('a rental statement: lines sum to the balance, deposits reduce it, the rule is on every line', () => {
  const terms = validateDealTerms({
    dealType: 'rental', rentMode: 'versus', rentCents: 300000, rentPercentBps: 1500, rentBaseKind: 'net_of_tax_and_fees',
    barMode: 'guarantee', barGuaranteeCents: 500000, facilityFeeCents: 200, ticketFeeShareBps: 2500, depositCents: 150000,
    houseExpenses: [
      { label: 'Security', category: 'security', basis: 'from_shifts', role: 'security', rateCents: 3500 },
      { label: 'Cleaning', category: 'cleaning', basis: 'flat', amountCents: 40000 },
    ],
  });
  const st = promoterStatement(terms, actuals({
    ticketGrossCents: 4200000, taxCents: 0, serviceFeesCents: 0, facilityFeesCents: 0, ticketsSold: 1000, outsideServiceFeesCents: 600000,
    netBarCents: 380000, depositsPaidCents: 150000,
    shifts: [{ role: 'security', clockIn: '2027-05-01T18:00:00Z', clockOut: '2027-05-02T00:00:00Z', rateCents: 2000 }, { role: 'bartender', clockIn: '2027-05-01T18:00:00Z', clockOut: '2027-05-02T00:00:00Z', rateCents: 2000 }],
  }));
  const by = (k: string) => st.lines.filter(l => l.kind === k).reduce((n, l) => n + l.amountCents, 0);
  assert.equal(by('facility_fee'), 200000);
  assert.equal(by('ticket_fee_share'), 150000);
  assert.equal(by('house_expense'), 21000 + 40000); // 6 h × $35 security; flat cleaning
  assert.equal(by('rent'), 630000); // 15% of $42,000 beats $3,000
  assert.equal(by('bar_guarantee_shortfall'), 120000);
  assert.equal(by('deposit'), -150000);
  assert.equal(st.balanceCents, st.lines.reduce((n, l) => n + l.amountCents, 0));
  assert.equal(st.balanceCents, 200000 + 150000 + 61000 + 630000 + 120000 - 150000);
  assert.ok(st.lines.every(l => l.rule.length > 0));
});

test('when the venue sold the tickets, the ticket money goes to the promoter less what the venue keeps', () => {
  const terms = validateDealTerms({ dealType: 'rental', rentMode: 'flat', rentCents: 200000 });
  const st = promoterStatement(terms, actuals({ venueHoldsTicketMoney: true, ticketGrossCents: 1100000, taxCents: 50000, serviceFeesCents: 80000, facilityFeesCents: 20000, ticketsSold: 400 }));
  // Promoter is owed gross less tax less the venue's fees less rent: 11,000 − 500 − 800 − 200 − 2,000 = 7,500 owed to the promoter.
  assert.equal(st.balanceCents, -750000);
});

test('a co-pro with bar in the pot and an in-house deal', () => {
  const terms = validateDealTerms({ dealType: 'co_pro', coProMode: 'up_and_down', venueShareBps: 4000, contributedRevenues: ['tickets', 'bar'] });
  const st = promoterStatement(terms, actuals({ ticketGrossCents: 1000000, netBarCents: 200000, showExpensesCents: 1500000 }));
  // Net = 10,000 + 2,000 − 15,000 = −3,000; venue carries 40% of the loss = −1,200; bar −2,000 to the pot.
  assert.equal(st.lines.find(l => l.kind === 'co_pro_share')?.amountCents, -120000);
  assert.equal(st.balanceCents, -200000 - 120000);
  assert.throws(() => promoterStatement(validateDealTerms({ dealType: 'in_house' }), actuals()), /artist settlement/);
});

test('deal terms refuse what cannot be settled', () => {
  assert.throws(() => validateDealTerms({ dealType: 'rental', rentMode: 'versus', rentCents: 1 }), /needs a percentage/);
  assert.throws(() => validateDealTerms({ dealType: 'rental', rentMode: 'plus', rentPercentBps: 500 }), /fixed amount/);
  assert.throws(() => validateDealTerms({ dealType: 'co_pro' }), /venue share/);
  assert.throws(() => validateDealTerms({ barMode: 'split' }), /tier/);
  assert.throws(() => validateDealTerms({ rentCents: -5 }), /whole cents/);
  assert.throws(() => validateDealTerms({ rentPercentBps: 10001, rentMode: 'versus' }), /between 0% and 100%/);
  assert.throws(() => validateDealTerms({ houseExpenses: [{ label: '' }] }), /label/);
  const t = validateDealTerms({});
  assert.equal(t.insuranceRequired, true); assert.equal(t.requiredLimitCents, 100000000); assert.match(t.rentBase, /less refunds, sales tax/);
});
