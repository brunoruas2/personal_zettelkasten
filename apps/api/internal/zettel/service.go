package zettel

import (
	"context"
	"errors"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/drawings"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	"github.com/brunofullstack/zettelkasten/api/internal/models"
)

// ChangeEvent descreve uma escrita confirmada, para quem acompanha a base em
// tempo real. Source é auth.SourceAgent ou auth.SourceUI.
type ChangeEvent struct {
	Kind   string   `json:"kind"` // "zettel"
	Op     string   `json:"op"`   // "upsert" | "delete"
	IDs    []string `json:"ids"`
	Source string   `json:"source"`
}

// Notifier recebe as mudanças depois do commit; nunca é chamado numa escrita que falhou.
type Notifier interface {
	Changed(ctx context.Context, userID string, ev ChangeEvent)
}

// NopNotifier não faz nada (padrão até existir o barramento de eventos).
type NopNotifier struct{}

func (NopNotifier) Changed(context.Context, string, ChangeEvent) {}

// Service é o ponto único de escrita de zettels no servidor: REST e MCP passam
// por aqui, então links, refs de imagem/desenho e notificação ficam consistentes.
type Service struct {
	repo     *Repository
	images   *images.Repository
	drawings *drawings.Repository
	notifier Notifier
	now      func() time.Time
}

func NewService(repo *Repository, imageRepo *images.Repository) *Service {
	return &Service{repo: repo, images: imageRepo, notifier: NopNotifier{}, now: time.Now}
}

// WithDrawings liga a contagem de referências de desenho (`zk:draw/<id>`).
func (s *Service) WithDrawings(repo *drawings.Repository) *Service {
	s.drawings = repo
	return s
}

// WithNotifier troca o NopNotifier.
func (s *Service) WithNotifier(n Notifier) *Service {
	if n == nil {
		n = NopNotifier{}
	}
	s.notifier = n
	return s
}

func (s *Service) notify(ctx context.Context, userID, op string, ids ...string) {
	if len(ids) == 0 {
		return
	}
	s.notifier.Changed(ctx, userID, ChangeEvent{Kind: "zettel", Op: op, IDs: ids, Source: auth.GetSource(ctx)})
}

// nextUpdatedAt: agora, mas sempre estritamente depois da versão anterior.
func (s *Service) nextUpdatedAt(prev int64) int64 {
	now := s.now().UnixMilli()
	if now <= prev {
		return prev + 1
	}
	return now
}

// --- leitura ---

// List é o GET /api/zettels do REST (delta, busca FTS crua ou tudo).
func (s *Service) List(userID string, since int64, query string) ([]models.Zettel, error) {
	return s.repo.List(userID, since, query)
}

// ListMeta é o índice sem corpo do pull.
func (s *Service) ListMeta(userID string, since int64) ([]models.ZettelMeta, error) {
	return s.repo.ListMeta(userID, since)
}

// Bodies devolve os corpos de um lote de ids.
func (s *Service) Bodies(userID string, ids []string) ([]models.ZettelBody, error) {
	return s.repo.Bodies(userID, ids)
}

// Get devolve o zettel vivo ou ErrNotFound.
func (s *Service) Get(userID, id string) (*models.Zettel, error) {
	z, err := s.repo.GetByID(userID, id)
	if err != nil {
		return nil, err
	}
	if z == nil {
		return nil, ErrNotFound
	}
	return z, nil
}

// GetByTitle acha pelo título sem diferenciar maiúsculas; ErrNotFound se não há.
func (s *Service) GetByTitle(userID, title string) (*models.Zettel, error) {
	z, err := s.repo.FindByTitleFold(userID, title, "")
	if err != nil {
		return nil, err
	}
	if z == nil {
		return nil, ErrNotFound
	}
	return z, nil
}

var ftsWordRE = regexp.MustCompile(`[\p{L}\p{N}_]+`)

