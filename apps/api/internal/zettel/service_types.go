package zettel

import (
	"context"
	"errors"
	"strings"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/models"
	"github.com/brunofullstack/zettelkasten/api/internal/types"
)

// Tipos de zettel no serviço: atribuição de tipo e nível, regras de autoria
// impostas à origem `agent` e filtros. A definição dos tipos é do usuário (JWT,
// pacote types); o serviço só a lê.

// WithTypes liga os tipos de zettel. Sem isso, nada nesta camada age.
func (s *Service) WithTypes(repo *types.Repository) *Service {
	s.types = repo
	return s
}

// Types devolve o repositório de tipos (nil se não ligado).
func (s *Service) Types() *types.Repository { return s.types }

// TypeRef filtra por tipo (id ou slug) e/ou nível (chave).
type TypeRef struct {
	Type  string
	Level string
}

func (r TypeRef) empty() bool {
	return strings.TrimSpace(r.Type) == "" && strings.TrimSpace(r.Level) == ""
}

// TypeFilter é o filtro já resolvido para ids, pronto para o SQL.
type TypeFilter struct {
	TypeID string
	Level  string
}

// sql devolve a cláusula `AND EXISTS (…)` sobre as atribuições vivas, com o
// alias da tabela de zettels; vazia quando não há filtro.
func (f TypeFilter) sql(alias string) (string, []any) {
	if f.TypeID == "" && f.Level == "" {
		return "", nil
	}
	q := ` AND EXISTS (SELECT 1 FROM zettel_type_assignments a WHERE a.user_id = ` + alias + `.user_id` +
		` AND a.zettel_id = ` + alias + `.id AND a.deleted_at IS NULL`
	var args []any
	if f.TypeID != "" {
		q += ` AND a.type_id = ?`
		args = append(args, f.TypeID)
	}
	if f.Level != "" {
		q += ` AND a.level = ?`
		args = append(args, f.Level)
	}
	return q + `)`, args
}

// resolveFilter converte slug em id. Tipo desconhecido = ErrInvalid com os slugs que existem.
func (s *Service) resolveFilter(userID string, ref TypeRef) (TypeFilter, error) {
	f := TypeFilter{Level: strings.TrimSpace(ref.Level)}
	t := strings.TrimSpace(ref.Type)
	if t == "" {
		return f, nil
	}
	if s.types == nil {
		return f, invalid("tipos de zettel não estão disponíveis")
	}
	tp, err := s.types.Resolve(userID, t)
	if errors.Is(err, types.ErrNotFound) {
		return f, s.unknownType(userID, t)
	}
	if err != nil {
		return f, err
	}
	f.TypeID = tp.ID
	return f, nil
}

func (s *Service) unknownType(userID, ref string) error {
	list, _ := s.types.List(userID)
	slugs := make([]string, len(list))
	for i, t := range list {
		slugs[i] = t.Slug
	}
	if len(slugs) == 0 {
		return invalid("tipo «" + ref + "» inexistente (nenhum tipo cadastrado)")
	}
	return invalid("tipo «" + ref + "» inexistente; use um de: " + strings.Join(slugs, ", "))
}

// fromTypesErr traduz os erros do pacote types para os do serviço.
func fromTypesErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, types.ErrReservedLevel):
		return forbidden(strings.TrimPrefix(err.Error(), "reserved level: "))
	case errors.Is(err, types.ErrInvalid), errors.Is(err, types.ErrLimit):
		return invalid(strings.TrimPrefix(err.Error(), "invalid: "))
	case errors.Is(err, types.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, types.ErrSlugTaken):
		return conflict(err.Error())
	}
	return err
}

// TypeInfo é o tipo e o nível efetivo de um zettel; Type nil = sem tipo.
type TypeInfo struct {
	Type  *types.Type
	Level string
}

