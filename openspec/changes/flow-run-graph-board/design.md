# Design: board de runs em grafo

## Fonte dos dados

O serviço continua responsável pelo estado. O board consulta uma lista paginada
de runs e um resumo somente de leitura do run selecionado. O resumo usa a
definição do flow fixada no run e seus checkpoints para calcular nós e arestas.
O board não lê os arquivos do dossiê diretamente.

`flow_next` modifica o run e não serve para atualizar a tela. O novo resumo
precisa calcular os estados sem gravar skips, iniciar o run ou executar regras
com efeitos. O estado `running` do run não prova que um agente esteja ativo
naquele instante; a tela mostra o horário do último checkpoint.

## Interface proposta

Dentro de uma pane do Herdr, a lista de runs fica à esquerda, o grafo do run
selecionado no centro e os detalhes do nó à direita. O grafo usa camadas de um
DAG, com linhas para dependências, ramificações e junções. Teclado permite
selecionar runs e nós, percorrer a área visível e abrir detalhes. Terminais
pequenos exibem menos detalhes por vez, com rolagem.

Textual é candidato para a TUI. Antes de adotá-lo, um protótipo deve confirmar
o custo de instalação de Python e o comportamento dentro da pane do Herdr.
Uma alternativa com o runtime Node atual também deve ser comparada.

## Limites de desempenho

A lista atual pagina a resposta depois de carregar todos os arquivos de runs.
Consultar essa rota repetidamente pode ficar caro quando houver muitos runs.
Antes do board, medir e definir uma leitura realmente limitada para a lista.
O board deve consultar detalhes apenas do run selecionado, pausar a atualização
quando a pane não estiver visível e evitar redesenhar o grafo sem mudança de
estado. O intervalo de atualização e as metas de latência/memória serão
escolhidos após medições com muitos runs e flows de até 256 nós.

## Decisões abertas

- Textual ou TUI no runtime Node já instalado.
- Intervalo de atualização e limite de runs mostrados por página.
- Metas de latência e memória para lista, resumo e renderização.
- Como representar nós prontos sem sugerir que um agente está trabalhando.
