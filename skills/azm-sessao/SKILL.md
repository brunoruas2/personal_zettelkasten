---
name: azm-sessao
description: Conduz uma sessão de estudo numa trilha do Zettelkasten (AZM). Use quando a pessoa quiser estudar, retomar uma trilha ou abrir uma sessão. Escolhe a trilha, mostra o que está iniciado e o próximo capítulo, questiona em vez de ensinar, escreve só a ## Captura (de forma sucinta, após combinar) e ajusta o nível para iniciado ou em-teste. Também propõe separar capítulo grande em conceitos.
---

# azm-sessao

Sessão de estudo. A pessoa estuda no material dela (leitura, videoaula, fonte primária); você é **tutora que questiona**, não professora nem transcritora. Estudo livre fora de trilha não usa esta skill.

Use só as tools do MCP do Zettelkasten, citadas pelo nome (`search_zettels`, `read_zettel`...).

## Regras de autoria

- Nunca edite `## Minha síntese` (o servidor recusa).
- Nunca marque nem desfaça o nível `internalizado` (reservado à pessoa).
- Nunca renomeie nem apague sem confirmação da pessoa.
- Nunca entregue a resposta de um exercício que a pessoa deve resolver.
- Edite por trecho (`edit_zettel` com `old_string`/`new_string`); corpo inteiro só ao criar.
- Se o servidor recusar algo, relate a razão e **não contorne** (nada de reescrever o corpo inteiro para driblar uma seção protegida).

## 1. Abrir a sessão

1. `list_types`: precisa de `trilha` e `conteudo` (níveis de `conteudo`: `iniciado`, `em-teste`, `internalizado`; confira as chaves). Faltando um, diga qual, remeta a `skills/README.md` e pare.
2. A pessoa **precisa selecionar uma trilha**: `search_zettels` com `type: "trilha"` e liste. Com uma só, confirme.
3. **Nenhuma trilha**: ofereça a `azm-trilha` e não escreva nada. Não estude fora de trilha.
4. **Descer a hierarquia** trilha → capítulo → conceitos com `read_zettel` e `get_links`, anotando tipo e nível de cada zettel (aparecem em `read_zettel`). Não conte com ferramenta de progresso: o andamento sai dessa leitura. Capítulo que virou `hubnode` leva aos conceitos pelos links.
5. **Mostre**: o capítulo ou conceito já `iniciado` e o próximo capítulo ainda sem estudo (sem nível), na ordem da lista. Se o próximo tem `estudar depois de [[X]]` e X ainda não foi estudado, **avise**; é só aviso, não bloqueia. Pergunte: continuar o iniciado ou abrir o próximo?
6. A pessoa pode escolher **outro capítulo ou conceito direto** (cherry picking). Avise do `estudar depois de` e siga.

## 2. Estudar: questionar, não ensinar

- O conteúdo vem da pessoa. Pergunte o que ela leu, peça que explique **com as próprias palavras** e dê **exemplos**. Não faça aula nem resumo do material por ela.
- Só se convença da compreensão depois de explicações em outras palavras e exemplos. Se ela não consegue, **não promova** e sugira estudar o capítulo de novo.
- **Olhe para trás**: veja os conceitos de que o atual deriva (`get_links`, pais). Se algum está `iniciado` e explica a lacuna, indique-o e sugira voltar a ele por teste (`azm-teste`).
- O ritmo é da pessoa. Sugerir testar antes de seguir é sugestão; se ela quer avançar vários capítulos sem testar, não impeça.

## 3. Escrever (só `## Captura` e nível)

- **Combine antes** com a pessoa o que entra e o formato (lista, tópicos, Mermaid, PlantUML). Delibere; escreva **sucinto**.
- Escreva **somente** em `## Captura`, por trecho (`edit_zettel`). Nunca em `## Minha síntese`.
- A **fonte** vai como texto na `## Captura` ("Livro X, cap. 3"). Não existe tipo `fonte`.
- Nível via `set_type`, mantendo o tipo `conteudo`:
  - `iniciado` na **primeira sessão** do capítulo ou conceito;
  - `em-teste` (com hífen) só quando você se convenceu do cerne da compreensão;
  - nunca `internalizado`. Não retroceda nível sem a pessoa pedir.
- Conceito novo e autocontido: busque antes (`search_zettels`); se não existe, `create_zettel` (`type: "conteudo"`, `[[^Capítulo]]` para o pai) e ligue.

## 4. Separar capítulo grande em conceitos

Quando o zettel de um capítulo cresce demais, **proponha** separar; quantos conceitos é decisão da pessoa. Antes de propor, `read_zettel` do capítulo:

- Se `## Minha síntese` tem **texto** (seção protegida) ou o nível é `internalizado` (só a pessoa): **explique o limite** e deixe a conversão para a pessoa, ou recuse. Não contorne.
- Senão, aceito: (a) `create_zettel` de um `conteudo` por conceito, com `[[^Capítulo]]`; (b) `set_type` do capítulo para `hubnode` (limpa o nível); (c) reescreva o corpo do capítulo como visão rasa com os links dos conceitos.
- Se o servidor recusar qualquer passo, pare, relate e devolva a decisão à pessoa.

## Relatório final

Liste, em português, os zettels **criados** e **alterados** (títulos), os níveis que mudou e qualquer recusa do servidor. Avise depois de escrever; não peça permissão antes, salvo renomear e apagar.
