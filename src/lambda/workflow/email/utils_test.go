package main

import (
	"strings"
	"testing"
)

func TestFetchDestination(t *testing.T) {

	v := fetchDestination("user@domain.tld", "abc@xyz.com")
	if !strings.Contains(v, "@domain.tld") {
		t.Logf("expected user+<timestamp>@domain.tld, got %s", v)
		t.FailNow()
	}

	v = fetchDestination("", "abc@xyz.com")
	if !strings.Contains(v, "abc@xyz.com") {
		t.Logf("expected abc@xyz.com, got %s", v)
		t.FailNow()
	}

	v = fetchDestination("domain.tld", "abc@xyz.com")
	if !strings.Contains(v, "abc@xyz.com") {
		t.Logf("expected abc@xyz.com, got %s", v)
		t.FailNow()
	}

	v = fetchDestination("@domain.tld", "abc@xyz.com")
	if !strings.Contains(v, "abc@xyz.com") {
		t.Logf("expected abc@xyz.com, got %s", v)
		t.FailNow()
	}
}
