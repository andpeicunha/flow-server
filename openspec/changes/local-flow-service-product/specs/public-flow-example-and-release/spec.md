## ADDED Requirements

### Requirement: Exemplo público autocontido
A distribuição SHALL incluir exemplo sintético com flow YAML pequeno, workspace
fictício, receipts/audit sintéticos e README de quickstart em menos de cinco
minutos, sem dependência de profile, runtime real ou dado pessoal.

#### Scenario: Validação de fixture pública
- **WHEN** o CI valida o exemplo
- **THEN** ele executa o fluxo/audit de fixture e falha se encontrar secret pattern, path pessoal ou profile privado

### Requirement: Gate de release open-source
Antes de publicar, a release SHALL ter licença, README, threat model, secret
scan, testes, exemplos e verificação de conteúdo do artefato.

