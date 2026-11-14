# Command reference

Every slash command zero-pi registers. The README has the short table.

| Command | Does |
| ------- | ---- |
| `/forge <feature>` | Run the SDD pipeline — `--continue [slug]` resumes. (A prompt, `prompts/forge.md`, not an extension command.) |
| `/zero-models [<phase>=[<provider>/]<model> [thinking=<level>]]` | Show or set per-phase models, providers, and thinking — `thinking=<level>` (`off\|minimal\|low\|medium\|high\|xhigh`); `autotune=auto\|ask\|off`. Direct assignments fail fast when pi's registry says the provider/model is unknown or ambiguous. |
| `/zero-models profile [list\|new <name> [from <other>]\|save [<name>]\|use <name>\|delete <name>]` | Manage named per-phase model profiles. `new` and `use` make the profile active; while a profile is active, every model edit lands in it. |
| `/zero-doctor` | Run zero-pi preflight diagnostics: package, Node, pi-subagents, generated agents/support modules, model config, `.sdd/config`, run history, git, and `gh`. |
| `/zero-sync <slug>` | Fold a run's spec delta into the canonical spec store; a first all-`## ADDED` delta creates the store lazily. |
| `/zero-archive <slug> [--dry-run] [--json] [--allow-dirty]` | Merge an approved run into `.sdd/specs/`, move it to `.sdd/archive/YYYY-MM-DD-<slug>/`, and persist `archivePath`. |
| `/zero-validate <slug>` | Validate proposal/spec/design/tasks artifacts, including task schema and per-domain specs. |
| `/zero-status` | Show each `.sdd/` run's artifact, sync, latest-verdict, and GitHub-link status. |
| `/zero-hud [compact\|minimal\|full\|ascii\|off\|on\|preview]` | Preview or switch the segmented ZERO footer for this pi session. Default preset: `compact`. |
| `/zero-theme [neon\|sunset\|sdd\|sith\|saiyan\|matrix\|cyberpunk]` | Switch between packaged ZERO theme variants without remembering full `zero-*` names. |
| `/zero-cost [<runId>\|<slug>]` | Report registered child input/output/cacheRead/cacheWrite and provider-reported USD. Exact UUID selects an execution; slug/default selects a single newest ledger in the current cwd, never sums reused slugs or scans global sessions. |
| `/zero-checkpoint [<slug>] [--json]` | Save `diff.patch`, `status.txt`, `head.txt`, `meta.json`, and a review-before-running `restore.sh` under `.sdd/<slug>/checkpoints/<id>/`. |
| `/zero-rounds [status\|record <verdicto>\|reset] [<slug>] [--cap N] [--json]` | Read or append the run's build/veredicto rounds. `record` returns the routing state — `proceed`, `cap-reached` or `done`. The cap defaults to `.sdd/config.json` `rounds.cap` (3). |
| `/zero-branch <slug> [--dry-run] [--json] [--allow-dirty] [--base=<branch>]` | Create/reuse the configured SDD Git branch and persist `branch`/`baseBranch`. |
| `/zero-git-validate <slug> [--for=pr\|archive\|any] [--json]` | Check worktree, branch, remote, `gh auth`, and verdict gating before PR/archive. |
| `/zero-pr <slug> [--type=<label>]` | Create an audit-ready GitHub PR from a run that already has verdict `pasa`. |
| `/zero-issue <slug> [--type=<label>]` | Create or reuse a GitHub issue for a run and persist the link. |
| `/zero-diff <slug>` | Preview the logical spec-store merge without writing files. |
| `/zero-resume` | Write the session handoff note now. |
