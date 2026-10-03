package server

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

// ConfigFromEnv reads the settings an operator sets for the machine, through getenv. A variable
// that is unset or empty takes its default; one that is set and wrong is an error naming it.
//
//	WEB_ROOT            built web app (default ../web/dist)
//	APP_ENV             "development" turns the limits off and the logs on
//	TRUSTED_PROXIES     reverse proxies whose X-Forwarded-For counts (default none)
//	LOOP_LIMIT          generations running at once, beyond which the answer is 429 (default: follows the CPUs, see
//	                    engine.DefaultConcurrentSearches)
//	RATE_LIMIT          requests per address per RATE_WINDOW (default 60)
//	RATE_WINDOW         a duration such as 10m (default 10m)
//	GENERATION_TIMEOUT  a duration such as 15s (default 15s)
//
// The caps depend on the machine: a generation runs on every CPU it may use (up to 8), so a machine
// with 8 CPUs or fewer runs one at a time and a larger one runs one more per 8 CPUs, and fewer CPUs
// need a longer timeout.
func ConfigFromEnv(getenv func(string) string) (Config, error) {
	cfg := Config{
		WebRoot: "../web/dist",
		// On unless explicitly in development, so forgetting APP_ENV keeps them on.
		Limits: getenv("APP_ENV") != "development",
	}
	if getenv("APP_ENV") == "development" {
		cfg.Log = log.New(os.Stdout, "", log.LstdFlags)
	}
	if v := getenv("WEB_ROOT"); v != "" {
		cfg.WebRoot = v
	}
	var err error
	if list := getenv("TRUSTED_PROXIES"); strings.TrimSpace(list) != "" {
		if cfg.TrustedProxies, err = ParseAddressRanges(list, "TRUSTED_PROXIES"); err != nil {
			return Config{}, err
		}
	}
	if cfg.LoopLimit, err = positiveInt(getenv, "LOOP_LIMIT"); err != nil {
		return Config{}, err
	}
	if cfg.RateLimit, err = positiveInt(getenv, "RATE_LIMIT"); err != nil {
		return Config{}, err
	}
	if cfg.RateWindow, err = positiveDuration(getenv, "RATE_WINDOW"); err != nil {
		return Config{}, err
	}
	if cfg.GenerationTimeout, err = positiveDuration(getenv, "GENERATION_TIMEOUT"); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// positiveInt returns 0, the default, for an unset variable.
func positiveInt(getenv func(string) string, name string) (int, error) {
	v := getenv(name)
	if v == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s must be a positive whole number", name)
	}
	return n, nil
}

func positiveDuration(getenv func(string) string, name string) (time.Duration, error) {
	v := getenv(name)
	if v == "" {
		return 0, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("%s must be a positive duration such as 15s", name)
	}
	return d, nil
}
