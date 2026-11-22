// Generates fictional sample invoices (DANFE) and boletos into samples/out/.
// Everything is invented: company names, addresses and CNPJs (valid check digits, random bases).
// Deterministic for a given date: `node scripts/generate-samples.js [YYYY-MM-DD]` or env SAMPLE_DATE.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { isValidCnpj, parseDigitableLine } = require('../src/validate.js');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, '..', 'samples', 'out');
const SEED = 20250222;
const MS_PER_DAY = 86400000;
const FACTOR_BASE_DATE = '2025-02-22';
const FACTOR_BASE = 1000;
const BANK_CODE = '001'; // just a number; the layout says "Banco Exemplo"
const FREE_FIELD_LENGTH = 25;
const ACCESS_KEY_LENGTH = 44;
const BROKEN_BOLETO_DAYS = 5;
const MIN_BOLETO_AMOUNT = 300;
const BOLETO_AMOUNT_SPREAD = 4700;
const INSTALLMENT_OFFSETS_DAYS = [30, 60, 90];
// Best effort only: CNPJ roots of a few well-known companies; not an exhaustive check.
const WELL_KNOWN_ROOTS = ['33000167', '00000000', '60746948', '60701190', '33683111', '47508411', '07526557', '02558157'];
const CNPJ_W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

const PAYER = { name: 'Oficina Pedra Azul Ltda', address: 'Rua das Acácias, 120, Sala 4 - Bairro Jardim Norte - Cidade Modelo/UF' };
const VENDORS = [
  { name: 'Distribuidora Vale Verde Ltda', address: 'Av. dos Ipês, 850 - Distrito Industrial - Vila Exemplo/UF', items: [['Papel sulfite A4 75g (resma)', 40, 28.9], ['Caneta esferográfica azul (cx 50)', 6, 41.5]] },
  { name: 'Tecnologia Rio Claro S.A.', address: 'Rua Dois de Ficção, 33 - Centro - Cidade Modelo/UF', items: [['Licença mensal de software de gestão', 1, 1890], ['Suporte técnico (horas)', 4, 160]] },
  { name: 'Serviços Gerais Monte Alto ME', address: 'Travessa da Aurora, 7 - Bairro Alto - Vila Exemplo/UF', items: [['Manutenção preventiva de ar-condicionado', 3, 310], ['Material de limpeza (kit)', 5, 74.9]] },
  { name: 'Gráfica Horizonte Fictícia Ltda', address: 'Rua do Sol Poente, 410 - Vila Nova - Cidade Modelo/UF', items: [['Impressão de folhetos 10x15 (milheiro)', 8, 215]] },
  { name: 'Transportes Serra Branca Ltda', address: 'Rod. Imaginária km 12 - Zona Rural - Vila Exemplo/UF', items: [['Frete rodoviário', 1, 1350]] },
];

function makeRng(seed) { // mulberry32
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(SEED);
const randDigits = (n) => Array.from({ length: n }, () => Math.floor(rng() * 10)).join('');

function cnpjDv(digits, weights) {
  const r = weights.reduce((s, w, i) => s + Number(digits[i]) * w, 0) % 11;
  return r < 2 ? 0 : 11 - r;
}

function makeCnpj() {
  for (;;) {
    const root = randDigits(8);
    if (WELL_KNOWN_ROOTS.includes(root) || /^(\d)\1+$/.test(root)) continue;
    const base = `${root}0001`;
    const d1 = cnpjDv(base, CNPJ_W1);
    const cnpj = `${base}${d1}${cnpjDv(base + d1, CNPJ_W2)}`;
    if (!isValidCnpj(cnpj)) throw new Error(`generated invalid CNPJ ${cnpj}`);
    return cnpj;
  }
}

const fmtCnpj = (c) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
const brl = (v) => v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+,)/g, '.');
const brDate = (iso) => iso.split('-').reverse().join('/');
const addDays = (iso, n) => new Date(Date.parse(iso) + n * MS_PER_DAY).toISOString().slice(0, 10);
const roundCents = (v) => Math.round(v * 100) / 100;

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function mod10(d) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const p = Number(d[d.length - 1 - i]) * (i % 2 === 0 ? 2 : 1);
    sum += p > 9 ? p - 9 : p;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11(d) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += Number(d[d.length - 1 - i]) * (2 + (i % 8));
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

function buildLine(cents, dueDate, { breakDv = false } = {}) {
  const factor = Math.round((Date.parse(dueDate) - Date.parse(FACTOR_BASE_DATE)) / MS_PER_DAY) + FACTOR_BASE;
  const tail = String(factor).padStart(4, '0') + String(cents).padStart(10, '0');
  const free = randDigits(FREE_FIELD_LENGTH);
  let dv = mod11(`${BANK_CODE}9${tail}${free}`);
  if (breakDv) dv = (dv % 9) + 1;
  const f1 = `${BANK_CODE}9${free.slice(0, 5)}`;
  const f2 = free.slice(5, 15);
  const f3 = free.slice(15);
  return `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}${dv}${tail}`;
}

