// Parsers and gate checks for the Markdown artifacts in .delivery/<id>/.
// The formats are contracts: commands/*.md show templates of them, and
// test/commands.test.mjs runs those templates through these parsers.

export const SPEC_SECTIONS = [
  'Summary', 'Acceptance criteria', 'Affected areas', 'Data changes and migrations',
  'Edge cases', 'Test plan', 'Risks', 'Open questions',
];
export const MAX_ATTEMPTS = 3;

export const AC_IDS = /\bAC-\d+\b/g;
const AC_LINE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*)?(AC-\d+)\b/;
const APPROVED = /^Status: approved by (.+?) on (\d{4}-\d{2}-\d{2})\s*$/;
const FENCE = /^\s*(```|~~~)/;

export function toLines(text) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/);
}

// Splits on H2 headings that are outside fenced code blocks.
export function splitSections(text) {
  const preamble = [];
  const sections = new Map();
  const order = [];
  let current = null;
  let fenced = false;
  for (const line of toLines(text)) {
    if (FENCE.test(line)) fenced = !fenced;
    const heading = !fenced && line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1];
      order.push(current);
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    (current === null ? preamble : sections.get(current)).push(line);
  }
  return { preamble, sections, order };
}

export function parseSpec(text) {
  const { preamble, sections, order } = splitSections(text);
  const statusLine = preamble.find((l) => l.startsWith('Status:'))?.trim() ?? null;
  const approved = statusLine?.match(APPROVED) ?? null;
  const acIds = [];
  for (const line of sections.get('Acceptance criteria') ?? []) {
    const m = line.match(AC_LINE);
    if (m) acIds.push(m[1]);
  }
  return {
    statusLine,
    approved: approved !== null,
    approver: approved?.[1] ?? null,
    approvedOn: approved?.[2] ?? null,
    order,
    acIds,
    openQuestions: (sections.get('Open questions') ?? []).join('\n').trim(),
  };
}

export function checkSpec(spec) {
  const errors = [];
  if (!spec.approved) errors.push(`spec is not approved (${spec.statusLine ?? 'no Status: line'})`);
  const missing = SPEC_SECTIONS.filter((s) => !spec.order.includes(s));
  for (const s of missing) errors.push(`missing section "## ${s}"`);
  if (missing.length === 0) {
    const seen = spec.order.filter((s) => SPEC_SECTIONS.includes(s));
    if (seen.join('|') !== SPEC_SECTIONS.join('|')) errors.push(`sections out of order; expected ${SPEC_SECTIONS.join(', ')}`);
  }
  if (spec.order.includes('Gate result')) errors.push('spec still has a "## Gate result" section from a failed /spec run');
  if (spec.acIds.length === 0) errors.push('no acceptance criteria numbered AC-n');
  const dupes = new Set(spec.acIds.filter((id, i) => spec.acIds.indexOf(id) !== i));
  for (const id of dupes) errors.push(`acceptance criterion ${id} is numbered twice`);
  if (spec.order.includes('Open questions') && spec.openQuestions !== 'None.') {
    errors.push('open questions remain (the section must be exactly "None.")');
  }
  return errors;
}

const STEP_HEADING = /^###\s+Step\s+(\d+):\s*(.*?)\s*$/;
const STEP_FIELD = /^\s*[-*]\s+(Covers|Files|Test|Depends on):\s*(.*?)\s*$/i;
const NONE = /^none\b/i;

export function parsePlan(text) {
  const all = toLines(text);
  const specLine = all.find((l) => /^Spec:/.test(l))?.trim() ?? null;
  const steps = [];
  let step = null;
  let fenced = false;
  let gateResult = false;
  for (const line of all) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^##\s+Gate result\s*$/.test(line)) gateResult = true;
    const heading = line.match(STEP_HEADING);
    if (heading) {
      step = { n: Number(heading[1]), title: heading[2], covers: null, files: [], test: '', dependsOn: [] };
      steps.push(step);
      continue;
    }
    if (/^#{1,2}\s/.test(line)) { step = null; continue; }
    const field = step && line.match(STEP_FIELD);
    if (!field) continue;
    const key = field[1].toLowerCase();
    const value = field[2];
    if (key === 'covers') step.covers = NONE.test(value) ? [] : value.match(AC_IDS) ?? [];
    else if (key === 'files') step.files = value.split(',').map((f) => f.replace(/`/g, '').trim()).filter(Boolean);
    else if (key === 'test') step.test = value;
    else step.dependsOn = NONE.test(value) ? [] : [...value.matchAll(/\d+/g)].map((m) => Number(m[0]));
  }
  return { specLine, steps, gateResult };
}

