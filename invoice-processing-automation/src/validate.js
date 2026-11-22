// Pure validators. Kept free of require/import so the file can be pasted
// into an n8n Code node unchanged.

const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_PATTERN = /^[0-9A-Z]{12}[0-9]{2}$/;
const BOLETO_LINE_LENGTH = 47;
const FACTOR_RESET_MIN = 1000; // factor restarted at 1000 after 9999 on 2025-02-21
const MS_PER_DAY = 86400000;
const PRE_RESET_BASE = '1997-10-07'; // factor 0 of the original scheme
const POST_RESET_BASE = '2025-02-22'; // factor 1000 of the restarted scheme
const MAX_DUE_DATE_DRIFT_DAYS = 365;
const REFERENCE_TIME_ZONE = 'America/Sao_Paulo';
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_FIELDS = {
  boleto: ['amount', 'dueDate', 'digitableLine'],
  nfe: ['vendorTaxId', 'amount'],
  other: ['amount'],
};

function cnpjDigit(chars, weights) {
  // Alphanumeric CNPJ: character value is charCode - 48 ('0'..'9' -> 0..9, 'A' -> 17).
  const sum = weights.reduce((acc, w, i) => acc + (chars.charCodeAt(i) - 48) * w, 0);
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

function isValidCnpj(value) {
  const cnpj = String(value).replace(/[./\-\s]/g, '').toUpperCase();
  if (!CNPJ_PATTERN.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;
  const d1 = cnpjDigit(cnpj, CNPJ_WEIGHTS_1);
  const d2 = cnpjDigit(cnpj, CNPJ_WEIGHTS_2);
  return cnpj[12] === String(d1) && cnpj[13] === String(d2);
}

function mod10(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const p = Number(digits[digits.length - 1 - i]) * (i % 2 === 0 ? 2 : 1);
    sum += p > 9 ? p - 9 : p;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11Barcode(digits43) {
  let sum = 0;
  for (let i = 0; i < digits43.length; i++) {
    sum += Number(digits43[digits43.length - 1 - i]) * (2 + (i % 8));
  }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

function addDays(isoDate, days) {
  return new Date(Date.parse(isoDate) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function decodeDueDate(factor, referenceDate) {
  if (factor === 0) return null;
  // The factor wraps, so the same number can mean two dates; pick the one nearest the reference.
  const candidates = [addDays(PRE_RESET_BASE, factor)];
  if (factor >= FACTOR_RESET_MIN) candidates.push(addDays(POST_RESET_BASE, factor - FACTOR_RESET_MIN));
  const distance = (d) => Math.abs(Date.parse(d) - Date.parse(referenceDate));
  return candidates.sort((a, b) => distance(a) - distance(b))[0];
}

function parseDigitableLine(line, referenceDate) {
  const d = String(line).replace(/\D/g, '');
  if (d.length !== BOLETO_LINE_LENGTH) return null; // also rejects 48-digit convenio lines
  const fields = [d.slice(0, 9), d.slice(10, 20), d.slice(21, 31)];
  const fieldDvs = [d[9], d[20], d[31]];
  if (fields.some((f, i) => String(mod10(f)) !== fieldDvs[i])) return null;
  const barcodeNoDv = d.slice(0, 4) + d.slice(33) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  if (String(mod11Barcode(barcodeNoDv)) !== d[32]) return null;
  const factor = Number(d.slice(33, 37));
  const cents = Number(d.slice(37));
  return {
    amount: cents === 0 ? null : cents / 100,
    dueDate: decodeDueDate(factor, referenceDate),
  };
}

function referenceDateOf(processedAt) {
  // en-CA formats as YYYY-MM-DD; the zone keeps late-evening runs on the Brazilian calendar day.
  return new Intl.DateTimeFormat('en-CA', { timeZone: REFERENCE_TIME_ZONE }).format(new Date(processedAt));
}

function isRealIsoDate(value) {
  return ISO_DATE_PATTERN.test(value) && addDays(value, 0) === value;
}

function normalizeTaxId(value) {
  return value == null ? null : String(value).replace(/[./\-\s]/g, '').toUpperCase();
}

function formatCnpj(c) {
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

function formatBrl(amount) {
  const [int, frac] = amount.toFixed(2).split('.');
  return { plain: `${int},${frac}`, grouped: `${int.replace(/\B(?=(\d{3})+$)/g, '.')},${frac}` };
}

function amountInText(amount, text) {
  const { plain, grouped } = formatBrl(amount);
  const esc = (s) => s.replace(/\./g, '\\.');
  // Boundaries stop "1.234,56" from matching inside "11.234,56" or "1.234,567".
  const re = new RegExp(`(?<![\\d.,])(?:${esc(grouped)}|${esc(plain)})(?!\\d|,\\d)`);
  return re.test(text);
}

function applyLine(x, referenceDate, fail) {
  if (x.digitableLine == null) return;
  const line = parseDigitableLine(x.digitableLine, referenceDate);
  if (!line) { fail('digitable_line_invalid'); x.digitableLine = null; return; }
  x.digitableLine = String(x.digitableLine).replace(/\D/g, '');
  for (const f of ['amount', 'dueDate']) {
    if (line[f] == null) continue;
    if (x[f] != null && x[f] !== line[f]) fail(f === 'amount' ? 'amount_mismatch_line' : 'due_date_mismatch_line');
    x[f] = line[f];
  }
}

function checkAmountAndDate(x, referenceDate, fail) {
  if (x.amount != null) {
    x.amount = Math.round(Number(x.amount) * 100) / 100;
    if (!(x.amount > 0)) { fail('amount_invalid'); x.amount = null; }
  }
  if (x.dueDate == null) return;
  if (!isRealIsoDate(x.dueDate)) { fail('due_date_invalid'); x.dueDate = null; return; }
  const days = Math.abs(Date.parse(x.dueDate) - Date.parse(referenceDate)) / MS_PER_DAY;
  if (days > MAX_DUE_DATE_DRIFT_DAYS) { fail('due_date_out_of_range'); x.dueDate = null; }
}

function groundInText(x, pdfText, fail) {
  if (typeof pdfText !== 'string' || pdfText === '') return;
  if (x.amount != null && !amountInText(x.amount, pdfText)) { fail('amount_not_in_text'); x.amount = null; }
  if (x.vendorTaxId != null && !pdfText.includes(x.vendorTaxId) && !pdfText.includes(formatCnpj(x.vendorTaxId))) {
    fail('cnpj_not_in_text'); x.vendorTaxId = null;
  }
}

function payableStatus(x) {
  if (x.documentType === 'boleto') return 'pending';
  return x.documentType === 'other' && x.dueDate != null ? 'pending' : 'n/a';
}

function validateExtraction(extraction, ctx) {
  const reasons = [];
  const fail = (code) => { if (!reasons.includes(code)) reasons.push(code); };
  const x = { ...extraction, vendorTaxId: normalizeTaxId(extraction.vendorTaxId) };
  const referenceDate = referenceDateOf(ctx.processedAt);

  if (x.vendorTaxId != null && !isValidCnpj(x.vendorTaxId)) { fail('cnpj_invalid'); x.vendorTaxId = null; }
  applyLine(x, referenceDate, fail);
  checkAmountAndDate(x, referenceDate, fail);
  groundInText(x, ctx.pdfText, fail);
  if (x.boletoCount > 1) fail('multiple_boletos');
  // Checked after nulling so a field rejected above also counts as missing.
  for (const f of REQUIRED_FIELDS[x.documentType] || []) if (x[f] == null) fail(`missing_${f}`);

  const record = {
    documentType: x.documentType, vendorName: x.vendorName, vendorTaxId: x.vendorTaxId,
    amount: x.amount, dueDate: x.dueDate, category: x.category, digitableLine: x.digitableLine,
    status: payableStatus(x),
  };
  return { record, reasons, extractionStatus: reasons.length ? 'needs_review' : 'ok' };
}

module.exports = { isValidCnpj, parseDigitableLine, validateExtraction };
