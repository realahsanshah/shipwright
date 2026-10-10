# Ticket to Production: Claude Code Delivery Workflow

Oct 10, 2026 · @Ahsan Shah

## Overview

One Claude Code workflow takes a structured ticket to a reviewed PR and a deployed release, for any 10Pearls project. Engineers stay in control at three checkpoints: spec approval, code review, and production release. Everything else is commands, skills, and hooks that live in a versioned `.claude/` kit.

**Goals**

- Cut ticket to PR time for routine work by at least half, measured on real tickets.
- Make output consistent across engineers: same spec format, same tests, same review checklist.
- Deploy to whatever the client runs on, from one command, without the engineer memorising each platform.
- Keep every step auditable: each run leaves a spec, a plan, a test report, and a deploy record in the repo.

**Principles**

- **Spec first.** No code is written until a spec exists and a human approves it.
- **Small, verifiable steps.** Each stage writes an artifact the next stage reads. A failed stage stops the run.
- **Plugins over branches.** New deploy targets and app templates are added as adapters, never as special cases inside the core.
- **Client credentials never touch the model.** Deploys run through scripts and CI that read secrets from the client's own vault.
- **Dogfood before rollout.** One engineer uses it on real work for two weeks before anyone else sees it.

**Non goals (v1)**

- Fully autonomous merges or production deploys with no human approval.
- Replacing project management tools. The workflow reads tickets from Jira, Linear, Azure DevOps, or GitHub Issues; it does not manage them.
- Handling work that needs product decisions. Those tickets are bounced back to the author at the spec stage.

## Architecture

One core pipeline, two entry points, and a pluggable deploy layer. The task flow starts from an existing repo and a ticket. The app flow starts from an intake form and a template. Both converge on the same spec, plan, build, verify, and ship stages.

&#91;embedded content: architecture · 2 entry points, 7 stages, 9 adapter families\]

Only the entry step differs between flows; spec and ship are the two gates a human always sees before code reaches a shared environment.

The kit is a single Git repo (working name `delivery-kit`) installed per project, or globally in `~/.claude/` for personal use. Projects pin a kit version so a kit change never silently alters a running engagement.

```
delivery-kit/
  .claude/
    CLAUDE.md                 # global rules: spec first, never commit secrets, stop on failed gate
    settings.json             # permissions, allowed tools, hooks wiring
    commands/
      onboard.md              # /onboard  : map an existing repo, write project CLAUDE.md
      intake.md               # /intake   : form or ticket -> ticket.json
      spec.md                 # /spec     : ticket -> spec.md (human gate)
      plan.md                 # /plan     : spec -> plan.md with ordered steps
      build.md                # /build    : execute plan step by step
      verify.md               # /verify   : tests, lint, types, security, spec check
      review.md               # /review   : self review + PR description
      ship.md                 # /ship     : PR, then deploy via adapter
      publish.md              # /publish  : store and marketplace releases
      connect.md              # /connect  : check platforms, ask engineer to connect, verify
      discover-target.md      # /discover-target : research listed and unlisted hosts
      new-adapter.md          # /new-adapter : draft + sandbox test an adapter
      run.md                  # /run <ticket-url> : chains all of the above
    skills/
      spec-writing/           # how to write acceptance criteria and edge cases
      test-strategy/          # what to test per stack
      stack-node/ stack-python/ stack-dotnet/ stack-react/ stack-react-native/
      deploy-<target>/        # one skill per deploy adapter (see Deployment layer)
      publish-<store>/        # app store, play store, chrome web store, etc.
    agents/
      spec-critic.md          # reviews spec for gaps before the human sees it
      planner.md              # spec -> plan, splits parallel steps
      builder.md              # implements one step or feature
      code-reviewer.md        # fresh-eyes review of the diff
      security-reviewer.md    # secrets, injection, auth, dependency risk
      target-researcher.md    # deploy target research
      adapter-author.md       # new adapters from official docs
      release-checker.md      # store policy checks
    hooks/
      pre-tool-guard.sh       # blocks writes to secrets, prod config, .env
      post-edit-format.sh     # formatter + linter after each edit
      stop-gate.sh            # refuses to finish if verify failed
  templates/                  # app flow starters (see App flow)
  adapters/                   # deploy scripts, IaC modules, CI workflow templates
  schemas/
    ticket.schema.json
    deploy.schema.json
  runs/                       # per ticket artifacts, copied into the project repo
```

