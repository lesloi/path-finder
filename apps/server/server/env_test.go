package server

import (
	"strings"
	"testing"
	"time"
)

func env(vars map[string]string) func(string) string { return func(k string) string { return vars[k] } }

func TestConfigFromEnvDefaults(t *testing.T) {
	cfg, err := ConfigFromEnv(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Limits || cfg.Log != nil || cfg.WebRoot != "../web/dist" || !cfg.Elevation {
		t.Errorf("defaults = %+v", cfg)
	}
	if cfg.LoopLimit != 0 || cfg.RateLimit != 0 || cfg.RateWindow != 0 || cfg.GenerationTimeout != 0 {
		t.Errorf("unset caps must stay zero for New to default them: %+v", cfg)
	}
}

func TestConfigFromEnvReadsTheCaps(t *testing.T) {
	cfg, err := ConfigFromEnv(env(map[string]string{
		"LOOP_LIMIT": "4", "RATE_LIMIT": "30", "RATE_WINDOW": "1m", "GENERATION_TIMEOUT": "45s",
		"WEB_ROOT": "/srv/web", "TRUSTED_PROXIES": "10.0.0.0/8",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LoopLimit != 4 || cfg.RateLimit != 30 || cfg.RateWindow != time.Minute ||
		cfg.GenerationTimeout != 45*time.Second || cfg.WebRoot != "/srv/web" || len(cfg.TrustedProxies) != 1 {
		t.Errorf("config = %+v", cfg)
	}
}

func TestConfigFromEnvDevelopment(t *testing.T) {
	cfg, err := ConfigFromEnv(env(map[string]string{"APP_ENV": "development"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Limits || cfg.Log == nil {
		t.Errorf("development: limits %v, log %v", cfg.Limits, cfg.Log)
	}
}

func TestConfigFromEnvNamesTheWrongVariable(t *testing.T) {
	for name, value := range map[string]string{
		"LOOP_LIMIT": "0", "RATE_LIMIT": "many", "RATE_WINDOW": "10", "GENERATION_TIMEOUT": "-5s", "TRUSTED_PROXIES": "nope",
	} {
		_, err := ConfigFromEnv(env(map[string]string{name: value}))
		if err == nil || !strings.Contains(err.Error(), name) {
			t.Errorf("%s=%s: err = %v", name, value, err)
		}
	}
}
