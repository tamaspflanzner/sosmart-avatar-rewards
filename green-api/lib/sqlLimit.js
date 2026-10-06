// mysql2 sends JavaScript numbers as DOUBLE in prepared statements. MySQL
// rejects that type in LIMIT positions; bind a validated integer string instead.
function sqlLimit(value, fallback, maximum) {
  const parsed = Number(value);
  const limit = value == null || value === "" || !Number.isFinite(parsed)
    ? fallback
    : Math.trunc(parsed);
  return String(Math.max(1, Math.min(maximum, limit)));
}

module.exports = { sqlLimit };
