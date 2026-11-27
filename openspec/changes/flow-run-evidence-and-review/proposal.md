# Flow run evidence and review / Evidências e revisão de runs

## Why / Por quê

Flow maintainers need inexpensive evidence to decide whether a flow really
needs a change. Active runs must not be delayed, rerouted, or modified by deep
evaluation.

## What changes / O que muda

- Record small, redacted, structured node evidence with each run.
- Emit passive review signals that never affect run execution.
- Add a deterministic `flow review <flowId>` command that compares completed
  run evidence by flow content hash.
- Store generated review reports inside the anchor run dossier.
- Install a Skill that tells an independent agent how to interpret a report and
  propose, validate, and seek approval for a flow change.

## Non-goals / Fora de escopo

- Run an LLM judge during a node.
- Stop, retry, reroute, or mutate an active run because of review signals.
- Automatically edit or activate a flow.
- Treat one anomalous run as proof that a flow must change.