Each run writes its artifacts to `.delivery/<ticket-id>/` inside the project repo: `ticket.json`, `spec.md`, `plan.md`, `verify-report.md`, `deploy-record.json`. That folder is the audit trail and the resume point if a session dies.

## Ticket and spec format

Every run starts from one normalized `ticket.json`, whatever the source. Free text tickets are allowed, but `/intake` converts them and flags missing fields as open questions instead of guessing.

**Intake form fields (app flow)**

| Field             | Type                                        | Example                                                                       |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| Project name      | text                                        | Clinic booking portal                                                         |
| Product type      | dropdown                                    | web app, API, mobile app, browser extension, CLI tool, library, internal tool |
| Template          | dropdown, filtered by type                  | react-fastapi-postgres                                                        |
| Problem statement | text, 2 to 5 sentences                      | Front desk books by phone; patients need self service                         |
| User roles        | repeatable                                  | admin, staff, patient                                                         |
| Features          | repeatable: name, role, acceptance criteria | Patient books a slot; slot disappears for others                              |
| Data entities     | repeatable: name, fields                    | Appointment: patient, doctor, time, status                                    |
| Integrations      | multiselect + notes                         | Stripe, SendGrid, Google OAuth                                                |
| Non functional    | checkboxes                                  | auth, audit log, i18n, offline, accessibility                                 |
| Deploy target     | dropdown (see Deployment layer)             | azure-app-service                                                             |
| Environments      | multiselect                                 | dev, staging, prod                                                            |
| Branding          | uploads                                     | logo, colours                                                                 |
| Out of scope      | text                                        | Payments in v1                                                                |

**Ticket fields (task flow)**: repo URL, branch, ticket type (feature, bug, refactor, chore), description, acceptance criteria, linked files or screenshots, reproduction steps for bugs, deploy target if the change ships.

**ticket.json (normalized)**

```json
{
  "id": "HC-142",
  "source": "jira",
  "flow": "task",
  "type": "feature",
  "repo": "git@github.com:client/portal.git",
  "base_branch": "develop",
  "title": "Export appointments to CSV",
  "description": "...",
  "acceptance_criteria": [
    "Admin sees Export on the appointments page",
    "CSV contains date, patient, doctor, status",
    "Export respects the current filters"
  ],
  "constraints": ["No new dependencies"],
  "deploy": { "target": "azure-app-service", "env": "staging" },
  "open_questions": []
}
```

**spec.md** sections: summary, acceptance criteria as testable statements, affected areas (files, modules, endpoints), data changes and migrations, edge cases, test plan, risks, open questions. A spec with open questions cannot pass the gate.

## Pipeline stages

Eight stages, each a slash command that reads the previous stage's artifact and writes its own. `/run <ticket-url>` chains them and pauses at the human gates. Any stage can be rerun alone, which is how you recover from a bad step without starting over.

| #   | Command    | Reads                                 | Writes                                                  | Gate to continue                                                                           |
| --- | ---------- | ------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `/intake`  | ticket URL, form JSON, or pasted text | `ticket.json`                                           | schema valid; open questions listed                                                        |
| 2   | `/spec`    | ticket.json, project CLAUDE.md, code  | `spec.md`                                               | spec-critic finds no gaps; **human approves**                                              |
| 3   | `/plan`    | spec.md, code                         | `plan.md`: ordered steps, files per step, test per step | every acceptance criterion maps to a step and a test                                       |
| 4   | `/build`   | plan.md                               | code commits on `feat/<ticket-id>`, one commit per step | each step's test passes before the next starts                                             |
| 5   | `/verify`  | branch                                | `verify-report.md`                                      | tests, lint, types, build, dependency audit, secret scan all green; each criterion checked |
| 6   | `/review`  | diff, spec.md                         | review notes, PR description                            | code-reviewer and security-reviewer agents raise no blocking issue                         |
| 7   | `/ship`    | branch, deploy config                 | PR; preview or staging deploy; `deploy-record.json`     | CI green; smoke test passes; **human reviews PR**                                          |
| 8   | `/publish` | release build, store config           | store submission, release notes                         | **human approves prod release**                                                            |

**Stage rules**

