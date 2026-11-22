const { test } = require('node:test');
const assert = require('node:assert');
const { selectDueRows, renderDigestHtml } = require('../src/digest.js');

const TODAY = '2026-11-22';
const row = (vendorName, dueDate, extra = {}) => ({
  vendorName, amount: '100', dueDate, status: 'pending', extractionStatus: 'ok', ...extra,
});

test('selects pending rows inside the window and flags overdue', () => {
  const rows = [
    row('today', '2026-11-22'),
    row('plus3', '2026-11-25'),
    row('plus4', '2026-11-26'),
    row('yesterday', '2026-11-21'),
    row('paid', '2026-11-22', { status: 'paid' }),
    row('na', '2026-11-22', { status: 'n/a' }),
    row('nodate', ''),
    row('baddate', 'garbage'),
    {},
    row('review', '2026-11-23', { extractionStatus: 'needs_review' }),
  ];
  const { dueRows, needsReviewCount } = selectDueRows(rows, TODAY, 3);
  assert.deepStrictEqual(dueRows.map((r) => r.vendorName), ['yesterday', 'today', 'review', 'plus3']);
  assert.strictEqual(dueRows[0].overdue, true);
  assert.strictEqual(dueRows[1].overdue, false);
  assert.strictEqual(dueRows[2].needsReview, true);
  assert.strictEqual(dueRows[3].needsReview, false);
  assert.strictEqual(needsReviewCount, 1);
});

test('needsReviewCount counts review and error rows that are not paid', () => {
  const rows = [
    row('a', '', { extractionStatus: 'error', status: 'n/a' }),
    row('b', '', { extractionStatus: 'needs_review', status: 'paid' }),
    row('c', '', { extractionStatus: 'needs_review' }),
    row('d', '', { extractionStatus: 'ok' }),
  ];
  assert.strictEqual(selectDueRows(rows, TODAY, 3).needsReviewCount, 2);
});

test('window crosses a month boundary', () => {
  const { dueRows } = selectDueRows([row('x', '2026-12-01')], '2026-11-29', 3);
  assert.strictEqual(dueRows.length, 1);
});

test('renders BRL amount, dd/mm/yyyy date, text flags and escapes vendor', () => {
  const { dueRows, needsReviewCount } = selectDueRows([
    row('<b>', '2026-11-21', { amount: '1234.56', extractionStatus: 'needs_review' }),
    row('ok', '2026-12-10', { amount: '5' }),
  ], TODAY, 30);
  const html = renderDigestHtml({ dueRows, needsReviewCount: 1 }, TODAY);
  assert.match(html, /R\$ 1\.234,56/);
  assert.match(html, /10\/12\/2026/);
  assert.match(html, /OVERDUE/);
  assert.match(html, /REVIEW/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /<td>ok<\/td>/);
  assert.match(html, /Documents needing review: 1/);
  assert.ok(!html.includes('<b>'));
});

test('empty or missing amount renders empty, not R$ 0,00', () => {
  const html = renderDigestHtml({ dueRows: [row('v', '2026-11-22', { amount: '' }), row('w', '2026-11-22', { amount: null })], needsReviewCount: 0 }, TODAY);
  assert.ok(!html.includes('R$'));
});

test('empty dueRows renders without throwing', () => {
  assert.match(renderDigestHtml({ dueRows: [], needsReviewCount: 2 }, TODAY), /Documents needing review: 2/);
});
