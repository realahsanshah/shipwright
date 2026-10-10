# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Shipwright is a Claude Code plugin; the repo root is the plugin root. `ticket_to_production.md` is still the design source of truth (the kit's working name there is `delivery-kit`). The approved deviations from it are listed under "Decisions that deviate from the spec" in `docs/superpowers/plans/2026-10-10-kit-foundation.md`: plugin layout instead of a `.claude/` folder, Node `.mjs` instead of `.sh`, global rules shipped as a SessionStart hook (`rules/delivery-rules.md`), the deny-list shipped as `settings/project-settings.json` for `/onboard` to offer (defense in depth; the guard is primary), and `deploy.schema.json` deferred. The plan/build/verify slice's decisions are under "Decisions that deviate from or fill gaps in the spec" in `docs/superpowers/plans/2026-10-10-plan-build-verify.md`.

Built so far: `/onboard`, `/intake`, `/spec`, `/plan`, `/build`, `/verify`, `/review`, `/ship` (the PR half only; deploys wait for the adapters), the `spec-writing` and `test-strategy` skills, the `spec-critic`, `planner`, `builder`, `code-reviewer` and `security-reviewer` agents, the `ticket` schema, the five gate CLIs (`scripts/check-spec.mjs`, `check-plan.mjs`, `check-build.mjs`, `check-verify.mjs`, `check-review.mjs`), `scripts/secret-scan.mjs`, and the hooks. Everything else in the doc is not built yet. Read the relevant section of `ticket_to_production.md` before building any part of the kit. If the code and the doc disagree, raise it rather than silently picking one.

## Commands

- `npm install` (only dev dependency is `ajv`)
- `npm test` runs `node --test` (it also picks up `test/helpers/frontmatter.mjs` as a file; harmless)
- One file: `node --test test/pre-tool-guard.test.mjs`
- One test: `node --test --test-name-pattern="danger zones" test/pre-tool-guard.test.mjs`
- `npm run validate` runs `claude plugin validate .`. `test/plugin.test.mjs` runs it with `--json` and fails on any error or warning except "CLAUDE.md at the plugin root is not loaded as project context". That warning is expected: this CLAUDE.md is the dev guide, not plugin context.
- Try the plugin in a project: `claude --plugin-dir "<path to this repo>"`

Runtime constraint: `hooks/` and `scripts/` use Node built-ins only, because an installed plugin has no `node_modules`. `ajv` is a dev-only oracle in tests.

## What is being built

A versioned Claude Code plugin that client projects install. Layout (all at the repo root): `.claude-plugin/plugin.json`, `commands/`, `skills/`, `agents/`, `hooks/` (`hooks.json`, `session-start.mjs`, `pre-tool-guard.mjs`, `post-edit-format.mjs`, `stop-gate.mjs`), `rules/`, `settings/`, `schemas/`, `scripts/`, plus `templates/` and `adapters/` when built. Nothing under `.claude/` is part of the kit. It takes a ticket (Jira, Linear, Azure DevOps, GitHub Issues, or an intake form) to a reviewed PR and a deployed release.

The plugin's `PreToolUse` guard applies to sessions in this repo once the plugin is loaded. It blocks, with exit 2: secret files (`.env*` except `.env*.example/.sample/.template`, keys, `secrets/`, tfstate, cloud credentials) via file tools, Grep on secret paths, and shell commands (Bash/PowerShell) that reference them; edits to the target project's danger zones; `git push --force`/`-f`, `terraform destroy`, and `kubectl delete namespace`. The guard is best-effort: it cannot catch every shell form (`grep -r KEY .`, globbed or quoted paths, shell writes into danger zones), and `/verify`'s secret scan is the backstop.

`post-edit-format` (PostToolUse) runs the project's own tools after edits and feeds errors back with exit 2: prettier when `node_modules/.bin/prettier` exists, eslint only when an eslint config exists (`eslint.config.*`, `.eslintrc*`, or `eslintConfig` in `package.json`), and ruff only when configured (`[tool.ruff]` in `pyproject.toml`, `ruff.toml` or `.ruff.toml`), preferring `.venv`'s ruff over PATH. A tool that cannot be started is skipped with a one-line note (fail open). `SHIPWRIGHT_FORMAT_ON_EDIT=0` disables it. `stop-gate` (Stop) blocks only when the session is on `feat/<active id>`, the latest `verify-report.md` says `Status: FAIL` with `Attempts` below 3, and `stop_hook_active` is not set; `SHIPWRIGHT_STOP_GATE=0` disables it.

