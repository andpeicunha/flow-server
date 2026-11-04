# Tasks / Tarefas

## 1. Source contract / Contrato da fonte

- [x] **[us]** Add bounded optional `policy.skills`, `policy.mcps`, and
  `policy.mcpRegistrations` to the v1 source schema and validator. Support
  only exact names, `*`, and leading `!`; require an explicit positive rule
  in a nonempty list. Reject unknown fields, duplicates, malformed patterns,
  and invalid runtime names.
  **[pt]** Adicionar os campos opcionais ao schema v1 e validador. Aceitar
  apenas nomes exatos, `*` e `!` inicial; exigir regra positiva em lista não
  vazia. Rejeitar campos desconhecidos, duplicatas, padrões e runtimes inválidos.
- [x] **[us]** Add optional node `mcps` to the flow schema and canonical model;
  preserve it when a run pins its flow definition.
  **[pt]** Adicionar `mcps` opcional ao schema e modelo canônico do flow;
  preservá-lo na definição fixada pela run.
- [x] **[us]** Document two generic `sources.json` profiles and node YAML
  examples in plugin and flow-server guides. Explain `*`, `!`, deny precedence,
  migration, and the limits of name-based rules for agents on any installation.
  **[pt]** Documentar dois perfis genéricos e exemplos de YAML do nó nos guias
  do plugin e do flow-server. Explicar `*`, `!`, prioridade da negação, migração
  e limites das regras por nome para agentes em qualquer instalação.

## 2. Enforcement / Aplicação

- [x] **[us]** Check each node's Skill IDs, MCP names, and resolved MCP
  registrations against the selected profile rules during source validation
  and before a new run; deny wins and errors name profile, flow, node, and tool.
  **[pt]** Conferir Skills, nomes lógicos e registros MCP resolvidos contra as
  regras do perfil na validação e antes da run; negação prevalece e o erro
  informa perfil, flow, nó e ferramenta.
- [x] **[us]** Apply policy changes to new runs without rewriting active runs.
  **[pt]** Aplicar mudanças de política a novas runs sem reescrever runs ativas.

## 3. Doctor and guidance / Doctor e orientação

- [x] **[us]** Validate policy and node use when a source is added through the
  plugin and during plugin startup/update. Report errors without changing user
  source files; a clean install without sources gets setup guidance.
  **[pt]** Validar política e uso nos nós quando o plugin adiciona a fonte e
  ao iniciar/atualizar. Informar erros sem alterar arquivos do usuário;
  instalação sem fontes recebe orientação de configuração.
- [x] **[us]** Replace the fixed private Skill-to-MCP check with checks for
  MCP names used by nodes of the selected flow, mapped to registration names
  for each applicable runtime; leave the flow bridge check separate.
  **[pt]** Substituir a regra privada fixa pela checagem dos MCPs usados pelos
  nós do flow selecionado em cada runtime; manter separado o bridge do flow.
- [x] **[us]** Update guided node and agent guidance to use only the node's
  declared Skills and MCPs from the active profile.
  **[pt]** Orientar o agente a usar só Skills e MCPs declarados pelo nó do
  perfil ativo.

## 4. Verification / Verificação

- [x] **[us]** Test exact, wildcard, and deny rules across two profiles and
  nodes sharing an agent role. Cover `*`, deny precedence, invalid deny-only
  lists, empty lists, and a safe alias mapped to a denied registration.
  **[pt]** Testar regras exatas, curingas e negação em dois perfis e nós com o
  mesmo agente. Cobrir `*`, prioridade da negação, lista só de negações,
  lista vazia e nome lógico permitido ligado a registro proibido.
- [x] **[us]** Test primary and fallback MCP mappings and registration,
  unused aliases, profiles without policy, changed YAML before a run, and
  policy changes during an active run.
  **[pt]** Testar mapeamento e registro MCP nos runtimes principal e fallback,
  nomes não usados, perfis sem política, YAML alterado e runs ativas.
- [x] **[us]** Test plugin first use, update, malformed local config, and
  actionable diagnosis on a second machine-like installation fixture.
  **[pt]** Testar primeiro uso e atualização do plugin, configuração local
  inválida e diagnóstico acionável em instalação simulada de outra máquina.
- [x] **[us]** Run source-config schema checks, targeted service tests,
  `openspec validate`, and the public artifact check.
  **[pt]** Rodar checagens do schema, testes focados, `openspec validate` e
  a checagem do artefato público.