- A failed gate stops the run and writes the reason into the stage artifact. Claude may retry a failing step up to 3 times, then must stop and summarise.
- `/build` works test first where the stack allows: write the test from the plan, see it fail, make it pass.
- `/verify` checks the spec, not just the tests. For each acceptance criterion it records the test or manual check that proves it.
- `/review` uses fresh subagents that see the diff and spec but not the build conversation, so the work is not grading itself.
- Bugs get an extra step inside `/build`: reproduce with a failing test first, then fix.

## Task flow and repo onboarding

The task flow works on an existing codebase, so its quality depends on how well Claude knows that repo. `/onboard` runs once per repo and produces the project `CLAUDE.md` every later ticket starts from.

**/onboard produces**

- Stack and versions, detected from manifests (package.json, pyproject, .csproj, pubspec, Gemfile).
- How to install, run, test, lint, type check, build, and seed data, each as an exact command that was actually run and worked.
- Architecture map: main modules, entry points, where routes, models, services, and UI live.
- Conventions observed in the code: naming, folder patterns, error handling, logging, test style.
- Danger zones: generated code, vendored folders, migrations, prod config. These go into the pre-tool guard.
- Deploy facts: CI system, environments, current deploy target. This becomes `.delivery/deploy.yml`.

The engineer reviews and edits the generated `CLAUDE.md` before the first ticket. It is then committed and updated by `/review` whenever a run learns something new (a flaky test, a missing env var).

**Task flow run**

1. Engineer runs `/run https://jira.example.com/browse/HC-142`.
2. `/intake` pulls the ticket through the Jira, Linear, Azure DevOps, or GitHub MCP server and writes ticket.json.
3. `/spec` reads the relevant code and writes spec.md. Engineer approves or edits.
4. `/plan`, `/build`, `/verify`, `/review` run without stopping unless a gate fails.
5. `/ship` opens the PR, links it on the ticket, deploys to the preview or staging target, and posts the preview URL.
6. Engineer reviews the PR and the running preview, then merges. Production promotion follows the project's normal release process.

**Ticket types the task flow accepts in v1**: feature within existing patterns, bug with reproduction steps, refactor with a clear boundary, test coverage, dependency upgrade, small UI change with a screenshot or Figma link. Anything needing a design or product decision is returned with questions at the spec gate.

## App flow and template catalog

The app flow builds new products from an intake form. Speed comes from templates: Claude never starts from an empty folder, it starts from a hardened starter with auth, tests, CI, Docker, and a deploy config already working. Your friends' dozens of apps a day come from this, not from smarter prompts.

**App flow run**

1. Client or PM fills the intake form. The form posts `ticket.json` to a ticket in the tracker.
2. Engineer runs `/run <ticket-url>`. `/intake` selects the template from product type and stack.
3. The template is copied into a new repo; `/onboard` runs on it so the project CLAUDE.md exists from day one.
4. `/spec` turns features and entities into a spec with data model, screens, endpoints, and acceptance criteria. Human gate.
5. `/plan` and `/build` add features one at a time on top of the template. Each feature is a commit with its tests.
6. `/verify`, `/review`, `/ship` deploy to a preview environment in the client's account. `/publish` handles stores and marketplaces.

**Template catalog**

| Template              | Product type      | Stack                                      | Default deploy                              |
| --------------------- | ----------------- | ------------------------------------------ | ------------------------------------------- |
| web-react-fastapi     | web app           | React + Vite, FastAPI, Postgres            | Docker on Cloud Run, App Service, or ECS    |
| web-next-nest         | web app           | Next.js, NestJS, Postgres, Prisma          | Docker or Vercel                            |
| web-react-dotnet      | web app           | React, ASP.NET Core, SQL Server            | Azure App Service                           |
| api-node              | API               | NestJS or Express, Postgres                | container or serverless                     |
| api-python            | API               | FastAPI, Postgres                          | container or serverless                     |
| mobile-rn-expo        | mobile app        | React Native + Expo, EAS                   | App Store, Play Store via EAS               |
| ext-mv3               | browser extension | Manifest V3, TypeScript, Vite, React popup | Chrome Web Store, Edge Add-ons, Firefox AMO |
| cli-node / cli-python | CLI tool          | TypeScript + commander, or Python + Typer  | npm, PyPI, Homebrew, GitHub Releases        |
| lib-ts / lib-py       | library           | TypeScript, Python                         | npm, PyPI                                   |
| agent-langgraph       | AI service        | FastAPI, LangGraph, pgvector               | container                                   |
| static-site           | marketing site    | Astro                                      | static hosting, CDN                         |

