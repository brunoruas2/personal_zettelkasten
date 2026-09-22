import type { Metadata } from 'next';
import { Public_Sans, IBM_Plex_Mono } from 'next/font/google';
import styles from './page.module.css';
import { CopyButton } from './CopyButton';

const publicSans = Public_Sans({ subsets: ['latin'], variable: '--font-public-sans', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Skill Zettelkasten — instruções para agentes',
  description:
    'Instruções completas para um agente de código (Claude Code, GitHub Copilot CLI, etc.) construir uma skill que lê e escreve na base de conhecimento zettelkasten via API.',
};

const SKILL_TEMPLATE = `---
name: zettelkasten
description: Consulta e escreve na base de conhecimento pessoal (zettelkasten) do usuário via API HTTP. Use quando o usuário pedir para buscar/lembrar algo que já escreveu, salvar um insight como nota permanente, ou atualizar uma nota existente.
---

# Skill: Zettelkasten

Acesso à base de zettels pessoal do usuário via API HTTP autenticada por chave.

## Configuração

Requer \`ZETTEL_API_URL\` e \`ZETTEL_API_KEY\` no ambiente. Se ausentes, peça ao
usuário antes de continuar — não prossiga sem os dois.

## Quando usar

- Contexto da conversa toca algo que o usuário provavelmente já anotou → busque
  primeiro com \`GET /api/zettels?q=...\` antes de responder do zero.
- Usuário pede explicitamente para salvar algo ("anota isso", "salva como
  zettel") → busque duplicatas, depois \`POST /api/zettels\`.
- Usuário pede para atualizar/expandir uma nota já identificada → \`GET\` o
  zettel inteiro, edite em memória, \`PUT\` o zettel inteiro de volta.

## Quando NÃO usar

- Não crie zettels sem pedido explícito.
- Não tente DELETE, backlinks, rebuild-links, images, settings ou admin —
  fora do escopo da chave, sempre falha.
- Não faça PUT parcial — sempre reenvie title/body/tags inteiros.

## Referência rápida

| Rota                    | Método | Uso                          |
|--------------------------|--------|-------------------------------|
| \`/api/zettels?q=termo\`   | GET    | Buscar (full-text)             |
| \`/api/zettels/{id}\`      | GET    | Ler um zettel                  |
| \`/api/zettels\`           | POST   | Criar (title obrigatório)      |
| \`/api/zettels/{id}\`      | PUT    | Substituir title/body/tags     |

Auth: \`X-API-Key: $ZETTEL_API_KEY\` em todas as chamadas.

## Convenções

- Wiki links: \`[[Título exato]]\`. Tags: kebab-case minúsculo. Corpo: markdown puro.
- Busque antes de criar — evite duplicar notas.
- Uma nota, um tema — prefira atômico a genérico.`;

export default function AgentSkillPage() {
  return (
    <div className={`${styles.page} ${publicSans.variable} ${plexMono.variable}`} style={{ fontFamily: 'var(--font-public-sans)' }}>
      <div className={styles.shell}>
        <nav className={styles.toc}>
          <div className={styles.tocKicker}>Nesta página</div>
          <div className={styles.tocGrid}>
            <a href="#overview">Visão geral</a>
            <a href="#auth">Autenticação</a>
            <a href="#api">Referência da API</a>
            <a href="#conventions">Convenções</a>
            <a href="#rules">Comportamento</a>
            <a href="#security">Segurança</a>
            <a href="#build">Construir a skill</a>
            <a href="#template">Template SKILL.md</a>
          </div>
        </nav>

        <main className={styles.main}>
          <header className={styles.hero}>
            <div className={styles.eyebrow}>◆ Blueprint de skill de agente</div>
            <h1>Skill Zettelkasten — instruções completas</h1>
            <p className={styles.lede}>
              Página autossuficiente para um agente (Claude Code, GitHub Copilot CLI, ou similar) construir, em qualquer
              repositório, uma skill que lê e escreve na base de conhecimento pessoal do usuário via API HTTP.
            </p>
            <div className={styles.calloutRow}>
              <span className={`${styles.pill} ${styles.pillOn}`}>Consumida por um agente, não por humano</span>
              <span className={styles.pill}>
                API: chave <code>zk_…</code>
              </span>
              <span className={styles.pill}>Escopo: listar · ler · criar · editar</span>
            </div>
          </header>

          <section className={styles.section} id="overview">
            <h2>
              <span className={styles.num}>01</span> Visão geral
            </h2>
            <p className={styles.sectionLede}>
              A skill dá a qualquer agente de código acesso orgânico à base de zettels do usuário — não um CRUD genérico,
              mas um comportamento: consultar antes de assumir, evitar duplicar notas, e escrever no mesmo estilo que já
              existe na base.
            </p>
            <div className={styles.card}>
              <p style={{ margin: '0 0 10px' }}>
                <b>O que a skill deve fazer:</b>
              </p>
              <ul className={styles.rules}>
                <li>
                  <b>Consultar</b> a base quando o contexto da conversa tocar em algo que o usuário provavelmente já
                  escreveu sobre — antes de responder do zero.
                </li>
                <li>
                  <b>Capturar</b> insights, decisões ou trechos que valem virar nota permanente, quando o usuário pedir
                  explicitamente (&quot;salva isso&quot;, &quot;anota como zettel&quot;) — nunca criar zettels sem pedido.
                </li>
                <li>
                  <b>Editar</b> um zettel existente quando o usuário pedir para atualizar, expandir ou corrigir uma nota já
                  identificada.
                </li>
                <li>
                  <b>Nunca apagar, nunca tentar rotas fora do escopo</b> — ver <a href="#api">referência da API</a>.
                </li>
              </ul>
            </div>
          </section>

          <section className={styles.section} id="auth">
            <h2>
              <span className={styles.num}>02</span> Autenticação e configuração
            </h2>
            <p className={styles.sectionLede}>
              A API usa uma chave pessoal (<code>zk_</code> + 64 hex), gerada em <b>Settings → Chave de API</b> no app web
              do usuário. A skill nunca gera ou vê essa chave sozinha — ela é fornecida uma vez pelo usuário e guardada
              fora do repositório de código.
            </p>
            <div className={styles.tblWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Variável</th>
                    <th>Obrigatória</th>
                    <th>Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>ZETTEL_API_URL</code>
                    </td>
                    <td>Sim</td>
                    <td>
                      Base da API. Produção: <code>https://personal-zettel.app.br</code>. Sem barra final.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>ZETTEL_API_KEY</code>
                    </td>
                    <td>Sim</td>
                    <td>
                      A chave <code>zk_…</code> do usuário. Nunca hardcode, nunca logue o valor completo.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 12 }}>Header de autenticação — qualquer um dos dois funciona, escolha um e seja consistente:</p>
            <pre className={styles.code}>
              <span className={styles.c}># opção A</span>
              {'\n'}Authorization: Bearer <span className={styles.k}>$ZETTEL_API_KEY</span>
              {'\n\n'}
              <span className={styles.c}># opção B</span>
              {'\n'}X-API-Key: <span className={styles.k}>$ZETTEL_API_KEY</span>
            </pre>
            <div className={`${styles.note} ${styles.noteDanger}`}>
              <span className={styles.noteIcon}>✕</span>
              <p className={styles.noteBody}>
                A chave nunca vai em query string (<code>?key=</code>) nas rotas de zettel — o servidor rejeita com 401 de
                propósito, isso não é bug a contornar.
              </p>
            </div>
          </section>

          <section className={styles.section} id="api">
            <h2>
              <span className={styles.num}>03</span> Referência da API
            </h2>
            <p className={styles.sectionLede}>
              Superfície completa permitida para chave de API. Qualquer rota fora desta tabela responde 401/403 — a skill
              não deve tentar.
            </p>

            <div className={styles.tblWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Rota</th>
                    <th>Uso</th>
                    <th>Sucesso</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeGet}`}>GET</span> <code>/api/zettels</code>
                    </td>
                    <td>
                      Listar todos, ou buscar com <code>?q=termo</code> (full-text: título + corpo + tags)
                    </td>
                    <td>200 → array de zettels</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeGet}`}>GET</span> <code>/api/zettels/{'{id}'}</code>
                    </td>
                    <td>Ler um zettel específico</td>
                    <td>200 → zettel · 404 se não existir</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={`${styles.badge} ${styles.badgePost}`}>POST</span> <code>/api/zettels</code>
                    </td>
                    <td>Criar zettel novo</td>
                    <td>201 → zettel criado</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={`${styles.badge} ${styles.badgePut}`}>PUT</span> <code>/api/zettels/{'{id}'}</code>
                    </td>
                    <td>Substituir título/corpo/tags de um zettel existente</td>
                    <td>200 → zettel atualizado · 404 se não existir</td>
                  </tr>
                  <tr>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeNo}`}>✕</span> tudo o resto
                    </td>
                    <td>
                      <code>DELETE</code>, backlinks, rebuild-links, images, settings, admin, export/import…
                    </td>
                    <td>401 ou 403 — fora do escopo da chave</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>Formato do zettel</h3>
            <pre className={styles.code}>
              <span className={styles.c}>{'// campos de um zettel, como a API devolve'}</span>
              {'\n{'}
              {'\n  '}
              <span className={styles.s}>&quot;id&quot;</span>: <span className={styles.s}>&quot;20260922143022k7p2&quot;</span>,
              <span className={styles.c}>{'   // string opaca, TEXT PK — ver convenções'}</span>
              {'\n  '}
              <span className={styles.s}>&quot;title&quot;</span>: <span className={styles.s}>&quot;Título da nota&quot;</span>,
              {'\n  '}
              <span className={styles.s}>&quot;body&quot;</span>:{' '}
              <span className={styles.s}>&quot;Corpo em markdown, com [[wiki links]] se quiser&quot;</span>,{'\n  '}
              <span className={styles.s}>&quot;tags&quot;</span>: [<span className={styles.s}>&quot;agentes&quot;</span>,{' '}
              <span className={styles.s}>&quot;api&quot;</span>], <span className={styles.c}>{'// kebab-case, sempre array'}</span>
              {'\n  '}
              <span className={styles.s}>&quot;created_at&quot;</span>: 1758543022000,{' '}
              <span className={styles.c}>{'// epoch ms'}</span>
              {'\n  '}
              <span className={styles.s}>&quot;updated_at&quot;</span>: 1758543022000{'\n}'}
            </pre>

            <h3>Buscar antes de criar</h3>
            <pre className={styles.code}>
              curl -sS &quot;$ZETTEL_API_URL/api/zettels?q=agentes+de+codigo&quot; \{'\n'}
              {'  '}-H &quot;X-API-Key: $ZETTEL_API_KEY&quot;
            </pre>

            <h3>Criar</h3>
            <pre className={styles.code}>
              curl -sS -X POST &quot;$ZETTEL_API_URL/api/zettels&quot; \{'\n'}
              {'  '}-H &quot;X-API-Key: $ZETTEL_API_KEY&quot; \{'\n'}
              {'  '}-H &quot;Content-Type: application/json&quot; \{'\n'}
              {'  '}-d &apos;{'{'}&quot;title&quot;: &quot;Título da nota&quot;, &quot;body&quot;: &quot;Corpo em markdown.&quot;, &quot;tags&quot;: [&quot;tag-um&quot;]{'}'}&apos;
              {'\n'}
              <span className={styles.c}>
                {'\n# title é o único campo obrigatório. id/created_at/updated_at ficam'}
                {'\n# a cargo do servidor se omitidos — não precisa gerar id manualmente.'}
              </span>
            </pre>

            <h3>
              Editar — <span style={{ color: 'var(--danger)' }}>substituição total, não patch</span>
            </h3>
            <pre className={styles.code}>
              <span className={styles.c}># 1. leia o zettel inteiro primeiro</span>
              {'\n'}curl -sS &quot;$ZETTEL_API_URL/api/zettels/$ID&quot; -H &quot;X-API-Key: $ZETTEL_API_KEY&quot;
              {'\n\n'}
              <span className={styles.c}>
                {'# 2. reenvie TODOS os campos — title/body/tags que você omitir'}
                {'\n# são gravados como vazios, o PUT não faz merge'}
              </span>
              {'\n'}curl -sS -X PUT &quot;$ZETTEL_API_URL/api/zettels/$ID&quot; \{'\n'}
              {'  '}-H &quot;X-API-Key: $ZETTEL_API_KEY&quot; \{'\n'}
              {'  '}-H &quot;Content-Type: application/json&quot; \{'\n'}
              {'  '}-d &apos;{'{'}&quot;title&quot;: &quot;Título (igual ou atualizado)&quot;, &quot;body&quot;: &quot;Corpo inteiro&quot;, &quot;tags&quot;: [&quot;tags&quot;]{'}'}&apos;
            </pre>
            <div className={`${styles.note} ${styles.noteDanger}`}>
              <span className={styles.noteIcon}>✕</span>
              <p className={styles.noteBody}>
                <b>
                  Nunca faça <code>PUT</code> só com o campo que mudou.
                </b>{' '}
                O handler não faz merge — <code>title</code> ou <code>tags</code> ausentes no corpo da requisição são
                gravados como string vazia / array vazio, apagando o que já existia. Sempre <code>GET</code> → editar em
                memória → <code>PUT</code> do zettel inteiro.
              </p>
            </div>
          </section>

          <section className={styles.section} id="conventions">
            <h2>
              <span className={styles.num}>04</span> Convenções da base
            </h2>
            <p className={styles.sectionLede}>
              Para o conteúdo criado/editado pelo agente ficar indistinguível do que o usuário escreve à mão no app.
            </p>
            <div className={styles.tblWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Convenção</th>
                    <th>Regra</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Wiki links</td>
                    <td>
                      <code>[[Título exato de outro zettel]]</code> — resolvido por título, não por id. Título tem que
                      bater exatamente com um zettel existente para o link resolver.
                    </td>
                  </tr>
                  <tr>
                    <td>Tags</td>
                    <td>
                      kebab-case, minúsculas (<code>revisao-espacada</code>, não <code>Revisão Espaçada</code>).
                    </td>
                  </tr>
                  <tr>
                    <td>Corpo</td>
                    <td>Markdown puro — títulos, listas, blocos de código, sem HTML.</td>
                  </tr>
                  <tr>
                    <td>Idioma</td>
                    <td>Espelhe o idioma predominante da base do usuário (verifique em zettels existentes antes de assumir).</td>
                  </tr>
                  <tr>
                    <td>IDs</td>
                    <td>Deixe o servidor gerar ao criar. Nunca reaproveite um id de outro zettel.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section} id="rules">
            <h2>
              <span className={styles.num}>05</span> Regras de comportamento do agente
            </h2>
            <p className={styles.sectionLede}>
              O contrato de API é mecânico; isto é o que faz a integração parecer orgânica em vez de um bot de CRUD.
            </p>
            <ul className={styles.rules}>
              <li>
                <b>Busque antes de criar.</b> Sempre <code>GET /api/zettels?q=…</code> com os termos-chave antes de propor
                um zettel novo — se já existe nota próxima, ofereça editar/expandir em vez de duplicar.
              </li>
              <li>
                <b>Nunca crie sem pedido explícito.</b> &quot;Isso parece que vale uma nota&quot; é uma sugestão para o
                usuário decidir, não gatilho automático.
              </li>
              <li>
                <b>Confirme antes de editar</b> um zettel que já tem conteúdo substancial — mostre o diff pretendido (o
                que entra, o que sai) antes do <code>PUT</code>.
              </li>
              <li>
                <b>Nunca tente rotas fora do escopo</b> (backlinks, delete, rebuild-links, images, settings) — a skill não
                deve nem oferecer essas ações, já que sempre falham por design.
              </li>
              <li>
                <b>Trate 403 como escopo, não como bug.</b> Se alguma chamada retornar 403, informe o usuário e não insista.
              </li>
              <li>
                <b>Uma nota, um tema.</b> Siga o espírito zettelkasten: prefira várias notas atômicas linkadas a uma nota
                longa e genérica.
              </li>
            </ul>
          </section>

          <section className={styles.section} id="security">
            <h2>
              <span className={styles.num}>06</span> Segurança da chave
            </h2>
            <ul className={styles.rules}>
              <li>
                <b>Nunca commite</b> a chave em nenhum arquivo versionado — nem em exemplos, nem em histórico de commit.
              </li>
              <li>
                <b>Guarde fora do repositório</b> onde a skill roda: variável de ambiente do shell (perfil do usuário) ou
                um arquivo de config no home do usuário (ex. <code>~/.config/zettelkasten/env</code>), nunca dentro de um
                projeto específico — a base é pessoal, não do repositório.
              </li>
              <li>
                <b>Nunca logue o valor completo</b> — se precisar confirmar que a chave está configurada, mostre só os 4
                últimos caracteres.
              </li>
              <li>
                <b>Revogação é o mecanismo de contenção.</b> Se a chave vazar, o usuário revoga em Settings → Chave de API
                (gera uma nova, invalida a antiga) — a skill não tem como mitigar isso sozinha, só evitar o vazamento.
              </li>
            </ul>
          </section>

          <section className={styles.section} id="build">
            <h2>
              <span className={styles.num}>07</span> Construir a skill — passo a passo
            </h2>
            <ol className={styles.steps}>
              <li>
                <b>Confirme as credenciais.</b> Pergunte ao usuário por <code>ZETTEL_API_URL</code> e{' '}
                <code>ZETTEL_API_KEY</code> se não estiverem já no ambiente. Não prossiga sem os dois.
              </li>
              <li>
                <b>Valide a chave.</b> Faça um <code>GET /api/zettels</code> simples pra confirmar que a chave funciona
                antes de escrever qualquer arquivo de skill.
              </li>
              <li>
                <b>Escolha o local da skill.</b> Instale como skill <i>global</i> do usuário (ex.{' '}
                <code>~/.claude/skills/zettelkasten/</code> no Claude Code), não dentro de um repositório específico — a
                base de conhecimento é pessoal e deve estar disponível em qualquer projeto.
              </li>
              <li>
                <b>Escreva o arquivo de skill</b> usando o template da próxima seção como ponto de partida, adaptando ao
                formato do agente (frontmatter <code>SKILL.md</code> para Claude Code; instruções/prompt equivalentes para
                Copilot CLI ou outro).
              </li>
              <li>
                <b>Valide com um caso real</b> — peça para o usuário testar &quot;procura nas minhas notas sobre X&quot; e
                confirme que a skill busca antes de responder, e não cria nada sem ser pedido.
              </li>
            </ol>
          </section>

          <section className={styles.section} id="template">
            <h2>
              <span className={styles.num}>08</span> Template — <code>SKILL.md</code>
            </h2>
            <p className={styles.sectionLede}>
              Ponto de partida para Claude Code. Adapte a seção de instruções para outro agente sem frontmatter
              equivalente — o conteúdo do contrato (auth, endpoints, regras) é o mesmo.
            </p>
            <div className={styles.codeLabel}>
              <span>skills/zettelkasten/SKILL.md</span>
              <CopyButton targetId="skill-template" />
            </div>
            <pre className={styles.code} id="skill-template">
              {SKILL_TEMPLATE}
            </pre>
          </section>

          <footer className={styles.footer}>
            Escrito para ser lido por um agente de código, não por navegação humana casual. Todo o contrato acima reflete
            o comportamento real de <code>apps/api/internal/zettel/handler.go</code> e{' '}
            <code>apps/api/internal/auth/middleware.go</code> no momento da publicação — se o backend mudar, esta página
            precisa ser atualizada junto.
          </footer>
        </main>
      </div>
    </div>
  );
}
