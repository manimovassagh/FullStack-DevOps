package auth

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
	"github.com/labstack/echo/v4"
)

// fakeAccounts answers every call with err (nil = success) and records what it was asked.
type fakeAccounts struct {
	err       error
	signUp    *cognitoidentityprovider.SignUpInput
	token     string
	attrs     []types.AttributeType
	signedOut bool
}

type ctx = context.Context
type opt = func(*cognitoidentityprovider.Options)

func (f *fakeAccounts) SignUp(_ ctx, in *cognitoidentityprovider.SignUpInput, _ ...opt) (*cognitoidentityprovider.SignUpOutput, error) {
	f.signUp = in
	return &cognitoidentityprovider.SignUpOutput{CodeDeliveryDetails: &types.CodeDeliveryDetailsType{Destination: aws.String("a***@e***")}}, f.err
}
func (f *fakeAccounts) ConfirmSignUp(ctx, *cognitoidentityprovider.ConfirmSignUpInput, ...opt) (*cognitoidentityprovider.ConfirmSignUpOutput, error) {
	return &cognitoidentityprovider.ConfirmSignUpOutput{}, f.err
}
func (f *fakeAccounts) ResendConfirmationCode(ctx, *cognitoidentityprovider.ResendConfirmationCodeInput, ...opt) (*cognitoidentityprovider.ResendConfirmationCodeOutput, error) {
	return &cognitoidentityprovider.ResendConfirmationCodeOutput{}, f.err
}
func (f *fakeAccounts) ForgotPassword(ctx, *cognitoidentityprovider.ForgotPasswordInput, ...opt) (*cognitoidentityprovider.ForgotPasswordOutput, error) {
	return &cognitoidentityprovider.ForgotPasswordOutput{}, f.err
}
func (f *fakeAccounts) ConfirmForgotPassword(ctx, *cognitoidentityprovider.ConfirmForgotPasswordInput, ...opt) (*cognitoidentityprovider.ConfirmForgotPasswordOutput, error) {
	return &cognitoidentityprovider.ConfirmForgotPasswordOutput{}, f.err
}
func (f *fakeAccounts) GetUser(_ ctx, in *cognitoidentityprovider.GetUserInput, _ ...opt) (*cognitoidentityprovider.GetUserOutput, error) {
	f.token = aws.ToString(in.AccessToken)
	return &cognitoidentityprovider.GetUserOutput{UserAttributes: []types.AttributeType{
		{Name: aws.String("email"), Value: aws.String("alice@plant.example")}, {Name: aws.String("name"), Value: aws.String("Alice")},
	}}, f.err
}
func (f *fakeAccounts) UpdateUserAttributes(_ ctx, in *cognitoidentityprovider.UpdateUserAttributesInput, _ ...opt) (*cognitoidentityprovider.UpdateUserAttributesOutput, error) {
	f.token, f.attrs = aws.ToString(in.AccessToken), in.UserAttributes
	return &cognitoidentityprovider.UpdateUserAttributesOutput{}, f.err
}
func (f *fakeAccounts) ChangePassword(_ ctx, in *cognitoidentityprovider.ChangePasswordInput, _ ...opt) (*cognitoidentityprovider.ChangePasswordOutput, error) {
	f.token = aws.ToString(in.AccessToken)
	return &cognitoidentityprovider.ChangePasswordOutput{}, f.err
}
func (f *fakeAccounts) GlobalSignOut(_ ctx, in *cognitoidentityprovider.GlobalSignOutInput, _ ...opt) (*cognitoidentityprovider.GlobalSignOutOutput, error) {
	f.token, f.signedOut = aws.ToString(in.AccessToken), true
	return &cognitoidentityprovider.GlobalSignOutOutput{}, f.err
}

// call runs one request through the account endpoints; signed-in routes get a pass-through middleware
// (the verifier itself is tested in auth_test.go).
func call(f *fakeAccounts, method, path, body string) *httptest.ResponseRecorder {
	e := echo.New()
	a := &Accounts{IDP: f, ClientID: "c", Login: &Login{}}
	a.Register(e.Group("/api"))
	a.RegisterSignedIn(e, func(next echo.HandlerFunc) echo.HandlerFunc { return next })
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer TOKEN")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestSignUpSendsEmailAndName(t *testing.T) {
	f := &fakeAccounts{}
	rec := call(f, http.MethodPost, "/api/auth/signup", `{"email":" Alice@Plant.Example ","password":"Plant-Parent-2026!","name":"Alice"}`)
	if rec.Code != http.StatusCreated || aws.ToString(f.signUp.Username) != "alice@plant.example" {
		t.Fatalf("status %d, username %q", rec.Code, aws.ToString(f.signUp.Username))
	}
	if !strings.Contains(rec.Body.String(), `"sent_to":"a***@e***"`) {
		t.Errorf("body %s", rec.Body.String())
	}
}