Each template contains: working auth (or none, for extensions and CLIs), one example feature end to end, unit and e2e tests, lint and type configs, a Dockerfile where relevant, a CI workflow, `.delivery/deploy.yml`, and its own CLAUDE.md with stack conventions. A template is accepted into the catalog only after an app built from it has shipped once.

Start v1 with three templates: **web-react-fastapi**, **ext-mv3**, and **mobile-rn-expo**. They cover your strongest stack and the two product types your friends proved demand for.

## Deployment layer

Deploys go through adapters: one per target, each with the same interface, so `/ship` never knows platform details. An adapter is a skill (how Claude reasons about the target) plus scripts and IaC (what actually runs). Claude edits config and calls scripts; it does not click through consoles or hold credentials.

**Adapter interface** (every adapter implements these scripts in `adapters/<target>/`)

| Script      | Does                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `check`     | verifies prerequisites: CLI installed, logged in via the client's identity, required config present |
| `plan`      | shows what will change (terraform plan, helm diff, cdk diff, store listing diff)                    |
| `provision` | creates infra once per environment via IaC                                                          |
| `build`     | produces the artifact: image, bundle, zip, AAB/IPA, CRX, package                                    |
| `deploy`    | ships the artifact to an environment                                                                |
| `smoke`     | hits health endpoints or runs a minimal e2e check                                                   |
| `rollback`  | returns to the previous release                                                                     |
| `record`    | writes deploy-record.json: target, env, version, URL, commit, time                                  |

**deploy.yml (per project)**

```yaml
target: aws-ecs-fargate
region: me-central-1
environments:
  staging: { account_ref: client-staging, auto: true }
  prod: { account_ref: client-prod, auto: false, approval: required }
iac: terraform
ci: github-actions
secrets: aws-secrets-manager
healthcheck: /healthz
```

**Target matrix**

| Family              | Target id                                                               | Artifact                   | Tooling                                                     | v1               |
| ------------------- | ----------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------- | ---------------- |
| Containers, AWS     | aws-ecs-fargate, aws-app-runner                                         | Docker image in ECR        | Terraform or CDK                                            | yes              |
| Containers, Azure   | azure-container-apps, azure-app-service                                 | image in ACR               | Terraform or Bicep                                          | yes              |
| Containers, GCP     | gcp-cloud-run                                                           | image in Artifact Registry | Terraform                                                   | yes              |
| Kubernetes          | k8s-eks, k8s-aks, k8s-gke, k8s-generic                                  | image + Helm chart         | Helm, Kustomize, optional Argo CD                           | phase 2          |
| Serverless          | aws-lambda, azure-functions, gcp-cloud-functions                        | zip or image               | SAM, CDK, Terraform, func CLI                               | phase 2          |
| Static and frontend | s3-cloudfront, azure-static-web-apps, firebase-hosting, vercel, netlify | static bundle              | CLI per host                                                | yes              |
| VMs                 | vm-docker-compose (EC2, Azure VM, GCE, any VPS)                         | image + compose file       | SSH via CI, Ansible for setup, Caddy or Nginx               | yes              |
| VMs, bare process   | vm-systemd                                                              | build output               | Ansible, systemd unit                                       | phase 2          |
| Databases           | managed Postgres, MySQL, SQL Server per cloud                           | migrations                 | Terraform + migration tool per stack                        | with each target |
| Mobile, iOS         | appstore                                                                | IPA                        | Expo EAS Build + Submit, or Fastlane                        | yes              |
| Mobile, Android     | playstore                                                               | AAB                        | EAS Submit or Fastlane supply                               | yes              |
| Browser extensions  | chrome-web-store, edge-addons, firefox-amo                              | zip                        | Chrome Web Store API, Edge Add-ons API, web-ext sign        | yes              |
| Packages and tools  | npm, pypi, nuget, homebrew, github-releases                             | package or binary          | npm publish, twine, dotnet nuget, goreleaser style workflow | phase 2          |
| Desktop             | electron or tauri                                                       | installers                 | electron-builder, tauri action, code signing                | later            |

**How a deploy runs**

