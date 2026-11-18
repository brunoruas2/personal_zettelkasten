// Package mcp expõe a base de zettels a agentes de IA pelo Model Context
// Protocol (Streamable HTTP, sem sessão). Toda escrita passa pelo
// zettel.Service com origem "agent".
package mcp

import (
	"context"
	_ "embed"
	"net/http"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/drawings"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

//go:embed instructions.md
var instructions string

// MaxRequestBytes: desenho de 5 MB (cena + SVG, com escape JSON) + folga.
const MaxRequestBytes = 12 << 20

// Handler devolve o endpoint MCP. Precisa vir atrás de auth.RequireKey: o
// userID sai do contexto da requisição e cada requisição monta um servidor
// com as tools ligadas a esse usuário (o modo sem sessão já cria uma sessão
// temporária por requisição; o cache de schemas evita refazer a reflexão).
func Handler(svc *zettel.Service, dh *drawings.Handler) http.Handler {
	cache := sdk.NewSchemaCache()
	return sdk.NewStreamableHTTPHandler(func(r *http.Request) *sdk.Server {
		return newServer(svc, dh, auth.UserIDFromContext(r.Context()), cache)
	}, &sdk.StreamableHTTPOptions{
		Stateless:    true,
		JSONResponse: true,
		// Atrás do Nginx toda requisição chega por localhost com o Host
		// público, e a proteção contra DNS rebinding do SDK a recusaria (403).
		// A rota exige a chave zk_, que um site malicioso não tem.
		DisableLocalhostProtection: true,
		MaxRequestBodyBytes:        MaxRequestBytes,
	})
}

func newServer(svc *zettel.Service, dh *drawings.Handler, userID string, cache *sdk.SchemaCache) *sdk.Server {
	s := sdk.NewServer(&sdk.Implementation{Name: "zettelkasten", Title: "Zettelkasten", Version: "1.0.0"}, &sdk.ServerOptions{
		Instructions: instructions,
		SchemaCache:  cache,
	})
	t := &tools{svc: svc, drawings: dh, userID: userID}
	t.register(s)
	return s
}

// agentCtx garante a origem "agent" no contexto das escritas, venha o ctx da
// requisição ou não (o SDK pode não propagar os valores do middleware).
func agentCtx(ctx context.Context) context.Context {
	return context.WithValue(ctx, auth.SourceKey, auth.SourceAgent)
}
