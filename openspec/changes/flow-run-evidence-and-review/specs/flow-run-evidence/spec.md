# flow-run-evidence Specification

## ADDED Requirements

### Requirement: Passive evidence

The system SHALL store bounded, redacted node evidence in the run dossier.
Review signals SHALL always declare that they do not affect the active run.

#### Scenario: A node reports a review signal

- **WHEN** a receipt contains a valid passive signal
- **THEN** the receipt is stored with the run
- **AND** the run lifecycle and routing are unchanged

### Requirement: Traceable identity

Every review SHALL identify the flow ID, content hash, and analyzed run IDs.

#### Scenario: A review is generated

- **WHEN** stored run evidence is reviewed
- **THEN** the report identifies its flow, version groups, and run IDs