// Search busca pelo FTS5 com a consulta saneada: cada palavra vira um prefixo
// entre aspas (`"pal"*`, todas obrigatórias), então a sintaxe do FTS não vaza
// para quem chama. limit ≤ 0 = 20.
func (s *Service) Search(userID, query string, limit int) ([]models.Zettel, error) {
	words := ftsWordRE.FindAllString(query, -1)
	if len(words) == 0 {
		return []models.Zettel{}, nil
	}
	if limit <= 0 {
		limit = 20
	}
	terms := make([]string, len(words))
	for i, w := range words {
		terms[i] = `"` + w + `"*`
	}
	return s.repo.SearchFTS(userID, strings.Join(terms, " "), limit)
}

// ListRecent devolve os mais atualizados. limit ≤ 0 = 20.
func (s *Service) ListRecent(userID string, limit int) ([]models.Zettel, error) {
	if limit <= 0 {
		limit = 20
	}
	return s.repo.ListRecent(userID, limit)
}

// Links devolve quem o zettel cita (out) e quem o cita (in).
func (s *Service) Links(userID, id string) (out, in []LinkRef, err error) {
	if _, err = s.Get(userID, id); err != nil {
		return nil, nil, err
	}
	if out, err = s.repo.OutgoingLinks(userID, id); err != nil {
		return nil, nil, err
	}
	in, err = s.repo.IncomingLinks(userID, id)
	return out, in, err
}

// Backlinks é o GET /api/zettels/{id}/backlinks do REST.
func (s *Service) Backlinks(userID, id string) ([]models.Zettel, error) {
	return s.repo.GetBacklinks(userID, id)
}

// TagCount é uma tag e quantos zettels vivos a usam.
type TagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

