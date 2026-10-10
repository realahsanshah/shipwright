# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Shipwright is a Claude Code plugin; the repo root is the plugin root. `ticket_to_production.md` is still the design source of truth (the kit's working name there is `delivery-kit`). The approved deviations from it are listed under "Decisions that deviate from the spec" in `docs/superpowers/plans/2026-10-10-kit-foundation.md`: plugin layout instead of a `.claude/` folder, Node `.mjs` instead of `.sh`, global rules shipped as a SessionStart hook (`rules/delivery-rules.md`), the deny-list shipped as `settings/project-settings.json` for `/onboard` to offer, and `deploy.schema.json`, `post-edit-format` and `stop-gate` deferred.

Built so far: `/onboard`, `/intake`, `/spec`, the `spec-writing` skill, the `spec-critic` agent, the `ticket` schema, and the hooks. Everything else in the doc is not built yet. Read the relevant section of `ticket_to_production.md` before building any part of the kit. If the code and the doc disagree, raise it rather than silently picking one.

## Commands

- `npm install` (only dev dependency is `ajv`)
- `npm test` runs `node --test` (it also picks up `test/helpers/frontmatter.mjs` as a file; harmless)
- One file: `node --test test/pre-tool-guard.test.mjs`
- One test: `node --test --test-name-pattern="danger zones" test/pre-tool-guard.test.mjs`
- `npm run validate` runs `claude plugin validate .`. `test/plugin.test.mjs` runs it with `--json` and fails on any error or warning except "CLAUDE.md at the plugin root is not loaded as project context". That warning is expected: this CLAUDE.md is the dev guide, not plugin context.
- Try the plugin in a project: `claude --plugin-dir "<path to this repo>"`

Runtime constraint: `hooks/` and `scripts/` use Node built-ins only, because an installed plugin has no `node_modules`. `ajv` is a dev-only oracle in tests.

## What is being built

A versioned Claude Code plugin that client projects install. Layout (all at the repo root): `.claude-plugin/plugin.json`, `commands/`, `skills/`, `agents/`, `hooks/` (`hooks.json`, `session-start.mjs`, `pre-tool-guard.mjs`), `rules/`, `settings/`, `schemas/`, `scripts/`, plus `templates/` and `adapters/` when built. Nothing under `.claude/` is part of the kit. It takes a ticket (Jira, Linear, Azure DevOps, GitHub Issues, or an intake form) to a reviewed PR and a deployed release.

The plugin's `PreToolUse` guard applies to sessions in this repo once the plugin is loaded. It blocks, with exit 2: secret files (`.env*` except `.env*.example/.sample/.template`, keys, `secrets/`, tfstate, cloud credentials) via file tools, Grep on secret paths, and shell commands (Bash/PowerShell) that reference them; edits to the target project's danger zones; `git push --force`/`-f`, `terraform destroy`, and `kubectl delete namespace`.

## Contracts pinned by tests

Other components rely on these. Change the test and every consumer together.

- Danger zones: a `## Danger zones` section in the project's `CLAUDE.md`, one backticked glob per bullet (a trailing `/` means everything below). Pinned by `test/pre-tool-guard.test.mjs`; parsed by `readDangerZones` in `hooks/pre-tool-guard.mjs`. Zones block writes only.
- `spec.md` sections: Summary, Acceptance criteria, Affected areas, Data changes and migrations, Edge cases, Test plan, Risks, Open questions. Pinned by `SPEC_SECTIONS` in `test/components.test.mjs`.
- spec-critic verdict: a line `Verdict: PASS` or `Verdict: GAPS`, with findings tagged by category (`[untestable]`, `[ambiguous]`, `[missing-edge-case]`, `[unmapped-criterion]`, `[scope]`, `[product-decision]`, `[missing-section]`, `[open-question]`). Pinned by `test/components.test.mjs`.
- `.delivery/active`: holds the active ticket id. Read by the commands and named in `rules/delivery-rules.md`; pinned for `/intake` and `/spec` by `test/commands.test.mjs`.
- `scripts/validate.mjs <schema-name> <file>` exit codes: 0 valid, 1 invalid (errors on stdout), 2 usage or input error. Pinned by `test/validate-cli.test.mjs`.

## Core architecture (spans the whole doc)

**Pipeline of stage commands.** Each stage reads the previous stage's artifact and writes its own into `.delivery/<ticket-id>/` in the *target* project. That folder is both the audit trail and the resume point. The order is `/intake` → `ticket.json`, `/spec` → `spec.md`, `/plan` → `plan.md`, `/build` → one commit per step on `feat/<ticket-id>`, `/verify` → `verify-report.md`, `/review` → the PR description, `/ship` → the PR and `deploy-record.json`, then `/publish` for store releases. `/run` chains the stages. Every stage must also run on its own, because rerunning one stage is how a run recovers.

Supporting commands sit outside the stage chain. `/onboard` writes the target project's `CLAUDE.md` and `.delivery/deploy.yml`. The others are `/connect`, `/discover-target`, and `/new-adapter`.

**Gates.** Every stage ends with an explicit pass/fail check. A failure stops the run and writes the reason into that stage's artifact. A failing step may be retried at most 3 times; after that the run stops and summarises. Humans must approve at three points, and the kit may never automate past them: spec approval, PR review, and the production or store release. A spec that still has open questions cannot pass its gate.

**Two entry flows, one pipeline.** In the task flow, `/onboard` maps an existing repo first. In the app flow, a template is copied into a new repo and `/onboard` then runs on it. After entry, the two flows are identical.

**Deploy adapters.** `/ship` must stay platform-agnostic. All platform logic lives in `adapters/<target>/`, and each adapter implements the same 8 scripts: `check`, `plan`, `provision`, `build`, `deploy`, `smoke`, `rollback`, `record`. Each adapter also has a matching `skills/deploy-<target>/` skill. Add a new platform as a new adapter, never as a special case in the core. A failed `smoke` triggers `rollback`. On a first deploy, `plan` output needs approval before `provision` runs.

**Solo and agents modes.** Every command and skill must work both inline (solo) and when delegated to a subagent in `agents/`. Instructions must never assume a subagent exists. Review agents see the diff and the spec but not the build conversation.

## Rules for authoring kit content

- One job per skill. The skill's description says exactly when it applies. Keep `SKILL.md` short and move long reference material into separate files beside it.
- A skill's inputs and outputs are files in `.delivery/<ticket-id>/`, and each skill names them.
- Deterministic work (builds, deploys, checks) belongs in `adapters/` scripts. Skills call those scripts and interpret their output.
- Every deploy, publish, and integration skill starts with the `/connect` connection check. It runs the verify command; if the connection is missing, it shows the engineer the single command to fix it and waits.
- Secrets are handled only by reference (`account_ref: client-prod`). Scripts and CI resolve them from the client's vault. Kit content must never read, print, or store a secret value.
- Skills that depend on current platform behaviour (pricing, APIs, store policies) fetch the official docs during the run instead of relying on memory.
- The kit must contain no client code, names, or data. Test it on the author's own projects (CodeCloak, the Jev firewall, the Pashto app).

## v1 scope (from the build plan)

- Task flow end to end.
- One template: `web-react-fastapi`.
- Deploy adapters: `gcp-cloud-run`, `cloudflare` (Workers/Pages), and `vm-docker-compose`.
- Publish adapter: `chrome-web-store`, trusted testers only.

Kubernetes, serverless, package registries, and desktop targets come in later phases. Don't build them early.
