package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/db"
	"github.com/brunofullstack/zettelkasten/api/internal/drawings"
	"github.com/brunofullstack/zettelkasten/api/internal/events"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	mcpserver "github.com/brunofullstack/zettelkasten/api/internal/mcp"
	"github.com/brunofullstack/zettelkasten/api/internal/portability"
	"github.com/brunofullstack/zettelkasten/api/internal/positions"
	"github.com/brunofullstack/zettelkasten/api/internal/types"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	dbPath := resolveDBPath(getenv("DB_PATH", "zettelkasten.db"))
	port := getenv("PORT", "3001")
	allowedOrigin := getenv("ALLOWED_ORIGIN", "http://localhost:3000")
	jwtSecret := getenv("JWT_SECRET", "dev-secret-change-in-production")
	waRPID := getenv("WEBAUTHN_RP_ID", "localhost")
	waRPName := getenv("WEBAUTHN_RP_NAME", "Zettelkasten")
	waRPOrigin := getenv("WEBAUTHN_RP_ORIGIN", "http://localhost:3000")
	imageQuota := getenvInt64("IMAGE_QUOTA_BYTES", 250<<20)
	drawingQuota := getenvInt64("DRAWING_QUOTA_BYTES", 100<<20)

	database, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer database.Close()

	wa, err := auth.NewWebAuthn(waRPID, waRPName, waRPOrigin)
	if err != nil {
		log.Fatalf("failed to init webauthn: %v", err)
	}

	sessions := auth.NewSessionStore()
	authRepo := auth.NewRepository(database)
	authHandler := auth.NewHandler(authRepo, jwtSecret, wa, sessions)

	imageRepo := images.NewRepository(database)
	imageHandler := images.NewHandler(imageRepo, imageQuota)

	drawingRepo := drawings.NewRepository(database)
	drawingHandler := drawings.NewHandler(drawingRepo, drawingQuota)
	positionRepo := positions.NewRepository(database)
	positionHandler := positions.NewHandler(positionRepo)

	zettelRepo := zettel.NewRepository(database)
	// Ponto único de escrita de zettels: o REST e (depois) o MCP usam o mesmo serviço.
	// Barramento de tempo real: escritas de zettel e desenho publicam aqui e
	// GET /api/events entrega por SSE.
	broker := events.NewBroker()
	drawingHandler.WithNotify(func(ctx context.Context, userID, op, id string) {
		broker.Publish(userID, events.Event{Kind: "drawing", Op: op, IDs: []string{id}, Source: auth.GetSource(ctx)})
	})
	// Tipos de zettel: definição (só JWT) e atribuição de tipo/nível.
	typeRepo := types.NewRepository(database)
	typeHandler := types.NewHandler(typeRepo).WithNotify(func(ctx context.Context, userID, op string, ids []string) {
		broker.Publish(userID, events.Event{Kind: "type", Op: op, IDs: ids, Source: auth.GetSource(ctx)})
	})
	zettelService := zettel.NewService(zettelRepo, imageRepo).WithDrawings(drawingRepo).
		WithTypes(typeRepo).
		WithNotifier(events.ZettelNotifier{B: broker})
	zettelHandler := zettel.NewHandlerWithService(zettelService)

	portabilityHandler := portability.NewHandler(zettelRepo, authRepo, imageRepo).
		WithDrawings(drawingRepo, drawingQuota).
		WithPositions(positionRepo).
		WithTypes(typeRepo).
		WithSnapshot(dbPath)

	startOrphanPurge(imageRepo, drawingRepo)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware(allowedOrigin))
	// O timeout vale por grupo, não no r.Use global: GET /api/events é um
	// stream longo e seria cortado em 30 s. Rota nova = dentro de um grupo com
	// `timeout`, salvo stream.
	timeout := middleware.Timeout(30 * time.Second)

	// Auth routes (public + protected internamente)
	r.With(timeout).Mount("/api/auth", authHandler.Routes(jwtSecret))

	// Public backup export (authenticated via backup key, not JWT)
	r.With(timeout).Get("/api/backup/export", portabilityHandler.BackupExport)

	// Tempo real (SSE): só JWT, sem timeout.
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(jwtSecret))
		r.Get("/api/events", events.Handler(broker))
	})

	// Zettels: JWT ou chave de API. A chave só passa em GET /api/zettels,
	// GET|PUT /api/zettels/{id} (allowlist em auth.RequireAuthOrKey).
	r.Group(func(r chi.Router) {
		r.Use(timeout)
		r.Use(auth.RequireAuthOrKey(jwtSecret, authRepo))
		r.Mount("/api/zettels", zettelHandler.Routes())
	})

	// Desenhos: inline (o Mount em "/api" abaixo impede outro Mount no mesmo
	// prefixo). JWT ou chave de API; a chave só passa em GET manifest e
	// GET|PUT {id} — DELETE recebe 403 (allowlist em auth.RequireAuthOrKey).
	// A rota estática precede a paramétrica.
	r.Group(func(r chi.Router) {
		r.Use(timeout)
		r.Use(auth.RequireAuthOrKey(jwtSecret, authRepo))
		r.Get("/api/drawings/manifest", drawingHandler.Manifest)
		r.Put("/api/drawings/{id}", drawingHandler.Put)
		r.Get("/api/drawings/{id}", drawingHandler.Get)
		r.Delete("/api/drawings/{id}", drawingHandler.Delete)
	})

	// MCP (agentes de IA): só chave zk_, sem allowlist de rota — as tools
	// passam pelo zettel.Service com origem "agent". Inline pelo mesmo motivo
	// das imagens (Mount em "/api" abaixo). Sem sessão: GET/DELETE → 405.
	r.Group(func(r chi.Router) {
		r.Use(timeout)
		r.Use(auth.RequireKey(authRepo))
		r.Handle("/api/mcp", mcpserver.Handler(zettelService, drawingHandler))
	})

	// Rotas protegidas (requerem JWT)
	r.Group(func(r chi.Router) {
		r.Use(timeout)
		r.Use(auth.RequireAuth(jwtSecret))

		r.Mount("/api/admin", authHandler.AdminRoutes())
		r.Mount("/api", portabilityHandler.Routes())

		// Imagens: registradas inline porque o Mount em "/api" acima impede um
		// Mount novo no mesmo prefixo (chi entra em pânico com prefixos
		// sobrepostos). Mesmo padrão do /api/links abaixo.
		// A rota estática precede a paramétrica.
		r.Get("/api/images/manifest", imageHandler.Manifest)
		r.Post("/api/images/{id}", imageHandler.Upload)
		r.Get("/api/images/{id}", imageHandler.Get)
		r.Delete("/api/images/{id}", imageHandler.Delete)

		// Posições na galáxia: inline pelo mesmo motivo, só JWT.
		r.Get("/api/positions", positionHandler.List)
		r.Put("/api/positions", positionHandler.Put)
		r.Post("/api/positions/init", positionHandler.Init)
		r.Delete("/api/positions", positionHandler.Reset)

		// Tipos de zettel e atribuições: inline, só JWT (a chave zk_ recebe 401;
		// o agente atribui tipo pelo MCP).
		r.Get("/api/types", typeHandler.List)
		r.Put("/api/types", typeHandler.Put)
		r.Delete("/api/types/{id}", typeHandler.Delete)
		r.Get("/api/type-assignments", typeHandler.ListAssignments)
		r.Put("/api/type-assignments", typeHandler.PutAssignments)

		r.Get("/api/links", func(w http.ResponseWriter, req *http.Request) {
			links, err := zettelRepo.GetAllLinks(auth.GetUserID(req))
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(links)
		})
	})

	log.Printf("API listening on :%s  db=%s  cors=%s  rpid=%s", port, dbPath, allowedOrigin, waRPID)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// resolveDBPath turns a relative DB_PATH into an absolute path anchored to the
