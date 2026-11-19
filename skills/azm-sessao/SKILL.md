---
name: azm-sessao
description: Abre uma sessão de estudo no Zettelkasten (AZM). Use quando o usuário quiser estudar, retomar uma trilha, "abrir sessão" ou perguntar como está numa trilha. Lista as trilhas, mostra onde parou e oferece continuar, testar, revisar, captar ou consolidar. Só lê; nunca escreve na base.
---

# azm-sessao

Porta de entrada do estudo. **Só lê**: nenhuma escrita, nenhuma mudança de tipo ou nível.

Use apenas as tools do MCP do Zettelkasten. Status e progresso aparecem só aqui ou quando o usuário pede; nunca cobre estudo fora da conversa.

## Passos

1. **Trilhas.** `list_types` para achar o tipo de slug `trilha`. Se não existe, diga que falta cadastrar o tipo `trilha` (definição em `skills/README.md`) e pare. Com o tipo, `search_zettels` com `type: "trilha"` e texto vazio.
2. **Nenhuma trilha?** Diga e ofereça criar uma pela `azm-trilha`. Não escreva nada por conta própria.
3. **Escolha.** Liste as trilhas (título e nível, `beta`/`estavel`) e pergunte qual percorrer. Com uma só, confirme em vez de perguntar.
4. **Onde parou.** `read_zettel` da trilha e `trail_progress` (por id ou título). Mostre:
   - total de conteúdos e contagem por nível (`semente`, `testado`, `consolidado`);
   - o próximo conteúdo ainda em `semente`, na ordem do corpo da trilha;
   - lacunas abertas, se `read_zettel` do Teste do tema mostrar (um zettel `teste` ligado ao conteúdo).
5. **Caminhos.** Ofereça e delegue:
   - **Continuar de onde parou** → `azm-tutor` no próximo conteúdo em `semente`.
   - **Testar o que já viu** → `azm-teste`.
   - **Revisar** → `azm-tutor`, relendo o conteúdo `testado` com perguntas de verificação.
   - **Captar algo novo** → `azm-captura`.
   - **Consolidar** → `azm-consolidar`.
6. Deixe o usuário conduzir; não fixe o diálogo. Se ele só quer o status, pare depois do passo 4.

## Regras

- Trilha sem conteúdo citado: `trail_progress` volta total 0; diga que a trilha ainda não liga nenhum conteúdo e sugira `azm-trilha`.
- Zettel sem tipo fica fora do progresso; não o conte.
- Nunca altere nível nem tipo aqui.
