// Package auth checks Amazon Cognito access tokens and runs the sign-in endpoints.
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"

	"github.com/manimovassagh/FullStack-DevOps/backend-serverless-auth/internal/store"
)

// AdminGroup is the Cognito group whose members see every user's data.
const AdminGroup = "admin"

// Claims is what the API takes from a verified access token.
type Claims struct {
	Subject  string // "sub": stable, unique user id
	Username string
	Admin    bool
}

// Verifier validates Cognito access tokens against the user pool's public keys (JWKS).
type Verifier struct {
	issuer   string
	clientID string
	keys     keyfunc.Keyfunc
}

// NewVerifier downloads the pool's signing keys from jwksURL and keeps them refreshed.
// issuer is compared with the token's "iss" claim; it is not fetched, so the two can differ
// (on Floci the token says http://localhost:4566/<pool> while the API reaches Floci by container name).
func NewVerifier(ctx context.Context, issuer, jwksURL, clientID string) (*Verifier, error) {
	k, err := keyfunc.NewDefaultCtx(ctx, []string{jwksURL})
	if err != nil {
		return nil, fmt.Errorf("load signing keys from %s: %w", jwksURL, err)
	}
	return NewVerifierWithKeys(issuer, clientID, k), nil
}

// NewVerifierWithKeys builds a Verifier from an existing key source (used by tests).
func NewVerifierWithKeys(issuer, clientID string, keys keyfunc.Keyfunc) *Verifier {
	return &Verifier{issuer: issuer, clientID: clientID, keys: keys}
}

// Verify checks signature, algorithm, issuer, expiry, token type and app client.
func (v *Verifier) Verify(raw string) (Claims, error) {
	var mc jwt.MapClaims
	_, err := jwt.ParseWithClaims(raw, &mc, v.keys.Keyfunc,
		jwt.WithValidMethods([]string{"RS256"}), // never accept "none" or HMAC tokens
		jwt.WithIssuer(v.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return Claims{}, err
	}
	// An ID token also verifies against the same keys, but it is for the client, not for APIs.
	if mc["token_use"] != "access" {
		return Claims{}, errors.New("not an access token")
	}
	if mc["client_id"] != v.clientID {
		return Claims{}, errors.New("token was issued to a different app client")
	}
	sub, _ := mc["sub"].(string)
	if sub == "" {
		return Claims{}, errors.New("token has no subject")
	}
	c := Claims{Subject: sub}
	c.Username, _ = mc["username"].(string)
	if groups, ok := mc["cognito:groups"].([]any); ok {
		for _, g := range groups {
			if g == AdminGroup {
				c.Admin = true
			}
		}
	}
	return c, nil
}

const claimsKey = "auth.claims"

// Require rejects requests without a valid bearer token and runs the rest of the
// request as the token's user: every store query is scoped to that user.
func (v *Verifier) Require(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		h := c.Request().Header.Get("Authorization")
		raw, ok := strings.CutPrefix(h, "Bearer ")
		if !ok || raw == "" {
			return unauthorized(c, "missing bearer token")
		}
		claims, err := v.Verify(raw)
		if err != nil {
			return unauthorized(c, "invalid or expired token")
		}
		c.Set(claimsKey, claims)
		req := c.Request()
		c.SetRequest(req.WithContext(store.WithOwner(req.Context(), store.Owner{ID: claims.Subject, Admin: claims.Admin})))
		return next(c)
	}
}

// ClaimsFrom returns the verified claims of the current request.
func ClaimsFrom(c echo.Context) (Claims, bool) {
	cl, ok := c.Get(claimsKey).(Claims)
	return cl, ok
}

func unauthorized(c echo.Context, msg string) error {
	c.Response().Header().Set("WWW-Authenticate", `Bearer realm="plant-parent"`)
	return c.JSON(http.StatusUnauthorized, map[string]string{"error": msg})
}
