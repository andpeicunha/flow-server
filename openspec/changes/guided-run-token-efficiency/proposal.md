# Guided run token efficiency / Eficiência de tokens em runs guiadas

## Why / Por quê

- [us] Guided runs repeat full node reports in later prompts and route large reports through the orchestrator twice. This increases token cost and can truncate evidence.
- [pt] Runs guiadas repetem relatórios completos em prompts seguintes e fazem relatórios grandes passarem duas vezes pelo orquestrador. Isso aumenta o custo em tokens e pode truncar evidências.

## What changes / O que muda

- [us] Store full node reports in a run-scoped directory; let nodes write through a constrained flow-server capability; validate and hash reports at checkpoint; reference earlier reports from later prompts; expose report integrity in audit.
- [pt] Guardar relatórios completos em diretório da run; permitir gravação por uma capacidade restrita do flow-server; validar e calcular hash no checkpoint; referenciar relatórios anteriores nos próximos prompts; expor integridade na auditoria.
- [us] Reuse prior receipts only by explicit request, with source run/node and context fingerprint recorded, and reject stale context.
- [pt] Reutilizar receipts anteriores somente por solicitação explícita, registrando run/nó de origem e impressão digital do contexto, e rejeitando contexto desatualizado.
- [us] Support optional per-node output schemas, report when an executor cannot load declared Skills, and document that ready independent nodes may run in parallel.
- [pt] Aceitar schemas opcionais de saída por nó, avisar quando o executor não puder carregar Skills declaradas e documentar que nós independentes disponíveis podem rodar em paralelo.

## Non-goals / Fora de escopo

- [us] Change the semantic decisions or quality gates of existing flows.
- [pt] Alterar as decisões semânticas ou os gates de qualidade dos flows existentes.
- [us] Automatically reuse old analysis or let a node read files outside its run report directory through the report API.
- [pt] Reutilizar análise antiga automaticamente ou permitir que um nó leia arquivos fora do diretório de relatórios da própria run pela API de relatório.

## Compatibility / Compatibilidade

- [us] Existing inline receipt output and flows without schemas remain valid. Report references, reuse metadata, and schema validation are additive and opt-in; legacy flows retain current behavior.
- [pt] Outputs inline de receipts existentes e flows sem schemas continuam válidos. Referências de relatório, metadados de reutilização e validação por schema são aditivos e opcionais; flows antigos mantêm o comportamento atual.
