package mcp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/models"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// log_test_session: acrescenta uma sessão ao zettel de Teste do tema, com
// formato fixo, e liga o Teste aos conteúdos testados. Não muda tipo nem nível
// (subir para "testado" continua sendo set_type).

type sessionQuestion struct {
	Technique string `json:"technique" jsonschema:"recuperacao, transferencia, caca-ao-erro ou calibragem"`
	Question  string `json:"question"`
	Answer    string `json:"answer,omitempty" jsonschema:"resposta do usuário, resumida"`
	Correct   bool   `json:"correct" jsonschema:"se acertou"`
}

type sessionGap struct {
	Text   string `json:"text"`
	Closed bool   `json:"closed,omitempty" jsonschema:"true se a lacuna já foi fechada"`
}

type logSessionIn struct {
	Test       string            `json:"test" jsonschema:"id ou título exato do zettel de Teste (tipo teste)"`
	Date       string            `json:"date,omitempty" jsonschema:"AAAA-MM-DD; vazio = hoje"`
	Result     string            `json:"result" jsonschema:"passou, parcial ou nao_passou"`
	Confidence *int              `json:"confidence,omitempty" jsonschema:"confiança do usuário, de 1 a 5"`
	Questions  []sessionQuestion `json:"questions" jsonschema:"perguntas da sessão"`
	Gaps       []sessionGap      `json:"gaps,omitempty" jsonschema:"lacunas, abertas ou fechadas"`
	Concepts   []string          `json:"concepts,omitempty" jsonschema:"títulos exatos dos conteúdos testados"`
}

type logSessionOut struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Date    string   `json:"date"`
	Linked  []string `json:"linked"`
	Skipped []string `json:"skipped"`
}

var (
	sessionResults    = map[string]string{"passou": "passou", "parcial": "parcial", "nao_passou": "não passou"}
	sessionTechniques = map[string]bool{"recuperacao": true, "transferencia": true, "caca-ao-erro": true, "calibragem": true}
)

// oneLine tira quebras de linha: um texto do agente não pode virar cabeçalho.
func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

func formatSession(in logSessionIn, date string, linked []string) (string, error) {
	label, ok := sessionResults[in.Result]
	if !ok {
		return "", fmt.Errorf("result inválido %q; use passou, parcial ou nao_passou", in.Result)
	}
	if len(in.Questions) == 0 {
		return "", errors.New("informe ao menos uma pergunta em questions")
	}
	var b strings.Builder
	fmt.Fprintf(&b, "### %s — %s\n", date, label)
	if in.Confidence != nil {
		if *in.Confidence < 1 || *in.Confidence > 5 {
			return "", errors.New("confidence deve ir de 1 a 5")
		}
		fmt.Fprintf(&b, "Confiança: %d/5\n", *in.Confidence)
	}
	if len(linked) > 0 {
		refs := make([]string, len(linked))
		for i, t := range linked {
			refs[i] = "[[" + t + "]]"
		}
		fmt.Fprintf(&b, "Conteúdos: %s\n", strings.Join(refs, ", "))
	}
	for _, q := range in.Questions {
		if !sessionTechniques[q.Technique] {
			return "", fmt.Errorf("technique inválida %q; use recuperacao, transferencia, caca-ao-erro ou calibragem", q.Technique)
		}
		verdict := "errou"
		if q.Correct {
			verdict = "acertou"
		}
		line := fmt.Sprintf("- [%s] %s", q.Technique, oneLine(q.Question))
		if a := oneLine(q.Answer); a != "" {
			line += " → " + a
		}
		fmt.Fprintf(&b, "%s (%s)\n", line, verdict)
	}
	if len(in.Gaps) > 0 {
		b.WriteString("Lacunas:\n")
		for _, g := range in.Gaps {
			box := " "
			if g.Closed {
				box = "x"
			}
			fmt.Fprintf(&b, "- [%s] %s\n", box, oneLine(g.Text))
		}
	}
	return strings.TrimRight(b.String(), "\n"), nil
}

func (t *tools) resolveZettel(ref string) (*models.Zettel, error) {
	z, err := t.svc.Get(t.userID, ref)
	if errors.Is(err, zettel.ErrNotFound) {
		z, err = t.svc.GetByTitle(t.userID, ref)
	}
	return z, err
}

