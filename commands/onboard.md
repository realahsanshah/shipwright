---
description: Map an existing repo once and write the project CLAUDE.md (verified commands, architecture, conventions, danger zones) and .delivery/deploy.yml.
argument-hint: "[path to repo, default: current directory]"
---

# /onboard

Map the repo at `$ARGUMENTS` (default: the current directory) once, and write the project `CLAUDE.md` and `.delivery/deploy.yml`. Every later ticket starts from these files. This command may be run inline or delegated to a subagent; either way the gate is the same.

Never read `.env`, `*.pem`, `*.key` or `secrets/**`. Never print or store a secret value.

## Steps

1. **Check the runtime and detect the stack.** Run `node --version`. If Node is missing or older than 20, stop and tell the engineer: the kit's hooks are Node scripts, and without Node >= 20 on PATH the secret guard and rules injection silently do nothing. Then look for these manifests and record the language and framework versions they declare: `package.json`, `pyproject.toml` or `requirements.txt`, `*.csproj` or `*.sln`, `pubspec.yaml`, `Gemfile`, `go.mod`, `Dockerfile`, and CI files (`.github/workflows/`, `azure-pipelines.yml`, `.gitlab-ci.yml`).

2. **Verify the dev commands.** For install, run, test, lint, type check, build and seed, find the candidate command (manifest scripts, Makefile, README) and run it. Record only commands that actually ran successfully, with their exact invocation. Mark anything that failed or was not tried as `not verified: <reason>`. Also record how to run a single test.
   - Run `git status --porcelain` before and after verification. Report any changes the commands made and offer to revert them.
   - Prefer non-mutating variants: `npm ci` over `npm install`, lint without `--fix`, formatters in check mode.
   - Start long-running `run` or dev-server commands in the background, wait until they report ready (or about 60 seconds), confirm, then stop them. Never leave one running or block on it.
   - Never run deploy or publish commands.
   - Never run a seed against a database that is not local. If you cannot tell, mark seed `not verified` and say why.

3. **Map the architecture.** Cover entry points and where the routes, models, services, UI and tests live. Give a big-picture view, not a file listing.

4. **Note the conventions observed.** Naming, folder patterns, error handling, logging and test style. Cite one example file for each.

5. **Find the danger zones.** Look for generated code, vendored folders, applied migrations, prod config, and lockfiles if the project treats them as generated. Write them as a `## Danger zones` section in `CLAUDE.md`, one bullet per zone. Each bullet starts with a backticked project-relative glob, then an em-dash and the reason:

   ```
   ## Danger zones

   - `db/migrations/**` — applied migrations, add new ones instead
   ```

   A trailing `/` or a bare directory name (for example `vendor`) protects the whole directory. The `pre-tool-guard` hook blocks edits to paths matching these entries, so a wrong zone blocks real work. Tell the engineer to prune the list. If `CLAUDE.md` already has a `## Danger zones` section, merge into it rather than adding a second heading. If you find none, write `None found.` under the heading.

6. **List the env vars.** Learn the required variable names from `.env.example` or `.env.sample` and from code references, never from `.env`. List names only, never values.

7. **Write deploy facts** to `.delivery/deploy.yml` using these fields: `target`, `region`, `environments` (each with `account_ref`, `auto`, and `approval`), `iac`, `ci`, `secrets`, `healthcheck`. Use `unknown` for anything you cannot determine. Put only references in the file (for example `account_ref: client-prod`), never secret values. Do not overwrite an existing `.delivery/deploy.yml`; show a diff and ask before changing it.

8. **Write `CLAUDE.md`** in the repo root with the results of steps 1 to 6 and a pointer to `.delivery/deploy.yml`. If the project already has a `CLAUDE.md`, never overwrite it. Show the proposed additions as a diff and apply them only after the engineer approves.

9. **Permissions.** Ask before merging the deny rules from `${CLAUDE_PLUGIN_ROOT}/settings/project-settings.json` into the project's `.claude/settings.json`. Merging means taking the union of the `permissions.deny` arrays and keeping every existing key. Show the resulting file first and wait for a yes. If the engineer declines, skip this step.

## Gate

PASS when all of these hold:
- `CLAUDE.md` contains verified test and build commands, or an explicit `not verified` reason for each.
- `CLAUDE.md` has a `## Danger zones` section (it may say `None found.`).
- `CLAUDE.md` points to `.delivery/deploy.yml`.
- The engineer reviews and approves the `CLAUDE.md` content.

Otherwise FAIL and list what is missing. Stop on FAIL. This command runs once per repo, before the first ticket.
