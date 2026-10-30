---
name: flow-source-management
description: Validate, review, commit, synchronize, or roll back YAML/JSON flows in a configured flow-server local or Git source. Use when a developer or hook reports a changed flow, asks to sync a personal flow repository, or needs to inspect a pending flow update.
---

# Flow Source Management

Treat the configured local directory as the execution source of truth. Git is
optional history and synchronization. Use the developer's existing Git and SSH
setup. Never ask flow-server to store credentials.

## Resolve and validate

1. Read the explicit source configuration. Do not search `$HOME` for flows or
   infer another repository.
2. Confirm the canonical worktree and configured source ID, mode, remote,
   branch, and sync policy.
3. Run `flow-source validate <file>` for every changed flow.
4. Inspect `git status --short --branch` and the flow-only diff when the source
   mode is `git`.
5. Stop if validation fails, the branch or remote differs from configuration,
   HEAD is detached, conflicts exist, or unrelated changes would enter the
   commit.

## Record a pending change

After successful validation, run:

```sh
flow-source mark --config <absolute-config> --source <source-id> --file <absolute-flow-file>
```

This records the validated hash. For a `local` source it also creates a
versioned local backup. The command does not perform a Git mutation.

## Push policy

- `manual`: report the validated pending change. Do not commit or push.
- `confirm`: show the exact flow-only diff and ask before commit or push.
- `after-validation`: successful validation is standing authorization to stage,
  commit, and push only the intended flow files and approved metadata. It does
  not authorize unrelated files, remote changes, branch changes, force-push,
  history rewrites, or repository creation/deletion.

Use non-interactive Git commands. Stage explicit paths. Before pushing, verify
the staged diff and configured upstream again. Report the commit and remote
branch after success.

## Pull and rollback

Never pull or activate remote flow instructions automatically. Fetch may be
used read-only to show that an update exists. Show the incoming change and ask
for confirmation before pull.

For rollback, show the target local backup or Git commit and the affected flow
diff first. Do not rewrite shared history. An active run keeps its recorded flow
hash and Git commit; never replace its selected definition.
