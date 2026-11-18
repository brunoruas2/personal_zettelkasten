package events

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
)

// HeartbeatInterval mantém o Nginx (timeout padrão de 60 s) e proxies vivos.
var HeartbeatInterval = 25 * time.Second

// Handler é o GET /api/events: SSE com os eventos do usuário autenticado.
// Precisa ficar fora do middleware.Timeout das outras rotas.
func Handler(b *Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := auth.GetUserID(r)
		rc := http.NewResponseController(w)
		h := w.Header()
		h.Set("Content-Type", "text/event-stream")
		h.Set("Cache-Control", "no-cache")
		h.Set("Connection", "keep-alive")
		h.Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		// Comentário inicial: o cliente sabe que o stream abriu.
		if _, err := fmt.Fprint(w, ": ok\n\n"); err != nil {
			return
		}
		if err := rc.Flush(); err != nil {
			return
		}

		events, kicked, cancel := b.Subscribe(userID)
		defer cancel()
		tick := time.NewTicker(HeartbeatInterval)
		defer tick.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-kicked:
				return
			case <-tick.C:
				if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
					return
				}
			case ev := <-events:
				data, _ := json.Marshal(ev)
				if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
					return
				}
			}
			if err := rc.Flush(); err != nil {
				return
			}
		}
	}
}
