package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

// serve converts an API Gateway HTTP API event into an http.Request, runs it
// through h, and converts the recorded response back into an API Gateway response.
func serve(ctx context.Context, h http.Handler, ev events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var body io.Reader = strings.NewReader(ev.Body)
	if ev.IsBase64Encoded { // binary uploads (multipart photos) arrive base64-encoded
		raw, err := base64.StdEncoding.DecodeString(ev.Body)
		if err != nil {
			return events.APIGatewayV2HTTPResponse{StatusCode: 400, Body: `{"error":"bad body encoding"}`}, nil
		}
		body = bytes.NewReader(raw)
	}

	target := ev.RawPath
	if ev.RawQueryString != "" {
		target += "?" + ev.RawQueryString
	}
	req, err := http.NewRequestWithContext(ctx, ev.RequestContext.HTTP.Method, target, body)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, fmt.Errorf("build request: %w", err)
	}
	for k, v := range ev.Headers { // API Gateway lower-cases names and joins repeated values with ","
		req.Header.Set(k, v)
	}
	// Payload format 2.0 sends cookies in their own field, not as a Cookie header (the refresh token is one).
	if len(ev.Cookies) > 0 && req.Header.Get("Cookie") == "" {
		req.Header.Set("Cookie", strings.Join(ev.Cookies, "; "))
	}
	req.Host = ev.RequestContext.DomainName
	req.RemoteAddr = ev.RequestContext.HTTP.SourceIP

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	res := rec.Result()
	defer res.Body.Close()

	out, err := io.ReadAll(res.Body)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, fmt.Errorf("read response: %w", err)
	}
	headers := make(map[string]string, len(res.Header))
	for k := range res.Header {
		if k == "Set-Cookie" {
			continue // goes in the response's own cookies field, so several cookies survive
		}
		headers[k] = res.Header.Get(k)
	}
	if release := os.Getenv("RELEASE"); release != "" {
		headers["X-Release"] = release // which deployment answered: lets a rollout test see the new version go live
	}
	return events.APIGatewayV2HTTPResponse{
		StatusCode:      res.StatusCode,
		Headers:         headers,
		Cookies:         res.Header.Values("Set-Cookie"),
		Body:            base64.StdEncoding.EncodeToString(out), // always base64: safe for any content type
		IsBase64Encoded: true,
	}, nil
}
