package decls

import (
	"errors"
	"time"
)

var KillGrace = 5 * time.Second

const Timeout = 30

// Sentinel errors, in the grouped form Go code almost always uses.
var (
	// ErrInvalidConfig is returned for a malformed configuration.
	ErrInvalidConfig = errors.New("invalid config")

	errInternal = errors.New("internal")
	retries     int
)

const (
	StateIdle Kind = iota
	StateBusy
	stateGone
)

var First, Second = 1, 2

func Run() error {
	var local = errors.New("local")
	return local
}
