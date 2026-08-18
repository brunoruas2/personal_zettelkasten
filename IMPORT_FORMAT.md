# Formato de import

Schema JSON aceito por `POST /api/import/json`. Este documento é escrito para ser lido
tanto por humanos quanto por agentes de IA encarregados de converter um cofre existente
(Obsidian, Notion, Roam, Logseq) para o Zettelkasten.

O mesmo formato é produzido por `GET /api/export/json` e por
`GET /api/backup/export?key=…`, então um export sempre pode ser reimportado.

## Envelope

```json
{
  "version": 1,
  "exported_at": "2026-08-18T14:30:22Z",
  "zettels": [ /* … */ ],
  "links": [ /* … */ ]
}
```

| Campo | Tipo | Obrigatório | Observações |
|---|---|---|---|
| `version` | inteiro | sim | Deve ser exatamente `1`. Qualquer outro valor retorna `400`. |
| `exported_at` | string RFC 3339 | não | Informativo; o servidor ignora na importação. |
| `zettels` | array | sim | As notas. Ver abaixo. |
| `links` | array | não | **Ignorado na importação.** Ver [Links](#links). |

Limite de corpo da requisição: **50 MB**. Para cofres maiores, divida em vários arquivos —
a importação é idempotente e pode ser repetida.

## Objeto `zettel`

```json
{
  "id": "20260517143022k7p2",
  "title": "Efeito Zeigarnik",
  "body": "Tarefas interrompidas são lembradas melhor.\n\nVer [[Memória de trabalho]].",
  "tags": ["psicologia", "memoria"],
  "created_at": 1779373822000,
  "updated_at": 1779373822000
}
```

| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `id` | string | não | Se ausente/vazio, o servidor gera um. Ver [IDs](#ids). |
| `title` | string | **sim** | Vazio → o zettel é rejeitado e reportado em `errors`. Também é a chave de resolução dos wiki links. |
| `body` | string | não | Markdown. `\n` para quebra de linha. Default: `""`. |
| `tags` | array de string | não | `null` vira `[]`. Use minúsculas com hífen (`gestao-do-conhecimento`). |
| `created_at` | inteiro | não | **Unix em milissegundos** (não segundos). Ausente/`0` → agora. |
| `updated_at` | inteiro | não | Unix em milissegundos. Ausente/`0` → agora. Decide conflitos. |
| `deleted_at` | inteiro \| null | não | Só aparece em exports. Não envie na importação. |

> ⚠️ `created_at` e `updated_at` são **milissegundos**. `1779373822` (segundos) seria
> interpretado como janeiro de 1970. Multiplique por 1000 ao converter de Unix em segundos.

### IDs

O app gera IDs de 18 caracteres: `yyyymmddhhmmss` + 4 alfanuméricos aleatórios —
ex. `20260517143022k7p2`. IDs legados de 14 e 12 caracteres também são aceitos: a coluna é
um `TEXT PRIMARY KEY` livre.

Ao converter de outra ferramenta, você pode:
- **omitir `id`** e deixar o servidor gerar (mais simples, mas cada reimportação cria duplicatas); ou
- **gerar IDs estáveis e determinísticos** a partir da ferramenta de origem (recomendado) —
  assim reimportar o mesmo cofre atualiza em vez de duplicar.

### Regra de conflito

Para cada zettel do payload:

| Situação | Resultado |
|---|---|
| `id` não existe para este usuário | **Inserido** → conta em `imported` |
| `id` existe e `updated_at` do payload **>** o do servidor | **Atualizado** → conta em `imported` |
| `id` existe e `updated_at` do payload **≤** o do servidor | **Ignorado** → conta em `skipped` |
| `title` vazio | Rejeitado → mensagem em `errors` |

Um zettel deletado no servidor cujo backup é mais antigo aparece em `skipped` com um aviso
em `errors`: para restaurá-lo, apague a linha definitivamente no banco ou use um backup
mais recente.

## Links

O array `links` do envelope existe apenas para fidelidade do export. **Na importação ele é
ignorado por completo**: depois de gravar os zettels, o servidor relê o `body` de cada um,
extrai os wiki links e reconstrói a tabela de links do zero.

Consequência prática: **não tente montar `links` na mão**. Basta escrever os `[[títulos]]`
corretos no `body`.

Sintaxe reconhecida no `body`:

| Escrita | Significado |
|---|---|
| `[[Efeito Zeigarnik]]` | Link para o zettel cujo título é exatamente `Efeito Zeigarnik` |
| `[[Efeito Zeigarnik\|esse efeito]]` | Mesmo link, exibido como `esse efeito` |
| `[[^Psicologia cognitiva]]` | Link do tipo `parent-ref` — marca o alvo como nota-pai no mapa |

A resolução é **por título, com correspondência exata**. Um `[[título]]` que não bate com
nenhum zettel é simplesmente descartado (sem erro). Por isso: importe tudo de uma vez, ou
importe primeiro as notas-alvo. Títulos duplicados resolvem para um dos zettels de forma
não determinística — normalize títulos antes de converter.

Formato do objeto em exports:

```json
{ "source_id": "20260517143022k7p2", "target_id": "20260518090111ab3z", "type": "parent-ref" }
```

`type` é omitido em links comuns.

## Resposta

```json
{ "imported": 412, "skipped": 3, "errors": ["\"\" : título vazio"] }
```

HTTP `200` mesmo com erros parciais — sempre confira `errors`.

## Autenticação

Rota protegida: exige o header `Authorization: Bearer <access_token>`. Pela interface,
use Configurações → Importar dados, que já cuida disso.

```bash
curl -X POST http://localhost:3000/api/import/json \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @meu-cofre.json
```

## Convertendo de outras ferramentas

### Obsidian

Um vault do Obsidian já é quase compatível: os `[[wiki links]]` têm a mesma sintaxe.

- **Título** = nome do arquivo sem `.md`. O Obsidian resolve links por nome de arquivo, e o
  Zettelkasten resolve por título — mantendo essa igualdade, todos os links continuam válidos.
- **Body** = conteúdo do arquivo, **sem** o frontmatter YAML.
- **Tags** = as do frontmatter (`tags:`) somadas às inline (`#tag`), em minúsculas e com
  hífen no lugar de espaço.
- **Timestamps** = `mtime`/`ctime` do arquivo × 1000.
- Links de heading e de bloco (`[[Nota#Seção]]`, `[[Nota^bloco]]`) **não** são suportados —
  reduza para `[[Nota]]`. Atenção: `[[^Nota]]` (circunflexo no início) tem outro significado
  aqui, é o link de nota-pai.
- Embeds (`![[Nota]]`) não são suportados; converta para link normal ou inline o conteúdo.
- Anexos binários (imagens em `attachments/`) não são importados — hospede-os em outro lugar
  e use `![alt](https://url)`.

### Notion

- Exporte como **Markdown & CSV**.
- **Título** = título da página. Remova o sufixo hash que o Notion acrescenta ao nome do
  arquivo (`Minha Nota a1b2c3d4….md` → `Minha Nota`).
- Links entre páginas viram `[Título](Titulo%20a1b2c3.md)` — converta para `[[Título]]`.
- Propriedades de database viram tags, quando fizer sentido; as demais podem ir para uma
  tabela markdown no topo do `body`.
- Páginas aninhadas: use `[[^Página Pai]]` no filho para preservar a hierarquia no mapa.

### Roam / Logseq

- Cada **página** vira um zettel. Blocos viram lista aninhada no `body`.
- `[[links]]` já são compatíveis. `#tags` viram entradas em `tags`.
- Referências de bloco (`((uuid))`) não têm equivalente — resolva para o texto do bloco.
- Daily notes viram zettels comuns; o título `August 18th, 2026` costuma ficar melhor
  normalizado como `2026-08-18`.

### Markdown avulso

O `body` aceita as extensões renderizadas pelo app: blocos de código com destaque de
sintaxe, tabelas, listas de tarefas (`- [ ]`), e as cercas especiais ` ```plantuml `,
` ```chords ` e ` ```abc `. Escreva-as direto no `body`.

## Exportando

| Rota | Saída |
|---|---|
| `GET /api/export/json` | Este mesmo envelope. Reimportável. |
| `GET /api/export/markdown` | `.zip` com um `.md` por zettel (frontmatter `id`/`tags`/`created_at`/`updated_at`) + `index.json` com os links. |
| `GET /api/backup/export?key=<64-hex>` | Igual ao JSON, autenticado por chave em vez de JWT — para cron. |
