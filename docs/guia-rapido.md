# Guia rápido do Flow Server

O plugin organiza um trabalho em etapas chamadas **nós**. Cada nó indica um
agente e pode indicar um modelo e Skills. O plugin acompanha o andamento; o
agente executa o trabalho. Hoje a execução é **guiada**: o plugin não inicia
agentes sozinho.

## Preparar uma vez

1. Instale ou vincule o plugin ao Herdr e abra **flow: open server**. No painel,
   escolha a pasta que contém seus flows e, se quiser, a pasta do projeto.
   Essa pasta pode estar em qualquer repositório privado seu; o plugin não
   escolhe um repositório por você. No modo Git, ele lê o clone desta máquina.
   A instalação reconhece a versão antiga, valida e copia seus YAMLs antes de
   retirar o comando e o plugin antigos. Se houver conflito ou arquivo
   desconhecido, ela para antes da limpeza. Logs antigos são movidos, sem
   alteração, para `~/.local/share/flow-server/legacy-runs`.
2. Instale os comandos com `npm link` na pasta deste repositório e configure o
   MCP `flow-server` no Codex. Veja os comandos em [Configurar o MCP](codex-mcp.md).
3. Abra o painel. Ele confere o serviço e o inicia se estiver parado e sem um
   lock de processo ativo. Antes de criar um run, ele executa o diagnóstico.
   Também pode conferir manualmente com `flow-server status` e iniciar com
   `flow-server start --source-config ~/.config/flow-server/sources.json --port 4741`.
4. Use **7 Doctor** no painel ou `flow-server doctor` para conferir serviço,
   fonte, MCP e Skills dos runtimes configurados nos perfis de execução ou nas
   configurações legadas. O
   diagnóstico não inicia runs nem testa acesso aos modelos ou às contas; esses
   itens aparecem como `not_tested`. Para checar só um flow,
   use `flow-server doctor --profile ahkta --flow sdd-ahkta`.
5. Na sessão do agente, confirme que a tool `flow_list` aparece. O doctor
   confere o registro do MCP, mas não consegue confirmar se esta sessão carregou
   suas tools. Se elas não aparecerem após configurar o MCP, abra uma nova sessão.

### Perfis de execução

A configuração local da fonte pode oferecer mais de um runtime para o mesmo
flow. Cada perfil define um runtime e, quando necessário, mapeia os IDs de
modelo do YAML para IDs aceitos pelo cliente correspondente:

```json
"execution": {
  "profiles": [
    {
      "id": "codex",
      "name": "Codex",
      "runtime": "codex",
      "models": {"anthropic/review-model": "openai/review-model"}
    },
    {
      "id": "claude",
      "name": "Claude",
      "runtime": "claude",
      "models": {"openai/review-model": "anthropic/review-model"}
    }
  ],
  "defaultProfileId": "codex"
}
```

Ajuste os IDs aos modelos disponíveis em cada runtime. O painel pergunta qual
perfil usar ao criar cada run. Via MCP, escolha um dos `executionProfiles` de
`flow_select` e passe seu ID como `executionProfileId` para
`flow_start_guided`. Via CLI, use `flow start --execution-profile <id>`. Se só
houver um perfil ou existir `defaultProfileId`, esse perfil pode ser usado sem
uma nova escolha.

A escolha vale apenas para aquela run; outra run pode usar outro perfil. O
serviço fixa o perfil e os modelos resolvidos na run. O perfil não troca a conta
autenticada: a sessão ativa de Codex ou Claude precisa ter acesso à conta que
pode usar o runtime escolhido.

Fontes antigas com `execution.runtime`, `execution.models` e `execution.efforts`
continuam aceitas quando não usam `execution.profiles`. O `execution.fallback`
legado também continua disponível para trocar somente o nó bloqueado.

## Rodar um flow

1. Abra o projeto certo e descreva a tarefa ao agente. Diga para usar o MCP
   `flow-server`. Você não precisa escolher o flow antes.
2. O agente usa `flow_list` e `flow_select` para encontrar o flow. Se houver
   uma única opção, ele segue. Se houver mais de uma, você escolhe antes de
   começar.
3. `flow_start_guided` cria o run com o perfil escolhido ou o runtime legado
   configurado na fonte. Guarde seu ID (campo `id`); ele será o
   `runId` usado nas próximas chamadas.
