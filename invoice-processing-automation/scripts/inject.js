// Copies a tested source file into an n8n Code node, so the logic the workflow
// runs is the same file `npm test` covers.
const fs = require('node:fs');

const LIB_BLOCK = /(\/\/ <lib>\n)[\s\S]*?(\/\/ <\/lib>)/;

function inject(workflowJson, nodeName, libSource) {
  const wf = structuredClone(workflowJson);
  const node = wf.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found`);
  const code = node.parameters.jsCode || '';
  if (!LIB_BLOCK.test(code)) throw new Error(`Node "${nodeName}" lacks // <lib> ... // </lib> markers`);
  // Code nodes have no module system; the export line would throw at runtime.
  const lib = libSource.split('\n').filter((l) => !l.startsWith('module.exports')).join('\n').trimEnd();
  // Function replacer: libSource may contain "$" sequences that a string replacement would expand.
  node.parameters.jsCode = code.replace(LIB_BLOCK, (_, open, close) => `${open}${lib}\n${close}`);
  return wf;
}

if (require.main === module) {
  const [file, nodeName, srcFile] = process.argv.slice(2);
  if (!srcFile) {
    console.error('Usage: node scripts/inject.js <workflow.json> <nodeName> <src.js>');
    process.exit(1);
  }
  const wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = inject(wf, nodeName, fs.readFileSync(srcFile, 'utf8').replace(/\r\n/g, '\n'));
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
}

module.exports = { inject };
