# flow-performance-review Specification

## ADDED Requirements

### Requirement: Explicit post-run review

The system SHALL review runs only after an explicit `flow review` request and
SHALL use deterministic local aggregation without model calls.

#### Scenario: Compare flow versions

- **WHEN** a maintainer reviews a flow with evidence from multiple content hashes
- **THEN** the report groups metrics by content hash
- **AND** provides the run IDs used as evidence
- **AND** stores the report in an anchor run dossier

