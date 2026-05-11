package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	authCookieName = "bf_sess"
	authUser       = "admin"
	authPass       = "a8f5f167f44f4964e6c998dee827110c"
	sessionDays    = 30
)

func authSessionSecret() []byte {
	s := strings.TrimSpace(os.Getenv("AUTH_SESSION_SECRET"))
	if s == "" {
		s = "bf-wallet-analyzer-local-hmac-v1"
	}
	return []byte(s)
}

func signSession(user string, expUnix int64) (string, error) {
	payload := user + "|" + strconv.FormatInt(expUnix, 10)
	mac := hmac.New(sha256.New, authSessionSecret())
	mac.Write([]byte(payload))
	sig := mac.Sum(nil)
	tok := base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(sig)
	return tok, nil
}

func parseSession(cookieVal string) (user string, err error) {
	parts := strings.Split(cookieVal, ".")
	if len(parts) != 2 {
		return "", errors.New("bad token")
	}
	rawPayload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	payload := string(rawPayload)
	mac := hmac.New(sha256.New, authSessionSecret())
	mac.Write([]byte(payload))
	expected := mac.Sum(nil)
	if subtle.ConstantTimeCompare(sig, expected) != 1 {
		return "", errors.New("bad sig")
	}
	i := strings.LastIndexByte(payload, '|')
	if i <= 0 || i >= len(payload)-1 {
		return "", errors.New("bad payload")
	}
	u := payload[:i]
	expStr := payload[i+1:]
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil {
		return "", err
	}
	if time.Now().Unix() > exp {
		return "", errors.New("expired")
	}
	return u, nil
}

func sessionUser(r *http.Request) (string, error) {
	c, err := r.Cookie(authCookieName)
	if err != nil || c.Value == "" {
		return "", errors.New("no cookie")
	}
	return parseSession(c.Value)
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   sessionDays * 24 * 3600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
	})
}

func credsOK(username, password string) bool {
	u := []byte(username)
	p := []byte(password)
	// Pad to max length for timing-safe compare on variable inputs would be wrong;
	// compare fixed expected lengths only.
	if len(u) != len([]byte(authUser)) || len(p) != len([]byte(authPass)) {
		return false
	}
	return subtle.ConstantTimeCompare(u, []byte(authUser)) == 1 &&
		subtle.ConstantTimeCompare(p, []byte(authPass)) == 1
}

func authLoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if !credsOK(strings.TrimSpace(body.Username), body.Password) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "Неверный логин или пароль"})
		return
	}
	exp := time.Now().Add(sessionDays * 24 * time.Hour).Unix()
	tok, err := signSession(authUser, exp)
	if err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	setSessionCookie(w, r, tok)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "user": authUser})
}

func authLogoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	clearSessionCookie(w, r)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func authMeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	u, err := sessionUser(r)
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "user": u})
}

func withAPIAuth(inner http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == "/api/auth/login" && r.Method == http.MethodPost {
			inner.ServeHTTP(w, r)
			return
		}
		if p == "/api/auth/logout" && r.Method == http.MethodPost {
			inner.ServeHTTP(w, r)
			return
		}
		if p == "/api/auth/me" && r.Method == http.MethodGet {
			inner.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(p, "/api/") {
			if _, err := sessionUser(r); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
				return
			}
		}
		inner.ServeHTTP(w, r)
	})
}