`scripts/secret-scan.mjs --base <ref>` scans the net branch diff, uncommitted and untracked files, and the added lines of every non-merge commit in `<merge-base>..HEAD`, so a secret committed and later removed is still reported (as `file:line rule (commit <sha>)`). It never prints values. A line carrying `shipwright:allow-secret` is skipped, and a history hit whose line is still in the working tree with that marker counts as acknowledged. A `--base` starting with `-` is rejected (exit 2). A ticket's `base_branch` must match `^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$` (schema and `/build`/`/verify`).

## Contracts pinned by tests

Other components rely on these. Change the test and every consumer together.

- Danger zones: a `## Danger zones` section in the project's `CLAUDE.md`, one backticked glob per bullet (a trailing `/` or a bare directory name means everything below; a leading `/`, `./` and backslashes are normalised). Pinned by `test/pre-tool-guard.test.mjs`; parsed by `readDangerZones` in `hooks/pre-tool-guard.mjs`. Zones block writes only.
- `spec.md` sections: Summary, Acceptance criteria, Affected areas, Data changes and migrations, Edge cases, Test plan, Risks, Open questions. Defined by `SPEC_SECTIONS` in `scripts/lib/delivery-docs.mjs`, imported by `test/components.test.mjs`.
- `plan.md`, `build-log.md` and `verify-report.md` formats (step blocks with `Covers:`/`Files:`/`Test:`; per-step log entries; `Status:`/`Attempts:` plus checks and evidence tables): parsed and checked by `scripts/lib/delivery-docs.mjs`. Pinned by `test/delivery-docs.test.mjs` and the embedded-template parsing tests in `test/commands.test.mjs`.
- `check-spec`, `check-plan`, `check-build`, `check-verify` exit codes: 0 pass, 1 gate failure (`failed: <file>` then `  - <reason>` lines on stdout), 2 usage or input error. Pinned by `test/check-cli.test.mjs`.
- Commit subjects: `/build` makes `<id> step <N>: <title>`; fixes during `/verify` and `/review` are `<id> fix: <summary>`; `/ship` makes `<id> delivery record`. Defined in `commands/build.md`, `commands/verify.md`, `commands/review.md` and `commands/ship.md`.
- `review.md` (written by `/review`): preamble `Commit:` (7-40 hex), `Status: PASS|FAIL`, `Mode: agents|solo`, `Round: N` (integer >= 1; persisted so the 3-round cap holds across invocations); exactly two sections, `## Code review` and `## Security review`, each with a `Verdict: PASS|BLOCKING` line and findings as bullets starting `[blocking]` or `[non-blocking]` (plain, numbered or bold-tagged bullets all count). Any other H2, a repeated section, or a second `Verdict:` line in a section is an error, and a `[blocking]` tag anywhere (bulleted or not) counts as blocking. A section is BLOCKING if and only if it has a `[blocking]` finding; `Status: PASS` if and only if both are PASS. Parsed by `parseReview`/`checkReview` in `scripts/lib/delivery-docs.mjs`; pinned by `test/delivery-docs.test.mjs`.
- `pr-description.md` (written by `/review` on a PASS): first non-empty line is the `# <title>` (enforced by the parser), a `Closes: <ticket url, #n or id>` line, H2 sections `Summary`, `Acceptance criteria`, `Test plan`, `Risks` and `Notes for CLAUDE.md`, and a row with non-empty evidence in the Acceptance criteria table for every spec AC. `/review` lists proposed CLAUDE.md additions under `Notes for CLAUDE.md` instead of editing CLAUDE.md (that would make verify stale). Parsed by `parsePrDescription`/`checkPrDescription`.
- `scripts/check-review.mjs <spec.md> <verify-report.md> <review.md> <pr-description.md> [--head <sha>]` (the `/review` gate and `/ship` entry check): same exit codes as the other gate CLIs. It fails unless verify passes, `review.md` and `pr-description.md` follow their formats, and, with `--head`, both reports' `Commit:` match it (either SHA a prefix of the other, case-insensitive). `--head` must match `^[0-9a-f]{7,40}$` or the CLI exits 2. Pinned by `test/check-cli.test.mjs`.
- Last code commit: the gates compare `Commit:` lines against `git log -1 --format=%h -- . ":(exclude).delivery"`, the last commit touching anything outside `.delivery/`. Delivery-record commits do not make a passing verify or review stale; any code change does.
- `.delivery/` commit policy: `/ship` commits `.delivery/<id>/` as one last commit with subject `<id> delivery record`, right before pushing, so the artifacts travel with the PR as the audit trail. `.delivery/active` is per-machine state and is gitignored (`/onboard` adds the line); `.delivery/deploy.yml` stays committed. Push rule (`rules/delivery-rules.md`): never push, except `/ship` pushing `feat/<id>` after its entry gate passes; never force; never merge a PR.
- Review/ship slice decisions (GitHub-only PRs, PR-only `/ship`, run learnings as `Notes for CLAUDE.md`): see "Decisions that deviate from or fill gaps in the spec" in `docs/superpowers/plans/2026-10-10-review-ship.md`.
- Frontmatter values containing `: ` must be quoted (YAML safety). Pinned by `test/components.test.mjs`.
- spec-critic verdict: a line `Verdict: PASS` or `Verdict: GAPS`, with findings tagged by category (`[untestable]`, `[ambiguous]`, `[missing-edge-case]`, `[unmapped-criterion]`, `[scope]`, `[product-decision]`, `[missing-section]`, `[open-question]`). Pinned by `test/components.test.mjs`.
- `.delivery/active`: holds the active ticket id. Read by the commands and named in `rules/delivery-rules.md`; pinned for `/intake` and `/spec` by `test/commands.test.mjs`.
- `scripts/validate.mjs <schema-name> <file>` exit codes: 0 valid, 1 invalid (errors on stdout), 2 usage or input error. Pinned by `test/validate-cli.test.mjs`.