1. `/ship` reads deploy.yml and loads the matching `deploy-<target>` skill.
2. It runs `check`. Missing login or config stops the run with exact instructions for the engineer.
3. First deploy only: it runs `plan`, shows the diff, and waits for approval before `provision`.
4. `build`, `deploy` to staging or preview, `smoke`, `record`. A failed smoke triggers `rollback`.
5. Production uses the same steps behind a human approval, ideally in CI rather than on the engineer's laptop.

**Store and marketplace publishing (/publish)**

- **App Store**: needs the client's Apple Developer account, App Store Connect API key, bundle id, signing via EAS or Fastlane match. Claude prepares metadata, screenshots list, privacy answers, and release notes; first submission and review replies stay human.
- **Play Store**: needs the client's Play Console, a service account JSON, and the first manual upload (Google requires it). After that, EAS Submit or Fastlane pushes to internal, closed, or production tracks.
- **Chrome Web Store**: needs the client's developer account and API OAuth credentials. The adapter zips the build, uploads, and publishes to a trusted tester group first. Claude drafts the listing and the permission justifications, which are the usual rejection reason.
- **Edge and Firefox**: same zip, separate APIs; Firefox needs `web-ext sign` and source code upload when bundling is used.

Every publish adapter also generates a checklist of store policy items (privacy policy URL, data use disclosures, permission justifications, age rating) so rejections are caught before submission.

## Connections and target discovery

The system ships end to end only if it can reach every platform involved, so connecting is a first class stage, not an assumption. Every deploy and publish skill opens with a connection check and, when something is missing, asks the engineer to connect it and waits.

**/connect: the connection broker**

`/connect` reads deploy.yml and the ticket, works out which platforms the run needs, and checks each one. For anything missing it prompts the engineer with the exact step, then verifies before moving on.

| Platform                               | How the skill connects                                                                              | Verify command                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| GCP                                    | engineer runs `gcloud auth login` and `gcloud config set project`; or service account impersonation | `gcloud projects describe`              |
| AWS                                    | `aws sso login --profile <client>`; or an assumable role via OIDC in CI                             | `aws sts get-caller-identity`           |
| Azure                                  | `az login`, `az account set`; or a service principal in CI                                          | `az account show`                       |
| Cloudflare                             | `wrangler login`, or a scoped API token in the client's secret store                                | `wrangler whoami`                       |
| Vercel / Netlify                       | `vercel login` / `netlify login`, project linked                                                    | `vercel whoami` / `netlify status`      |
| Kubernetes                             | kubeconfig context from the cloud CLI                                                               | `kubectl auth can-i create deployments` |
| GitHub / GitLab / Azure DevOps         | `gh auth login` or MCP connector                                                                    | `gh auth status`                        |
| Ticket trackers                        | MCP server for Jira, Linear, Azure DevOps, GitHub Issues                                            | list one ticket                         |
| Apple / Google Play                    | EAS login, App Store Connect API key, Play service account added to CI secrets                      | `eas whoami`, a dry run submit          |
| Chrome Web Store / Edge / AMO          | OAuth client and refresh token, or API key, in CI secrets                                           | fetch the item's current status         |
| Expo, Supabase, Firebase, Stripe, etc. | their CLI login or MCP connector                                                                    | a read only call                        |

**Connection prompt rules (written into every deploy and publish skill)**

- Check before acting. Run the verify command first; never assume a session is still valid.
- Ask, then wait. When a connection is missing, show the engineer the one command or console step, say why it is needed, and pause the run until verify passes.
- Prefer MCP connectors and official CLIs over raw API tokens. Prefer short lived logins and OIDC over long lived keys.
- Least privilege. Request only the roles the adapter lists, and name them in the prompt.
- Never read, print, or store secret values. The CLI holds the session; Claude only runs commands through it.
- Record which identity was used in deploy-record.json.
- Once connected, the system runs the full ship on its own: provision, build, deploy, smoke, record. Production and store releases still pause for approval.

**/discover-target: research listed and unlisted platforms**

When a ticket has no deploy target, names a platform with no adapter yet, or the engineer asks for options, `/discover-target` researches before choosing.

1. Read requirements from the spec: runtime, database, traffic, regions, budget, compliance, client's existing cloud.
2. Shortlist from the adapter catalog and from unlisted platforms found by web research: Cloudflare (Workers, Pages, R2, D1), Vercel, Netlify, Render, Railway, Fly.io, DigitalOcean App Platform, Heroku, Supabase, Firebase, Hetzner, Coolify, and others that match.
3. Compare on fit, price at the expected scale, regions, lock in, CLI and API maturity, and whether the client already has an account.
4. Write `target-research.md` with a recommendation, two alternatives, and sources, all fetched in this run, never from memory.
5. Human picks the target. That choice goes into deploy.yml.
6. If the pick has no adapter, `/new-adapter <platform>` drafts one from the platform's official docs using the 8 script interface, runs it against a sandbox project, and only then adds it to the catalog after review.

