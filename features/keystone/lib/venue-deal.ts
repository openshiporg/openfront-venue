import { percentage } from './settlement';

/**
 * How the venue is paid for a show (D5 to D7), and the promoter statement built from it on settlement night (D8).
 * All amounts are integer cents. Percentages are basis points and floor the way Concerts' `percentage` does.
 * Sign convention on the statement: a positive line is owed BY the promoter TO the venue; a negative line is owed to the promoter.
 */
export const DEAL_TYPES = ['rental', 'co_pro', 'in_house'] as const;
export const RENT_MODES = ['flat', 'versus', 'plus'] as const;
export const RENT_BASES = ['gross', 'net_of_tax_and_fees'] as const;
export const CO_PRO_MODES = ['upside', 'up_and_down'] as const;
export const BAR_MODES = ['none', 'guarantee', 'split'] as const;
export const ISSUERS = ['own', 'openfront_concerts', 'openfront_comedy_club', 'other'] as const;
export const HOUSE_CATEGORIES = ['security', 'stagehands', 'sound', 'lights', 'cleaning', 'insurance', 'box_office', 'other'] as const;
export const STAFF_ROLES = ['security', 'crowd_manager', 'bartender', 'barback', 'box_office', 'door', 'sound', 'lights', 'stagehand', 'manager', 'server', 'cleaner'] as const;

export type BarTier = { fromCents: number; bps: number };
export type HouseExpenseTerm = { label: string; category: string; basis: 'flat' | 'from_shifts'; role?: string; amountCents?: number; rateCents?: number };
export type DealTerms = {
  dealType: typeof DEAL_TYPES[number]; version: number; issuer: string;
  rentMode: typeof RENT_MODES[number]; rentCents: number; rentPercentBps: number; rentBase: string; rentBaseKind: typeof RENT_BASES[number];
  coProMode: typeof CO_PRO_MODES[number]; venueShareBps: number; contributedRevenues: string[];
  barMode: typeof BAR_MODES[number]; barGuaranteeCents: number; barTiers: BarTier[];
  facilityFeeCents: number; ticketFeeShareBps: number;
  depositCents: number; depositDueAt: string | null; balanceDueAt: string | null;
  insuranceRequired: boolean; requiredLimitCents: number;
  houseExpenses: HouseExpenseTerm[]; notes: string;
};

const money = (v: any, label: string, max = 1_000_000_000_00) => {
  const n = v === undefined || v === null || v === '' ? 0 : Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new Error(`${label} must be whole cents, 0 or more`);
  return n;
};
const bps = (v: any, label: string) => {
  const n = v === undefined || v === null || v === '' ? 0 : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error(`${label} must be between 0% and 100%`);
  return n;
};
const oneOf = <T extends readonly string[]>(list: T, v: any, fallback: T[number], label: string): T[number] => {
  const value = v === undefined || v === null || v === '' ? fallback : String(v);
  if (!(list as readonly string[]).includes(value)) throw new Error(`Unknown ${label}`);
  return value as T[number];
};
const when = (v: any, label: string) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(+d)) throw new Error(`${label} must be a date`);
  return d.toISOString();
};

