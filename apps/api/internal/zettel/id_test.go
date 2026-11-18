package zettel

import (
	"regexp"
	"testing"
	"time"
)

func TestGenerateIDFormat(t *testing.T) {
	re := regexp.MustCompile(`^\d{14}[a-z0-9]{4}$`)
	at := time.Date(2026, 5, 17, 14, 30, 22, 0, time.UTC)
	for i := 0; i < 50; i++ {
		id := generateID(at)
		if !re.MatchString(id) {
			t.Fatalf("id fora do formato: %q", id)
		}
		if id[:14] != "20260517143022" {
			t.Fatalf("prefixo de data errado: %q", id)
		}
	}
}
