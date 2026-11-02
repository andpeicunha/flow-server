# Board visual de runs em grafo

## Por quê

O painel atual permite listar flows e inspecionar um run por ID, mas não mostra
em uma tela os nós, suas dependências e o avanço do run. Um board dentro de um
workspace do Herdr pode ajudar a acompanhar um flow sem interferir na execução.

## O que propomos

- Mostrar os runs locais em uma lista e o grafo do run selecionado.
- Distinguir nós concluídos, ignorados, falhos, prontos e ainda bloqueados.
- Mostrar os detalhes e o último checkpoint do nó selecionado.
- Usar somente consultas de leitura ao serviço local; o board não avança runs.
- Avaliar Textual com um protótipo funcional e medições antes de escolher a
  tecnologia da TUI.

Referência visual: [protótipo em PNG](../../../work/flow-board-grafo-prototipo.png).

## Fora de escopo

- Iniciar agentes, executar nós ou chamar `flow_next` para atualizar a tela.
- Editar flows, fazer review automático ou sincronizar repositórios.
- Enviar dados de runs a um serviço remoto.

## Estado da proposta

Esta change registra a ideia para discussão. A implementação depende de uma
avaliação de desempenho e de uma decisão sobre a tecnologia da interface.