// TypeOf devolve o tipo e o nível do zettel (nível removido do tipo vira vazio).
func (s *Service) TypeOf(userID, zettelID string) (TypeInfo, error) {
	if s.types == nil {
		return TypeInfo{}, nil
	}
	a, err := s.types.Assignment(userID, zettelID)
	if err != nil || a == nil {
		return TypeInfo{}, err
	}
	t, err := s.types.Get(userID, a.TypeID)
	if errors.Is(err, types.ErrNotFound) {
		return TypeInfo{}, nil
	}
	if err != nil {
		return TypeInfo{}, err
	}
	return TypeInfo{Type: t, Level: t.EffectiveLevel(a.Level)}, nil
}

// TypesOf devolve o tipo e o nível de vários zettels de uma vez (só os que têm tipo).
func (s *Service) TypesOf(userID string, ids []string) (map[string]TypeInfo, error) {
	out := map[string]TypeInfo{}
	if s.types == nil || len(ids) == 0 {
		return out, nil
	}
	as, err := s.types.AssignmentsFor(userID, ids)
	if err != nil {
		return nil, err
	}
	live, err := s.types.List(userID)
	if err != nil {
		return nil, err
	}
	byID := map[string]*types.Type{}
	for i := range live {
		byID[live[i].ID] = &live[i]
	}
	for id, a := range as {
		if t := byID[a.TypeID]; t != nil {
			out[id] = TypeInfo{Type: t, Level: t.EffectiveLevel(a.Level)}
		}
	}
	return out, nil
}

// guardProtected recusa a escrita do agente que muda o conteúdo de uma seção
// protegida do tipo do zettel. Vale para corpo inteiro e para edição por
// trecho (o Patch passa por Update). A origem ui nunca é barrada.
func (s *Service) guardProtected(ctx context.Context, userID, id, newBody string) error {
	if s.types == nil || auth.GetSource(ctx) != auth.SourceAgent {
		return nil
	}
	info, err := s.TypeOf(userID, id)
	if err != nil {
		return err
	}
	if info.Type == nil || len(info.Type.ProtectedSections) == 0 {
		return nil
	}
	old, err := s.repo.GetByID(userID, id)
	if err != nil {
		return err
	}
	if old == nil {
		return nil // o Update responde ErrNotFound
	}
	if changed := ChangedProtectedSections(old.Body, newBody, info.Type.ProtectedSections); len(changed) > 0 {
		return forbidden("a seção «" + changed[0] + "» é do usuário e o agente não pode alterá-la; edite outra seção do zettel")
	}
	return nil
}

// prepareType valida o tipo pedido na criação e preenche o corpo com o
// template quando não veio corpo. Devolve o tipo (nil = sem tipo).
func (s *Service) prepareType(ctx context.Context, userID string, in *CreateInput) (*types.Type, error) {
	ref := strings.TrimSpace(in.Type)
	if ref == "" {
		if strings.TrimSpace(in.Level) != "" {
			return nil, invalid("level exige type")
		}
		return nil, nil
	}
	if s.types == nil {
		return nil, invalid("tipos de zettel não estão disponíveis")
	}
	tp, err := s.types.Resolve(userID, ref)
	if errors.Is(err, types.ErrNotFound) {
		return nil, s.unknownType(userID, ref)
	}
	if err != nil {
		return nil, err
	}
	if err := tp.ValidateLevel(in.Level); err != nil {
		return nil, fromTypesErr(err)
	}
	source := auth.GetSource(ctx)
	if err := types.CheckLevelChange(source, types.LevelState{}, types.LevelState{Type: tp, Level: in.Level}); err != nil {
		return nil, fromTypesErr(err)
	}
	if in.Body == "" {
		in.Body = tp.Template
	} else if source == auth.SourceAgent {
		if changed := ChangedProtectedSections("", in.Body, tp.ProtectedSections); len(changed) > 0 {
			return nil, forbidden("a seção «" + changed[0] + "» é do usuário; crie o zettel com ela vazia")
		}
	}
	return tp, nil
}

// assign grava a atribuição de um zettel recém-criado (sempre mais nova que qualquer anterior).
func (s *Service) assign(ctx context.Context, userID, zettelID string, tp *types.Type, level string) error {
	now := s.now().UnixMilli()
	_, err := s.types.UpsertAssignments(userID, []types.Assignment{
		{ZettelID: zettelID, TypeID: tp.ID, Level: level, UpdatedAt: now},
	}, now)
	if err != nil {
		return fromTypesErr(err)
	}
	s.notifyType(ctx, userID, zettelID)
	return nil
}

