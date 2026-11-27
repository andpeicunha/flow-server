# flow-run-graph-board Specification

## ADDED Requirements

### Requirement: Board local somente de leitura

O sistema SHALL mostrar um board de runs em uma pane local sem alterar o
estado de nenhum run durante abertura, navegação ou atualização da tela.

#### Scenario: Acompanhar um run

- **WHEN** o usuário abre o board e seleciona um run
- **THEN** o board mostra seu grafo e o último checkpoint conhecido
- **AND** não chama `flow_next`, cria checkpoints nem inicia agentes

#### Scenario: Nenhum run disponível

- **WHEN** não há runs locais
- **THEN** o board mostra um estado vazio sem criar um run

### Requirement: Grafo fiel ao run

O sistema SHALL construir nós e arestas a partir da definição fixada no run e
dos checkpoints registrados, distinguindo estado do run de atividade do agente.

#### Scenario: Ramificação e junção

- **WHEN** o flow possui nós condicionais ou dependências paralelas
- **THEN** o board mostra as ramificações e junções com seus estados reais
- **AND** indica nós ignorados sem tratá-los como falhas

#### Scenario: Run marcado como running

- **WHEN** um run está marcado como `running` sem evidência recente de execução
- **THEN** o board informa o último checkpoint sem afirmar que um agente está ativo

### Requirement: Atualização com custo limitado

O sistema SHALL limitar a leitura e a renderização ao necessário para a página
de runs e o run selecionado, com desempenho medido antes da implementação final.

#### Scenario: Muitos runs ou nós

- **WHEN** há muitos runs ou um flow com até 256 nós
- **THEN** a lista é paginada e a interface permanece navegável
- **AND** a tela não lê os dossiês de todos os runs a cada atualização
