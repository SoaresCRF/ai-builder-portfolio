// Daily digest of pending bills. Kept free of require/import so the file
// can be injected into an n8n Code node unchanged.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86400000;

// Dates are plain YYYY-MM-DD text; UTC math avoids any timezone shift.
function addDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function hasValidDate(row) {
  return DATE_RE.test(row.dueDate || '') && !Number.isNaN(Date.parse(`${row.dueDate}T00:00:00Z`));
}

function isReviewStatus(row) {
  return row.extractionStatus === 'needs_review' || row.extractionStatus === 'error';
}

function selectDueRows(rows, today, windowDays) {
  const limit = addDays(today, windowDays);
  const dueRows = rows
    .filter((r) => r.status === 'pending' && hasValidDate(r) && r.dueDate <= limit)
    .map((r) => ({ ...r, overdue: r.dueDate < today, needsReview: isReviewStatus(r) }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { dueRows, needsReviewCount: rows.filter(isReviewStatus).length };
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function formatBrl(amount) {
  const n = Number(amount);
  if (Number.isNaN(n)) return '';
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function renderRow(r) {
  const flags = [r.overdue ? 'OVERDUE' : '', r.needsReview ? 'REVIEW' : ''].filter(Boolean).join(' ');
  const cells = [escapeHtml(r.vendor), formatBrl(r.amount), formatDate(r.dueDate), flags];
  return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
}

function renderDigestHtml(result, today) {
  const head = ['Vendor', 'Amount', 'Due date', 'Flags'].map((h) => `<th scope="col">${h}</th>`).join('');
  const body = result.dueRows.map(renderRow).join('');
  return [
    `<p>Bills due soon as of ${formatDate(today)}.</p>`,
    `<table border="1" cellpadding="6" cellspacing="0"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    `<p>Documents needing review: ${result.needsReviewCount}</p>`,
  ].join('\n');
}

module.exports = { selectDueRows, renderDigestHtml };
