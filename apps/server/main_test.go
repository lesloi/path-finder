package main

import (
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