This keeps the catalog growing from real demand: every unlisted platform a client asks for becomes an adapter the next engineer gets for free.

## Credentials, client accounts, and guardrails

Claude never sees a secret value. It works with references (`account_ref: client-prod`), and scripts or CI resolve them at run time from the client's own secret store.

**Client accounts**

- Each client gets a deploy identity in their own cloud: an AWS IAM role, an Azure service principal or managed identity, a GCP service account. Scope it to the project's resources only.
- Prefer CI with OIDC federation (GitHub Actions or Azure DevOps to AWS, Azure, GCP). No long lived keys on laptops.
- Store credentials (App Store Connect key, Play service account, Chrome Web Store OAuth) live in the client's CI secrets, never in the repo or the kit.
- Local deploys, when unavoidable, use the cloud CLI's normal login (`aws sso login`, `az login`, `gcloud auth login`) by the engineer, not by Claude.

**Guardrails in the kit**

- `settings.json` denies reading `.env*`, `*.pem`, `*.key`, `secrets/`, and cloud credential files; denies `git push --force`, `terraform destroy`, `kubectl delete namespace`, and prod deploy scripts without an approval flag.
- `pre-tool-guard.sh` blocks edits to danger zones from the project CLAUDE.md.
- `/verify` runs a secret scanner (gitleaks or trufflehog) and a dependency audit on every run.
- `security-reviewer` agent checks auth, input validation, injection, and permission changes on every diff.
- Production actions always require an explicit human approval recorded in deploy-record.json.

**Client and company policy**

- Run the workflow on a client codebase only where the client allows AI coding tools, and with the Claude Code licence approved for that work.
- Keep the kit free of client code, names, and data, so it can move between engagements cleanly.
- Since you are building the kit on personal time and a personal account, check your 10Pearls agreement on IP for tools built outside work before offering it internally. Agree ownership up front so adoption is easy.

## Quality gates, human checkpoints, and metrics

Three human checkpoints are fixed; everything else is automated and must pass before a human is asked to look.

| Checkpoint         | Who                           | What they decide                               | Typical time |
| ------------------ | ----------------------------- | ---------------------------------------------- | ------------ |
| Spec approval      | engineer (PM for app flow)    | is this the right thing to build               | 5 to 10 min  |
| PR review          | engineer + normal code review | is this code acceptable, does the preview work | 10 to 30 min |
| Production release | engineer or lead              | ship to prod or store                          | 2 to 5 min   |

**Automated gates (in /verify and /review)**: build passes, all tests pass, coverage does not drop, lint and type check clean, no secrets found, no high severity dependency issues, every acceptance criterion has evidence, reviewer agents raise no blocking issue, smoke test passes on the preview.

**Metrics (logged per run to `.delivery/<ticket-id>/metrics.json`)**

- Ticket to PR time, and engineer hands on time.
- Gates failed and retries per stage.
- Spec edits made by the human (a proxy for spec quality).
- PR review comments and rework commits after the PR opens.
- First pass acceptance: PR merged without rework.
- Deploy success rate and rollbacks per target.

After two weeks of dogfooding, these numbers are the pitch: real tickets, real times, real rework rate.

## Building the skills

Every command and skill in the kit follows the same authoring rules, and every run can execute in one of two modes: solo (one session) or with subagents. The mode is a setting, not a rewrite, so each skill is written to work both ways.

**Execution modes**

|                | Solo mode                                                       | Subagent mode                                                                 |
| -------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| How it runs    | one Claude Code session does every stage in sequence            | an orchestrator session delegates stages to subagents with fresh context      |
| Best for       | small tickets, bug fixes, tight usage budgets, dogfooding early | features touching many files, app flow builds, research, independent reviews  |
| Usage cost     | lowest                                                          | higher: each subagent re reads context                                        |
| Review quality | self review only, same context that wrote the code              | reviewers never saw the build conversation, so the work is not grading itself |
| Parallel work  | none                                                            | research, multiple independent features, multi target deploys in parallel     |
| Set by         | `mode: solo` in `.delivery/config.yml` or `/run --solo`         | `mode: agents` or `/run --agents`; default `auto` picks by ticket size        |

