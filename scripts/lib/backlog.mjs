// Parser, checks and edits for .delivery/backlog.md. Format contract:
// docs/superpowers/plans/2026-10-11-breakdown-run.md.

export const TYPES = ['feature', 'bug', 'refactor', 'chore'];
export const STATES = ['todo', 'in-progress', 'in-review', 'done', 'blocked'];
const ITEM = /^##\s+(B-(\d+)):\s*(.*?)\s*$/;
const FIELD = /^\s*[-*]\s+(Type|Depends on|State|Issue|Ticket|PR|Acceptance criteria|Open questions):\s*(.*?)\s*$/i;
const SUB = /^\s{2,}[-*]\s+(.*?)\s*$/;
const APPROVED = /^Status: approved by (.+?) on (\d{4}-\d{2}-\d{2})\s*$/;
const SETTABLE = { State: STATES, Issue: null, Ticket: null, PR: null };
const FENCE = /^\s{0,3}(```|~~~)/;
const TICKET_ID = /^(?!.*\.\.)[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9_-])?$/;

export function parseBacklog(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const source = lines.find((l) => /^Source:/.test(l))?.replace(/^Source:\s*/, '').trim() ?? null;
  const statusLine = lines.find((l) => /^Status:/.test(l))?.trim() ?? null;
  const items = [];
  let item = null;
  let list = null;
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const head = line.match(ITEM);
    if (head) {
      item = { id: head[1], n: Number(head[2]), title: head[3], type: null, dependsOn: null, state: null,
        issue: null, ticket: null, pr: null, acceptance: null, openQuestions: null };
      items.push(item);
      list = null;
      continue;
    }
    if (/^#{1,2}\s/.test(line)) { item = null; list = null; continue; }
    if (!item) continue;
    const sub = list && line.match(SUB);
    if (sub) { if (!/^none\.?$/i.test(sub[1])) item[list].push(sub[1]); continue; }
    const field = line.match(FIELD);
    if (!field) continue;
    const key = field[1].toLowerCase();
    const value = field[2];
    list = null;
    if (key === 'type') item.type = value.toLowerCase();
    else if (key === 'state') item.state = value.toLowerCase();
    else if (key === 'depends on') item.dependsOn = /^none\b/i.test(value) ? [] : value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === 'issue') item.issue = value;
    else if (key === 'ticket') item.ticket = value;
    else if (key === 'pr') item.pr = value;
    else if (key === 'acceptance criteria') { item.acceptance = []; list = 'acceptance'; }
    else { item.openQuestions = []; list = 'openQuestions'; }
  }
  return { source, statusLine, approved: APPROVED.test(statusLine ?? ''), items };
}

function findCycle(items) {
  const deps = new Map(items.map((i) => [i.id, i.dependsOn ?? []]));
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'active') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'active');
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue;
      const cycle = visit(d, [...path, id]);
      if (cycle) return cycle;
    }
    state.set(id, 'done');
    return null;
  };
  for (const i of items) { const c = visit(i.id, []); if (c) return c; }
  return null;
}

export function checkBacklog(backlog, { requireApproved = false } = {}) {
  const errors = [];
  if (requireApproved && !backlog.approved) errors.push(`backlog is not approved (${backlog.statusLine ?? 'no Status: line'})`);
  if (backlog.items.length === 0) errors.push('backlog has no "## B-<n>: <title>" items');
  const ids = new Set();
  for (const item of backlog.items) {
    const label = item.id;
    if (ids.has(item.id)) errors.push(`${label}: id is used more than once`);
    ids.add(item.id);
    if (!item.title) errors.push(`${label}: missing title`);
    if (!TYPES.includes(item.type)) errors.push(`${label}: Type must be one of ${TYPES.join(', ')}`);
    if (!STATES.includes(item.state)) errors.push(`${label}: State must be one of ${STATES.join(', ')}`);
    for (const f of ['issue', 'ticket', 'pr']) if (item[f] === null) errors.push(`${label}: missing "- ${f === 'pr' ? 'PR' : f[0].toUpperCase() + f.slice(1)}:"`);
    if (item.dependsOn === null) errors.push(`${label}: missing "- Depends on:"`);
    if (item.acceptance === null || item.acceptance.length === 0) errors.push(`${label}: needs at least one acceptance criterion`);
    if (item.openQuestions === null) errors.push(`${label}: missing "- Open questions:" (use "- None.")`);
  }
  for (const item of backlog.items) {
    for (const d of item.dependsOn ?? []) {
      if (d === item.id) errors.push(`${item.id}: depends on itself`);
      else if (!ids.has(d)) errors.push(`${item.id}: depends on ${d}, which is not in the backlog`);
    }
  }
  const cycle = findCycle(backlog.items);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' → ')}`);
  return errors;
}

