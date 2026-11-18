// Package events é o barramento de mudanças em tempo real: as escritas
// publicam por usuário e GET /api/events entrega por SSE a cada aba aberta.
// Em memória — a API roda num processo só.
package events

import (
	"context"
	"sync"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
)

// Event é o aviso de que algo mudou; nunca leva dados — o cliente faz pull.
type Event struct {
	Kind   string   `json:"kind"` // "zettel" | "drawing" | "resync"
	Op     string   `json:"op,omitempty"`
	IDs    []string `json:"ids,omitempty"`
	Source string   `json:"source,omitempty"` // "agent" | "ui"
	At     int64    `json:"at"`
}

const (
	bufferSize = 32
	// MaxPerUser é o teto de conexões abertas por usuário; a mais antiga cai.
	MaxPerUser = 5
)

type sub struct {
	ch     chan Event
	kicked chan struct{}
	missed bool
}

// Broker entrega eventos só às conexões do próprio usuário.
type Broker struct {
	mu   sync.Mutex
	subs map[string][]*sub
	now  func() time.Time
}

func NewBroker() *Broker {
	return &Broker{subs: map[string][]*sub{}, now: time.Now}
}

// Subscribe registra uma conexão. events recebe os eventos; kicked fecha quando
// a conexão é derrubada pelo teto por usuário; cancel a remove.
func (b *Broker) Subscribe(userID string) (events <-chan Event, kicked <-chan struct{}, cancel func()) {
	s := &sub{ch: make(chan Event, bufferSize), kicked: make(chan struct{})}
	b.mu.Lock()
	list := append(b.subs[userID], s)
	for len(list) > MaxPerUser {
		close(list[0].kicked)
		list = list[1:]
	}
	b.subs[userID] = list
	b.mu.Unlock()
	return s.ch, s.kicked, func() { b.remove(userID, s) }
}

func (b *Broker) remove(userID string, s *sub) {
	b.mu.Lock()
	defer b.mu.Unlock()
	list := b.subs[userID]
	for i, x := range list {
		if x == s {
			b.subs[userID] = append(list[:i:i], list[i+1:]...)
			break
		}
	}
	if len(b.subs[userID]) == 0 {
		delete(b.subs, userID)
	}
}

// Publish entrega sem bloquear. Assinante com o buffer cheio perde o evento e
// recebe um "resync" assim que houver espaço (o cliente faz o ciclo completo).
func (b *Broker) Publish(userID string, ev Event) {
	if ev.At == 0 {
		ev.At = b.now().UnixMilli()
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, s := range b.subs[userID] {
		if s.missed {
			select {
			case s.ch <- Event{Kind: "resync", At: ev.At}:
				s.missed = false
			default:
				continue
			}
		}
		select {
		case s.ch <- ev:
		default:
			s.missed = true
		}
	}
}

// Subscribers conta as conexões abertas de um usuário (testes e diagnóstico).
func (b *Broker) Subscribers(userID string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subs[userID])
}

// ZettelNotifier liga o zettel.Service ao broker.
type ZettelNotifier struct{ B *Broker }

func (n ZettelNotifier) Changed(_ context.Context, userID string, ev zettel.ChangeEvent) {
	n.B.Publish(userID, Event{Kind: ev.Kind, Op: ev.Op, IDs: ev.IDs, Source: ev.Source})
}
