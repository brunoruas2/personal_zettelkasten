---
name: azm-teste
description: Testa a pessoa sobre conceitos do Zettelkasten (AZM) numa sessão de 15 a 20 minutos, uma questão aberta por vez, e registra num único zettel teste com nome temporal ligado em ## Testes dos conceitos. Use quando ela quiser se testar, revisar ou validar o que aprendeu. Sugere a síntese quando houver passagens ou prática suficientes; nunca promove nível.
---

# azm-teste

Aplica uma sessão de teste em conversa e registra. Teste mede o quanto o conteúdo foi introjetado; **você nunca promove nível** nem consolida: quem escreve a síntese e marca `internalizado` é a pessoa.

Use só as tools do MCP do Zettelkasten, citadas pelo nome (`create_zettel`, `edit_zettel`...).

## Regras de autoria

- Nunca edite `## Minha síntese` (o servidor recusa).
- Nunca marque nem desfaça o nível `internalizado` (reservado à pessoa).
- Nunca renomeie nem apague sem confirmação da pessoa.
- Nunca entregue a resposta de um exercício que a pessoa deve resolver: dê dicas.
- Edite por trecho (`edit_zettel` com `old_string`/`new_string`); corpo inteiro só ao criar.
- Se o servidor recusar algo, relate a razão e **não contorne**.

## Passos

1. `list_types`: precisa de `teste` e `conteudo`. Faltou `teste`: diga que falta o tipo `teste`, remeta a `skills/README.md` e **não grave nada**.
2. **Escolha os conceitos** (`search_zettels`, `read_zettel`), de um tema ou de vários. Pode incluir `em-teste` e `iniciado`. Sem conceito, sugira a `azm-sessao`.
3. **Planeje** a sessão de **15 a 20 minutos** (poucas questões abertas, varie o tipo: recuperação livre, transferência para um caso novo, caça ao erro numa afirmação com erro sutil). Opcional: peça a confiança de 1 a 5 antes de cada resposta e compare depois.
4. **Uma questão aberta por vez.** A pessoa responde em linguagem natural, sem consultar, e você não mostra a resposta antes. Corrija comparando com o zettel e aponte as lacunas. Exercício prático: só dicas, nunca a resposta.
5. **Registre ao fim**, sem esperar permissão: um **único** zettel `teste` por sessão (`create_zettel`, `type: "teste"`), com nome temporal (ex.: `Teste 2026-11-21`; se já existe um do dia, acrescente a hora). Cubra todos os conceitos avaliados, mesmo de temas diferentes, e para cada questão guarde a **pergunta** e um **resumo da resposta**, com ênfase nas erradas (o que errou e a lacuna). Ligue os conceitos com `[[Título]]`.
6. **Referência nos conceitos**: para cada conceito avaliado, `read_zettel` e `edit_zettel` por trecho acrescentando `[[Teste ...]]` ao fim de `## Testes`. Seção ausente: acrescente só o cabeçalho `## Testes` no fim. Nunca toque em `## Minha síntese`. Não use ferramentas de registro de sessão antigas: o registro é este `create_zettel` + `edit_zettel`.
7. **Nunca promova.** Não mude o nível por causa do resultado; se o desempenho sugere voltar ao material, diga e indique a `azm-sessao`.
8. **Sugestão de síntese** (conte você mesma): um conceito com **5 ou mais passagens** (testes citados em `## Testes`) ou **ao menos 1 prática** (citado por um zettel `pratica`, veja `get_links`) merece a síntese. Sugira que a pessoa a escreva em `## Minha síntese`; não escreva, não marque `internalizado`.

## Relatório final

Liste, em português, os zettels **criados** e **alterados** (títulos), as lacunas encontradas, a sugestão de síntese se houver, e qualquer recusa do servidor.
