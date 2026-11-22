const test = require('node:test');
const assert = require('node:assert/strict');
const { inject } = require('../scripts/inject.js');

const workflow = () => ({
  nodes: [
    { name: 'Trigger', parameters: {} },
    { name: 'Validate', parameters: { jsCode: '// <lib>\nold\n// </lib>\nreturn items;' } },
  ],
});

test('inject replaces the lib block and strips module.exports lines', () => {
  const wf = workflow();
  const out = inject(wf, 'Validate', 'function a(){}\nmodule.exports = { a };');
  assert.equal(out.nodes[1].parameters.jsCode, '// <lib>\nfunction a(){}\n// </lib>\nreturn items;');
  assert.equal(wf.nodes[1].parameters.jsCode, '// <lib>\nold\n// </lib>\nreturn items;', 'input not mutated');
});

test('inject fills an empty lib block', () => {
  const wf = workflow();
  wf.nodes[1].parameters.jsCode = '// <lib>\n// </lib>\nreturn items;';
  const out = inject(wf, 'Validate', 'const b = 1;\n');
  assert.equal(out.nodes[1].parameters.jsCode, '// <lib>\nconst b = 1;\n// </lib>\nreturn items;');
});

test('inject throws when the node is missing', () => {
  assert.throws(() => inject(workflow(), 'Nope', 'x'), /Nope/);
});

test('inject throws when the markers are missing', () => {
  const wf = workflow();
  wf.nodes[1].parameters.jsCode = 'return items;';
  assert.throws(() => inject(wf, 'Validate', 'x'), /marker/);
});
