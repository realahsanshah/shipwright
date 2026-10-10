# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Shipwright is at the design stage. The only substantive file is `ticket_to_production.md`, the design doc and source of truth. In that doc the kit's working name is `delivery-kit`; this repo is that kit. No code, build, lint, or test tooling exists yet. Don't invent commands. When tooling is added, record the real, verified commands here.

Read the relevant section of `ticket_to_production.md` before building any part of the kit. If the code and the doc disagree, raise it rather than silently picking one.

## What is being built

A versioned Claude Code kit that client projects install. It is mostly a `.claude/` directory of commands, skills, agents, and hooks, plus `templates/`, `adapters/`, and `schemas/`. It takes a ticket (Jira, Linear, Azure DevOps, GitHub Issues, or an intake form) to a reviewed PR and a deployed release.

Because the kit lives under `.claude/`, the files you write there also configure Claude Code sessions in this repo. Hooks and `settings.json` deny rules will start applying to you once they exist.

## Core architecture (spans the whole doc)

**Pipeline of stage commands.** Each stage reads the previous stage's artifact and writes its own into `.delivery/<ticket-id>/` in the *target* project. That folder is both the audit trail and the resume point. The order is `/intake` → `ticket.json`, `/spec` → `spec.md`, `/plan` → `plan.md`, `/build` → one commit per step on `feat/<ticket-id>`, `/verify` → `verify-report.md`, `/review` → the PR description, `/ship` → the PR and `deploy-record.json`, then `/publish` for store releases. `/run` chains the stages. Every stage must also run on its own, because rerunning one stage is how a run recovers.

Supporting commands sit outside the stage chain. `/onboard` writes the target project's `CLAUDE.md` and `.delivery/deploy.yml`. The others are `/connect`, `/discover-target`, and `/new-adapter`.

**Gates.** Every stage ends with an explicit pass/fail check. A failure stops the run and writes the reason into that stage's artifact. A failing step may be retried at most 3 times; after that the run stops and summarises. Humans must approve at three points, and the kit may never automate past them: spec approval, PR review, and the production or store release. A spec that still has open questions cannot pass its gate.

**Two entry flows, one pipeline.** In the task flow, `/onboard` maps an existing repo first. In the app flow, a template is copied into a new repo and `/onboard` then runs on it. After entry, the two flows are identical.

**Deploy adapters.** `/ship` must stay platform-agnostic. All platform logic lives in `adapters/<target>/`, and each adapter implements the same 8 scripts: `check`, `plan`, `provision`, `build`, `deploy`, `smoke`, `rollback`, `record`. Each adapter also has a matching `skills/deploy-<target>/` skill. Add a new platform as a new adapter, never as a special case in the core. A failed `smoke` triggers `rollback`. On a first deploy, `plan` output needs approval before `provision` runs.

**Solo and agents modes.** Every command and skill must work both inline (solo) and when delegated to a subagent in `.claude/agents/`. Instructions must never assume a subagent exists. Review agents see the diff and the spec but not the build conversation.

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
