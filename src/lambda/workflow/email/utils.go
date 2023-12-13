package main

import (
	"strings"
	"time"
)

func fetchDestination(sesTestToAddress, toAddr string) string {
	if sesTestToAddress != "" {
		emailParts := strings.Split(sesTestToAddress, "@")
		if len(emailParts) <= 1 || len(strings.TrimSpace(emailParts[0])) == 0 {
			// Invalid value in SesTestToAddress field.
			// Use the value in toAddr field
			return toAddr
		}

		t := time.Now().UTC().Format("200601021504") // YYYYMMDDhhmm
		handler := emailParts[0] + "+" + t
		emailParts[0] = handler
		email := strings.Join(emailParts, "@")

		return email
	} else {
		return toAddr
	}
}
