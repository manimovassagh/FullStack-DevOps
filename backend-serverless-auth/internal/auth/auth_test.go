package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"

	"github.com/manimovassagh/FullStack-DevOps/backend-serverless-auth/internal/store"
)

const (
	issuer   = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test"
	clientID = "client-1"
	kid      = "key-1"
)

// signer plays Cognito: it owns a key pair, publishes the public half as a JWKS and signs tokens.
type signer struct{ key *rsa.PrivateKey }

func newSigner(t *testing.T) *signer {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return &signer{key: k}
}

func (s *signer) verifier(t *testing.T) *Verifier {
	t.Helper()
	jwks, _ := json.Marshal(map[string]any{"keys": []map[string]string{{
		"kty": "RSA", "kid": kid, "alg": "RS256", "use": "sig",
		"n": base64.RawURLEncoding.EncodeToString(s.key.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(s.key.E)).Bytes()),
	}}})
	k, err := keyfunc.NewJWKSetJSON(jwks)
	if err != nil {
		t.Fatal(err)
	}
	return NewVerifierWithKeys(issuer, clientID, k)
}

func (s *signer) token(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()
	base := jwt.MapClaims{"sub": "user-1", "iss": issuer, "token_use": "access", "client_id": clientID,
		"username": "alice", "exp": time.Now().Add(time.Hour).Unix()}
	for k, v := range claims {
		if v == nil {
			delete(base, k)
		} else {
			base[k] = v
		}
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, base)
	tok.Header["kid"] = kid
	raw, err := tok.SignedString(s.key)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestVerify(t *testing.T) {
	s := newSigner(t)
	v := s.verifier(t)
	other := newSigner(t) // a different key pair: a forger

	cases := []struct {
		name    string
		token   string
		wantErr bool
	}{
		{"valid", s.token(t, nil), false},
		{"expired", s.token(t, jwt.MapClaims{"exp": time.Now().Add(-time.Minute).Unix()}), true},
		{"wrong issuer", s.token(t, jwt.MapClaims{"iss": "https://evil.example/pool"}), true},
		{"id token instead of access token", s.token(t, jwt.MapClaims{"token_use": "id"}), true},
		{"other app client", s.token(t, jwt.MapClaims{"client_id": "someone-else"}), true},
		{"no subject", s.token(t, jwt.MapClaims{"sub": nil}), true},
		{"no expiry", s.token(t, jwt.MapClaims{"exp": nil}), true},
		{"signed with a different key", other.token(t, nil), true},
		{"garbage", "not-a-jwt", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := v.Verify(tc.token)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

func TestVerifyRejectsAlgNone(t *testing.T) {
	v := newSigner(t).verifier(t)
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{"sub": "x", "iss": issuer, "token_use": "access",
		"client_id": clientID, "exp": time.Now().Add(time.Hour).Unix()})
	tok.Header["kid"] = kid
	raw, _ := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if _, err := v.Verify(raw); err == nil {
		t.Fatal("unsigned token was accepted")
	}
}

func TestVerifyReadsAdminGroup(t *testing.T) {
	s := newSigner(t)
	v := s.verifier(t)
	c, err := v.Verify(s.token(t, jwt.MapClaims{"cognito:groups": []string{"gardeners", "admin"}}))
	if err != nil || !c.Admin || c.Subject != "user-1" || c.Username != "alice" {
		t.Fatalf("claims = %+v, err = %v", c, err)
	}
	c, _ = v.Verify(s.token(t, nil))
	if c.Admin {
		t.Fatal("a user without the admin group must not be admin")
	}
}

func TestRequireScopesTheRequestToTheTokensUser(t *testing.T) {
	s := newSigner(t)
	e := echo.New()
	var got store.Owner
	e.GET("/x", func(c echo.Context) error {
		got, _ = ownerOf(c)
		return c.NoContent(http.StatusOK)
	}, s.verifier(t).Require)

	call := func(header string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec
	}

	if rec := call(""); rec.Code != http.StatusUnauthorized || rec.Header().Get("WWW-Authenticate") == "" {
		t.Errorf("no header: status %d, WWW-Authenticate %q", rec.Code, rec.Header().Get("WWW-Authenticate"))
	}
	if rec := call("Bearer garbage"); rec.Code != http.StatusUnauthorized {
		t.Errorf("bad token: status %d", rec.Code)
	}
	if rec := call("Basic abc"); rec.Code != http.StatusUnauthorized {
		t.Errorf("wrong scheme: status %d", rec.Code)
	}
	if rec := call("Bearer " + s.token(t, jwt.MapClaims{"cognito:groups": []string{"admin"}})); rec.Code != http.StatusOK {
		t.Fatalf("valid token: status %d", rec.Code)
	}
	if got != (store.Owner{ID: "user-1", Admin: true}) {
		t.Errorf("handler ran as %+v", got)
	}
}

// ownerOf reads the owner the middleware put into the request context, through a store call's view of it.
func ownerOf(c echo.Context) (store.Owner, bool) {
	cl, ok := ClaimsFrom(c)
	return store.Owner{ID: cl.Subject, Admin: cl.Admin}, ok
}

// ---- sign-in endpoints ----

type fakeIDP struct {
	out       *cognitoidentityprovider.InitiateAuthOutput
	err       error
	gotFlow   types.AuthFlowType
	gotParams map[string]string
	revoked   string
}

func (f *fakeIDP) InitiateAuth(_ context.Context, in *cognitoidentityprovider.InitiateAuthInput, _ ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.InitiateAuthOutput, error) {
	f.gotFlow, f.gotParams = in.AuthFlow, in.AuthParameters
	return f.out, f.err
}

func (f *fakeIDP) GetUser(context.Context, *cognitoidentityprovider.GetUserInput, ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.GetUserOutput, error) {
	return &cognitoidentityprovider.GetUserOutput{UserAttributes: []types.AttributeType{{Name: aws.String("email"), Value: aws.String("alice@plant.example")}}}, nil
}

func (f *fakeIDP) RevokeToken(_ context.Context, in *cognitoidentityprovider.RevokeTokenInput, _ ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.RevokeTokenOutput, error) {
	f.revoked = *in.Token
	return &cognitoidentityprovider.RevokeTokenOutput{}, nil
}

func post(l *Login, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	e := echo.New()
	l.Register(e.Group("/api"))
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func authResult(access, refresh string) *cognitoidentityprovider.InitiateAuthOutput {
	r := &types.AuthenticationResultType{AccessToken: &access, ExpiresIn: 3600}
	if refresh != "" {
		r.RefreshToken = &refresh
	}
	return &cognitoidentityprovider.InitiateAuthOutput{AuthenticationResult: r}
}

func TestLoginReturnsAccessTokenAndHidesRefreshTokenInACookie(t *testing.T) {
	idp := &fakeIDP{out: authResult("ACCESS", "REFRESH")}
	rec := post(&Login{IDP: idp, ClientID: "c", SecureCookie: true}, "/api/auth/login", `{"username":"alice","password":"pw"}`, nil)

	if rec.Code != http.StatusOK || idp.gotFlow != types.AuthFlowTypeUserPasswordAuth || idp.gotParams["USERNAME"] != "alice" {
		t.Fatalf("status %d, flow %s, params %v", rec.Code, idp.gotFlow, idp.gotParams)
	}
	if strings.Contains(rec.Body.String(), "REFRESH") || !strings.Contains(rec.Body.String(), "ACCESS") {
		t.Errorf("body must carry the access token only: %s", rec.Body.String())
	}
	ck := rec.Result().Cookies()
	if len(ck) != 1 || ck[0].Value != "REFRESH" || !ck[0].HttpOnly || !ck[0].Secure || ck[0].SameSite != http.SameSiteStrictMode || ck[0].Path != "/api/auth" {
		t.Errorf("refresh cookie = %+v", ck)
	}
}

func TestLoginErrors(t *testing.T) {
	cases := []struct {
		name string
		idp  *fakeIDP
		body string
		want int
	}{
		{"wrong password", &fakeIDP{err: &types.NotAuthorizedException{}}, `{"username":"a","password":"b"}`, http.StatusUnauthorized},
		{"unknown user looks the same", &fakeIDP{err: &types.UserNotFoundException{}}, `{"username":"a","password":"b"}`, http.StatusUnauthorized},
		{"throttled", &fakeIDP{err: &types.TooManyRequestsException{}}, `{"username":"a","password":"b"}`, http.StatusTooManyRequests},
		{"cognito down", &fakeIDP{err: errors.New("dial tcp")}, `{"username":"a","password":"b"}`, http.StatusBadGateway},
		{"challenge", &fakeIDP{out: &cognitoidentityprovider.InitiateAuthOutput{ChallengeName: types.ChallengeNameTypeNewPasswordRequired}}, `{"username":"a","password":"b"}`, http.StatusForbidden},
		{"missing password", &fakeIDP{}, `{"username":"a"}`, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := post(&Login{IDP: tc.idp, ClientID: "c"}, "/api/auth/login", tc.body, nil)
			if rec.Code != tc.want {
				t.Fatalf("status %d, want %d (%s)", rec.Code, tc.want, rec.Body.String())
			}
			if len(rec.Result().Cookies()) != 0 {
				t.Error("a failed login must not set a cookie")
			}
		})
	}
}

func TestRefreshUsesTheCookie(t *testing.T) {
	idp := &fakeIDP{out: authResult("NEW-ACCESS", "")}
	l := &Login{IDP: idp, ClientID: "c"}

	if rec := post(l, "/api/auth/refresh", ``, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("without a cookie: status %d", rec.Code)
	}
	rec := post(l, "/api/auth/refresh", ``, &http.Cookie{Name: refreshCookie, Value: "REFRESH"})
	if rec.Code != http.StatusOK || idp.gotFlow != types.AuthFlowTypeRefreshTokenAuth || idp.gotParams["REFRESH_TOKEN"] != "REFRESH" || !strings.Contains(rec.Body.String(), "NEW-ACCESS") {
		t.Fatalf("status %d, flow %s, params %v, body %s", rec.Code, idp.gotFlow, idp.gotParams, rec.Body.String())
	}

	// A refresh token Cognito rejects is dropped from the browser.
	bad := post(&Login{IDP: &fakeIDP{err: &types.NotAuthorizedException{}}, ClientID: "c"}, "/api/auth/refresh", ``, &http.Cookie{Name: refreshCookie, Value: "REVOKED"})
	if bad.Code != http.StatusUnauthorized || len(bad.Result().Cookies()) != 1 || bad.Result().Cookies()[0].MaxAge >= 0 {
		t.Errorf("revoked token: status %d, cookies %+v", bad.Code, bad.Result().Cookies())
	}
}

func TestLogoutRevokesAndClears(t *testing.T) {
	idp := &fakeIDP{}
	rec := post(&Login{IDP: idp, ClientID: "c"}, "/api/auth/logout", ``, &http.Cookie{Name: refreshCookie, Value: "REFRESH"})
	if rec.Code != http.StatusNoContent || idp.revoked != "REFRESH" {
		t.Fatalf("status %d, revoked %q", rec.Code, idp.revoked)
	}
	if ck := rec.Result().Cookies(); len(ck) != 1 || ck[0].MaxAge >= 0 {
		t.Errorf("cookie not cleared: %+v", ck)
	}
}

func TestMeShowsTheEmailFromCognito(t *testing.T) {
	s := newSigner(t)
	e := echo.New()
	l := &Login{IDP: &fakeIDP{}, ClientID: clientID}
	e.GET("/me", l.Me, s.verifier(t).Require)
	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	req.Header.Set("Authorization", "Bearer "+s.token(t, jwt.MapClaims{"username": "0b1c-uuid"}))
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"username":"alice@plant.example"`) {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
}
