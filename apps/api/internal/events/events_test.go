package events_test

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/events"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
)

const secret = "test-secret"

func token(sub string) string {
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": sub, "role": "member", "exp": time.Now().Add(time.Hour).Unix(),
	})
	s, _ := tok.SignedString([]byte(secret))
	return s
}

func recv(t *testing.T, ch <-chan events.Event) events.Event {
	t.Helper()
	select {
	case ev := <-ch:
		return ev
	case <-time.After(time.Second):
		t.Fatal("evento não chegou")
	}
	return events.Event{}
}

func TestBrokerIsolation(t *testing.T) {
	b := events.NewBroker()
	a, _, ca := b.Subscribe("A")
	bb, _, cb := b.Subscribe("B")
	defer ca()
	defer cb()
	b.Publish("A", events.Event{Kind: "zettel", Op: "upsert", IDs: []string{"1"}})
	if ev := recv(t, a); ev.IDs[0] != "1" || ev.At == 0 {
		t.Fatalf("evento: %+v", ev)
	}
	select {
	case ev := <-bb:
		t.Fatalf("B recebeu evento de A: %+v", ev)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestBrokerSlowSubscriberGetsResync(t *testing.T) {
	b := events.NewBroker()
	ch, _, cancel := b.Subscribe("A")
	defer cancel()
	for i := 0; i < 40; i++ { // buffer de 32: 8 se perdem, sem bloquear
		b.Publish("A", events.Event{Kind: "zettel", Op: "upsert"})
	}
	for i := 0; i < 32; i++ {
		<-ch
	}
	b.Publish("A", events.Event{Kind: "zettel", Op: "upsert", IDs: []string{"novo"}})
	if ev := recv(t, ch); ev.Kind != "resync" {
		t.Fatalf("want resync, got %+v", ev)
	}
	if ev := recv(t, ch); ev.IDs[0] != "novo" {
		t.Fatalf("depois do resync: %+v", ev)
	}
}

func TestBrokerMaxPerUser(t *testing.T) {
	b := events.NewBroker()
	_, first, _ := b.Subscribe("A")
	for i := 0; i < events.MaxPerUser; i++ {
		b.Subscribe("A")
	}
	select {
	case <-first:
	default:
		t.Fatal("a conexão mais antiga não caiu")
	}
	if n := b.Subscribers("A"); n != events.MaxPerUser {
		t.Fatalf("conexões: %d", n)
	}
}

// Mesmo arranjo do main.go: timeout por grupo, /api/events fora dele.
func newServer(t *testing.T, b *events.Broker, to time.Duration) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(middleware.Logger) // como no main.go: o Flush precisa atravessar o wrapper
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(secret))
		r.Get("/api/events", events.Handler(b))
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.Timeout(to))
		r.Use(auth.RequireAuth(secret))
		r.Get("/api/slow", func(w http.ResponseWriter, req *http.Request) {
			select {
			case <-req.Context().Done():
			case <-time.After(5 * to):
				w.WriteHeader(http.StatusOK)
			}
		})
	})
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func open(t *testing.T, ctx context.Context, url, auth string) (*http.Response, *bufio.Reader) {
	t.Helper()
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("Authorization", auth)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp, bufio.NewReader(resp.Body)
}

func TestSSEDeliversHeartbeatsAndOutlivesTimeout(t *testing.T) {
	old := events.HeartbeatInterval
	events.HeartbeatInterval = 30 * time.Millisecond
	defer func() { events.HeartbeatInterval = old }()

	b := events.NewBroker()
	srv := newServer(t, b, 100*time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resp, rd := open(t, ctx, srv.URL+"/api/events", "Bearer "+token("A"))
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "text/event-stream" || resp.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("resposta: %d %v", resp.StatusCode, resp.Header)
	}
	if cc := resp.Header.Get("Cache-Control"); !strings.Contains(cc, "no-transform") {
		t.Fatalf("Cache-Control sem no-transform: %q", cc)
	}

	// Passa do timeout das outras rotas e continua recebendo heartbeats.
	time.Sleep(300 * time.Millisecond)
	pings := 0
	deadline := time.Now().Add(time.Second)
	for pings < 2 && time.Now().Before(deadline) {
		line, err := rd.ReadString('\n')
		if err != nil {
			t.Fatalf("stream fechou: %v", err)
		}
		if strings.HasPrefix(line, ": ping") {
			pings++
		}
	}
	if pings < 2 {
		t.Fatal("sem heartbeat")
	}

	for b.Subscribers("A") == 0 {
		time.Sleep(5 * time.Millisecond)
	}
	b.Publish("A", events.Event{Kind: "zettel", Op: "upsert", IDs: []string{"z1"}, Source: "agent"})
	for {
		line, err := rd.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if data, ok := strings.CutPrefix(line, "data: "); ok {
			var ev events.Event
			if err := json.Unmarshal([]byte(data), &ev); err != nil {
				t.Fatal(err)
			}
			if ev.IDs[0] != "z1" || ev.Source != "agent" {
				t.Fatalf("evento: %+v", ev)
			}
			break
		}
	}

	// A rota comum, no grupo com timeout, continua sendo cortada.
	req, _ := http.NewRequest("GET", srv.URL+"/api/slow", nil)
	req.Header.Set("Authorization", "Bearer "+token("A"))
	r2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r2.Body.Close()
	if r2.StatusCode != http.StatusGatewayTimeout {
		t.Fatalf("rota comum: want 504, got %d", r2.StatusCode)
	}
}

func TestSSERejectsAPIKey(t *testing.T) {
	srv := newServer(t, events.NewBroker(), time.Second)
	resp, _ := open(t, context.Background(), srv.URL+"/api/events", "Bearer zk_"+strings.Repeat("ab", 32))
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", resp.StatusCode)
	}
}
