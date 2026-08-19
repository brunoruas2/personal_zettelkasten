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
- Anexos binários (imagens em `attachments/`) não entram pelo import JSON. Para trazê-los,
  monte um pacote `.zip` (veja [Imagens](#imagens)) ou cole as imagens no editor depois de
  importar o texto. Imagens já hospedadas fora continuam funcionando com `![alt](https://url)`.

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

## Imagens

Imagens são referenciadas no `body` pelo scheme local:

```markdown
![legenda opcional](zk:img/0123456789abcdef0123456789abcdef)
```

O id são **32 caracteres hexadecimais** — o `sha256` do conteúdo comprimido, truncado.
Isso é o que dá deduplicação e cache imutável de graça. Os bytes ficam num BLOB no SQLite
do servidor e no IndexedDB do navegador; nunca no `body`.

Toda imagem é comprimida no cliente antes de qualquer envio: lado maior no máximo
**1200 px**, convertida para **WebP**, com a qualidade reduzida em degraus até caber em
**120 KB**. SVG passa sem rasterizar. GIF animado não é aceito (a conversão achataria a
animação no primeiro frame).

### ⚠️ O export JSON não contém as imagens

O envelope JSON ganha um array `images`, mas ele carrega **apenas metadados** — nunca os
bytes:

```json
{
  "images": [
    { "id": "0123456789abcdef0123456789abcdef", "mime": "image/webp",
      "width": 1200, "height": 900, "byte_len": 98304, "created_at": 1755500000000 }
  ]
}
```

O motivo é aritmética, não preguiça. Base64 infla 33%. Com o teto de 120 KB por imagem,
mil imagens dariam cerca de **160 MB** de JSON — acima do limite de 50 MB do import, acima
do heap de 384 MB usado no build, e acima do que a RAM do VPS aguenta serializar de uma vez.

**Para backup completo, use o ZIP.**

### Formato do pacote ZIP

```
zettelkasten-backup-2026-08-19.zip
├── zettels.json        ← o mesmo envelope descrito acima
└── images/
    ├── 0123456789abcdef0123456789abcdef.webp
    └── fedcba9876543210fedcba9876543210.png
```

O nome de cada arquivo é o id da imagem mais a extensão do seu tipo. No import, o id é lido
do nome do arquivo — renomear quebra as referências do `body`.

Tanto o export quanto o import do ZIP trabalham com memória constante: o export escreve
direto na resposta lendo um blob por vez, e o import grava o upload num arquivo temporário
antes de ler.

### Ciclo de vida

Uma imagem que deixa de ser referenciada por **qualquer** zettel do usuário não é apagada na
hora: ela é marcada como órfã e só é removida de fato depois de **30 dias**. Se voltar a ser
referenciada nesse período — um desfazer, ou um aparelho que passou semanas offline e só
agora sincronizou o zettel que a cita — a marca é removida e nada se perde.

O expurgo libera páginas dentro do arquivo `.db`, mas **não encolhe o arquivo**. Para
devolver o espaço ao disco é preciso rodar `VACUUM` manualmente:

```bash
sqlite3 zettelkasten.db "VACUUM;"
```

## Exportando

| Rota | Saída |
|---|---|
| `GET /api/export/zip` | **Backup completo.** `zettels.json` + `images/`. Streamado. |
| `GET /api/export/json` | Este mesmo envelope, **sem os bytes das imagens**. Reimportável. |
| `GET /api/export/markdown` | `.zip` com um `.md` por zettel (frontmatter `id`/`tags`/`created_at`/`updated_at`) + `index.json` com os links + `images/`. As referências `zk:img/` são reescritas para caminhos relativos, então abre direto no Obsidian. |
| `GET /api/backup/export?key=<64-hex>` | Autenticado por chave em vez de JWT — para cron. Aceita `&format=zip` para o backup completo. |

## Importando

| Rota | Entrada |
|---|---|
| `POST /api/import/json` | O envelope JSON. Até 50 MB. |
| `POST /api/import/zip` | O pacote ZIP com texto e imagens. Até 500 MB. |

> Em produção atrás do Nginx, confira que o `location /api/` tem `client_max_body_size`
> configurado — o default de 1 MB corta o upload antes de ele chegar na API.
