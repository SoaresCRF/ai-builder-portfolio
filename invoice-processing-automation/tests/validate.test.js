const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidCnpj, parseDigitableLine, validateExtraction } = require('../src/validate.js');

test('isValidCnpj accepts numeric, formatted and alphanumeric', () => {
  assert.equal(isValidCnpj('11222333000181'), true);
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(isValidCnpj('12.ABC.345/01DE-35'), true);
  assert.equal(isValidCnpj('12abc34501de35'), true);
});
test('isValidCnpj rejects bad digits, wrong length, repeated', () => {
  assert.equal(isValidCnpj('11222333000182'), false);
  assert.equal(isValidCnpj('1122233300018'), false);
  assert.equal(isValidCnpj('00000000000000'), false);
  assert.equal(isValidCnpj(''), false);
});

const LINE = '00190000090123456789701234567897316560000123456'; // R$ 1.234,56, due 2026-12-10, factor 1656
test('parseDigitableLine decodes amount and post-2025 due date', () => {
  assert.deepEqual(parseDigitableLine(LINE, '2026-11-22'), { amount: 1234.56, dueDate: '2026-12-10' });
  assert.deepEqual(parseDigitableLine('00190.00009 01234.567897 01234.567897 3 16560000123456', '2026-11-22'), { amount: 1234.56, dueDate: '2026-12-10' });
});
test('parseDigitableLine rejects any wrong check digit', () => {
  for (const i of [9, 20, 31, 32]) { // field 1/2/3 DVs and general DV
    const bad = LINE.slice(0, i) + ((+LINE[i] + 1) % 10) + LINE.slice(i + 1);
    assert.equal(parseDigitableLine(bad, '2026-11-22'), null);
  }
  assert.equal(parseDigitableLine(LINE.slice(1), '2026-11-22'), null);
});
test('parseDigitableLine rejects utility (convenio) lines starting with 8', () => {
  assert.equal(parseDigitableLine('8'.padEnd(48, '0'), '2026-11-22'), null);
});

// Independent check-digit builder, deliberately not sharing code with src/validate.js.
function buildLine(factor, value) {
  const dv10 = (s) => {
    let sum = 0;
    [...s].reverse().forEach((c, i) => {
      const p = Number(c) * (i % 2 === 0 ? 2 : 1);
      sum += p > 9 ? p - 9 : p;
    });
    return (10 - (sum % 10)) % 10;
  };
  const free = '0123456789012345678901234';
  const head = '0019'; // bank 001, currency 9
  const body = factor + value;
  let sum = 0;
  [...(head + body + free)].reverse().forEach((c, i) => { sum += Number(c) * (2 + (i % 8)); });
  const r = 11 - (sum % 11);
  const general = r === 0 || r === 10 || r === 11 ? 1 : r;
  const f1 = head + free.slice(0, 5);
  const f2 = free.slice(5, 15);
  const f3 = free.slice(15, 25);
  return f1 + dv10(f1) + f2 + dv10(f2) + f3 + dv10(f3) + general + body;
}
test('parseDigitableLine: zero factor and zero amount give nulls', () => {
  assert.deepEqual(parseDigitableLine(buildLine('0000', '0000123456'), '2026-11-22'), { amount: 1234.56, dueDate: null });
  assert.deepEqual(parseDigitableLine(buildLine('1656', '0000000000'), '2026-11-22'), { amount: null, dueDate: '2026-12-10' });
  assert.deepEqual(parseDigitableLine(buildLine('1656', '0000123456'), '2026-11-22'), { amount: 1234.56, dueDate: '2026-12-10' });
});
test('parseDigitableLine handles factor reset boundary', () => {
  assert.equal(parseDigitableLine(buildLine('9999', '0000000100'), '2025-02-10').dueDate, '2025-02-21');
  assert.equal(parseDigitableLine(buildLine('1000', '0000000100'), '2025-03-01').dueDate, '2025-02-22');
});

const NOW = '2026-11-22T12:00:00Z';
const CNPJ = '11222333000181';
const BOLETO = {
  documentType: 'boleto', vendorName: 'ACME Ltda', vendorTaxId: CNPJ, amount: 1234.56,
  dueDate: '2026-12-10', issueDate: '2026-11-01', category: 'utilities', digitableLine: LINE,
  boletoCount: 1, sources: { amount: null, dueDate: null, vendorTaxId: null },
};
const NFE = { ...BOLETO, documentType: 'nfe', dueDate: null, digitableLine: null };
const run = (e, pdfText = null) => validateExtraction(e, { pdfText, processedAt: NOW });

