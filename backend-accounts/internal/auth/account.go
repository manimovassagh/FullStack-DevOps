package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
	"github.com/labstack/echo/v4"
)

// AccountProvider is the part of the Cognito client the account endpoints use.
type AccountProvider interface {
	SignUp(ctx context.Context, in *cognitoidentityprovider.SignUpInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.SignUpOutput, error)
	ConfirmSignUp(ctx context.Context, in *cognitoidentityprovider.ConfirmSignUpInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.ConfirmSignUpOutput, error)
	ResendConfirmationCode(ctx context.Context, in *cognitoidentityprovider.ResendConfirmationCodeInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.ResendConfirmationCodeOutput, error)
	ForgotPassword(ctx context.Context, in *cognitoidentityprovider.ForgotPasswordInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.ForgotPasswordOutput, error)
	ConfirmForgotPassword(ctx context.Context, in *cognitoidentityprovider.ConfirmForgotPasswordInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.ConfirmForgotPasswordOutput, error)
	GetUser(ctx context.Context, in *cognitoidentityprovider.GetUserInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.GetUserOutput, error)
	UpdateUserAttributes(ctx context.Context, in *cognitoidentityprovider.UpdateUserAttributesInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.UpdateUserAttributesOutput, error)
	ChangePassword(ctx context.Context, in *cognitoidentityprovider.ChangePasswordInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.ChangePasswordOutput, error)
	GlobalSignOut(ctx context.Context, in *cognitoidentityprovider.GlobalSignOutInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.GlobalSignOutOutput, error)
}

// Accounts runs the self-service account endpoints: sign up with an emailed code, password reset, profile,
// password change and "sign out everywhere". Cognito keeps the passwords and sends the emails; the browser
// only ever talks to this API, as with sign-in.
//
// Endpoints that take an email address answer the same way whether or not an account exists (resend,
// forgot), so they cannot be used to find out who has an account. Sign-up is the exception every app has:
// it has to say "this email is taken".
type Accounts struct {
	IDP      AccountProvider
	ClientID string
	Login    *Login // for clearing the refresh cookie after "sign out everywhere"
}

// Register mounts the public account endpoints (no token yet) on g.
func (a *Accounts) Register(g *echo.Group) {
	g.POST("/auth/signup", a.signUp)
	g.POST("/auth/confirm", a.confirm)
	g.POST("/auth/resend", a.resend)
	g.POST("/auth/forgot", a.forgot)
	g.POST("/auth/reset", a.reset)
}

// RegisterSignedIn mounts the endpoints that act on the signed-in user, behind require.
func (a *Accounts) RegisterSignedIn(e *echo.Echo, require echo.MiddlewareFunc) {
	e.GET("/api/account", a.profile, require)
	e.PATCH("/api/account", a.updateProfile, require)
	e.POST("/api/account/password", a.changePassword, require)
	e.POST("/api/account/signout-everywhere", a.signOutEverywhere, require)
}

type msg = map[string]string

func badRequest(c echo.Context, s string) error { return c.JSON(http.StatusBadRequest, msg{"error": s}) }

func normEmail(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	addr, err := mail.ParseAddress(s)
	return s, err == nil && addr.Address == s
}

func (a *Accounts) signUp(c echo.Context) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := c.Bind(&body); err != nil {
		return badRequest(c, "invalid request")
	}
	email, ok := normEmail(body.Email)
	if !ok {
		return badRequest(c, "enter a valid email address")
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 80 {
		return badRequest(c, "enter your name (up to 80 characters)")
	}
	out, err := a.IDP.SignUp(c.Request().Context(), &cognitoidentityprovider.SignUpInput{
		ClientId: aws.String(a.ClientID), Username: aws.String(email), Password: aws.String(body.Password),
		UserAttributes: []types.AttributeType{
			{Name: aws.String("email"), Value: aws.String(email)},
			{Name: aws.String("name"), Value: aws.String(name)},
		},
	})
	if err != nil {
		var exists *types.UsernameExistsException
		if errors.As(err, &exists) {
			return c.JSON(http.StatusConflict, msg{"error": "an account with this email already exists: sign in or reset your password"})
		}
		return a.fail(c, err)
	}
	return c.JSON(http.StatusCreated, map[string]any{"confirmed": out.UserConfirmed, "sent_to": deliveredTo(out.CodeDeliveryDetails)})
}

