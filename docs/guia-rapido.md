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
   fonte, MCP do Codex ou Claude e Skills do runtime escolhido. O diagnóstico não inicia runs nem testa modelos;
   ele mostra o acesso aos modelos como `not_tested`. Para checar só um flow,
   use `flow-server doctor --profile ahkta --flow sdd-ahkta`.
5. Na sessão do agente, confirme que a tool `flow_list` aparece. O doctor
   confere o registro do MCP, mas não consegue confirmar se esta sessão carregou
   suas tools. Se elas não aparecerem após configurar o MCP, abra uma nova sessão.

### Escolher o runtime nesta máquina

Na configuração local da fonte (`~/.config/flow-server/sources.json`), adicione
`execution` à fonte. O YAML compartilhado do flow continua igual:

```json
"execution": {
  "runtime": "claude",
  "models": {
    "openai/gpt-5.5-fast": "anthropic/modelo-rapido",
    "openai/gpt-5.5": "anthropic/modelo-principal"
  },
  "efforts": { "medium": "high" }
}
```

Substitua os nomes de exemplo pelos modelos que o cliente da máquina aceita.
Se usar Codex e os modelos do YAML, basta `"execution": { "runtime": "codex" }`.
Ao iniciar um run, o serviço fixa os modelos resolvidos para seus nós. Se
faltar um modelo no mapa, ele não inicia o run. Uma troca de runtime exige
editar essa configuração local; não há troca automática durante o run. Para
OpenRouter, configure o cliente escolhido e use no mapa os IDs aceitos por ele.

## Rodar um flow

1. Abra o projeto certo e descreva a tarefa ao agente. Diga para usar o MCP
   `flow-server`. Você não precisa escolher o flow antes.
2. O agente usa `flow_list` e `flow_select` para encontrar o flow. Se houver
   uma única opção, ele segue. Se houver mais de uma, você escolhe antes de
   começar.
3. `flow_start_guided` cria o run com o runtime configurado na máquina. Guarde
   seu ID (campo `id`); ele será o
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

### Fallback de runtime

O fallback é definido por perfil no `sources.json` da máquina. Um perfil sem
`execution.fallback` não troca de runtime. Em cada novo run, o plugin fixa os
modelos permitidos; `flow_next` registra a escolha de cada nó antes da execução.

Se o runtime atingir um limite antes do checkpoint, o agente chama `flow_block`
com `reasonCode: "RATE_LIMIT"` somente se o run ainda não estiver bloqueado.
Para um bloqueio existente, confirma o run e o nó em `flow_inspect` e chama
`flow_retry_inspect`. Confere `runStatus`, `selectedExecution`,
`fallbackExecution`, todos os recibos anteriores, `otherFailures` e
`retryPending`; também revisa o trabalho parcial no worktree fixado.

Só pode chamar `flow_switch_runtime` se o bloqueio for `RATE_LIMIT` para aquele
nó, houver `fallbackExecution` fixado com outro runtime, todos os nós anteriores
estiverem `completed` ou `skipped`, não houver outras falhas nem retry pendente,
e o worktree estiver seguro. Informa o worktree fixado, o motivo e a revisão;
define `reviewedPredecessors: true` só depois de conferir todos os anteriores.
O mesmo nó volta com outro `attempt`, modelo e runtime. O checkpoint usa os
valores retornados, e a troca aparece na auditoria.

Sem `fallbackExecution`, este run não pode trocar de runtime: a configuração
fica fixada quando o run começa. Ele pode continuar no mesmo runtime depois
que o acesso ao provider primário for restaurado, usando `flow_continue`. Se o
limite ainda estiver ativo, deixa o run bloqueado e informa que ainda não pode
retomar. Não inicia outro run sem orientação do dev.

Exemplo: `gate0_check` parou por falta de acesso. O dev corrige o acesso; o
agente confere e continua em `gate0_check`. Se uma revisão externa ainda
rejeitar a ação, o agente mantém o run parado. O limite padrão é de três
novas tentativas por nó; o flow pode definir outro limite em `retry`.

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