// Tags lista as tags em uso, da mais usada para a menos (empate: alfabética).
func (s *Service) Tags(userID string) ([]TagCount, error) {
	all, err := s.repo.AllTags(userID)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, tags := range all {
		for _, t := range tags {
			counts[t]++
		}
	}
	out := make([]TagCount, 0, len(counts))
	for t, n := range counts {
		out = append(out, TagCount{Tag: t, Count: n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Tag < out[j].Tag
	})
	return out, nil
}

// --- escrita ---

// CreateInput é o zettel a criar; ID, datas e Tags são opcionais.
type CreateInput struct {
	ID        string
	Title     string
	Body      string
	Tags      []string
	CreatedAt int64
	UpdatedAt int64
}

// Create grava um zettel novo. Sem título e sem id = ErrInvalid; id repetido = ErrConflict.
func (s *Service) Create(ctx context.Context, userID string, in CreateInput) (*models.Zettel, error) {
	if in.Title == "" && in.ID == "" {
		return nil, invalid("title is required")
	}
	now := s.now()
	if in.Tags == nil {
		in.Tags = []string{}
	}
	if in.CreatedAt == 0 {
		in.CreatedAt = now.UnixMilli()
	}
	if in.UpdatedAt == 0 {
		in.UpdatedAt = now.UnixMilli()
	}
	if in.ID == "" {
		in.ID = generateID(now)
	}
	z := &models.Zettel{
		ID: in.ID, UserID: userID, Title: in.Title, Body: in.Body, Tags: in.Tags,
		CreatedAt: in.CreatedAt, UpdatedAt: in.UpdatedAt,
	}
	if err := s.repo.Create(z); err != nil {
		return nil, err
	}
	s.syncRefs(userID, z.ID, z.Body)
	s.relinkPending(userID, z.Title, z.ID)
	s.notify(ctx, userID, "upsert", z.ID)
	return s.Get(userID, z.ID)
}

// UpdateInput é o zettel inteiro (PUT): campo vazio grava vazio.
type UpdateInput struct {
	Title     string
	Body      string
	Tags      []string
	UpdatedAt int64
}

// Update substitui título, corpo e tags (contrato do PUT REST, sem reescrever links).
func (s *Service) Update(ctx context.Context, userID, id string, in UpdateInput) (*models.Zettel, error) {
	if in.Tags == nil {
		in.Tags = []string{}
	}
	if in.UpdatedAt == 0 {
		in.UpdatedAt = s.now().UnixMilli()
	}
	z := &models.Zettel{ID: id, UserID: userID, Title: in.Title, Body: in.Body, Tags: in.Tags, UpdatedAt: in.UpdatedAt}
	if err := s.repo.Update(z); err != nil {
		return nil, err
	}
	s.syncRefs(userID, id, z.Body)
	s.notify(ctx, userID, "upsert", id)
	return s.Get(userID, id)
}

// Patch troca `old` por `new` no corpo quando `old` aparece exatamente uma vez.
func (s *Service) Patch(ctx context.Context, userID, id, old, new string) (*models.Zettel, error) {
	if old == "" {
		return nil, invalid("old_string vazio")
	}
	z, err := s.Get(userID, id)
	if err != nil {
		return nil, err
	}
	if n := strings.Count(z.Body, old); n != 1 {
		return nil, &PatchMismatchError{Count: n}
	}
	return s.Update(ctx, userID, id, UpdateInput{
		Title: z.Title, Body: strings.Replace(z.Body, old, new, 1), Tags: z.Tags,
		UpdatedAt: s.nextUpdatedAt(z.UpdatedAt),
	})
}

var tagSpaceRE = regexp.MustCompile(`\s+`)

// NormalizeTag espelha o TagInput do app: trim, minúsculas, espaços → "-".
func NormalizeTag(t string) string {
	return tagSpaceRE.ReplaceAllString(strings.ToLower(strings.TrimSpace(t)), "-")
}

// SetTags acrescenta as de add que faltam e tira as de remove, preservando a ordem.
func (s *Service) SetTags(ctx context.Context, userID, id string, add, remove []string) (*models.Zettel, error) {
	z, err := s.Get(userID, id)
	if err != nil {
		return nil, err
	}
	drop := map[string]bool{}
	for _, t := range remove {
		if n := NormalizeTag(t); n != "" {
			drop[n] = true
		}
	}
	seen := map[string]bool{}
	tags := []string{}
	for _, t := range z.Tags {
		if !drop[t] && !seen[t] {
			tags = append(tags, t)
			seen[t] = true
		}
	}
	for _, t := range add {
		if n := NormalizeTag(t); n != "" && !drop[n] && !seen[n] {
			tags = append(tags, n)
			seen[n] = true
		}
	}
	if equalStrings(tags, z.Tags) {
		return z, nil
	}
	return s.Update(ctx, userID, id, UpdateInput{
		Title: z.Title, Body: z.Body, Tags: tags, UpdatedAt: s.nextUpdatedAt(z.UpdatedAt),
	})
}

// Rename troca o título e reescreve [[antigo]], [[^antigo]] e [[antigo|rótulo]]
// (sem caixa) em todos os zettels vivos, numa transação. Devolve o zettel e os
// ids reescritos. Título de outro zettel vivo = ErrConflict.
func (s *Service) Rename(ctx context.Context, userID, id, newTitle string) (*models.Zettel, []string, error) {
	newTitle = strings.TrimSpace(newTitle)
	if newTitle == "" {
		return nil, nil, invalid("título vazio")
	}
	if strings.ContainsAny(newTitle, "[]|") || strings.HasPrefix(newTitle, "^") {
		return nil, nil, invalid("o título não pode ter [, ], | nem começar com ^")
	}
	z, err := s.Get(userID, id)
	if err != nil {
		return nil, nil, err
	}
	old := z.Title
	if old == newTitle {
		return z, []string{}, nil
	}
	if other, err := s.repo.FindByTitleFold(userID, newTitle, id); err != nil {
		return nil, nil, err
	} else if other != nil {
		return nil, nil, conflict("já existe um zettel com o título «" + other.Title + "» (id " + other.ID + ")")
	}

	var rewrites []bodyUpdate
	rewritten := []string{}
	if strings.TrimSpace(old) != "" {
		candidates, err := s.repo.BodiesContaining(userID, "[[")
		if err != nil {
			return nil, nil, err
		}
		re := regexp.MustCompile(`(?i)\[\[(\^?)` + regexp.QuoteMeta(old) + `(\|[^\]]*)?\]\]`)
		for _, c := range candidates {
			body := re.ReplaceAllStringFunc(c.Body, func(m string) string {
				sub := re.FindStringSubmatch(m)
				return "[[" + sub[1] + newTitle + sub[2] + "]]"
			})
			if body != c.Body {
				rewrites = append(rewrites, bodyUpdate{ID: c.ID, Body: body, UpdatedAt: s.nextUpdatedAt(c.UpdatedAt)})
				rewritten = append(rewritten, c.ID)
			}
		}
	}
	// O próprio zettel pode estar entre os reescritos (autorreferência): a
	// troca de título e a do corpo usam o mesmo updated_at.
	selfAt := s.nextUpdatedAt(z.UpdatedAt)
	for i := range rewrites {
		if rewrites[i].ID == id {
			if rewrites[i].UpdatedAt > selfAt {
				selfAt = rewrites[i].UpdatedAt
			}
			rewrites[i].UpdatedAt = selfAt
		}
	}
	if err := s.repo.RenameTx(userID, id, newTitle, selfAt, rewrites); err != nil {
		return nil, nil, err
	}
	for _, b := range rewrites {
		s.syncLinks(userID, b.ID, b.Body)
	}
	s.relinkPending(userID, newTitle, id)

	ids := []string{id}
	for _, r := range rewritten {
		if r != id {
			ids = append(ids, r)
		}
	}
	s.notify(ctx, userID, "upsert", ids...)
	renamed, err := s.Get(userID, id)
	if err != nil {
		return nil, nil, err
	}
	return renamed, rewritten, nil
}

// Delete faz o soft delete e solta as referências de imagem e desenho.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	if err := s.repo.Delete(userID, id, s.now().UnixMilli()); err != nil {
		return err
	}
	s.syncImageRefs(userID, id, "")
	s.syncDrawingRefs(userID, id, "")
	s.notify(ctx, userID, "delete", id)
	return nil
}

