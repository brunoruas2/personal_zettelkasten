package portability

import (
	"fmt"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/types"
)

// WithTypes liga os tipos de zettel e as atribuições ao export/import. Opcional,
// como WithPositions: sem isto o pacote não leva nem restaura tipos.
func (h *Handler) WithTypes(repo *types.Repository) *Handler {
	h.types = repo
	return h
}

// typesForExport devolve os tipos vivos. Apagados ficam de fora: o backup
// descreve o estado atual, não o histórico de sync.
func (h *Handler) typesForExport(userID string) []types.Type {
	if h.types == nil {
		return nil
	}
	all, err := h.types.List(userID)
	if err != nil {
		return nil
	}
	return all
}

// assignmentsForExport devolve as atribuições vivas (sem tombstones).
func (h *Handler) assignmentsForExport(userID string) []types.Assignment {
	if h.types == nil {
		return nil
	}
	all, err := h.types.AssignmentsSince(userID, 0)
	if err != nil {
		return nil
	}
	out := make([]types.Assignment, 0, len(all))
	for _, a := range all {
		if a.DeletedAt == nil {
			out = append(out, a)
		}
	}
	return out
}

// importTypes grava os tipos com LWW, antes das atribuições. Um item inválido
// (slug já usado por outro tipo, ícone fora da lista…) vai para `errors` sem
// barrar os demais. Backup antigo, sem `types`, não chega aqui.
func (h *Handler) importTypes(userID string, in []types.Type, assignments []types.Assignment) []string {
	if h.types == nil || (len(in) == 0 && len(assignments) == 0) {
		return nil
	}
	var errs []string
	now := time.Now().UnixMilli()
	for _, t := range in {
		if _, err := h.types.Upsert(userID, []types.Type{t}, now); err != nil {
			errs = append(errs, fmt.Sprintf("type %q: %v", t.Slug, err))
		}
	}
	for _, a := range assignments {
		skipped, err := h.types.UpsertAssignments(userID, []types.Assignment{a}, now)
		switch {
		case err != nil:
			errs = append(errs, fmt.Sprintf("type assignment %s: %v", a.ZettelID, err))
		case len(skipped) > 0:
			// O zettel não está na conta (não entrou no import).
			errs = append(errs, fmt.Sprintf("type assignment %s: zettel não encontrado", a.ZettelID))
		}
	}
	return errs
}
