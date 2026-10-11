package main

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func event(method, path, query, body string, b64 bool) events.APIGatewayV2HTTPRequest {
	ev := events.APIGatewayV2HTTPRequest{RawPath: path, RawQueryString: query, Body: body, IsBase64Encoded: b64,
		Headers: map[string]string{"content-type": "text/plain"}}
	ev.RequestContext.HTTP.Method = method
	ev.RequestContext.HTTP.SourceIP = "203.0.113.9"
	ev.RequestContext.DomainName = "api.example.test"
	return ev
}

func TestServeRoundTrip(t *testing.T) {
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		w.Header().Set("X-Echo", r.Method+" "+r.URL.RequestURI()+" "+r.Host+" "+r.Header.Get("Content-Type"))
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write(b)
	})
	res, err := serve(context.Background(), h, event("POST", "/api/plants", "a=1&b=2", "hello", false))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusCreated {
		t.Errorf("status = %d, want 201", res.StatusCode)
	}
	if got, want := res.Headers["X-Echo"], "POST /api/plants?a=1&b=2 api.example.test text/plain"; got != want {
		t.Errorf("request seen by handler = %q, want %q", got, want)
	}
	if !res.IsBase64Encoded {
		t.Fatal("response must be base64-encoded")
	}
	if dec, _ := base64.StdEncoding.DecodeString(res.Body); string(dec) != "hello" {
		t.Errorf("body = %q, want hello", dec)
	}
}

func TestServeDecodesBase64Request(t *testing.T) {
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		_, _ = w.Write(b)
	})
	raw := []byte{0, 1, 2, 255} // binary, as in a photo upload
	res, _ := serve(context.Background(), h, event("PUT", "/x", "", base64.StdEncoding.EncodeToString(raw), true))
	if dec, _ := base64.StdEncoding.DecodeString(res.Body); string(dec) != string(raw) {
		t.Errorf("binary body corrupted: %v", dec)
	}
}

func TestServeRejectsBadBase64(t *testing.T) {
	res, _ := serve(context.Background(), http.NotFoundHandler(), event("POST", "/x", "", "!!!not-base64", true))
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", res.StatusCode)
	}
}