// RebuildLinks reprocessa links e refs de todos os zettels do usuário.
func (s *Service) RebuildLinks(userID string) error {
	zs, err := s.repo.List(userID, 0, "")
	if err != nil {
		return err
	}
	for _, z := range zs {
		s.syncRefs(userID, z.ID, z.Body)
	}
	return nil
}

// --- refs ---

func (s *Service) syncRefs(userID, id, body string) {
	s.syncLinks(userID, id, body)
	s.syncImageRefs(userID, id, body)
	s.syncDrawingRefs(userID, id, body)
}

// syncLinks resolve títulos de [[wiki links]] para IDs e atualiza a tabela links.
func (s *Service) syncLinks(userID, sourceID, body string) {
	var links []models.Link
	for _, p := range parseLinkTitles(body) {
		z, err := s.repo.FindByTitle(userID, p.title)
		if err != nil || z == nil {
			continue
		}
		l := models.Link{SourceID: sourceID, TargetID: z.ID}
		if p.isParentRef {
			l.Type = "parent-ref"
		}
		links = append(links, l)
	}
	_ = s.repo.UpsertLinks(sourceID, links)
}

// relinkPending recalcula os links de quem já citava `title` (exato, como o
// syncLinks resolve) e ainda não estava ligado — sem tocar corpo nem updated_at.
func (s *Service) relinkPending(userID, title, exceptID string) {
	if strings.TrimSpace(title) == "" {
		return
	}
	cands, err := s.repo.BodiesContaining(userID, "[["+title, "[[^"+title)
	if err != nil {
		return
	}
	for _, c := range cands {
		if c.ID != exceptID {
			s.syncLinks(userID, c.ID, c.Body)
		}
	}
}

func (s *Service) syncImageRefs(userID, zettelID, body string) {
	if s.images == nil {
		return
	}
	_ = s.images.SyncRefs(userID, zettelID, ParseImageIDs(body), s.now().UnixMilli())
}

func (s *Service) syncDrawingRefs(userID, zettelID, body string) {
	if s.drawings == nil {
		return
	}
	_ = s.drawings.SyncRefs(userID, zettelID, ParseDrawingIDs(body), s.now().UnixMilli())
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// IsNotFound é um atalho para errors.Is(err, ErrNotFound).
func IsNotFound(err error) bool { return errors.Is(err, ErrNotFound) }
