package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserIDKey contextKey = "userID"
const UserRoleKey contextKey = "userRole"

func RequireAuth(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				jsonErr(w, http.StatusUnauthorized, "missing token")
				return
			}
			tokenStr := strings.TrimPrefix(header, "Bearer ")

			token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return []byte(jwtSecret), nil
			})
			if err != nil || !token.Valid {
				jsonErr(w, http.StatusUnauthorized, "invalid token")
				return
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				jsonErr(w, http.StatusUnauthorized, "invalid claims")
				return
			}

			userID, _ := claims["sub"].(string)
			role, _ := claims["role"].(string)
			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			ctx = context.WithValue(ctx, UserRoleKey, role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// APIKeyStore is the slice of Repository the key middleware needs.
type APIKeyStore interface {
	FindUserIDByAPIKeyHash(keyHash string) (userID, role string, err error)
	TouchAPIKey(keyHash string) error
}

const apiKeyPrefix = "zk_"

func hashAPIKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// apiKeyFromRequest extracts a candidate key from X-API-Key or a Bearer token
// carrying the zk_ prefix. Query strings are deliberately not read.
func apiKeyFromRequest(r *http.Request) (key string, present bool) {
	if k := r.Header.Get("X-API-Key"); k != "" {
		return k, true
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer "+apiKeyPrefix) {
		return strings.TrimPrefix(h, "Bearer "), true
	}
	return "", false
}

// apiKeyRouteAllowed is the allowlist for key-authenticated requests:
// GET /api/zettels, POST /api/zettels, GET /api/zettels/{id}, PUT /api/zettels/{id}.
func apiKeyRouteAllowed(method, path string) bool {
	path = strings.TrimSuffix(path, "/")
	if path == "/api/zettels" {
		return method == http.MethodGet || method == http.MethodPost
	}
	id, ok := strings.CutPrefix(path, "/api/zettels/")
	if !ok || id == "" || strings.Contains(id, "/") || id == "rebuild-links" {
		return false
	}
	return method == http.MethodGet || method == http.MethodPut
}

// RequireAuthOrKey accepts either a JWT (unrestricted, same as RequireAuth) or an
// API key (restricted to apiKeyRouteAllowed). Use only on the zettel routes.
func RequireAuthOrKey(jwtSecret string, store APIKeyStore) func(http.Handler) http.Handler {
	jwtAuth := RequireAuth(jwtSecret)
	return func(next http.Handler) http.Handler {
		jwtNext := jwtAuth(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key, present := apiKeyFromRequest(r)
			if !present {
				jwtNext.ServeHTTP(w, r)
				return
			}
			if !apiKeyRe.MatchString(key) {
				jsonErr(w, http.StatusUnauthorized, "invalid api key")
				return
			}
			keyHash := hashAPIKey(key)
			userID, role, err := store.FindUserIDByAPIKeyHash(keyHash)
			if err != nil || userID == "" {
				jsonErr(w, http.StatusUnauthorized, "invalid api key")
				return
			}
			if !apiKeyRouteAllowed(r.Method, r.URL.Path) {
				jsonErr(w, http.StatusForbidden, "api key not allowed for this route")
				return
			}
			if err := store.TouchAPIKey(keyHash); err != nil {
				log.Printf("touch api key: %v", err)
			}
			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			ctx = context.WithValue(ctx, UserRoleKey, role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role, _ := r.Context().Value(UserRoleKey).(string)
		if role != "admin" {
			jsonErr(w, http.StatusForbidden, "admin only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func GetUserID(r *http.Request) string {
	id, _ := r.Context().Value(UserIDKey).(string)
	return id
}

func jsonErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
