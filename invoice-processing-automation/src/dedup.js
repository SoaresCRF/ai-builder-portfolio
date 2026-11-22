// Re-polling must not duplicate rows. Kept free of require/import so the file
// can be injected into an n8n Code node unchanged.

function filterUnprocessed(items, rows) {
  const key = (r) => `${r.messageId}:${r.fileName}`;
  const seen = new Set(rows.map(key));
  return items.filter((item) => !seen.has(key(item.json)));
}

module.exports = { filterUnprocessed };
