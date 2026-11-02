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
2. Instale os comandos com `npm link` na pasta deste repositório e configure o
   MCP `flow-server` no Codex. Veja os comandos em [Configurar o MCP](codex-mcp.md).
3. Confira o serviço com `flow-server status`. Se estiver parado, abra o painel
   ou inicie `flow-server start --source-config ~/.config/flow-server/sources.json --port 4741`.

## Rodar um flow

1. Abra o projeto certo e descreva a tarefa ao agente. Diga para usar o MCP
   `flow-server`. Você não precisa escolher o flow antes.
2. O agente usa `flow_list` e `flow_select` para encontrar o flow. Se houver
   uma única opção, ele segue. Se houver mais de uma, você escolhe antes de
   começar.
3. `flow_start_guided` cria o run. Guarde seu ID (campo `id`); ele será o
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
