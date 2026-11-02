---
name: flow-source-management
description: Validate, review, commit, synchronize, or roll back YAML/JSON flows in a configured flow-server local or Git source. Use when a developer or hook reports a changed flow, asks to sync a personal flow repository, or needs to inspect a pending flow update.
---

# Flow Source Management

Treat the configured local directory as the execution source of truth. Git is
optional history and synchronization. Use the developer's existing Git and SSH
setup. Never ask flow-server to store credentials.

## Select and run a flow

1. Resolve the target workspace from the current task. A configured
   `workspaceRoots` match is the local source of truth for its private profile.
2. Use `flow_select` with the workspace and task. Trust a unique profile match
   and a unique flow match only. If routing terms match more than one flow,
   ask which flow to use even when their priorities differ.
3. If the result is `needs_confirmation`, present the candidate profiles or
   flows and ask the developer which one to use. Never create the run while
   selection is unresolved.
4. Start with the selected `profileId`, `flowId`, and original task, then follow
   `flow_next`. The task and prior completed node outputs render into prompts.
   Preserve each node's configured agent, model, effort/variant, executor,
   Skills, constraints, prompt, and output contract. Do not silently substitute
   a model, agent, or Skill.
5. Use the lifecycle controls to pause/resume, stop, or fail a run. The first
   `flow_next` starts it, and the scheduler marks it complete when all required
   nodes finish. A paused run cannot accept node checkpoints.
6. Use `flow_audit` at completion. It must report `passed` and include evidence
   for all required nodes before treating the run as successful.
7. Record bounded structured node output in the receipt when later conditions
   depend on it. Never copy private profile names or workspace paths into public
   examples or plugin defaults.

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

## Change a node model

When a maintainer approves a model change, edit the configured flow file. Use
the full model ID, not an alias, and set the intended effort or variant for
that node. Do not silently change other nodes. Validate the edited file with
`flow-source validate`, then use `flow-source mark` to record its hash and local
backup. Report the old and new model, the validated hash, and which runs still
use the old pinned definition. There is no MCP tool that edits models, and a
model named in a flow is guidance until the executing runtime confirms it.

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
