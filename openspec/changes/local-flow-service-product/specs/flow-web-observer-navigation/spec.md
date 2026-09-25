## ADDED Requirements

### Requirement: Flow-web somente observador
`flow-web` SHALL ser uma interface opcional de observação de runs e SHALL NOT
criar, iniciar, executar, selecionar runtime ou montar worktree.

#### Scenario: Usuário abre o viewer
- **WHEN** o usuário abre a interface web local
- **THEN** ela lista apenas estado, evidências redigidas e auditorias disponíveis, sem iniciar um run

### Requirement: Filtro e deep link por query parameter
`flow-web` SHALL aceitar `flowId` e `runId` na query string. `flowId` filtra
runs pelo flow lógico; `runId` seleciona um run específico.

#### Scenario: Agente abre um run específico
- **WHEN** um agente abre `/?runId=<run-id>`
- **THEN** o viewer carrega o dossiê redigido daquele run sem criar ou modificar estado

#### Scenario: Usuário filtra um flow
- **WHEN** o usuário abre `/?flowId=<flow-id>`
- **THEN** o viewer mostra somente os runs daquele flow e mantém a interface em modo observador

#### Scenario: Identificador desconhecido
- **WHEN** `flowId` ou `runId` não existe
- **THEN** o viewer informa not-found/resultado vazio e não dispara lifecycle ou execução

