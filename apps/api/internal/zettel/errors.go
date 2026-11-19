package zettel

import (
	"errors"
	"fmt"
)

// Erros do serviço/repositório de zettels, comparáveis com errors.Is. Os
// handlers REST os mapeiam para 404, 409, 400 e 409; o MCP, para mensagens.
var (
	ErrNotFound      = errors.New("not found")
	ErrConflict      = errors.New("conflict")
	ErrInvalid       = errors.New("invalid")
	ErrPatchMismatch = errors.New("patch mismatch")
	// ErrForbidden: a escrita é válida, mas a origem (agente) não pode fazê-la:
	// seção protegida ou nível reservado ao usuário. Vira 403 no REST.
	ErrForbidden = errors.New("forbidden")
)

// PatchMismatchError diz quantas vezes o trecho apareceu (0 ou mais de 1).
// errors.Is(err, ErrPatchMismatch) é verdadeiro.
type PatchMismatchError struct{ Count int }

func (e *PatchMismatchError) Error() string {
	return fmt.Sprintf("o trecho aparece %d vezes no corpo; precisa aparecer exatamente uma", e.Count)
}

func (e *PatchMismatchError) Is(target error) bool { return target == ErrPatchMismatch }

// invalid embrulha ErrInvalid com uma mensagem legível.
func invalid(msg string) error { return fmt.Errorf("%w: %s", ErrInvalid, msg) }

// forbidden embrulha ErrForbidden com uma mensagem legível.
func forbidden(msg string) error { return fmt.Errorf("%w: %s", ErrForbidden, msg) }

// conflict embrulha ErrConflict com uma mensagem legível.
func conflict(msg string) error { return fmt.Errorf("%w: %s", ErrConflict, msg) }