func TestAccountErrors(t *testing.T) {
	cases := []struct {
		name, method, path, body string
		err                      error
		want                     int
		says                     string
	}{
		{"bad email", "POST", "/api/auth/signup", `{"email":"nope","password":"x","name":"A"}`, nil, 400, "valid email"},
		{"no name", "POST", "/api/auth/signup", `{"email":"a@b.co","password":"x","name":" "}`, nil, 400, "your name"},
		{"email taken", "POST", "/api/auth/signup", `{"email":"a@b.co","password":"x","name":"A"}`, &types.UsernameExistsException{}, 409, "already exists"},
		{"weak password", "POST", "/api/auth/signup", `{"email":"a@b.co","password":"x","name":"A"}`, &types.InvalidPasswordException{}, 400, "too weak"},
		{"wrong code", "POST", "/api/auth/confirm", `{"email":"a@b.co","code":"1"}`, &types.CodeMismatchException{}, 400, "not right"},
		{"expired code", "POST", "/api/auth/reset", `{"email":"a@b.co","code":"1","password":"x"}`, &types.ExpiredCodeException{}, 400, "expired"},
		{"throttled", "POST", "/api/auth/confirm", `{"email":"a@b.co","code":"1"}`, &types.LimitExceededException{}, 429, "too many"},
		{"cognito down", "POST", "/api/auth/confirm", `{"email":"a@b.co","code":"1"}`, errors.New("dial tcp"), 502, "unavailable"},
		{"wrong current password", "POST", "/api/account/password", `{"current":"x","new":"y"}`, &types.NotAuthorizedException{}, 400, "current password"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := call(&fakeAccounts{err: tc.err}, tc.method, tc.path, tc.body)
			if rec.Code != tc.want || !strings.Contains(rec.Body.String(), tc.says) {
				t.Errorf("got %d %s, want %d containing %q", rec.Code, rec.Body.String(), tc.want, tc.says)
			}
		})
	}
}

// Resend and forgot must not tell a stranger whether an account exists.
func TestResendAndForgotDoNotRevealAccounts(t *testing.T) {
	for _, path := range []string{"/api/auth/resend", "/api/auth/forgot"} {
		for _, err := range []error{nil, &types.UserNotFoundException{}, &types.InvalidParameterException{}} {
			if rec := call(&fakeAccounts{err: err}, "POST", path, `{"email":"a@b.co"}`); rec.Code != http.StatusNoContent {
				t.Errorf("%s with %T: %d, want 204 either way", path, err, rec.Code)
			}
		}
	}
}

func TestSignedInCallsUseTheCallersOwnToken(t *testing.T) {
	f := &fakeAccounts{}
	if rec := call(f, http.MethodPatch, "/api/account", `{"name":"  Alice B  "}`); rec.Code != 200 || f.token != "TOKEN" ||
		aws.ToString(f.attrs[0].Value) != "Alice B" || !strings.Contains(rec.Body.String(), `"email":"alice@plant.example"`) {
		t.Fatalf("update: %d %s token=%q attrs=%v", rec.Code, rec.Body.String(), f.token, f.attrs)
	}
	f = &fakeAccounts{}
	rec := call(f, http.MethodPost, "/api/account/signout-everywhere", ``)
	if rec.Code != http.StatusNoContent || !f.signedOut || f.token != "TOKEN" {
		t.Fatalf("sign out everywhere: %d signedOut=%v", rec.Code, f.signedOut)
	}
	if ck := rec.Result().Cookies(); len(ck) != 1 || ck[0].Name != refreshCookie || ck[0].MaxAge >= 0 {
		t.Errorf("refresh cookie not cleared: %+v", ck)
	}
}

func TestUnconfirmedSignInPointsToTheCode(t *testing.T) {
	rec := post(&Login{IDP: &fakeIDP{err: &types.UserNotConfirmedException{}}, ClientID: "c"}, "/api/auth/login", `{"username":"a","password":"b"}`, nil)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), `"code":"not_confirmed"`) {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}