/** Validate staff input into the terms a deal stores and the promoter accepts. Every percentage says what it is a percentage of. */
export function validateDealTerms(data: any, version = 1): DealTerms {
  const dealType = oneOf(DEAL_TYPES, data?.dealType, 'rental', 'deal type');
  const rentMode = oneOf(RENT_MODES, data?.rentMode, 'flat', 'rent mode');
  const rentBaseKind = oneOf(RENT_BASES, data?.rentBaseKind, 'net_of_tax_and_fees', 'rent base');
  const coProMode = oneOf(CO_PRO_MODES, data?.coProMode, 'upside', 'co-pro mode');
  const barMode = oneOf(BAR_MODES, data?.barMode, 'none', 'bar terms');
  const issuer = oneOf(ISSUERS, data?.issuer, 'own', 'ticket seller');
  const rentPercentBps = bps(data?.rentPercentBps, 'Rent percentage');
  const rentCents = money(data?.rentCents, 'Rent');
  const venueShareBps = bps(data?.venueShareBps, 'Venue share');
  const contributed = Array.isArray(data?.contributedRevenues) ? [...new Set<string>(data.contributedRevenues.map(String))] : ['tickets'];
  if (contributed.some(c => !['tickets', 'bar'].includes(c))) throw new Error('Co-pro revenues are tickets and bar');
  const barTiers: BarTier[] = (Array.isArray(data?.barTiers) ? data.barTiers : []).map((t: any) => ({ fromCents: money(t?.fromCents, 'Bar tier threshold'), bps: bps(t?.bps, 'Bar tier percentage') }));
  barTiers.sort((a, b) => a.fromCents - b.fromCents);
  if (new Set(barTiers.map(t => t.fromCents)).size !== barTiers.length) throw new Error('Two bar tiers start at the same amount');
  const houseExpenses: HouseExpenseTerm[] = (Array.isArray(data?.houseExpenses) ? data.houseExpenses : []).map((h: any) => {
    const label = String(h?.label || '').trim().slice(0, 120);
    if (!label) throw new Error('Each house expense needs a label');
    const basis = h?.basis === 'from_shifts' ? 'from_shifts' : 'flat';
    const category = oneOf(HOUSE_CATEGORIES, h?.category, 'other', 'house expense category');
    if (basis === 'flat') return { label, category, basis, amountCents: money(h?.amountCents, `${label} amount`) };
    const role = oneOf(STAFF_ROLES, h?.role, 'security', 'staff role');
    return { label, category, basis, role, rateCents: h?.rateCents === undefined || h?.rateCents === null || h?.rateCents === '' ? undefined : money(h.rateCents, `${label} hourly rate`) };
  });
  const rentBase = String(data?.rentBase || '').trim().slice(0, 500) || (rentBaseKind === 'gross' ? 'All money paid by ticket buyers, less refunds' : 'Ticket money less refunds, sales tax, service fees and facility fees');
  if (dealType === 'rental' && rentMode !== 'flat' && rentPercentBps === 0) throw new Error('A versus or plus rent needs a percentage');
  if (dealType === 'rental' && rentMode === 'plus' && rentCents === 0) throw new Error('A plus rent needs a fixed amount');
  if (dealType === 'co_pro' && venueShareBps === 0) throw new Error('A co-pro needs the venue share');
  if (barMode === 'guarantee' && money(data?.barGuaranteeCents, 'Bar guarantee') === 0) throw new Error('A bar guarantee needs an amount');
  if (barMode === 'split' && !barTiers.length) throw new Error('A bar split needs at least one tier');
  return {
    dealType, version, issuer,
    rentMode, rentCents, rentPercentBps, rentBase, rentBaseKind,
    coProMode, venueShareBps, contributedRevenues: contributed,
    barMode, barGuaranteeCents: barMode === 'guarantee' ? money(data?.barGuaranteeCents, 'Bar guarantee') : 0, barTiers: barMode === 'split' ? barTiers : [],
    facilityFeeCents: money(data?.facilityFeeCents, 'Facility fee'), ticketFeeShareBps: bps(data?.ticketFeeShareBps, 'Ticket fee share'),
    depositCents: money(data?.depositCents, 'Deposit'), depositDueAt: when(data?.depositDueAt, 'Deposit due'), balanceDueAt: when(data?.balanceDueAt, 'Balance due'),
    insuranceRequired: data?.insuranceRequired === undefined ? true : Boolean(data.insuranceRequired), requiredLimitCents: money(data?.requiredLimitCents ?? 100000000, 'Required insurance limit'),
    houseExpenses, notes: String(data?.notes || '').trim().slice(0, 4000),
  };
}

const usd = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (b: number) => `${(b / 100).toFixed(b % 100 ? 2 : 0)}%`;
export { usd as formatCents, pct as formatBps };

/** Rent (D5): flat; the greater of the minimum and a percentage of the base (versus); or the minimum plus the percentage (plus). */
export function rentFor(terms: Pick<DealTerms, 'rentMode' | 'rentCents' | 'rentPercentBps'>, baseCents: number) {
  const share = percentage(Math.max(0, baseCents), terms.rentPercentBps);
  const cents = terms.rentMode === 'flat' ? terms.rentCents : terms.rentMode === 'versus' ? Math.max(terms.rentCents, share.cents) : terms.rentCents + share.cents;
  const rule = terms.rentMode === 'flat' ? `Flat rent ${usd(terms.rentCents)}`
    : terms.rentMode === 'versus' ? `Greater of ${usd(terms.rentCents)} and ${pct(terms.rentPercentBps)} of ${usd(baseCents)} (${usd(share.cents)})`
    : `${usd(terms.rentCents)} plus ${pct(terms.rentPercentBps)} of ${usd(baseCents)} (${usd(share.cents)})`;
  return { cents, rule, remainder: terms.rentMode === 'flat' ? 0 : share.remainder };
}

