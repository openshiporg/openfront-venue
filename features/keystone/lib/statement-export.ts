/**
 * Settlement exports: CSV for the spreadsheet, and a plain PDF the promoter can sign. The PDF is written by hand
 * (PDF 1.4, built-in Helvetica, one text stream per page) so there is no rendering dependency.
 */
export type ExportRow = { label: string; kind?: string; rule?: string; amountCents: number };
export type ExportDoc = { title: string; subtitle: string[]; rows: ExportRow[]; totalLabel: string; totalCents: number; footer: string[] };

const usd = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cell = (v: string) => (/[",\n\r]/.test(v) || /^[=+\-@\t]/.test(v) ? `"${(/^[=+\-@\t]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v);

export function statementCsv(doc: ExportDoc) {
  // Text cells are guarded against spreadsheet formulas; the amount column is a plain number, negatives included.
  const row = (texts: string[], cents: number | null) => [...texts.map(cell), cents === null ? cell('Amount (USD)') : (cents / 100).toFixed(2)].join(',');
  const out = [row(['Line', 'Kind', 'How it was worked out'], null)];
  for (const r of doc.rows) out.push(row([r.label, r.kind || '', r.rule || ''], r.amountCents));
  out.push(row([doc.totalLabel, '', ''], doc.totalCents));
  return [doc.title, ...doc.subtitle].map(cell).join('\r\n') + '\r\n\r\n' + out.join('\r\n') + '\r\n';
}

/** Characters outside WinAnsi become '?'; parentheses and backslashes are escaped for a PDF string. */
const pdfText = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u00d7/g, 'x')
  .replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrap(s: string, width: number) {
  const words = s.split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > width) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export function statementPdf(doc: ExportDoc): Buffer {
  type Op = { x: number; size: number; bold?: boolean; text: string; right?: boolean; gap?: number };
  const ops: Op[] = [];
  ops.push({ x: 50, size: 16, bold: true, text: doc.title, gap: 22 });
  for (const s of doc.subtitle) ops.push({ x: 50, size: 10, text: s, gap: 14 });
  ops.push({ x: 50, size: 10, text: '', gap: 10 });
  for (const r of doc.rows) {
    ops.push({ x: 50, size: 10, bold: true, text: r.label, gap: 0 });
    ops.push({ x: 545, size: 10, bold: true, text: usd(r.amountCents), right: true, gap: 13 });
    for (const w of wrap(r.rule || '', 95)) if (w) ops.push({ x: 62, size: 8, text: w, gap: 11 });
    ops.push({ x: 50, size: 4, text: '', gap: 4 });
  }
  ops.push({ x: 50, size: 12, bold: true, text: doc.totalLabel, gap: 0 });
  ops.push({ x: 545, size: 12, bold: true, text: usd(doc.totalCents), right: true, gap: 26 });
  for (const f of doc.footer) for (const w of wrap(f, 100)) ops.push({ x: 50, size: 9, text: w, gap: 14 });

  const pages: string[] = []; let y = 792 - 56; let stream = '';
  for (const op of ops) {
    if (y < 60) { pages.push(stream); stream = ''; y = 792 - 56; }
    if (op.text) {
      // Helvetica averages ~0.5 em per glyph; right-aligned amounts are short and digits are 0.556 em.
      const x = op.right ? op.x - op.text.length * op.size * 0.556 : op.x;
      stream += `BT /${op.bold ? 'F2' : 'F1'} ${op.size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(op.text)}) Tj ET\n`;
    }
    y -= op.gap ?? 14;
  }
  pages.push(stream);
  const objects: string[] = [];
  const add = (s: string) => { objects.push(s); return objects.length; };
  const catalog = add(''); const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  pages.forEach((content, i) => {
    const footer = `BT /F1 8 Tf 50 30 Td (${pdfText(`Page ${i + 1} of ${pages.length}`)}) Tj ET\n`;
    const body = content + footer;
    const c = add(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}endstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** The export document for one settlement row with its lines. */
export function settlementExportDoc(s: any, venue: string): ExportDoc {
  const promoter = s.party === 'promoter';
  const lines = (s.settlementLine_settlement || s.lines || []).filter((l: any) => l.kind !== 'rounding');
  const due = promoter ? s.balanceDuePromoterCents || 0 : s.balanceDueArtistCents || 0;
  const signed = Object.entries(s.approvals || {}).map(([k, v]: any) => `${String(k).replace(/_/g, ' ')} ${String(v?.at || '').slice(0, 10)}`).join('; ');
  return {
    title: `${venue}: ${promoter ? 'promoter settlement' : 'artist settlement'}`,
    subtitle: [
      `${s.event?.title || 'Show'}${s.event?.showAt ? `, ${new Date(s.event.showAt).toISOString().slice(0, 10)}` : ''}${s.event?.room?.name ? `, ${s.event.room.name}` : ''}`,
      `${promoter && s.venueDeal?.promoter?.company ? `Promoter: ${s.venueDeal.promoter.company}. ` : ''}Version ${s.version}, ${String(s.status).replace(/_/g, ' ')}. Hash ${String(s.hash).slice(0, 16)}`,
    ],
    rows: lines.map((l: any) => ({ label: l.label, kind: String(l.kind).replace(/_/g, ' '), rule: l.rule || l.reason || '', amountCents: l.amountCents || 0 })),
    totalLabel: promoter ? (due >= 0 ? 'Balance owed by the promoter' : 'Balance owed to the promoter') : 'Balance due to the artist',
    totalCents: promoter ? Math.abs(due) : due,
    footer: [
      promoter ? 'Positive lines are owed by the promoter to the venue; negative lines are owed to the promoter. Deposits paid are shown as a credit.' : 'Lines show the artist side of the settlement.',
      signed ? `Signatures: ${signed}` : 'Not yet signed.',
    ],
  };
}
