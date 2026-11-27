# Tarefas: board de runs em grafo

## Decidir antes de implementar

- [ ] Confirmar com o mantenedor quais estados e detalhes precisam aparecer.
- [ ] Medir a listagem atual com muitos runs e um flow de até 256 nós.
- [ ] Fazer um pequeno protótipo Textual dentro de uma pane Herdr e comparar
  instalação, uso de memória e tempo de renderização com uma opção Node.
- [ ] Definir limites de página, intervalo de atualização e metas de desempenho.
- [ ] Escolher a tecnologia da TUI após as medições.

## Implementar somente após a decisão

- [ ] Expor resumo paginado e somente de leitura dos runs e do grafo selecionado.
- [ ] Construir navegação por teclado, grafo, detalhes e estado vazio.
- [ ] Testar que abrir, navegar e atualizar o board não modifica runs.
- [ ] Testar flows com ramificações, junções, skips e terminais pequenos.
- [ ] Medir desempenho com o limite de nós do contrato e documentar o resultado.