/** Bar guarantee (D6): the promoter pays the difference between the guarantee and actual NET bar sales; nothing when it is met. */
export function barShortfall(guaranteeCents: number, netBarCents: number) {
  return Math.max(0, guaranteeCents - Math.max(0, netBarCents));
}

/**
 * Bar split (D6): tiered percentages of NET bar sales paid to the promoter. Each tier's rate applies to the part of net sales
 * from its threshold up to the next tier's threshold (like tax brackets), so crossing a threshold never lowers the payout.
 */
export function barCommission(tiers: BarTier[], netBarCents: number) {
  const net = Math.max(0, netBarCents);
  const sorted = [...tiers].sort((a, b) => a.fromCents - b.fromCents);
  let cents = 0, remainder = 0;
  const parts: string[] = [];
  sorted.forEach((tier, i) => {
    const top = i + 1 < sorted.length ? sorted[i + 1].fromCents : Infinity;
    const band = Math.max(0, Math.min(net, top) - tier.fromCents);
    if (band <= 0) return;
    const p = percentage(band, tier.bps);
    cents += p.cents; remainder += p.remainder;
    parts.push(`${pct(tier.bps)} of ${usd(band)}`);
  });
  return { cents, remainder, rule: parts.length ? `${parts.join(' + ')} of net bar ${usd(net)}` : `Net bar ${usd(net)} is under the first tier` };
}

/** Co-pro (D5): the venue's share of the defined net. Upside only never goes below zero; up and down shares a loss. */
export function coProShare(mode: DealTerms['coProMode'], venueShareBps: number, netCents: number) {
  const p = percentage(netCents, venueShareBps);
  return { cents: mode === 'upside' ? Math.max(0, p.cents) : p.cents, remainder: p.remainder };
}

/** Clocked minutes × hourly rate, floored to the cent, per shift. A shift without both clock times counts nothing. */
export function shiftCost(shifts: { clockIn?: Date | string | null; clockOut?: Date | string | null; rateCents: number }[], overrideRateCents?: number) {
  let cents = 0, minutes = 0;
  for (const s of shifts) {
    if (!s.clockIn || !s.clockOut) continue;
    const m = Math.max(0, Math.floor((+new Date(s.clockOut) - +new Date(s.clockIn)) / 60000));
    const rate = overrideRateCents ?? s.rateCents;
    minutes += m; cents += Math.floor((m * rate) / 60);
  }
  return { cents, minutes };
}

export type StatementActuals = {
  /** Ticket money paid by buyers less refunds (own box office from orders; otherwise the promoter's statement). */
  ticketGrossCents: number; taxCents: number;
  /** Service and facility fees inside the gross. */
  serviceFeesCents: number; facilityFeesCents: number;
  ticketsSold: number;
  /** True when the venue's own box office sold the tickets and holds the money. */
  venueHoldsTicketMoney: boolean;
  /** Service fees charged by an outside seller, for the ticket fee share. */
  outsideServiceFeesCents: number;
  netBarCents: number;
  /** The promoter's show costs (artist, production, marketing) that a co-pro deducts from the net. */
  showExpensesCents: number;
  shifts: { role: string; clockIn?: Date | string | null; clockOut?: Date | string | null; rateCents: number }[];
  depositsPaidCents: number;
};
export type StatementLine = { kind: string; label: string; amountCents: number; rule: string; remainder?: number };

/**
 * The promoter/renter statement for one show (D8). Lines add up to the balance: positive means the promoter owes the venue.
 * In-house shows have no promoter statement; they settle through the artist settlement.
 */