export function nextItem(backlog) {
  const byId = new Map(backlog.items.map((i) => [i.id, i]));
  const waiting = [];
  for (const item of backlog.items) {
    if (item.state !== 'todo') continue;
    const unfinished = (item.dependsOn ?? []).filter((d) => byId.get(d)?.state !== 'done');
    if (unfinished.length) { waiting.push(`${item.id} waits on ${unfinished.join(', ')}`); continue; }
    if ((item.openQuestions ?? []).length) { waiting.push(`${item.id} has open questions`); continue; }
    return { item };
  }
  if (backlog.items.every((i) => i.state === 'done')) return { item: null, reason: 'all items done' };
  const others = backlog.items.filter((i) => ['in-progress', 'in-review', 'blocked'].includes(i.state)).map((i) => `${i.id} is ${i.state}`);
  return { item: null, reason: [...waiting, ...others].join('; ') || 'no runnable item' };
}

function validValue(field, value) {
  if (field === 'State') return STATES.includes(value);
  if (field === 'Issue') return value === 'none' || /^#\d+$/.test(value) || /^https:\/\/\S+$/.test(value);
  if (field === 'PR') return value === 'none' || /^https:\/\/\S+$/.test(value);
  return value === 'none' || TICKET_ID.test(value);
}

export function setFields(text, id, updates) {
  for (const [field, value] of Object.entries(updates)) {
    if (!Object.hasOwn(SETTABLE, field)) throw new Error(`cannot set field "${field}" (settable: ${Object.keys(SETTABLE).join(', ')})`);
    if (!validValue(field, value)) throw new Error(`invalid value for ${field}: ${JSON.stringify(value)}`);
  }
  // Odd indexes hold each line's own EOL, so mixed-EOL files round-trip unchanged.
  const parts = text.split(/(\r?\n)/);
  const canonical = new Map(Object.keys(SETTABLE).map((f) => [f.toLowerCase(), f]));
  let inItem = false;
  let found = false;
  let list = false;
  let fenced = false;
  const done = new Set();
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const head = line.match(ITEM);
    if (head) { inItem = head[1] === id; found ||= inItem; list = false; continue; }
    if (/^#{1,2}\s/.test(line)) { inItem = false; list = false; continue; }
    if (!inItem) continue;
    if (list && SUB.test(line)) continue;
    const field = line.match(FIELD);
    if (!field) continue;
    list = /^(acceptance criteria|open questions)$/i.test(field[1]);
    const name = canonical.get(field[1].toLowerCase());
    if (!name || !Object.hasOwn(updates, name) || done.has(name)) continue;
    const m = line.match(/^(\s*[-*]\s+)([^:]+):/);
    parts[i] = `${m[1]}${m[2]}: ${updates[name]}`;
    done.add(name);
  }
  if (!found) throw new Error(`no item ${id} in backlog`);
  const missing = Object.keys(updates).filter((f) => !done.has(f));
  if (missing.length) throw new Error(`${id} has no "- ${missing[0]}:" line to update`);
  return parts.join('');
}
