package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/db"
	"github.com/joho/godotenv"
)

func main() {
	username := flag.String("username", "", "username (required)")
	password := flag.String("password", "", "password (required)")
	role := flag.String("role", "member", "role: admin or member")
	dbPath := flag.String("db", "", "path to database (default: DB_PATH env or zettelkasten.db)")
	flag.Parse()

	if *username == "" || *password == "" {
		fmt.Fprintln(os.Stderr, "Usage: createuser -username <name> -password <pass> [-role admin|member] [-db path]")
		os.Exit(1)
	}

	_ = godotenv.Load()

	path := *dbPath
	if path == "" {
		path = getenv("DB_PATH", "zettelkasten.db")
	}

	database, err := db.Open(path)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer database.Close()

	repo := auth.NewRepository(database)
	user, err := repo.CreateUser(*username, *password, *role)
	if err != nil {
		log.Fatalf("create user: %v", err)
	}

	fmt.Printf("User created: id=%s username=%s role=%s\n", user.ID, user.Username, user.Role)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