test('valid boleto is ok and pending', () => {
  const r = run(BOLETO);
  assert.equal(r.extractionStatus, 'ok'); assert.deepEqual(r.reasons, []);
  assert.equal(r.record.status, 'pending'); assert.equal(r.record.amount, 1234.56);
});
test('line overrides model amount and records mismatch', () => {
  const r = run({ ...BOLETO, amount: 1243.56 });
  assert.equal(r.record.amount, 1234.56); assert.ok(r.reasons.includes('amount_mismatch_line'));
  assert.equal(r.extractionStatus, 'needs_review');
});
test('line overrides model due date and records mismatch', () => {
  const r = run({ ...BOLETO, dueDate: '2026-12-11' });
  assert.equal(r.record.dueDate, '2026-12-10'); assert.ok(r.reasons.includes('due_date_mismatch_line'));
});
test('invalid digitable line is nulled', () => {
  const r = run({ ...BOLETO, digitableLine: LINE.slice(1) });
  assert.equal(r.record.digitableLine, null);
  assert.ok(r.reasons.includes('digitable_line_invalid'));
  assert.ok(r.reasons.includes('missing_digitableLine'));
});
test('invalid CNPJ is nulled', () => {
  const r = run({ ...BOLETO, vendorTaxId: '11222333000182' });
  assert.equal(r.record.vendorTaxId, null); assert.ok(r.reasons.includes('cnpj_invalid'));
  assert.equal(r.extractionStatus, 'needs_review');
});
test('vendorTaxId is normalized to digits/uppercase', () => {
  assert.equal(run({ ...BOLETO, vendorTaxId: '11.222.333/0001-81' }).record.vendorTaxId, CNPJ);
});
test('nfe is n/a and needs no due date', () => {
  const r = run(NFE);
  assert.equal(r.record.status, 'n/a'); assert.equal(r.extractionStatus, 'ok');
});
test('boleto missing line needs review', () => {
  const r = run({ ...BOLETO, digitableLine: null });
  assert.ok(r.reasons.includes('missing_digitableLine')); assert.equal(r.extractionStatus, 'needs_review');
});
test('other with due date is pending, without is n/a', () => {
  assert.equal(run({ ...NFE, documentType: 'other', dueDate: '2026-12-10' }).record.status, 'pending');
  assert.equal(run({ ...NFE, documentType: 'other' }).record.status, 'n/a');
});
test('multiple boletos flagged', () => {
  const r = run({ ...BOLETO, boletoCount: 2 });
  assert.ok(r.reasons.includes('multiple_boletos'));
});
test('due date out of range', () => {
  const r = run({ ...NFE, dueDate: '2028-01-10' });
  assert.ok(r.reasons.includes('due_date_out_of_range')); assert.equal(r.record.dueDate, null);
});
test('malformed due date and non-positive amount are rejected', () => {
  const r = run({ ...NFE, dueDate: '10/12/2026', amount: 0 });
  assert.ok(r.reasons.includes('due_date_invalid'));
  assert.ok(r.reasons.includes('amount_invalid'));
  assert.ok(r.reasons.includes('missing_amount'));
  assert.equal(r.record.amount, null);
});
test('reasons have no duplicates', () => {
  const r = run({ ...BOLETO, digitableLine: null, amount: null, dueDate: null });
  assert.equal(new Set(r.reasons).size, r.reasons.length);
});
test('amount grounding accepts Brazilian formats', () => {
  for (const t of ['Total R$ 1.234,56', 'VALOR 1234,56']) {
    const r = run(NFE, t + ' CNPJ 11.222.333/0001-81');
    assert.ok(!r.reasons.includes('amount_not_in_text'), t);
  }
  const bad = run(NFE, 'Total 11.234,56 CNPJ 11222333000181');
  assert.ok(bad.reasons.includes('amount_not_in_text')); assert.equal(bad.record.amount, null);
});
test('CNPJ grounding accepts formatted or digits', () => {
  assert.ok(!run(NFE, 'R$ 1.234,56 CNPJ 11222333000181').reasons.includes('cnpj_not_in_text'));
  const r = run(NFE, 'R$ 1.234,56 CNPJ 99999999000191');
  assert.ok(r.reasons.includes('cnpj_not_in_text')); assert.equal(r.record.vendorTaxId, null);
});
test('empty pdfText skips text grounding', () => {
  assert.ok(!run(NFE, '').reasons.some((x) => x.endsWith('_not_in_text')));
});
