package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestPlanZonesIsNoLongerACommand(t *testing.T) {
	// Act
	err := run("plan-zones", nil)

	// Assert
	if err == nil || !strings.Contains(err.Error(), `unknown command "plan-zones"`) {
		t.Fatalf("err = %v, want an unknown command", err)
	}
}

// The flag set exits the process on a bad flag, so the test runs it in a child process.
func TestBboxIsNoLongerAFlag(t *testing.T) {
	if os.Getenv("PF_RUN_BBOX") == "1" {
		_ = run("build-graph", []string{"-bbox", "0,0,1,1"})
		return
	}
	// Arrange
	cmd := exec.Command(os.Args[0], "-test.run=^TestBboxIsNoLongerAFlag$")
	cmd.Env = append(os.Environ(), "PF_RUN_BBOX=1")

	// Act
	out, err := cmd.CombinedOutput()

	// Assert
	if err == nil || !strings.Contains(string(out), "flag provided but not defined: -bbox") {
		t.Fatalf("err = %v, output %q; want -bbox rejected", err, out)
	}
}
