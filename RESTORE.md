# Restaurar a partir do snapshot `.db`

O snapshot SQLite (Configurações → Exportar dados → **Baixar banco (.db)**, ou
`ZETTEL_BACKUP_FORMAT=sqlite` no `scripts/backup.py`) é o próprio banco da API
com só os seus dados: zettels (inclusive os apagados), links, índice de busca,
imagens, desenhos, posições na galáxia e configurações. A API abre o arquivo
como está — não há import.

Fica de fora: sessões, passkeys (presas ao domínio de produção), chave de API,
chave de backup, convites e os dados de outros usuários.

> O arquivo contém o hash bcrypt da sua senha e todo o conteúdo em claro.
> Guarde-o como guardaria o backup `.zip`.

## Rodar localmente (servidor fora do ar)

Pré-requisitos: Node 20+, pnpm, Go 1.26.2+ e este repositório clonado.

1. **API** — aponte `DB_PATH` para o snapshot (de preferência uma cópia: a API
   passa a escrever nele):

   ```bash
   cd apps/api
   cp ~/backups/zettelkasten-bruno-20261025.db ./restaurado.db
   DB_PATH=./restaurado.db JWT_SECRET=$(openssl rand -hex 32) go run ./main.go
   ```

   No PowerShell: `$env:DB_PATH="./restaurado.db"; $env:JWT_SECRET="qualquer-coisa-longa"; go run ./main.go`.
   Os demais valores padrão (`PORT=3001`, `ALLOWED_ORIGIN=http://localhost:3000`,
   WebAuthn em `localhost`) já servem para uso local.

2. **Web** — em outro terminal, na raiz do repositório:

   ```bash
   pnpm install
   echo "API_URL=http://localhost:3001" > apps/web/.env.local
   pnpm --filter @zettelkasten/web dev
   ```

3. Abra `http://localhost:3000` e entre com **o mesmo usuário e a mesma senha**.
   O navegador baixa o índice, os corpos e as posições como num aparelho novo.

Passkeys não funcionam aqui (estão presas ao domínio antigo); cadastre uma nova
se quiser. A chave de backup e a de API precisam ser geradas de novo.

## Só ler, sem subir nada

O `.db` abre em qualquer cliente SQLite (`sqlite3`, DB Browser for SQLite):

```sql
SELECT title, body FROM zettels WHERE deleted_at IS NULL ORDER BY updated_at DESC;
SELECT z.title FROM zettels_fts f JOIN zettels z ON z.rowid = f.rowid WHERE zettels_fts MATCH 'termo';
```

Imagens ficam em `images.data` (BLOB, `mime` ao lado); desenhos em
`drawings.svg` (preview) e `drawings.scene` (traços).

## Colocar num servidor novo

1. Instale o servidor normalmente (ver `README.md` / `deploy.sh`).
2. Com a API parada, copie o snapshot para o caminho de `DB_PATH` do `.env`.
3. Suba a API. Todos os aparelhos precisam entrar de novo (o `JWT_SECRET` e as
   sessões são outros); o conteúdo local deles continua e sincroniza pelo
   `updated_at`.

O snapshot é de **um** usuário. Para reunir vários num mesmo servidor, suba um
servidor com um deles e importe os outros pelo backup `.zip` de cada um
(Configurações → Importar).
