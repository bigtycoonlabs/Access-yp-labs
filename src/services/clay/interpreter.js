// The result interpreter, inherited from Arbo. Every Clay output is classified
// so the platform never presents an empty or failed result as a real answer.
//   answered    - real, substantive content was produced
//   empty        - Clay ran but produced nothing usable
//   unavailable  - Clay could not run (no API key, upstream error, timeout)
//   refused      - Clay declined on policy grounds (and says why)
const STATUSES = ['answered', 'empty', 'unavailable', 'refused'];

function classifySection(text) {
  if (text == null) return 'empty';
  const t = String(text).trim();
  if (!t) return 'empty';
  if (/^\s*(unable to|cannot|can't|i don'?t have|no data|not available)/i.test(t) && t.length < 240) {
    return 'unavailable';
  }
  return 'answered';
}

// Coverage assessment across a package: what came back vs. what's missing,
// described plainly so a blind user hears the truth, not a green checkmark.
function assessCoverage(sections) {
  const present = [];
  const missing = [];
  for (const [key, val] of Object.entries(sections)) {
    (classifySection(val) === 'answered' ? present : missing).push(key);
  }
  return {
    present,
    missing,
    complete: missing.length === 0,
    gap_description: missing.length
      ? `Clay produced ${present.length} of ${present.length + missing.length} sections. Still missing: ${missing.join(', ')}.`
      : 'Clay produced every section of the package.',
  };
}

module.exports = { STATUSES, classifySection, assessCoverage };
