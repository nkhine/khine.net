package main

import (
	"bytes"
	"fmt"
	"html/template"

	_ "embed"
)

//go:embed email.html
var emailTemplateBody string

type EmailTemplateInput struct {
	VerifiedUrl string
}

var emailTemplate = template.Must(template.New("email").Parse(emailTemplateBody))

func generateEmailBody(input EmailTemplateInput) (string, error) {

	output := new(bytes.Buffer)
	err := emailTemplate.Execute(output, input)
	if err != nil {
		return "", fmt.Errorf("error in executing template: %w", err)
	}

	return output.String(), nil
}