export function checkPlan(spec, plan) {
  const errors = checkSpec(spec).map((e) => `spec: ${e}`);
  if (spec.approved && !(plan.specLine ?? '').includes(`approved by ${spec.approver} on ${spec.approvedOn}`)) {
    errors.push('plan "Spec:" line does not match the current spec approval; rerun /plan');
  }
  if (plan.gateResult) errors.push('plan still has a "## Gate result" section from a failed /plan run; rerun /plan');
  if (plan.steps.length === 0) errors.push('plan has no "### Step N: <title>" headings');
  const known = new Set(spec.acIds);
  const covered = new Set();
  plan.steps.forEach((step, i) => {
    const label = `Step ${step.n}`;
    if (step.n !== i + 1) errors.push(`${label}: steps must be numbered 1, 2, 3… in order (expected Step ${i + 1})`);
    if (!step.title) errors.push(`${label}: missing title`);
    if (step.covers === null) errors.push(`${label}: missing "- Covers:" (AC ids, or "none")`);
    for (const id of step.covers ?? []) {
      if (known.has(id)) covered.add(id);
      else errors.push(`${label}: covers ${id}, which is not in the spec`);
    }
    if (step.files.length === 0) errors.push(`${label}: missing "- Files:"`);
    if (!step.test) errors.push(`${label}: missing "- Test:"`);
    else if (NONE.test(step.test) && (step.covers ?? []).length > 0) errors.push(`${label}: covers acceptance criteria, so it needs a real test`);
    for (const d of step.dependsOn) {
      if (d < 1 || d >= step.n) errors.push(`${label}: depends on Step ${d}, which is not an earlier step`);
    }
  });
  for (const id of spec.acIds) if (!covered.has(id)) errors.push(`${id} is not covered by any step`);
  return errors;
}

const LOG_STEP = /^##\s+Step\s+(\d+):\s*(.*?)\s*$/;
const LOG_FIELD = /^\s*[-*]\s+(Status|Commit|RED|GREEN|Attempts):\s*(.*?)\s*$/i;
const SHA = /^[0-9a-f]{7,40}$/i;