function formatLine(l) {
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}

const PAGE_CSS = `<meta charset="utf-8"><style>
@page { size: A4; margin: 10mm; }
body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 0; }
.box { border: 1px solid #000; padding: 4px 6px; }
.row { display: flex; } .row > * { flex: 1; }
.lbl { font-size: 8px; text-transform: uppercase; color: #333; display: block; }
.big { font-size: 15px; font-weight: bold; }
table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #000; padding: 3px 5px; text-align: left; }
th { background: #eee; font-size: 9px; text-transform: uppercase; } .num { text-align: right; }
h2 { font-size: 11px; margin: 10px 0 2px; text-transform: uppercase; }
</style>`;

const field = (label, value) => `<div class="box"><span class="lbl">${label}</span>${value}</div>`;

function itemRows(items) {
  return items.map(([desc, qty, unit], i) => `<tr><td>${i + 1}</td><td>${desc}</td><td>UN</td><td class="num">${qty}</td><td class="num">${brl(unit)}</td><td class="num">${brl(qty * unit)}</td></tr>`).join('');
}

function installmentsHtml(d) {
  if (!d.installments) return '';
  const rows = d.installments.map((v, i) => `<tr><td>${d.number}/${String.fromCharCode(65 + i)}</td><td>${brDate(d.installmentDates[i])}</td><td class="num">${brl(v)}</td></tr>`).join('');
  return `<h2>Fatura / Duplicatas</h2><table><tr><th>Número</th><th>Vencimento</th><th>Valor</th></tr>${rows}</table>`;
}

function danfeHtml(d) {
  return `<html><head>${PAGE_CSS}</head><body>
<div class="row">${field('Emitente', `<span class="big">${d.vendor.name}</span><br>${d.vendor.address}<br>CNPJ: ${fmtCnpj(d.cnpj)}`)}
${field('DANFE', `<span class="big">NOTA FISCAL ELETRÔNICA</span><br>Documento Auxiliar da Nota Fiscal Eletrônica<br>1 - SAÍDA<br>Nº ${d.number} &nbsp; Série 1`)}</div>
${field('Chave de acesso', d.accessKey.replace(/(\d{4})/g, '$1 ').trim())}
${field('Natureza da operação', 'Venda de mercadoria / prestação de serviço')}
<h2>Destinatário / Remetente</h2>
<div class="row">${field('Nome / Razão social', PAYER.name)}${field('CNPJ / CPF', fmtCnpj(d.payerCnpj))}${field('Data de emissão', brDate(d.issueDate))}</div>
${field('Endereço', PAYER.address)}
${installmentsHtml(d)}
<h2>Cálculo do imposto</h2>
<div class="row">${field('Base de cálculo do ICMS', brl(0))}${field('Valor do frete', brl(0))}${field('Valor total dos produtos', brl(d.total))}</div>
<div class="row">${field('Valor total da nota', `<span class="big">R$ ${brl(d.total)}</span>`)}</div>
<h2>Dados dos produtos / serviços</h2>
<table><tr><th>Item</th><th>Descrição</th><th>Un.</th><th>Qtd.</th><th>Valor unit.</th><th>Valor total</th></tr>${itemRows(d.vendor.items)}</table>
<h2>Dados adicionais</h2>${field('Informações complementares', 'Documento fictício gerado para demonstração. Sem valor fiscal.')}
</body></html>`;
}

function boletoHtml(b) {
  return `<html><head>${PAGE_CSS}</head><body>
<div class="row">${field('Banco', `<span class="big">Banco Exemplo | ${BANK_CODE}-9</span>`)}${field('Linha digitável', `<span class="big" style="font-size:12.5px;white-space:nowrap">${formatLine(b.line)}</span>`)}</div>
<div class="row">${field('Local de pagamento', 'Pagável em qualquer banco até o vencimento')}${field('Vencimento', `<span class="big">${brDate(b.dueDate)}</span>`)}</div>
<div class="row">${field('Beneficiário', `${b.vendor.name}<br>CNPJ: ${fmtCnpj(b.cnpj)}<br>${b.vendor.address}`)}${field('Agência / Código do beneficiário', '0001 / 1234567-8')}</div>
<div class="row">${field('Data do documento', brDate(b.issueDate))}${field('Nº do documento', b.number)}${field('Espécie', 'DM')}${field('Nosso número', b.ourNumber)}</div>
<div class="row">${field('Carteira', '17')}${field('Espécie moeda', 'R$')}${field('Valor do Documento', `<span class="big">${brl(b.amount)}</span>`)}</div>
${field('Instruções', 'Não receber após o vencimento. Boleto fictício para demonstração, sem valor de cobrança.')}
${field('Pagador', `${PAYER.name}<br>CNPJ: ${fmtCnpj(b.payerCnpj)}<br>${PAYER.address}`)}
<p style="font-family: monospace; letter-spacing: 3px; margin-top: 14px">|||| ||| |||||| || ||| |||| || ||||| ||| || |||| ||| ||||</p>
</body></html>`;
}