4. O agente chama `flow_next`, executa os nós prontos conforme as instruções
   recebidas e salva o resultado real com `flow_checkpoint`. Depois chama
   `flow_next` novamente. Repete até terminar ou encontrar um bloqueio.

Veja o [diagrama de sequência com cores](../README.md#guided-run-sequence).
A parte verde representa uma volta por nó: receber as instruções, executar e
registrar o resultado. Se o run bloquear, a parte amarela mostra como retomar
somente o nó pendente. O Test Auditor só aparece se estiver definido no YAML.

Um checkpoint identifica o run e o nó, registra se terminou ou falhou e pode
guardar uma saída curta. Por exemplo, um nó de decisão pode registrar
`output: { "decision": "ready" }`. Essa saída permite que o próximo nó siga
o caminho correto. Não registre um resultado que não aconteceu.

O formato de `flow_checkpoint` é este (substitua os valores pelo resultado real):

```json
{
  "runId": "run_exemplo",
  "receipt": {
    "schemaVersion": "v1",
    "runId": "run_exemplo",
    "nodeId": "gate0_check",
    "status": "completed",
    "recordedAt": "2026-11-02T14:00:00Z",
    "model": "provider/modelo-configurado",
    "effort": "low",
    "output": { "decision": "continue", "reason": "Motivo real" }
  }
}
```

Use `completed` ou `failed` no checkpoint. `flow_next` registra os nós
ignorados. Campos como `decision`, `reason` e `evidence` ficam dentro de
`receipt.output`; campos extras no nível de `receipt` são rejeitados.

### Resolver um bloqueio e continuar

Quando um nó não pode rodar, o agente registra o motivo com `flow_block`.
Se o próprio nó falhou, o checkpoint registra o bloqueio. O dev resolve o
problema e pede: **“continue o mesmo flow”**.

O agente confere o worktree e os nós anteriores. Se algum resultado anterior
estiver incorreto, ele para e explica o problema. Se estiver tudo certo, chama
`flow_continue` com o motivo da correção. Para um nó que já falhou, também
informa o worktree fixado, um resumo da revisão e confirma que conferiu os
nós anteriores. O plugin guarda a tentativa falha, prepara outra e devolve o
mesmo nó com o número `attempt` para o
próximo `flow_checkpoint`. O dev não precisa fornecer horários ou IDs de
recibos. Nenhum nó concluído roda de novo.

Uma regra `stopWhen` com `mode: block` permite corrigir e repetir o próprio
nó no mesmo run. Exemplo: `independent_verify` conclui com `FAIL`. O dev
corrige o problema, o agente revisa o worktree e usa `flow_continue`. O
recibo `FAIL` fica no histórico. A próxima etapa espera o novo checkpoint do
`independent_verify` com resultado aprovado. Sem `mode: block`, a regra
encerra o run.

### Trocar o perfil depois de um rate limit

Se o runtime atingir um limite antes do checkpoint, o agente chama `flow_block`
com `reasonCode: "RATE_LIMIT"` somente se o run ainda não estiver bloqueado.
Para um bloqueio existente, confirma o run e o nó em `flow_inspect` e chama
`flow_retry_inspect`. Confere `selectedExecution`, `availableExecutionProfiles`,
todos os recibos anteriores, `otherFailures` e `retryPending`; também revisa o
trabalho parcial no worktree fixado.

Só pode chamar `flow_switch_runtime` quando o run estiver bloqueado por
`RATE_LIMIT` naquele nó, houver outro perfil de execução disponível, todos os
predecessores estiverem `completed` ou `skipped`, não houver outras falhas nem
retry pendente, e o worktree estiver seguro. Informa o novo
`executionProfileId`, o workspace fixado, o motivo e a revisão; define
`reviewedPredecessors: true` só depois de conferir os predecessores. A troca
vale para o nó bloqueado e todos os nós seguintes que ainda não têm receipt. Os
receipts concluídos permanecem intactos. Usa no checkpoint o runtime, modelo,
effort e `attempt` retornados pelo serviço.

O perfil seleciona runtime e modelos, mas não troca credenciais. A sessão ativa
do agente precisa estar autenticada em uma conta que tenha acesso ao runtime
selecionado.

Fontes antigas podem ter um `fallbackExecution` fixado no run. Esse caminho
legado troca somente o nó bloqueado. Se não houver perfil alternativo nem
fallback legado, mantém o mesmo run bloqueado até o acesso ao provider primário
ser restaurado; então usa `flow_continue`. Não inicia outro run por conta
própria.

Exemplo pela CLI:

```sh
flow retry-inspect <run-id> <node-id>
flow switch-runtime <run-id> <node-id> --execution-profile codex --reason "Provider rate limit" --workspace /caminho/fixado --worktree-review "Revisei alterações parciais" --reviewed-predecessors
```

Um run pausado precisa de `flow_lifecycle` com `resume`. Um run `stopped` é
definitivo: o campo `stop` em `flow_inspect` mostra o motivo e o próximo passo.

O plugin exige que o checkpoint de um nó concluído informe o modelo e o effort
configurados. Ele não inicia o agente nem comprova sozinho qual modelo foi
executado; o agente deve conferir esses dados no runtime antes de registrá-los.
Se o runtime mostrar o uso de tokens do nó, o agente pode registrar
`tokenUsage: { "inputTokens": 1200, "outputTokens": 300 }`. Se não mostrar,
deixe `tokenUsage` ausente: o dado é desconhecido. O mesmo vale para
`durationMs`. Não estime esses números. O agente de validação pode consultar
os receipts em `flow_inspect`, mas deve tratar os números informados pelo
agente como dados sem comprovação independente pelo serviço.

Para novos worktrees, prefira `<repo>/.worktree/<nome>` e inclua `.worktree/`
no `.gitignore` do projeto. Cadastre a raiz do repositório como workspace e
informe o perfil explicitamente se a seleção automática não reconhecer o
worktree. Isso é uma convenção sugerida; o plugin aceita outros caminhos.

## Conferir o resultado

Use `flow_inspect` para ver o andamento e `flow_audit` ao terminar:

- `passed`: run concluído, com evidência para todos os nós necessários.
- `incomplete`: run ainda aberto ou com evidência faltando.
- `failed`: houve falha registrada.

Se precisar interromper, use `flow_lifecycle` para pausar, retomar ou parar.
Um run pausado precisa ser retomado antes de novos checkpoints.

## Validar um flow alterado

Depois de editar um arquivo YAML ou JSON, rode
`flow-source validate /caminho/para/flow.yaml`. O resultado `valid` confirma
o formato e mostra o hash do conteúdo. Ele **não** substitui um teste real do
flow. O painel também permite validar as fontes configuradas.

Para trocar o modelo de um nó, peça ao agente para usar a Skill
`flow-source-management`. Ele altera o ID completo do modelo no arquivo do
flow, valida o arquivo e registra a versão com `flow-source mark`. Não há uma
tool que troque modelos automaticamente. Um run já iniciado mantém a versão
com que começou; a mudança vale para novos runs.

## Rever o flow depois

O review **não roda automaticamente**. Quando quiser avaliar o desempenho de
um flow, abra outra sessão e peça ao agente para usar `flow_review` com a
Skill `flow-performance-review`. A tool reúne evidências de runs encerrados; a
Skill ajuda o agente a interpretar o relatório e propor melhorias. Nenhuma
proposta altera o flow por conta própria.

Se aparecer `fetch failed` ou `MCP_SERVICE_UNAVAILABLE`, confira
`flow-server status` e `flow-server doctor`. Uma sessão pode bloquear o acesso
ao endereço local mesmo quando o serviço está saudável em outra sessão. Se
`start` apontar lock de processo ativo, confira processo, porta e acesso da
sessão; não apague o lock nem inicie outro serviço. O painel também interrompe
a criação do run quando o diagnóstico falha. Se `flow_select`
pedir confirmação, escolha o flow antes de criar o run. Se a auditoria mostrar
evidência faltando, confira os checkpoints em `flow_inspect`.

## Ferramentas por perfil

Configure opcionalmente `policy` em cada fonte, conforme os dois exemplos genéricos no README. Em `skills` e `mcps`, `*` aceita qualquer sequência e `!` no início nega com prioridade. Lista omitida mantém a compatibilidade; lista vazia nega tudo. Liste no YAML de cada nó as Skills e os MCPs lógicos necessários, inclusive dependências de Skills. `mcpRegistrations` mapeia nomes para `codex` e `claude`; tanto o nome lógico quanto o registro precisam passar pela política. Regras por nome não comprovam propriedade nem bloqueiam chamadas externas. Agentes devem usar apenas ferramentas declaradas no nó e permitidas pelo perfil ativo.
