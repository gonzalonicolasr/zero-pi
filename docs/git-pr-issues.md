# Git, PRs, issues and spec deltas

Recommended flow: `/zero-branch <slug>` → `/zero-issue <slug>` → `/forge <slug>`
(the orchestrator validates plan artifacts and can create `/zero-checkpoint`
before build) → `/zero-git-validate <slug> --for=pr` → `/zero-pr <slug>` →
`/zero-archive <slug>`.

`links.json` (in `.sdd/<slug>/`) is forward-compatible and may contain:

```json
{
  "issueNumber": 12,
  "issueUrl": "https://github.com/org/repo/issues/12",
  "branch": "sdd/my-feature",
  "baseBranch": "main",
  "prNumber": 34,
  "prUrl": "https://github.com/org/repo/pull/34",
  "archivePath": ".sdd/archive/2026-05-24-my-feature"
}
```

## Branch

`/zero-branch <slug>` uses `.sdd/config.json` when present:

```json
{ "git": { "branchPrefix": "sdd/", "numbering": false, "autoCommit": false, "commitStyle": "conventional", "baseBranch": "main" } }
```

## PR

`/zero-pr <slug>` builds a PR title/body from `.sdd/<slug>/proposal.md`,
`spec.md`, `design.md`, and `tasks.md`, then saves the returned `prNumber` and
`prUrl` into `.sdd/<slug>/links.json`. It only runs after the run's latest
recorded verdict is `pasa`; if an issue was already linked, the PR body includes
`Closes #N`.

## Issue

`/zero-issue <slug>` searches open GitHub issues for the exact normalized title
before creating a new one, then saves `issueNumber` and `issueUrl` in the same
`links.json`. Both commands require the `gh` CLI to be installed and
authenticated (`gh auth login`). `--type=<label>` is optional: when the label
exists in the repository it is passed to `gh`, and when it does not exist the
command continues without it.

The implementation shells out through `gh` rather than GitHub-specific Node
SDKs, keeping zero-pi dependency-free and portable across Windows, macOS, and
Linux as long as GitHub CLI is on `PATH`.

## Validate and archive

- `/zero-git-validate <slug> [--for=pr|archive|any] [--json]` checks worktree,
  branch, remote, `gh auth`, and verdict gating.
- `/zero-archive <slug> [--dry-run] [--json] [--allow-dirty]` merges an
  approved run into `.sdd/specs/` and moves it to
  `.sdd/archive/YYYY-MM-DD-<slug>/`. Untracked `.nodd/` and `.pi/` folders do
  not count as a dirty worktree.

## Spec deltas

`/zero-sync` and `/zero-diff` understand four delta sections: `## ADDED`,
`## MODIFIED`, `## REMOVED`, and `## RENAMED`. `RENAMED` keeps the requirement's
store position while changing its stable name:

```md
## RENAMED

### REQ: new-name

from: old-name

Updated requirement body.

Acceptance criteria:
- ...
```

A first all-`## ADDED` delta creates the canonical spec store lazily.
`/zero-diff <slug>` previews the merge without writing files.
