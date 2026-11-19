---
name: azm-consolidar
description: Lembra o usuário de quais conteúdos estão prontos para a síntese própria (AZM). Use quando ele perguntar o que consolidar, o que está pronto, ou ao fechar um tema testado. Lista conteúdos em "testado" com lacunas fechadas e sugere o formato da síntese. Nunca escreve a síntese nem muda nível.
---

# azm-consolidar

Só lembra. **Não escreve na base**, não toca em `## Minha síntese`, não muda nível. A síntese é do usuário; consolidar é o ato dele.

Use só as tools do MCP do Zettelkasten.

## Passos

1. `list_types` e ache os tipos com `counts_progress` (em geral `conteudo`). Sem eles, diga qual tipo cadastrar (`skills/README.md`) e pare.
2. `search_zettels` com `type` do conteúdo e `level: "testado"`, texto vazio.
3. Para cada um, veja se as lacunas estão fechadas: `read_zettel`, siga o link em `## Testes` até o zettel `teste` e leia a **última sessão**. Pronto = nenhuma lacuna aberta nela.
4. **Há prontos:** liste os títulos e lembre que estão prontos para a síntese. Sugira o formato: lista de tópicos ou mapa mental, no `## Minha síntese`, nas palavras dele.
5. **Nada pronto:** diga que nada está pronto e sugira voltar ao conteúdo (`azm-tutor`) ou testar de novo (`azm-teste`).

## Se o usuário pedir "escreve a síntese pra mim"

Recuse: a síntese é dele e o servidor também recusa edição do agente nessa seção. Ofereça só **perguntas guia**, por exemplo: "qual é a ideia central em uma frase?", "o que isto muda no que você já sabia?", "com que outro conceito isto se liga?".

## Regras

- Nunca sugira marcar `consolidado` como ação sua: informe só que o conteúdo está pronto; quem marca é o usuário.
- Sem cobrança: só roda quando o usuário abre a sessão ou pergunta.
