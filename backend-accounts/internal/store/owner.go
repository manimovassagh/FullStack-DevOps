package store

import (
	"context"
	"errors"
)

// ErrNoOwner is returned when a query runs without a signed-in user in its context.
// The store refuses to run unscoped queries: forgetting the middleware fails closed.
var ErrNoOwner = errors.New("no owner in context")

// Owner is the signed-in user a request runs as.
type Owner struct {
	ID    string // the Cognito "sub" claim
	Admin bool   // member of the "admin" group: sees every user's data
}

type ownerKey struct{}

// WithOwner returns a context that scopes every store query to o.
func WithOwner(ctx context.Context, o Owner) context.Context {
	return context.WithValue(ctx, ownerKey{}, o)
}

func ownerFrom(ctx context.Context) (Owner, error) {
	o, ok := ctx.Value(ownerKey{}).(Owner)
	if !ok || o.ID == "" {
		return Owner{}, ErrNoOwner
	}
	return o, nil
}

// scope is the value bound to the "($n = ” OR p.owner_id = $n)" clause in every query:
// empty for an admin (no filter), the user's id for everyone else.
func scope(ctx context.Context) (string, error) {
	o, err := ownerFrom(ctx)
	if err != nil {
		return "", err
	}
	if o.Admin {
		return "", nil
	}
	return o.ID, nil
}
