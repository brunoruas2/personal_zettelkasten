package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/db"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	"github.com/brunofullstack/zettelkasten/api/internal/portability"
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

	zettelRepo := zettel.NewRepository(database)
	zettelHandler := zettel.NewHandler(zettelRepo, imageRepo)
	portabilityHandler := portability.NewHandler(zettelRepo, authRepo, imageRepo)

	startOrphanPurge(imageRepo)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware(allowedOrigin))
	r.Use(middleware.Timeout(30 * time.Second))

	// Auth routes (public + protected internamente)
	r.Mount("/api/auth", authHandler.Routes(jwtSecret))

	// Public backup export (authenticated via backup key, not JWT)
	r.Get("/api/backup/export", portabilityHandler.BackupExport)

	// Rotas protegidas (requerem JWT)
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(jwtSecret))

		r.Mount("/api/admin", authHandler.AdminRoutes())
		r.Mount("/api/zettels", zettelHandler.Routes())
		r.Mount("/api", portabilityHandler.Routes())

		// Imagens: registradas inline porque o Mount em "/api" acima impede um
		// Mount novo no mesmo prefixo (chi entra em pânico com prefixos
		// sobrepostos). Mesmo padrão do /api/links abaixo.
		// A rota estática precede a paramétrica.
		r.Get("/api/images/manifest", imageHandler.Manifest)
		r.Post("/api/images/{id}", imageHandler.Upload)
		r.Get("/api/images/{id}", imageHandler.Get)
		r.Delete("/api/images/{id}", imageHandler.Delete)

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

// startOrphanPurge apaga imagens órfãs há mais que a carência, no boot e a cada
// 24 h. Libera páginas dentro do .db mas não encolhe o arquivo — recuperar
// espaço em disco exige VACUUM manual.
func startOrphanPurge(repo *images.Repository) {
	purge := func() {
		cutoff := time.Now().UnixMilli() - images.OrphanGraceMillis
		n, err := repo.PurgeOrphans(cutoff)
		if err != nil {
			log.Printf("orphan image purge failed: %v", err)
			return
		}
		if n > 0 {
			log.Printf("purged %d orphaned image(s)", n)
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