**Subagents in the kit** (each a file in `.claude/agents/`, used only in subagent mode; solo mode runs the same instructions inline)

- `spec-critic`: finds gaps, ambiguity, and untestable criteria in spec.md.
- `planner`: turns the spec into plan.md and splits independent steps for parallel builders.
- `builder`: implements one plan step or one feature on its own branch or worktree.
- `code-reviewer` and `security-reviewer`: review the diff against the spec with no build history.
- `target-researcher`: runs `/discover-target` research and returns target-research.md.
- `adapter-author`: drafts and sandbox tests a new adapter from official docs.
- `release-checker`: store policy and listing checks before `/publish`.

**Authoring rules for every skill and command**

- One job per skill. The SKILL.md description says exactly when it applies, so Claude loads it only then.
- Inputs and outputs are files. Each skill names the artifact it reads and the artifact it writes in `.delivery/<ticket-id>/`.
- Write for both modes. Instructions never assume a subagent exists; the orchestrator decides who runs them.
- Gate at the end. Each skill finishes with an explicit pass or fail check and stops on fail.
- Connections first. Every deploy, publish, and integration skill starts with the connection check from `/connect` and its ask and wait prompt.
- Research before guessing. Skills that depend on a platform's current behaviour (pricing, APIs, store rules) fetch the official docs in the run.
- Scripts for anything deterministic. Builds, deploys, and checks live in `adapters/` scripts; the skill calls them and interprets the output.
- Keep SKILL.md short; push long reference material into files next to it that Claude reads only when needed.
- Test every skill on a real ticket before it enters the kit, and log what broke in the skill's own changelog.

## Build plan

Today's 13 hours deliver a working core with the task flow, one template, and three deploy adapters. The full matrix comes in later phases, each added only after the previous one has shipped real work.

**Today: 13 hour sprint (personal Claude Code)**

| Hours      | Build                                                                                                                                          | Done when                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 0 to 1     | Kit repo, global CLAUDE.md, settings.json permissions, ticket.schema.json                                                                      | Claude Code loads the kit; denied paths are blocked              |
| 1 to 3     | `/onboard`, `/intake`, `/spec`, spec-critic agent                                                                                              | Onboard a repo of yours; a GitHub issue becomes an approved spec |
| 3 to 6     | `/plan`, `/build`, `/verify`, hooks (format, guard, stop gate)                                                                                 | A real issue goes to a green branch with tests                   |
| 6 to 7.5   | `/review` with code-reviewer and security-reviewer, `/ship` opening a PR                                                                       | PR opens with description and evidence per criterion             |
| 7.5 to 10  | /connect with ask and wait prompts; adapters: gcp-cloud-run, cloudflare (Workers/Pages), vm-docker-compose, chrome-web-store (trusted testers) | One app reaches a live URL; one extension uploads as a draft     |
| 10 to 11.5 | `web-react-fastapi` template, `/run` chaining all stages in solo and agents modes, /discover-target                                            | Intake to preview deploy in one command                          |
| 11.5 to 13 | Run 3 to 4 real tickets end to end, fix what breaks, write the README                                                                          | Metrics recorded for each run                                    |

Use your own projects for the test tickets (CodeCloak, the Jev firewall, the Pashto app), never client code.

**Phases after today**

1. **Week 1 to 2, dogfood**: use it on every suitable ticket you touch. Fix the kit daily. Add ext-mv3 and mobile-rn-expo templates; add appstore and playstore adapters.
2. **Week 3, harden**: add AWS (ECS Fargate, S3 + CloudFront) and Azure (Container Apps, App Service) adapters; move deploys into CI with OIDC.
3. **Week 4, pitch**: one page with the metrics, a 5 minute demo video, and the kit repo. Pilot with 2 to 3 engineers on internal work first.
4. **Month 2 and later**: Kubernetes (Helm on EKS, AKS, GKE), serverless, package registries, intake form web app feeding the tracker, a kit version per engagement.

**Open questions**

- Which ticket tracker do most 10Pearls teams use? This decides the first intake MCP integration.
- Which cloud do most current clients run on? This orders the adapter roadmap.
- Who owns a kit built on personal time if 10Pearls adopts it?
