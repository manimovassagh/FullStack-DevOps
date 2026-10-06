package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
	"github.com/labstack/echo/v4"
)

// IdentityProvider is the part of the Cognito client the sign-in endpoints use.
type IdentityProvider interface {
	InitiateAuth(ctx context.Context, in *cognitoidentityprovider.InitiateAuthInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.InitiateAuthOutput, error)
	GetUser(ctx context.Context, in *cognitoidentityprovider.GetUserInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.GetUserOutput, error)
	RevokeToken(ctx context.Context, in *cognitoidentityprovider.RevokeTokenInput, opts ...func(*cognitoidentityprovider.Options)) (*cognitoidentityprovider.RevokeTokenOutput, error)
}

// Login runs the sign-in endpoints. The browser never talks to Cognito: it posts the password to
// this API over TLS, the API calls Cognito, and the long-lived refresh token goes back as an
// HttpOnly cookie that scripts cannot read. The page keeps only the short-lived access token, in memory.
type Login struct {
	IDP          IdentityProvider
	ClientID     string
	SecureCookie bool // set the Secure flag: true everywhere except plain-HTTP local runs
}

const refreshCookie = "plant_refresh"

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int32  `json:"expires_in"`
}

// Register mounts the public sign-in endpoints on g.
func (l *Login) Register(g *echo.Group) {
	g.POST("/auth/login", l.login)
	g.POST("/auth/refresh", l.refresh)
	g.POST("/auth/logout", l.logout)
}

func (l *Login) login(c echo.Context) error {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.Bind(&body); err != nil || body.Username == "" || body.Password == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "username and password are required"})
	}
	out, err := l.IDP.InitiateAuth(c.Request().Context(), &cognitoidentityprovider.InitiateAuthInput{
		AuthFlow:       types.AuthFlowTypeUserPasswordAuth,
		ClientId:       aws.String(l.ClientID),
		AuthParameters: map[string]string{"USERNAME": body.Username, "PASSWORD": body.Password},
	})
	if err != nil {
		return l.authError(c, err)
	}
	if out.AuthenticationResult == nil {
		// e.g. NEW_PASSWORD_REQUIRED or MFA: the sign-in page for those challenges is not built here.
		return c.JSON(http.StatusForbidden, map[string]string{"error": "additional sign-in step required: " + string(out.ChallengeName)})
	}
	r := out.AuthenticationResult
	if r.RefreshToken != nil {
		l.setRefreshCookie(c, *r.RefreshToken, 30*24*time.Hour)
	}
	return c.JSON(http.StatusOK, tokenResponse{AccessToken: aws.ToString(r.AccessToken), ExpiresIn: r.ExpiresIn})
}

func (l *Login) refresh(c echo.Context) error {
	ck, err := c.Cookie(refreshCookie)
	if err != nil || ck.Value == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "not signed in"})
	}
	out, err := l.IDP.InitiateAuth(c.Request().Context(), &cognitoidentityprovider.InitiateAuthInput{
		AuthFlow:       types.AuthFlowTypeRefreshTokenAuth,
		ClientId:       aws.String(l.ClientID),
		AuthParameters: map[string]string{"REFRESH_TOKEN": ck.Value},
	})
	if err != nil {
		l.clearRefreshCookie(c)
		return l.authError(c, err)
	}
	if out.AuthenticationResult == nil {
		l.clearRefreshCookie(c)
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "not signed in"})
	}
	return c.JSON(http.StatusOK, tokenResponse{AccessToken: aws.ToString(out.AuthenticationResult.AccessToken), ExpiresIn: out.AuthenticationResult.ExpiresIn})
}

func (l *Login) logout(c echo.Context) error {
	if ck, err := c.Cookie(refreshCookie); err == nil && ck.Value != "" {
		// Revoke it in Cognito so a stolen copy stops working; the cookie is cleared either way.
		if _, err := l.IDP.RevokeToken(c.Request().Context(), &cognitoidentityprovider.RevokeTokenInput{
			ClientId: aws.String(l.ClientID), Token: aws.String(ck.Value),
		}); err != nil {
			slog.Warn("could not revoke refresh token", "err", err)
		}
	}
	l.clearRefreshCookie(c)
	return c.NoContent(http.StatusNoContent)
}

// authError answers wrong credentials and unknown users identically, so the endpoint
// cannot be used to find out which usernames exist.
func (l *Login) authError(c echo.Context, err error) error {
	var notAuth *types.NotAuthorizedException
	var noUser *types.UserNotFoundException
	var notConfirmed *types.UserNotConfirmedException
	var throttled *types.TooManyRequestsException
	switch {
	case errors.As(err, &notAuth), errors.As(err, &noUser), errors.As(err, &notConfirmed):
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid username or password"})
	case errors.As(err, &throttled):
		return c.JSON(http.StatusTooManyRequests, map[string]string{"error": "too many attempts, try again later"})
	}
	slog.Error("cognito call failed", "err", err)
	return c.JSON(http.StatusBadGateway, map[string]string{"error": "sign-in service unavailable"})
}

func (l *Login) setRefreshCookie(c echo.Context, value string, ttl time.Duration) {
	c.SetCookie(&http.Cookie{
		Name: refreshCookie, Value: value, Path: "/api/auth", MaxAge: int(ttl.Seconds()),
		HttpOnly: true, Secure: l.SecureCookie, SameSite: http.SameSiteStrictMode,
	})
}

func (l *Login) clearRefreshCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{
		Name: refreshCookie, Value: "", Path: "/api/auth", MaxAge: -1,
		HttpOnly: true, Secure: l.SecureCookie, SameSite: http.SameSiteStrictMode,
	})
}

// NewCognitoClient builds the Cognito client. endpoint is empty on real AWS and Floci's URL locally.
func NewCognitoClient(ctx context.Context, region, endpoint string) (*cognitoidentityprovider.Client, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return cognitoidentityprovider.NewFromConfig(cfg, func(o *cognitoidentityprovider.Options) {
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
		}
	}), nil
}

// Me tells the page who it is signed in as. The access token only carries the user's id, so the
// email comes from Cognito's GetUser (called with the caller's own token); without it the id is shown.
func (l *Login) Me(c echo.Context) error {
	cl, _ := ClaimsFrom(c)
	name := cl.Username
	if raw, ok := strings.CutPrefix(c.Request().Header.Get("Authorization"), "Bearer "); ok {
		if out, err := l.IDP.GetUser(c.Request().Context(), &cognitoidentityprovider.GetUserInput{AccessToken: aws.String(raw)}); err == nil {
			for _, a := range out.UserAttributes {
				if aws.ToString(a.Name) == "email" {
					name = aws.ToString(a.Value)
				}
			}
		} else {
			slog.Warn("could not read the user's profile", "err", err)
		}
	}
	return c.JSON(http.StatusOK, map[string]any{"id": cl.Subject, "username": name, "admin": cl.Admin})
}
