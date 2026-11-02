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
3. Confira o serviço com `flow-server status`. Se estiver parado, abra o painel
   ou inicie `flow-server start --source-config ~/.config/flow-server/sources.json --port 4741`.
4. Use **7 Doctor** no painel ou `flow-server doctor` para conferir serviço,
   fonte, MCP do Codex ou Claude e Skills do runtime escolhido. O diagnóstico não inicia runs nem testa modelos;
   ele mostra o acesso aos modelos como `not_tested`. Para checar só um flow,
   use `flow-server doctor --profile ahkta --flow sdd-ahkta`.

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

Um checkpoint identifica o run e o nó, registra se terminou ou falhou e pode
guardar uma saída curta. Por exemplo, um nó de decisão pode registrar
`output: { "decision": "ready" }`. Essa saída permite que o próximo nó siga
o caminho correto. Não registre um resultado que não aconteceu.

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

Se o serviço não responder, confira `flow-server status`. Se `flow_select`
pedir confirmação, escolha o flow antes de criar o run. Se a auditoria mostrar
evidência faltando, confira os checkpoints em `flow_inspect`.