// editBody grava um corpo novo como agente (a guarda de seção protegida vale).
func (t *tools) editBody(ctx context.Context, z *models.Zettel, body string) (*models.Zettel, error) {
	at := time.Now().UnixMilli()
	if at <= z.UpdatedAt {
		at = z.UpdatedAt + 1
	}
	return t.svc.Update(agentCtx(ctx), t.userID, z.ID, zettel.UpdateInput{
		Title: z.Title, Body: body, Tags: z.Tags, UpdatedAt: at,
	})
}

func (t *tools) logTestSession(ctx context.Context, _ *sdk.CallToolRequest, in logSessionIn) (*sdk.CallToolResult, logSessionOut, error) {
	ref := strings.TrimSpace(in.Test)
	if ref == "" {
		return nil, logSessionOut{}, errors.New("informe test: id ou título do zettel de Teste")
	}
	date := strings.TrimSpace(in.Date)
	if date == "" {
		date = time.Now().Format("2006-01-02")
	} else if _, err := time.Parse("2006-01-02", date); err != nil {
		return nil, logSessionOut{}, fmt.Errorf("date inválida %q; use AAAA-MM-DD", in.Date)
	}

	test, err := t.resolveZettel(ref)
	if err != nil {
		return nil, logSessionOut{}, domainErr(err, ref)
	}
	if info, terr := t.svc.TypeOf(t.userID, test.ID); terr != nil {
		return nil, logSessionOut{}, domainErr(terr, test.ID)
	} else if info.Type == nil || info.Type.Slug != "teste" {
		return nil, logSessionOut{}, fmt.Errorf("«%s» não é do tipo teste; crie o Teste do tema com create_zettel (type: \"teste\") ou use o zettel certo", test.Title)
	}

	out := logSessionOut{ID: test.ID, Title: test.Title, Date: date, Linked: []string{}, Skipped: []string{}}
	var concepts []*models.Zettel
	seen := map[string]bool{}
	for _, title := range in.Concepts {
		title = strings.TrimSpace(title)
		if title == "" {
			continue
		}
		c, cerr := t.svc.GetByTitle(t.userID, title)
		if cerr != nil {
			out.Skipped = append(out.Skipped, fmt.Sprintf("%s (não encontrado)", title))
			continue
		}
		if c.ID == test.ID || seen[c.ID] {
			continue
		}
		seen[c.ID] = true
		concepts = append(concepts, c)
	}
	names := make([]string, len(concepts))
	for i, c := range concepts {
		names[i] = c.Title
	}

	entry, err := formatSession(in, date, names)
	if err != nil {
		return nil, logSessionOut{}, err
	}
	if _, err := t.editBody(ctx, test, zettel.AppendToSection(test.Body, "Sessões", entry)); err != nil {
		return nil, logSessionOut{}, domainErr(err, test.ID)
	}

	// Link de volta no conteúdo: só o fim de "## Testes", e só se ainda não cita o Teste.
	ref2 := "[[" + strings.ToLower(test.Title)
	for _, c := range concepts {
		if strings.Contains(strings.ToLower(c.Body), ref2) {
			out.Linked = append(out.Linked, c.Title)
			continue
		}
		if !hasSection(c.Body, "Testes") {
			out.Skipped = append(out.Skipped, fmt.Sprintf("%s (sem seção ## Testes)", c.Title))
			continue
		}
		if _, err := t.editBody(ctx, c, zettel.AppendToSection(c.Body, "Testes", "- [["+test.Title+"]]")); err != nil {
			if errors.Is(err, zettel.ErrForbidden) {
				out.Skipped = append(out.Skipped, fmt.Sprintf("%s (seção protegida)", c.Title))
				continue
			}
			return nil, out, domainErr(err, c.ID)
		}
		out.Linked = append(out.Linked, c.Title)
	}

	msg := fmt.Sprintf("Sessão de %s (%s) registrada em «%s» (id %s).", date, sessionResults[in.Result], test.Title, test.ID)
	if len(out.Linked) > 0 {
		msg += " Ligado a: " + strings.Join(out.Linked, ", ") + "."
	}
	if len(out.Skipped) > 0 {
		msg += " Omitido: " + strings.Join(out.Skipped, "; ") + "."
	}
	return textResult("%s", msg), out, nil
}

func hasSection(body, title string) bool {
	for _, s := range zettel.ParseSections(body) {
		if strings.EqualFold(strings.Join(strings.Fields(s.Title), " "), title) {
			return true
		}
	}
	return false
}