function renderPdf(html, name) {
  const htmlPath = path.join(OUT, `${name}.html`);
  fs.writeFileSync(htmlPath, html);
  const args = ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${path.join(OUT, `${name}.pdf`)}`, pathToFileURL(htmlPath).href];
  execFileSync(CHROME, args, { stdio: 'ignore' });
  fs.unlinkSync(htmlPath);
}

function makeDanfe(vendor, ctx) {
  const total = roundCents(vendor.items.reduce((s, [, q, u]) => s + q * u, 0));
  const number = String(10000 + Math.floor(rng() * 89999));
  return { vendor, cnpj: makeCnpj(), payerCnpj: ctx.payerCnpj, number, accessKey: randDigits(ACCESS_KEY_LENGTH), issueDate: addDays(ctx.date, -5), total };
}

function withInstallments(d, ctx) {
  const part = roundCents(d.total / INSTALLMENT_OFFSETS_DAYS.length);
  const last = roundCents(d.total - part * (INSTALLMENT_OFFSETS_DAYS.length - 1));
  d.installments = INSTALLMENT_OFFSETS_DAYS.map((_, i) => (i === INSTALLMENT_OFFSETS_DAYS.length - 1 ? last : part));
  d.installmentDates = INSTALLMENT_OFFSETS_DAYS.map((n) => addDays(ctx.date, n));
  return d;
}

function makeBoleto(vendor, ctx, days, { broken = false } = {}) {
  const dueDate = addDays(ctx.date, days);
  const amount = roundCents(MIN_BOLETO_AMOUNT + rng() * BOLETO_AMOUNT_SPREAD);
  const line = buildLine(Math.round(amount * 100), dueDate, { breakDv: broken });
  const parsed = parseDigitableLine(line, ctx.date);
  const ok = broken ? parsed === null : parsed && parsed.amount === amount && parsed.dueDate === dueDate;
  if (!ok) throw new Error(`boleto line self-check failed (${line})`);
  const number = String(1000 + Math.floor(rng() * 8999));
  return { vendor, cnpj: makeCnpj(), payerCnpj: ctx.payerCnpj, line, dueDate, amount, issueDate: addDays(ctx.date, -10), number, ourNumber: randDigits(11) };
}

const danfeEntry = (file, d) => ({ file, documentType: 'nfe', vendorTaxId: d.cnpj, amount: d.total, dueDate: null, digitableLine: null, expectedStatus: 'ok' });
const boletoEntry = (file, b, status) => ({ file, documentType: 'boleto', vendorTaxId: b.cnpj, amount: b.amount, dueDate: b.dueDate, digitableLine: b.line, expectedStatus: status });

function buildDocuments(ctx) {
  const [v0, v1, v2, v3, v4] = VENDORS;
  return [
    ['nfe-1.pdf', danfeHtml, makeDanfe(v0, ctx), danfeEntry],
    ['nfe-2.pdf', danfeHtml, makeDanfe(v1, ctx), danfeEntry],
    ['nfe-3-duplicatas.pdf', danfeHtml, withInstallments(makeDanfe(v4, ctx), ctx), danfeEntry],
    ['boleto-d1.pdf', boletoHtml, makeBoleto(v2, ctx, 1), (f, b) => boletoEntry(f, b, 'ok')],
    ['boleto-d3.pdf', boletoHtml, makeBoleto(v3, ctx, 3), (f, b) => boletoEntry(f, b, 'ok')],
    ['boleto-d10.pdf', boletoHtml, makeBoleto(v1, ctx, 10), (f, b) => boletoEntry(f, b, 'ok')],
    ['boleto-invalid-dv.pdf', boletoHtml, makeBoleto(v0, ctx, BROKEN_BOLETO_DAYS, { broken: true }), (f, b) => boletoEntry(f, b, 'needs_review')],
  ];
}

function addScans(expected) {
  const scans = [['nfe-1.pdf', 'nfe-scan.png'], ['boleto-d3.pdf', 'boleto-scan.png']];
  for (const [pdf, png] of scans) {
    execFileSync('python', [path.join(__dirname, 'scanify.py'), path.join(OUT, pdf), path.join(OUT, png)], { stdio: 'inherit' });
    expected.push({ ...expected.find((e) => e.file === pdf), file: png });
  }
}

function main() {
  const date = process.argv[2] || process.env.SAMPLE_DATE || todayInSaoPaulo();
  if (Number.isNaN(Date.parse(date))) throw new Error(`invalid date ${date}`);
  fs.mkdirSync(OUT, { recursive: true });
  const expected = [];
  for (const [file, html, doc, entry] of buildDocuments({ date, payerCnpj: makeCnpj() })) {
    renderPdf(html(doc), file.replace('.pdf', ''));
    expected.push(entry(file, doc));
  }
  expected.forEach((e) => { if (!isValidCnpj(e.vendorTaxId)) throw new Error(`bad CNPJ for ${e.file}`); });
  addScans(expected);
  fs.writeFileSync(path.join(OUT, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`generated ${expected.length} samples for reference date ${date} in ${OUT}`);
}

main();
