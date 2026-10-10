# Shipwright

Shipwright is a Claude Code plugin that takes a ticket (Jira, Linear, Azure DevOps, GitHub Issues, or an intake form) to a reviewed PR and a deployed release. Each stage writes an artifact into `.delivery/<ticket-id>/` in your project, which is both the audit trail and the resume point. Humans approve the spec, the PR, and the production release; the kit never skips those. The design lives in `ticket_to_production.md`. Stages up to `/ship` (PR only; deploys come with the adapters), plus `/breakdown` and `/run`, are built so far.

## Quick start

Install once (user scope, works in every project):

```
claude plugin marketplace add realahsanshah/shipwright
claude plugin install shipwright@shipwright
```

Then, in your project:

1. `/shipwright:onboard` maps the repo and writes its `CLAUDE.md`. Review and approve it.
2. `/shipwright:breakdown` reads your PRD/TRD (or the paths you pass) and drafts an ordered backlog in `.delivery/backlog.md`. You approve it; on GitHub, each item becomes an issue.
3. `/shipwright:run next` takes the next runnable item through intake, spec, plan, build, verify, review and ship. It stops at the spec for your approval; rerun `/shipwright:run B-<n>` after approving to continue.
4. Review and merge the PR yourself. The next `/shipwright:run next` sees the merge, marks the item done and unblocks its dependents.

One item per run, and the kit never merges or skips a gate. `/shipwright:run <ticket-url>` runs a single ticket without a backlog. Every stage command also runs on its own.

Update with `claude plugin marketplace update shipwright` and then `claude plugin update shipwright@shipwright`.

## Try it from a checkout

Prerequisite: Node >= 20 on PATH (hooks are Node scripts; without node the guard and rules injection silently do nothing).

```
claude --plugin-dir "<path to this repo>"
```

The guard is best-effort. It blocks Read/Edit/Write/Grep on secret paths and shell commands that name secret files, but it cannot catch every shell form (for example `grep -r KEY .`, globbed or quoted paths, or shell writes into danger zones). The secret scan in `/verify` is the backstop.

## Commands available

- `/onboard` maps a project and writes its `CLAUDE.md` (including danger zones).
- `/intake` turns a ticket into a validated `ticket.json`.
- `/spec` writes `spec.md`, runs the `spec-critic` agent, and waits for human approval.
- `/plan` maps every acceptance criterion to a step and test in `plan.md`; `/build` implements it test-first, one commit per step.
- `/verify` runs tests, lint, types, build, dependency audit, a secret scan and coverage, then maps each acceptance criterion to evidence in `verify-report.md`.
- `/review` runs fresh code and security reviewers, fixes blocking findings (3 rounds at most), and writes `review.md` and `pr-description.md`.
- `/ship` commits the delivery record, pushes `feat/<id>`, opens the PR and watches CI. It never merges.
- `/breakdown` turns requirement docs into an approved backlog (`.delivery/backlog.md`, mirrored as GitHub issues).
- `/run` chains every stage for one ticket, backlog item, or `next`.

## Layout

`.claude-plugin/` manifest, `commands/`, `skills/`, `agents/`, `hooks/` (session rules, a pre-tool guard for secrets and danger zones, format-on-edit, and a stop gate for failed verifies), `rules/`, `settings/`, `schemas/`, `scripts/`, `test/`.

## Develop

Run `npm install`, `npm test` and `npm run validate`. See `CLAUDE.md` for the dev guide.