export function parseBuildLog(text) {
  const steps = [];
  let step = null;
  let fenced = false;
  for (const line of toLines(text)) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = line.match(LOG_STEP);
    if (heading) {
      step = { n: Number(heading[1]), title: heading[2], status: '', commit: '', red: '', green: '', attempts: null };
      steps.push(step);
      continue;
    }
    if (/^#{1,2}\s/.test(line)) { step = null; continue; }
    const field = step && line.match(LOG_FIELD);
    if (!field) continue;
    const key = field[1].toLowerCase();
    const value = field[2];
    if (key === 'status') step.status = value.toUpperCase();
    else if (key === 'commit') step.commit = value.replace(/`/g, '');
    else if (key === 'attempts') step.attempts = /^\d+$/.test(value) ? Number(value) : null;
    else step[key] = value;
  }
  return { steps };
}

export function checkBuild(plan, log) {
  const errors = [];
  const planned = new Set(plan.steps.map((s) => s.n));
  for (const entry of log.steps) if (!planned.has(entry.n)) errors.push(`build log has Step ${entry.n}, which is not in the plan`);
  for (const step of plan.steps) {
    const label = `Step ${step.n}`;
    const entries = log.steps.filter((e) => e.n === step.n);
    if (entries.length === 0) { errors.push(`${label}: no entry in build log`); continue; }
    if (entries.length > 1) errors.push(`${label}: listed more than once in build log`);
    const entry = entries[entries.length - 1];
    const logTitle = entry.title.trim();
    const planTitle = step.title.trim();
    if (logTitle !== planTitle) errors.push(`${label}: build-log title "${logTitle}" does not match plan step title "${planTitle}"`);
    if (entry.status !== 'DONE') errors.push(`${label}: status is ${entry.status || 'missing'}, not DONE`);
    if (!SHA.test(entry.commit)) errors.push(`${label}: missing or invalid commit SHA`);
    if (!entry.green) errors.push(`${label}: missing GREEN evidence`);
    if (!entry.red && !NONE.test(step.test)) errors.push(`${label}: missing RED evidence (test-first)`);
  }
  return errors;
}

export const REQUIRED_CHECKS = ['tests', 'lint', 'types', 'build', 'dependency audit', 'secret scan', 'coverage'];
export const NEVER_SKIPPED = ['tests', 'secret scan'];

function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

// Data rows of the first Markdown table in a section (header and separator dropped).
function tableRows(sectionLines) {
  const rows = sectionLines.filter((l) => l.trim().startsWith('|')).map(splitRow)
    .filter((cells) => !cells.every((c) => /^:?-{3,}:?$/.test(c)));
  return rows.slice(1);
}

export function parseVerifyReport(text) {
  const { preamble, sections } = splitSections(text);
  const field = (name) => {
    for (const line of preamble) {
      const m = line.match(new RegExp(`^${name}:\\s*(.*?)\\s*$`));
      if (m) return m[1];
    }
    return null;
  };
  const status = field('Status');
  const attempts = field('Attempts');
  return {
    status: status === 'PASS' || status === 'FAIL' ? status : null,
    attempts: attempts !== null && /^\d+$/.test(attempts) ? Number(attempts) : null,
    commit: field('Commit')?.replace(/`/g, '') || null,
    checks: tableRows(sections.get('Checks') ?? []).map(([name = '', command = '', result = '', notes = '']) => (
      { name: name.toLowerCase(), command, result: result.toUpperCase(), notes })),
    evidence: tableRows(sections.get('Acceptance criteria evidence') ?? []).map(([ac = '', evidence = '', result = '']) => (
      { ac: ac.replace(/\*\*|`/g, '').trim(), evidence, result: result.toUpperCase() })),
  };
}

export function checkVerify(spec, report) {
  const errors = checkSpec(spec).map((e) => `spec: ${e}`);
  if (report.status === null) errors.push('missing "Status: PASS" or "Status: FAIL" line');
  if (report.attempts === null || report.attempts < 1) errors.push('missing "Attempts: N" line (N ≥ 1)');
  if (!report.commit || !SHA.test(report.commit)) errors.push('missing "Commit: <sha>" line');
  let failed = false;
  for (const name of REQUIRED_CHECKS) {
    const rows = report.checks.filter((c) => c.name === name);
    if (rows.length === 0) { errors.push(`missing check "${name}"`); continue; }
    if (rows.length > 1) errors.push(`check "${name}" is listed more than once`);
    const check = rows[0];
    if (!['PASS', 'FAIL', 'SKIP'].includes(check.result)) errors.push(`check "${name}": result must be PASS, FAIL or SKIP`);
    if (check.result === 'SKIP' && NEVER_SKIPPED.includes(name)) errors.push(`check "${name}" can never be skipped`);
    if (check.result === 'SKIP' && !check.notes) errors.push(`check "${name}": SKIP needs a reason in Notes`);
    if (check.result !== 'SKIP' && !check.command) errors.push(`check "${name}": missing command`);
  }
  if (report.checks.some((c) => c.result === 'FAIL')) failed = true;
  const known = new Set(spec.acIds);
  for (const id of spec.acIds) {
    const rows = report.evidence.filter((e) => e.ac === id);
    if (rows.length === 0) errors.push(`${id}: no evidence row`);
    for (const row of rows) {
      if (!row.evidence) errors.push(`${id}: evidence is empty`);
      if (!['PASS', 'FAIL'].includes(row.result)) errors.push(`${id}: result must be PASS or FAIL`);
    }
  }
  if (report.evidence.some((e) => e.result === 'FAIL')) failed = true;
  for (const row of report.evidence) if (!known.has(row.ac)) errors.push(`evidence row for ${row.ac || '(blank)'}, which is not in the spec`);
  const outcome = failed || errors.length > 0 ? 'FAIL' : 'PASS';
  if (report.status === 'PASS' && outcome === 'FAIL') errors.push('report says Status: PASS but a check or criterion failed or is missing');
  if (report.status === 'FAIL' && !failed && errors.length === 0) errors.push('report says Status: FAIL but every check and criterion passed');
  return { errors, outcome };
}

export const REVIEW_SECTIONS = ['Code review', 'Security review'];
export const PR_SECTIONS = ['Summary', 'Acceptance criteria', 'Test plan', 'Risks', 'Notes for CLAUDE.md'];
const FINDING = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*)?\[(blocking|non-blocking)\](?:\*\*)?\s*(.*)$/i;

function preambleField(preamble, name) {
  for (const line of preamble) {
    const m = line.match(new RegExp(`^${name}:\\s*(.*?)\\s*$`));
    if (m) return m[1].replace(/`/g, '');
  }
  return null;
}

export function sameCommit(a, b) {
  if (!a || !b) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

export function parseReview(text) {
  const { preamble, sections } = splitSections(text);
  const parsed = new Map();
  for (const name of REVIEW_SECTIONS) {
    if (!sections.has(name)) continue;
    let verdict = null;
    const findings = [];
    for (const line of sections.get(name)) {
      const v = line.match(/^Verdict:\s*(\S+)\s*$/);
      if (v && verdict === null) verdict = v[1].toUpperCase();
      const f = line.match(FINDING);
      if (f) findings.push({ severity: f[1].toLowerCase(), text: f[2] });
    }
    parsed.set(name, { verdict, findings });
  }
  return {
    commit: preambleField(preamble, 'Commit'),
    status: preambleField(preamble, 'Status'),
    mode: preambleField(preamble, 'Mode'),
    round: /^\d+$/.test(preambleField(preamble, 'Round') ?? '') ? Number(preambleField(preamble, 'Round')) : null,
    sections: parsed,
  };
}

export function checkReview(review) {
  const errors = [];
  if (!review.commit || !SHA.test(review.commit)) errors.push('missing "Commit: <sha>" line');
  if (!['PASS', 'FAIL'].includes(review.status)) errors.push('missing "Status: PASS" or "Status: FAIL" line');
  if (!['agents', 'solo'].includes(review.mode)) errors.push('missing "Mode: agents" or "Mode: solo" line');
  if (!Number.isInteger(review.round) || review.round < 1) errors.push('missing "Round: N" line (N ≥ 1)');
  let allPass = true;
  for (const name of REVIEW_SECTIONS) {
    const section = review.sections.get(name);
    if (!section) { errors.push(`missing section "## ${name}"`); allPass = false; continue; }
    const blocking = section.findings.some((f) => f.severity === 'blocking');
    if (!['PASS', 'BLOCKING'].includes(section.verdict)) { errors.push(`${name}: missing "Verdict: PASS" or "Verdict: BLOCKING"`); allPass = false; continue; }
    if (section.verdict === 'PASS' && blocking) errors.push(`${name}: says PASS but has a blocking finding`);
    if (section.verdict === 'BLOCKING' && !blocking) errors.push(`${name}: says BLOCKING but lists no [blocking] finding`);
    if (section.verdict !== 'PASS' || blocking) allPass = false;
  }
  if (review.status === 'PASS' && !allPass) errors.push('review says Status: PASS but a reviewer is BLOCKING');
  if (review.status === 'FAIL' && allPass && errors.length === 0) errors.push('review says Status: FAIL but both reviewers PASS');
  if (review.status === 'FAIL' && errors.length === 0) errors.push('review status is FAIL: fix the blocking findings and rerun /review');
  return errors;
}

export function parsePrDescription(text) {
  const { preamble, sections, order } = splitSections(text);
  const title = preamble.find((l) => /^#\s+\S/.test(l))?.replace(/^#\s+/, '').trim() ?? null;
  const closes = preambleField(preamble, 'Closes');
  const acRows = tableRows(sections.get('Acceptance criteria') ?? []).map(([ac = '', evidence = '']) => (
    { ac: ac.replace(/[*`]/g, '').trim(), evidence }));
  return { title, closes, order, acRows };
}

export function checkPrDescription(spec, pr) {
  const errors = [];
  if (!pr.title) errors.push('missing "# <title>" line');
  if (!pr.closes) errors.push('missing "Closes: <ticket link>" line');
  for (const s of PR_SECTIONS) if (!pr.order.includes(s)) errors.push(`missing section "## ${s}"`);
  const known = new Set(spec.acIds);
  for (const id of spec.acIds) {
    const rows = pr.acRows.filter((r) => r.ac === id);
    if (rows.length === 0) errors.push(`${id}: no row in Acceptance criteria`);
    if (rows.some((r) => !r.evidence)) errors.push(`${id}: evidence is empty`);
  }
  for (const r of pr.acRows) if (!known.has(r.ac)) errors.push(`Acceptance criteria row for ${r.ac || '(blank)'}, which is not in the spec`);
  return errors;
}
