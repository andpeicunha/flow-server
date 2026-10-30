# Design: flow run evidence and review

## Separation of concerns

Execution stores facts. Review reads facts after execution. Flow editing remains
a separate approved operation. Review signals are advisory and have
`affectsRun: false` by contract.

## Run dossier

Each receipt remains under its run directory and may contain bounded execution
metrics, effective agent/model/effort/Skills, deterministic validation results,
and passive signals. A review report is stored at
`runs/<anchorRunId>/review/flow-review.json`. It references every analyzed run,
the `flowId`, and each `flowContentHash`; it does not duplicate prompts or full
outputs.

## Cost boundary

The server performs only deterministic aggregation. It does not call a model.
An independent agent is invoked later, only when a maintainer explicitly asks
to review a flow. The installed Skill provides stable review criteria.

## Review metrics

The report groups runs by content hash and node. It calculates status counts,
success rate, retries, average duration, validation failures, missing evidence,
and passive signal counts. Recommendations are evidence pointers, not automatic
flow changes.

Evidence completeness is compared with the immutable flow snapshot when it is
available. Older runs without a snapshot are marked `unknown`. The review
fails closed when local evidence exceeds the bounded node or finding limits;
thousands of nodes are treated as invalid or corrupted evidence, not a
supported software-flow shape. Review output is written only to a real
directory contained by the run dossier, never through a symlink.

