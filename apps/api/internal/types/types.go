// Package types guarda os tipos de zettel (cadastrados pelo usuário) e a
// atribuição de tipo e nível a cada zettel. Tabelas próprias, no molde de
// positions: mudar um nível nunca toca na linha do zettel.
package types

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Limites (mesmos números de packages/core/src/models/ZettelType.ts).
const (
	MaxTypes             = 50
	MaxLevels            = 12
	MaxProtectedSections = 8
	MaxTemplateBytes     = 16 * 1024
	MaxNameChars         = 60
)

// Erros comparáveis com errors.Is.
var (
	ErrNotFound  = errors.New("type not found")
	ErrInvalid   = errors.New("invalid")
	ErrSlugTaken = errors.New("slug already in use")
	ErrLimit     = errors.New("type limit reached")
)

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, a...))
}

// Level é um degrau da escada de maturidade. A ordem do slice é a escada.
type Level struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Emoji    string `json:"emoji,omitempty"`
	UserOnly bool   `json:"user_only"`
}

// Type é um tipo de zettel do usuário.
type Type struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Slug              string   `json:"slug"`
	Icon              string   `json:"icon"`
	Color             string   `json:"color"`
	Template          string   `json:"template"`
	ProtectedSections []string `json:"protected_sections"`
	Levels            []Level  `json:"levels"`
	CountsProgress    bool     `json:"counts_progress"`
	UpdatedAt         int64    `json:"updated_at"`
	DeletedAt         *int64   `json:"deleted_at,omitempty"`
}

// Assignment liga um zettel a um tipo (e nível). Level vazio = sem nível.
// DeletedAt marca "sem tipo": um tombstone, para o delta chegar aos outros aparelhos.
type Assignment struct {
	ZettelID  string `json:"zettel_id"`
	TypeID    string `json:"type_id"`
	Level     string `json:"level"`
	UpdatedAt int64  `json:"updated_at"`
	DeletedAt *int64 `json:"deleted_at,omitempty"`
}

var (
	slugRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	idRE   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
)

// ValidSlug diz se s é um slug aceito (tipo e chave de nível).
func ValidSlug(s string) bool { return slugRE.MatchString(s) }

// Validate confere a forma de um tipo (não a unicidade do slug nem o teto de
// tipos, que dependem do conjunto). Normaliza nome e títulos de seção.
func (t *Type) Validate() error {
	t.Name = strings.TrimSpace(t.Name)
	if !idRE.MatchString(t.ID) {
		return invalid("id inválido")
	}
	if t.Name == "" {
		return invalid("o nome é obrigatório")
	}
	if utf8.RuneCountInString(t.Name) > MaxNameChars {
		return invalid("o nome passa de %d caracteres", MaxNameChars)
	}
	if !ValidSlug(t.Slug) {
		return invalid("slug inválido (minúsculas, números e hífen)")
	}
	if !ValidIcon(t.Icon) {
		return invalid("o ícone não está na lista permitida")
	}
	if !ValidColor(t.Color) {
		return invalid("a cor não está na paleta permitida")
	}
	t.Color = strings.ToLower(t.Color)
	if len(t.Template) > MaxTemplateBytes {
		return invalid("o template passa de 16 KB")
	}
	if t.UpdatedAt <= 0 {
		return invalid("updated_at é obrigatório")
	}
	if len(t.ProtectedSections) > MaxProtectedSections {
		return invalid("no máximo %d seções protegidas", MaxProtectedSections)
	}
	if t.ProtectedSections == nil {
		t.ProtectedSections = []string{}
	}
	for i, s := range t.ProtectedSections {
		s = strings.TrimSpace(s)
		if s == "" {
			return invalid("seção protegida sem título")
		}
		t.ProtectedSections[i] = s
	}
	if len(t.Levels) > MaxLevels {
		return invalid("no máximo %d níveis", MaxLevels)
	}
	if t.Levels == nil {
		t.Levels = []Level{}
	}
	seen := map[string]bool{}
	for i := range t.Levels {
		l := &t.Levels[i]
		l.Label = strings.TrimSpace(l.Label)
		if !ValidSlug(l.Key) {
			return invalid("a chave do nível %q é inválida", l.Key)
		}
		if seen[l.Key] {
			return invalid("o nível %q está repetido", l.Key)
		}
		seen[l.Key] = true
		if l.Label == "" {
			return invalid("o nível %q não tem rótulo", l.Key)
		}
	}
	return nil
}

// FindLevel devolve o nível de chave key, se o tipo o declara.
func (t *Type) FindLevel(key string) (Level, bool) {
	for _, l := range t.Levels {
		if l.Key == key {
			return l, true
		}
	}
	return Level{}, false
}

// ValidateLevel confere um nível contra o tipo: tipo sem escada só aceita
// vazio; senão a chave precisa existir.
func (t *Type) ValidateLevel(level string) error {
	if level == "" {
		return nil
	}
	if len(t.Levels) == 0 {
		return invalid("o tipo %q não tem níveis", t.Slug)
	}
	if _, ok := t.FindLevel(level); !ok {
		keys := make([]string, len(t.Levels))
		for i, l := range t.Levels {
			keys[i] = l.Key
		}
		return invalid("nível %q inexistente em %q; use um de: %s", level, t.Slug, strings.Join(keys, ", "))
	}
	return nil
}

// EffectiveLevel: a chave guardada só vale se o tipo ainda a declara (nível
// removido do tipo = sem nível).
func (t *Type) EffectiveLevel(key string) string {
	if _, ok := t.FindLevel(key); ok {
		return key
	}
	return ""
}

// Source é a origem de uma escrita (auth.SourceAgent / auth.SourceUI).
const (
	SourceAgent = "agent"
	SourceUI    = "ui"
)

// LevelState é o tipo e o nível de um zettel; Type nil = sem tipo.
type LevelState struct {
	Type  *Type
	Level string
}

// ErrReservedLevel: o agente tentou mexer num nível reservado ao usuário.
var ErrReservedLevel = errors.New("reserved level")

// CheckLevelChange: a origem agent não atribui nível user_only nem tira o
// zettel de um (trocar de nível, de tipo ou remover o tipo). A origem ui pode tudo.
func CheckLevelChange(source string, from, to LevelState) error {
	if source != SourceAgent {
		return nil
	}
	fromID, toID := "", ""
	if from.Type != nil {
		fromID = from.Type.ID
	}
	if to.Type != nil {
		toID = to.Type.ID
	}
	if fromID == toID && from.Level == to.Level {
		return nil
	}
	if from.Type != nil {
		if l, ok := from.Type.FindLevel(from.Level); ok && l.UserOnly {
			return fmt.Errorf("%w: o zettel está num nível reservado ao usuário (%q); só o usuário pode mudá-lo", ErrReservedLevel, l.Key)
		}
	}
	if to.Type != nil {
		if l, ok := to.Type.FindLevel(to.Level); ok && l.UserOnly {
			return fmt.Errorf("%w: o nível %q é reservado ao usuário; só ele pode marcá-lo", ErrReservedLevel, l.Key)
		}
	}
	return nil
}