// directory of the running executable (or current directory when using go run).
// This prevents the DB from being created in the wrong place if the API is
// started from a different working directory.
func resolveDBPath(p string) string {
	if filepath.IsAbs(p) {
		return p
	}
	exe, err := os.Executable()
	if err != nil {
		return p // fallback: keep relative (go run, tests)
	}
	// os.Executable may return a temp path under go run — in that case
	// filepath.EvalSymlinks resolves it, but we still want CWD behaviour for
	// development. Detect go run by checking if the exe dir looks temporary.
	dir := filepath.Dir(exe)
	if isGoRunTmp(dir) {
		return p
	}
	return filepath.Join(dir, p)
}

func isGoRunTmp(dir string) bool {
	// go run compiles to a temp dir like /tmp/go-build... or %TEMP%\go-build...
	tmpDir := os.TempDir()
	return len(dir) >= len(tmpDir) && dir[:len(tmpDir)] == tmpDir
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvInt64(key string, fallback int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		log.Printf("invalid %s=%q, using default %d", key, v, fallback)
		return fallback
	}
	return n
}

// startOrphanPurge apaga imagens e desenhos órfãos há mais que a carência, no
// boot e a cada 24 h. Libera páginas dentro do .db mas não encolhe o arquivo —
// recuperar espaço em disco exige VACUUM manual.
func startOrphanPurge(imageRepo *images.Repository, drawingRepo *drawings.Repository) {
	purge := func() {
		now := time.Now().UnixMilli()
		n, err := imageRepo.PurgeOrphans(now - images.OrphanGraceMillis)
		if err != nil {
			log.Printf("orphan image purge failed: %v", err)
		} else if n > 0 {
			log.Printf("purged %d orphaned image(s)", n)
		}
		n, err = drawingRepo.PurgeOrphans(now - drawings.OrphanGraceMillis)
		if err != nil {
			log.Printf("orphan drawing purge failed: %v", err)
		} else if n > 0 {
			log.Printf("purged %d orphaned drawing(s)", n)
		}
	}
	purge()
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			purge()
		}
	}()
}

func corsMiddleware(allowedOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
