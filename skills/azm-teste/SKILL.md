---
name: azm-teste
description: Testa o usuário sobre um conteúdo do Zettelkasten com recuperação livre, transferência, caça ao erro e calibragem 1-5 (AZM), e registra o resultado no zettel Teste do tema. Use quando o usuário quiser se testar, revisar ou validar o que aprendeu. Sobe o conteúdo até "testado" se passar; nunca consolida.
---

# azm-teste

Aplica uma bateria em conversa, como tutor, e registra. Teste mede o quanto o conteúdo foi introjetado; quem decide consolidar é o usuário.

Use só as tools do MCP do Zettelkasten.

## Regras de autoria

- Nunca edite `## Minha síntese` (o servidor recusa).
- Nunca marque nível `consolidado` (reservado ao usuário).
- Nunca renomeie nem apague sem confirmação.
- Nunca entregue a resposta de exercício que o usuário deve resolver: dê dicas.
- Edite por trecho (`edit_zettel` com `old_string`/`new_string`); corpo inteiro só ao criar.
- Se o servidor recusar algo, relate a razão ao usuário e **não contorne**.

## Passos

1. `list_types`: precisa de `teste` e `conteudo`. Faltou `teste`: diga qual cadastrar (`skills/README.md`), **não grave nada**.
2. Escolha o conteúdo (`search_zettels`, `read_zettel`). Sem conteúdo, mande para a `azm-captura`.
3. **Aplique a bateria**, uma pergunta por vez, sem mostrar a resposta antes:
   - **Recuperação livre:** "explique X sem consultar".
   - **Transferência:** aplicar a ideia num caso novo.
   - **Caça ao erro:** apresente uma afirmação com erro sutil para o usuário achar.
   - **Calibragem:** antes de responder, peça a confiança de 1 a 5; depois compare com o resultado.
4. **Corrija** comparando com o zettel; aponte lacunas. Exercício de prática: só dicas.
5. **Crie o Teste na primeira sessão** (um por tema, título como "Teste — SQL"; busque antes): `create_zettel` com `type: "teste"`. Nas seguintes ele já existe.
6. **Registre com `log_test_session`** (não edite o corpo do Teste à mão): `test` (título do Teste), `result` (`passou`, `parcial` ou `nao_passou`), `confidence`, `questions` (técnica, pergunta, resposta resumida, acertou) e `gaps` (abertas ou fechadas), com os conteúdos testados em `concepts`. A tool acrescenta a sessão em `## Sessões` sem tocar nas anteriores e põe o link de volta em `## Testes` do conteúdo. O que ela listar como omitido, relate ao usuário.
7. **Passou na bateria:** `set_type` do conteúdo para o nível `testado`. **Não passou:** o nível continua `semente`, as lacunas ficam no Teste e você sugere voltar ao conteúdo (`azm-tutor`).
8. Acertou tudo: **não** tente `consolidado`. Diga que o conteúdo está pronto para a síntese do usuário.

## Relatório final

Liste os zettels **criados** e **alterados** (títulos), o nível novo se mudou, e qualquer recusa do servidor. Avise depois de escrever.
