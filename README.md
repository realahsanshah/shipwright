# Shipwright

Shipwright is a Claude Code plugin that takes a ticket (Jira, Linear, Azure DevOps, GitHub Issues, or an intake form) to a reviewed PR and a deployed release. Each stage writes an artifact into `.delivery/<ticket-id>/` in your project, which is both the audit trail and the resume point. Humans approve the spec, the PR, and the production release; the kit never skips those. The design lives in `ticket_to_production.md`. Only the first stages are built so far.

## Try it

Prerequisite: Node >= 20 on PATH (hooks are Node scripts; without node the guard and rules injection silently do nothing).

```
claude --plugin-dir "<path to this repo>"
```

The guard is best-effort. It blocks Read/Edit/Write/Grep on secret paths and shell commands that name secret files, but it cannot catch every shell form (for example `grep -r KEY .`, globbed or quoted paths, or shell writes into danger zones). The secret scan in `/verify` (a later stage) is the backstop.

## Commands available

- `/onboard` maps a project and writes its `CLAUDE.md` (including danger zones).
- `/intake` turns a ticket into a validated `ticket.json`.
- `/spec` writes `spec.md`, runs the `spec-critic` agent, and waits for human approval.

## Layout

`.claude-plugin/` manifest, `commands/`, `skills/`, `agents/`, `hooks/` (session rules and a pre-tool guard for secrets and danger zones), `rules/`, `settings/`, `schemas/`, `scripts/`, `test/`.

## Develop

```
npm install
npm test
npm run validate
```

See `CLAUDE.md` for the dev guide.
