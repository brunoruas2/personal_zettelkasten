package zettel

import (
	"crypto/rand"
	"time"
)

const idAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

// generateID espelha o generateId() do core: yyyymmddhhmmss (UTC) + 4 de [a-z0-9].
func generateID(now time.Time) string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	suffix := make([]byte, 4)
	for i, v := range b {
		suffix[i] = idAlphabet[int(v)%len(idAlphabet)]
	}
	return now.UTC().Format("20060102150405") + string(suffix)
}

// NewID gera um id novo no formato padrão (para zettels e desenhos criados no servidor).
func NewID() string { return generateID(time.Now()) }