// SetType atribui (ou, com typeRef vazio, remove) o tipo e o nível de um zettel.
// Trocar o tipo limpa o nível, a menos que o pedido traga um nível válido do
// tipo novo; no mesmo tipo, nível vazio mantém o atual. A origem agent não
// atribui nem desfaz nível reservado ao usuário. Gravar não toca no zettel.
func (s *Service) SetType(ctx context.Context, userID, id, typeRef, level string) (TypeInfo, error) {
	if s.types == nil {
		return TypeInfo{}, invalid("tipos de zettel não estão disponíveis")
	}
	if _, err := s.Get(userID, id); err != nil {
		return TypeInfo{}, err
	}
	cur, err := s.TypeOf(userID, id)
	if err != nil {
		return TypeInfo{}, err
	}
	prev, err := s.types.Assignment(userID, id)
	if err != nil {
		return TypeInfo{}, err
	}

	level = strings.TrimSpace(level)
	var next TypeInfo
	typeRef = strings.TrimSpace(typeRef)
	if typeRef != "" {
		tp, err := s.types.Resolve(userID, typeRef)
		if errors.Is(err, types.ErrNotFound) {
			return TypeInfo{}, s.unknownType(userID, typeRef)
		}
		if err != nil {
			return TypeInfo{}, err
		}
		if level == "" && cur.Type != nil && cur.Type.ID == tp.ID {
			level = cur.Level
		}
		if err := tp.ValidateLevel(level); err != nil {
			return TypeInfo{}, fromTypesErr(err)
		}
		next = TypeInfo{Type: tp, Level: level}
	}

	check := types.CheckLevelChange(auth.GetSource(ctx),
		types.LevelState{Type: cur.Type, Level: cur.Level},
		types.LevelState{Type: next.Type, Level: next.Level})
	if check != nil {
		return TypeInfo{}, fromTypesErr(check)
	}
	if next.Type == nil && prev == nil {
		return next, nil // já está sem tipo
	}

	now := s.now().UnixMilli()
	at := now
	if prev != nil && prev.UpdatedAt >= at {
		at = prev.UpdatedAt + 1
	}
	a := types.Assignment{ZettelID: id, UpdatedAt: at}
	if next.Type != nil {
		a.TypeID, a.Level = next.Type.ID, next.Level
	} else {
		a.TypeID = prev.TypeID
		a.DeletedAt = &now
	}
	if _, err := s.types.UpsertAssignments(userID, []types.Assignment{a}, now); err != nil {
		return TypeInfo{}, fromTypesErr(err)
	}
	s.notifyType(ctx, userID, id)
	return next, nil
}

func (s *Service) notifyType(ctx context.Context, userID string, ids ...string) {
	if len(ids) == 0 {
		return
	}
	s.notifier.Changed(ctx, userID, ChangeEvent{Kind: "type", Op: "upsert", IDs: ids, Source: auth.GetSource(ctx)})
}

// --- leitura filtrada ---

// ListBy é o GET /api/zettels do REST, com filtro opcional por tipo e nível.
func (s *Service) ListBy(userID string, since int64, query string, ref TypeRef) ([]models.Zettel, error) {
	f, err := s.resolveFilter(userID, ref)
	if err != nil {
		return nil, err
	}
	return s.repo.ListFiltered(userID, since, query, f)
}

// SearchBy é a busca FTS saneada, com filtro opcional por tipo e nível.
func (s *Service) SearchBy(userID, query string, limit int, ref TypeRef) ([]models.Zettel, error) {
	f, err := s.resolveFilter(userID, ref)
	if err != nil {
		return nil, err
	}
	return s.searchFiltered(userID, query, limit, f)
}

// ListRecentBy lista os mais atualizados, com filtro opcional por tipo e nível.
func (s *Service) ListRecentBy(userID string, limit int, ref TypeRef) ([]models.Zettel, error) {
	f, err := s.resolveFilter(userID, ref)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 20
	}
	return s.repo.ListRecentFiltered(userID, limit, f)
}