## Core architecture (spans the whole doc)

**Pipeline of stage commands.** Each stage reads the previous stage's artifact and writes its own into `.delivery/<ticket-id>/` in the *target* project. That folder is both the audit trail and the resume point. The order is `/intake` → `ticket.json`, `/spec` → `spec.md`, `/plan` → `plan.md`, `/build` → one commit per step on `feat/<ticket-id>`, `/verify` → `verify-report.md`, `/review` → the PR description, `/ship` → the PR and `deploy-record.json`, then `/publish` for store releases. `/run` chains the stages. Every stage must also run on its own, because rerunning one stage is how a run recovers.

Supporting commands sit outside the stage chain. `/onboard` writes the target project's `CLAUDE.md` and `.delivery/deploy.yml`. The others are `/connect`, `/discover-target`, and `/new-adapter`.

**Gates.** Every stage ends with an explicit pass/fail check. A failure stops the run and writes the reason into that stage's artifact. A failing step may be retried at most 3 times; after that the run stops and summarises. Humans must approve at three points, and the kit may never automate past them: spec approval, PR review, and the production or store release. A spec that still has open questions cannot pass its gate.

**Two entry flows, one pipeline.** In the task flow, `/onboard` maps an existing repo first. In the app flow, a template is copied into a new repo and `/onboard` then runs on it. After entry, the two flows are identical.

**Deploy adapters.** `/ship` must stay platform-agnostic. All platform logic lives in `adapters/<target>/`, and each adapter implements the same 8 scripts: `check`, `plan`, `provision`, `build`, `deploy`, `smoke`, `rollback`, `record`. Each adapter also has a matching `skills/deploy-<target>/` skill. Add a new platform as a new adapter, never as a special case in the core. A failed `smoke` triggers `rollback`. On a first deploy, `plan` output needs approval before `provision` runs.

**Solo and agents modes.** Every command and skill must work both inline (solo) and when delegated to a subagent in `agents/`. Instructions must never assume a subagent exists. `/spec` auto mode picks solo for a bug, chore or refactor with 2 or fewer acceptance criteria, otherwise agents; with no subagent tool it is always solo. Review agents see the diff and the spec but not the build conversation.

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