export function promoterStatement(terms: DealTerms, a: StatementActuals) {
  if (terms.dealType === 'in_house') throw new Error('An in-house show settles through the artist settlement');
  const lines: StatementLine[] = [];
  const push = (kind: string, label: string, amountCents: number, rule: string, remainder = 0) => lines.push({ kind, label, amountCents, rule, remainder });
  const net = a.ticketGrossCents - a.taxCents - a.serviceFeesCents - a.facilityFeesCents;

  if (a.venueHoldsTicketMoney) {
    push('gross', 'Ticket money held by the venue', -(a.ticketGrossCents - a.taxCents), `${usd(a.ticketGrossCents)} paid by buyers less ${usd(a.taxCents)} sales tax the venue remits`);
    push('fee', 'Service fees kept by the venue', a.serviceFeesCents, 'Box office service fees collected on these tickets');
    push('facility_fee', 'Facility fees', a.facilityFeesCents, 'Facility fees collected on these tickets');
  } else {
    const fee = a.ticketsSold * terms.facilityFeeCents;
    if (fee) push('facility_fee', 'Facility fees', fee, `${a.ticketsSold} tickets × ${usd(terms.facilityFeeCents)}`);
    if (terms.ticketFeeShareBps && a.outsideServiceFeesCents) {
      const share = percentage(a.outsideServiceFeesCents, terms.ticketFeeShareBps);
      push('ticket_fee_share', 'Ticket fee share', share.cents, `${pct(terms.ticketFeeShareBps)} of ${usd(a.outsideServiceFeesCents)} seller service fees`, share.remainder);
    }
  }

  let houseTotal = 0;
  for (const h of terms.houseExpenses) {
    if (h.basis === 'flat') { houseTotal += h.amountCents || 0; push('house_expense', h.label, h.amountCents || 0, `Flat ${usd(h.amountCents || 0)}`); continue; }
    const cost = shiftCost(a.shifts.filter(s => s.role === h.role), h.rateCents);
    houseTotal += cost.cents;
    push('house_expense', h.label, cost.cents, `${(cost.minutes / 60).toFixed(2)} clocked ${String(h.role).replace(/_/g, ' ')} hours × ${h.rateCents !== undefined ? usd(h.rateCents) : 'each shift rate'}`);
  }

  if (terms.dealType === 'rental') {
    const base = terms.rentBaseKind === 'gross' ? a.ticketGrossCents : net;
    const rent = rentFor(terms, base);
    push('rent', 'Rent', rent.cents, terms.rentMode === 'flat' ? rent.rule : `${rent.rule}. Base: ${terms.rentBase}`, rent.remainder);
  } else {
    const barIn = terms.contributedRevenues.includes('bar') ? Math.max(0, a.netBarCents) : 0;
    const ticketsIn = terms.contributedRevenues.includes('tickets') ? net : 0;
    const definedNet = ticketsIn + barIn - houseTotal - a.showExpensesCents;
    if (barIn) push('gross', 'Net bar sales (shared revenue)', -barIn, 'Bar takings are held by the venue and shared in the co-pro');
    const share = coProShare(terms.coProMode, terms.venueShareBps, definedNet);
    push('co_pro_share', 'Venue co-pro share', share.cents, `${pct(terms.venueShareBps)} of net ${usd(definedNet)} (${usd(ticketsIn)} tickets + ${usd(barIn)} bar − ${usd(houseTotal)} house − ${usd(a.showExpensesCents)} show costs)${terms.coProMode === 'upside' ? ', never below zero' : ', losses shared'}`, share.remainder);
  }

  if (terms.barMode === 'guarantee') {
    const short = barShortfall(terms.barGuaranteeCents, a.netBarCents);
    push('bar_guarantee_shortfall', 'Bar guarantee shortfall', short, short ? `Guarantee ${usd(terms.barGuaranteeCents)} less net bar ${usd(a.netBarCents)}` : `Net bar ${usd(a.netBarCents)} met the ${usd(terms.barGuaranteeCents)} guarantee`);
  } else if (terms.barMode === 'split') {
    const c = barCommission(terms.barTiers, a.netBarCents);
    push('bar_commission', 'Bar commission to the promoter', -c.cents, c.rule, c.remainder);
  }

  if (a.depositsPaidCents) push('deposit', 'Deposits paid', -a.depositsPaidCents, 'Deposits received from the promoter');
  const balanceCents = lines.reduce((n, l) => n + l.amountCents, 0);
  if (lines.some(l => !Number.isSafeInteger(l.amountCents))) throw new Error('Statement exceeds safe integer cents');
  return { lines, balanceCents, netBoxOfficeCents: net, houseExpensesCents: houseTotal };
}
