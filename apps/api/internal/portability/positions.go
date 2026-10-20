package portability

import (
	"fmt"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/positions"
)

// WithPositions liga as posições da galáxia ao export/import. Opcional, como
// WithDrawings: sem isto o pacote não leva nem restaura posições.
func (h *Handler) WithPositions(repo *positions.Repository) *Handler {
	h.positions = repo
	return h
}

func (h *Handler) positionsForExport(userID string) []positions.Entry {
	if h.positions == nil {
		return nil
	}
	entries, err := h.positions.Since(userID, 0)
	if err != nil {
		return nil
	}
	return entries
}

// importPositions grava com LWW depois dos zettels: o repositório ignora ids
// que não viraram zettel. Backup sem o campo não chega aqui (lista vazia) e os
// zettels são posicionados automaticamente pelo cliente.
func (h *Handler) importPositions(userID string, entries []positions.Entry) []string {
	if h.positions == nil || len(entries) == 0 {
		return nil
	}
	if _, _, err := h.positions.Upsert(userID, entries, positions.ModeLWW, time.Now().UnixMilli()); err != nil {
		return []string{fmt.Sprintf("positions: %v", err)}
	}
	return nil
}
