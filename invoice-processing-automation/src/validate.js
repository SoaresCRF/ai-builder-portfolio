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

module.exports = { isValidCnpj, parseDigitableLine };
