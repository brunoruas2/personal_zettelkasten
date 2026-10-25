package portability

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/db"
)

// snapshotTable descreve uma tabela copiada para o snapshot e o filtro que a
// restringe ao usuário. Toda cláusula recebe o userID como único parâmetro.
type snapshotTable struct {
	name  string
	where string
}

// snapshotTables lista, em ordem de inserção, as tabelas que entram no
// snapshot. users vem primeiro por causa das FKs. links e image_refs não têm
// user_id: pertencem ao usuário pelo zettel de origem. zettels_fts não está
// aqui — os triggers zettels_ai o populam ao inserir os zettels.
// Ficam de fora de propósito: refresh_tokens, webauthn_credentials (presas ao
// domínio de produção), api_keys, backup_keys e invites.
var snapshotTables = []snapshotTable{
	{"users", "id = ?"},
	{"zettels", "user_id = ?"},
	{"links", "source_id IN (SELECT id FROM src.zettels WHERE user_id = ?)"},
	{"images", "user_id = ?"},
	{"image_refs", "zettel_id IN (SELECT id FROM src.zettels WHERE user_id = ?)"},
	{"drawings", "user_id = ?"},
	{"drawing_refs", "user_id = ?"},
	{"positions", "user_id = ?"},
}

// WriteUserSnapshot grava em dst um banco SQLite com o schema que a API cria
// (db.Open → migrate + evolve) contendo só as linhas de userID, lidas do banco
// vivo em liveDBPath. Devolve o username do dono.
//
// O banco vivo é anexado só para leitura e toda a cópia roda numa transação:
// com WAL, a leitura vê um único ponto no tempo sem bloquear escritores. Não
// se usa VACUUM INTO porque ele copiaria os dados de todos os usuários.
func WriteUserSnapshot(ctx context.Context, liveDBPath, userID, dst string) (string, error) {
	snap, err := db.Open(dst)
	if err != nil {
		return "", fmt.Errorf("create snapshot: %w", err)
	}
	defer snap.Close()
	// ATTACH é por conexão: tudo precisa passar pela mesma.
	snap.SetMaxOpenConns(1)
	conn, err := snap.Conn(ctx)
	if err != nil {
		return "", err
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, `ATTACH DATABASE ? AS src`, readOnlyURI(liveDBPath)); err != nil {
		return "", fmt.Errorf("attach live db: %w", err)
	}

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	for _, t := range snapshotTables {
		if err := copyTable(ctx, tx, t, userID); err != nil {
			tx.Rollback()
			return "", fmt.Errorf("copy %s: %w", t.name, err)
		}
	}
	var username string
	if err := tx.QueryRowContext(ctx, `SELECT username FROM main.users WHERE id = ?`, userID).Scan(&username); err != nil {
		tx.Rollback()
		return "", fmt.Errorf("user not found: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}

	if _, err := conn.ExecContext(ctx, `DETACH DATABASE src`); err != nil {
		return "", err
	}
	// Arquivo único para download: sair do WAL faz o checkpoint e apaga o
	// -wal/-shm; o VACUUM compacta as páginas.
	if _, err := conn.ExecContext(ctx, `PRAGMA journal_mode = DELETE`); err != nil {
		return "", err
	}
	if _, err := conn.ExecContext(ctx, `VACUUM`); err != nil {
		return "", err
	}
	return username, nil
}

// copyTable copia as linhas filtradas por colunas nomeadas, nunca SELECT *:
// colunas que vieram de ALTER TABLE no evolve() ficam em outra ordem num banco
// antigo do que num criado do zero. A lista vem do destino (o schema da versão
// atual), intersectada com a origem; coluna só do destino fica com o default.
func copyTable(ctx context.Context, tx *sql.Tx, t snapshotTable, userID string) error {
	dstCols, err := tableColumns(ctx, tx, "main", t.name)
	if err != nil {
		return err
	}
	srcCols, err := tableColumns(ctx, tx, "src", t.name)
	if err != nil {
		return err
	}
	inSrc := map[string]bool{}
	for _, c := range srcCols {
		inSrc[c] = true
	}
	var cols []string
	for _, c := range dstCols {
		if inSrc[c] {
			cols = append(cols, `"`+c+`"`)
		}
	}
	if len(cols) == 0 {
		return nil
	}
	list := strings.Join(cols, ", ")
	q := fmt.Sprintf(`INSERT INTO main.%s (%s) SELECT %s FROM src.%s WHERE %s`, t.name, list, list, t.name, t.where)
	_, err = tx.ExecContext(ctx, q, userID)
	return err
}

func tableColumns(ctx context.Context, tx *sql.Tx, schema, table string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, fmt.Sprintf(`SELECT name FROM pragma_table_info('%s', '%s')`, table, schema))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		cols = append(cols, c)
	}
	return cols, rows.Err()
}

// readOnlyURI monta a URI SQLite que abre o arquivo só para leitura. Os
// caracteres com significado em URI (% ? #) são escapados.
func readOnlyURI(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	p := filepath.ToSlash(abs)
	p = strings.NewReplacer("%", "%25", "?", "%3f", "#", "%23").Replace(p)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p // C:/… → /C:/…
	}
	return "file:" + p + "?mode=ro"
}

// WithSnapshot liga o export SQLite ao caminho do banco vivo. Opcional, como
// WithDrawings: sem isto GET /export/sqlite responde 404.
func (h *Handler) WithSnapshot(liveDBPath string) *Handler {
	h.snapshotDB = liveDBPath
	h.snapshotSem = make(chan struct{}, 1)
	return h
}

var unsafeFilename = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

// GET /api/export/sqlite
func (h *Handler) exportSQLite(w http.ResponseWriter, r *http.Request) {
	h.exportSQLiteForUser(w, r, auth.GetUserID(r))
}

// exportSQLiteForUser gera o snapshot num diretório temporário e o transmite
// do disco (os BLOBs nunca passam pelo heap). Um por vez: o arquivo tem o
// tamanho dos dados do usuário e o VPS tem disco e IO modestos.
func (h *Handler) exportSQLiteForUser(w http.ResponseWriter, r *http.Request, userID string) {
	if h.snapshotDB == "" {
		jsonError(w, http.StatusNotFound, "sqlite export not enabled")
		return
	}
	select {
	case h.snapshotSem <- struct{}{}:
		defer func() { <-h.snapshotSem }()
	default:
		w.Header().Set("Retry-After", "60")
		jsonError(w, http.StatusTooManyRequests, "export already in progress")
		return
	}

	dir, err := os.MkdirTemp(h.snapshotTmp, "zk-snapshot-*")
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer os.RemoveAll(dir)

	dst := filepath.Join(dir, "snapshot.db")
	username, err := WriteUserSnapshot(r.Context(), h.snapshotDB, userID, dst)
	if err != nil {
		log.Printf("sqlite export failed for %s: %v", userID, err)
		jsonError(w, http.StatusInternalServerError, "snapshot failed")
		return
	}

	f, err := os.Open(dst)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer f.Close() // roda antes do RemoveAll (LIFO): no Windows o arquivo aberto não sai
	info, err := f.Stat()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	name := unsafeFilename.ReplaceAllString(username, "_")
	w.Header().Set("Content-Type", "application/vnd.sqlite3")
	w.Header().Set("Content-Length", fmt.Sprint(info.Size()))
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="zettelkasten-%s-%s.db"`, name, time.Now().Format("20060102")))
	io.Copy(w, f)
}
