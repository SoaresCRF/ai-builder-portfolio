const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidCnpj, parseDigitableLine } = require('../src/validate.js');

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
