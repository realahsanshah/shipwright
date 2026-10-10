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
  for (const line of all) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
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
  return { specLine, steps };
}

export function checkPlan(spec, plan) {
  const errors = checkSpec(spec).map((e) => `spec: ${e}`);
  if (spec.approved && !(plan.specLine ?? '').includes(`approved by ${spec.approver} on ${spec.approvedOn}`)) {
    errors.push('plan "Spec:" line does not match the current spec approval; rerun /plan');
  }
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
