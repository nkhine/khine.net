package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"html/template"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

// Embed the footer.html into the binary.
//
//go:embed footer.html
var content embed.FS

type TemplateData struct {
	Date  string
	Items []string
}

func BuildPage(data TemplateData) *bytes.Buffer {
	var bodyBuffer bytes.Buffer

	// Load the embedded footer.html template
	htmlContent, _ := content.ReadFile("footer.html")

	t := template.New("template")
	var templates = template.Must(t.Parse(string(htmlContent)))
	templates.Execute(&bodyBuffer, data)
	return &bodyBuffer
}

func Handler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// If the schema query parameter is present, return the schema
	if _, exists := request.QueryStringParameters["schema"]; exists {
		schema := map[string]interface{}{
			"Date":  "string",
			"Items": []string{},
		}
		schemaBytes, _ := json.Marshal(schema)
		return events.APIGatewayProxyResponse{
			Headers:    map[string]string{"content-type": "application/json"},
			Body:       string(schemaBytes),
			StatusCode: 200,
		}, nil
	}

	currentYear := time.Now().Format("2006")
	data := TemplateData{
		Date:  currentYear,
		Items: []string{"About", "Privacy Policy", "Licensing", "Contact"},
	}
	return events.APIGatewayProxyResponse{
		Headers:    map[string]string{"content-type": "text/html"},
		Body:       BuildPage(data).String(),
		StatusCode: 200,
	}, nil
}

func main() {
	lambda.Start(Handler)
}
