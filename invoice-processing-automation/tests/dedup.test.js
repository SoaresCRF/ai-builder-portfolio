const test = require('node:test');
const assert = require('node:assert/strict');
const { filterUnprocessed } = require('../src/dedup.js');

const item = (messageId, fileName) => ({ json: { messageId, fileName } });
const rows = [{ messageId: 'm1', fileName: 'a.pdf' }];

test('drops an attachment already in the sheet', () => {
  assert.deepEqual(filterUnprocessed([item('m1', 'a.pdf')], rows), []);
});

test('keeps a new file from an already processed message', () => {
  assert.deepEqual(filterUnprocessed([item('m1', 'b.pdf')], rows), [item('m1', 'b.pdf')]);
});

test('keeps the same file name from a different message', () => {
  assert.deepEqual(filterUnprocessed([item('m2', 'a.pdf')], rows), [item('m2', 'a.pdf')]);
});

test('keeps everything when the sheet is empty', () => {
  const items = [item('m1', 'a.pdf'), item('m2', 'b.pdf')];
  assert.deepEqual(filterUnprocessed(items, []), items);
});

test('rows with missing or blank fields do not crash or match', () => {
  // alwaysOutputData on an empty sheet yields one {} row.
  const odd = [{}, { messageId: '', fileName: '' }, { messageId: null }];
  assert.deepEqual(filterUnprocessed([item('m1', 'a.pdf')], odd), [item('m1', 'a.pdf')]);
});