func (a *Accounts) confirm(c echo.Context) error {
	var body struct{ Email, Code string }
	if err := c.Bind(&body); err != nil || body.Email == "" || body.Code == "" {
		return badRequest(c, "email and code are required")
	}
	email, _ := normEmail(body.Email)
	_, err := a.IDP.ConfirmSignUp(c.Request().Context(), &cognitoidentityprovider.ConfirmSignUpInput{
		ClientId: aws.String(a.ClientID), Username: aws.String(email), ConfirmationCode: aws.String(strings.TrimSpace(body.Code)),
	})
	if err != nil {
		return a.fail(c, err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (a *Accounts) resend(c echo.Context) error {
	var body struct{ Email string }
	_ = c.Bind(&body)
	email, ok := normEmail(body.Email)
	if !ok {
		return badRequest(c, "enter a valid email address")
	}
	if _, err := a.IDP.ResendConfirmationCode(c.Request().Context(), &cognitoidentityprovider.ResendConfirmationCodeInput{
		ClientId: aws.String(a.ClientID), Username: aws.String(email),
	}); err != nil && !quiet(err) {
		return a.fail(c, err)
	}
	return c.NoContent(http.StatusNoContent) // same answer whether or not the account exists
}

func (a *Accounts) forgot(c echo.Context) error {
	var body struct{ Email string }
	_ = c.Bind(&body)
	email, ok := normEmail(body.Email)
	if !ok {
		return badRequest(c, "enter a valid email address")
	}
	if _, err := a.IDP.ForgotPassword(c.Request().Context(), &cognitoidentityprovider.ForgotPasswordInput{
		ClientId: aws.String(a.ClientID), Username: aws.String(email),
	}); err != nil && !quiet(err) {
		return a.fail(c, err)
	}
	return c.NoContent(http.StatusNoContent) // same answer whether or not the account exists
}

func (a *Accounts) reset(c echo.Context) error {
	var body struct{ Email, Code, Password string }
	if err := c.Bind(&body); err != nil || body.Email == "" || body.Code == "" || body.Password == "" {
		return badRequest(c, "email, code and new password are required")
	}
	email, _ := normEmail(body.Email)
	_, err := a.IDP.ConfirmForgotPassword(c.Request().Context(), &cognitoidentityprovider.ConfirmForgotPasswordInput{
		ClientId: aws.String(a.ClientID), Username: aws.String(email),
		ConfirmationCode: aws.String(strings.TrimSpace(body.Code)), Password: aws.String(body.Password),
	})
	if err != nil {
		return a.fail(c, err)
	}
	return c.NoContent(http.StatusNoContent)
}

// bearer is the caller's access token: Cognito's self-service calls take it, so a user can only ever
// read or change their own account.
func bearer(c echo.Context) *string {
	raw, _ := strings.CutPrefix(c.Request().Header.Get("Authorization"), "Bearer ")
	return aws.String(raw)
}

func (a *Accounts) profile(c echo.Context) error {
	out, err := a.IDP.GetUser(c.Request().Context(), &cognitoidentityprovider.GetUserInput{AccessToken: bearer(c)})
	if err != nil {
		return a.fail(c, err)
	}
	p := map[string]any{"email": "", "name": "", "email_verified": false}
	for _, at := range out.UserAttributes {
		switch v := aws.ToString(at.Value); aws.ToString(at.Name) {
		case "email":
			p["email"] = v
		case "name":
			p["name"] = v
		case "email_verified":
			p["email_verified"] = v == "true"
		}
	}
	cl, _ := ClaimsFrom(c)
	p["id"], p["admin"] = cl.Subject, cl.Admin
	return c.JSON(http.StatusOK, p)
}

func (a *Accounts) updateProfile(c echo.Context) error {
	var body struct{ Name string }
	if err := c.Bind(&body); err != nil {
		return badRequest(c, "invalid request")
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 80 {
		return badRequest(c, "enter your name (up to 80 characters)")
	}
	if _, err := a.IDP.UpdateUserAttributes(c.Request().Context(), &cognitoidentityprovider.UpdateUserAttributesInput{
		AccessToken: bearer(c), UserAttributes: []types.AttributeType{{Name: aws.String("name"), Value: aws.String(name)}},
	}); err != nil {
		return a.fail(c, err)
	}
	return a.profile(c)
}

func (a *Accounts) changePassword(c echo.Context) error {
	var body struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if err := c.Bind(&body); err != nil || body.Current == "" || body.New == "" {
		return badRequest(c, "current and new password are required")
	}
	if _, err := a.IDP.ChangePassword(c.Request().Context(), &cognitoidentityprovider.ChangePasswordInput{
		AccessToken: bearer(c), PreviousPassword: aws.String(body.Current), ProposedPassword: aws.String(body.New),
	}); err != nil {
		var notAuth *types.NotAuthorizedException
		if errors.As(err, &notAuth) {
			return badRequest(c, "the current password is not right")
		}
		return a.fail(c, err)
	}
	return c.NoContent(http.StatusNoContent)
}

// signOutEverywhere ends every session of this user: Cognito revokes all their tokens (other browsers stop
// working at their next refresh) and this browser's refresh cookie goes now.
func (a *Accounts) signOutEverywhere(c echo.Context) error {
	if _, err := a.IDP.GlobalSignOut(c.Request().Context(), &cognitoidentityprovider.GlobalSignOutInput{AccessToken: bearer(c)}); err != nil {
		return a.fail(c, err)
	}
	a.Login.clearRefreshCookie(c)
	return c.NoContent(http.StatusNoContent)
}

func deliveredTo(d *types.CodeDeliveryDetailsType) string {
	if d == nil {
		return ""
	}
	return aws.ToString(d.Destination) // masked by Cognito, e.g. a***@e***
}

// quiet: errors that would reveal whether an account exists; the endpoint answers as if it worked.
func quiet(err error) bool {
	var noUser *types.UserNotFoundException
	var notAuth *types.NotAuthorizedException
	var invalid *types.InvalidParameterException
	return errors.As(err, &noUser) || errors.As(err, &notAuth) || errors.As(err, &invalid)
}

// fail turns Cognito's errors into answers a person can act on.
func (a *Accounts) fail(c echo.Context, err error) error {
	var (
		badPw     *types.InvalidPasswordException
		mismatch  *types.CodeMismatchException
		expired   *types.ExpiredCodeException
		limit     *types.LimitExceededException
		throttled *types.TooManyRequestsException
		tooMany   *types.TooManyFailedAttemptsException
		notAuth   *types.NotAuthorizedException
		invalid   *types.InvalidParameterException
	)
	switch {
	case errors.As(err, &badPw):
		return badRequest(c, "password too weak: at least 12 characters with upper and lower case, a number and a symbol")
	case errors.As(err, &mismatch):
		return badRequest(c, "that code is not right")
	case errors.As(err, &expired):
		return badRequest(c, "that code has expired: ask for a new one")
	case errors.As(err, &limit), errors.As(err, &throttled), errors.As(err, &tooMany):
		return c.JSON(http.StatusTooManyRequests, msg{"error": "too many attempts, try again later"})
	case errors.As(err, &notAuth):
		return c.JSON(http.StatusUnauthorized, msg{"error": "not signed in"})
	case errors.As(err, &invalid):
		return badRequest(c, "check what you entered and try again")
	}
	slog.Error("cognito account call failed", "err", err)
	return c.JSON(http.StatusBadGateway, msg{"error": "account service unavailable"})
}
