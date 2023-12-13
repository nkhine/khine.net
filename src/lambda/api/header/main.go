package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

// Embed the header.html and logo.svg into the binary.
//
//go:embed header.html logo.svg
var content embed.FS

type Item struct {
	Id, Label, Request, Origin, Target string
	Modal, RequiresValidation          bool
}

type TemplateData struct {
	LogoSVG template.HTML
	Items   []Item
	Stage   string
}

func BuildPage(data TemplateData) *bytes.Buffer {
	var bodyBuffer bytes.Buffer

	// Load the embedded header.html template
	headerHtmlContent, _ := content.ReadFile("header.html")

	t := template.New("template")
	var templates = template.Must(t.Parse(string(headerHtmlContent)))
	templates.Execute(&bodyBuffer, data)
	return &bodyBuffer
}

func Handler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	apiGatewayStage := fmt.Sprintf(`/%s/`, os.Getenv("STAGE"))
	// Initialize the items slice with capacity
	// Menu items data
	commonItems := []Item{
		{"Landing", "Some ...", "get", "todo", "#account", false, false},
		{"Account", "Some ...", "get", "account", "#modal", true, false},
		{"Work", "Some ...", "get", "todo", "#account", false, false},
		{"Blog", "Some ...", "get", "todo", "#account", false, false},
	}
	Items := make([]Item, 0, len(commonItems)+1)
	for _, info := range commonItems {
		Items = append(Items, Item{
			Id:                 info.Id,
			Label:              info.Label,
			Request:            info.Request,
			Origin:             apiGatewayStage + info.Origin,
			Target:             info.Target,
			Modal:              info.Modal,
			RequiresValidation: info.RequiresValidation,
		})
	}
	// If the schema query parameter is present, return the schema
	if _, exists := request.QueryStringParameters["schema"]; exists {
		schema := map[string]interface{}{
			"LogoSVG":  "template.HTML",    // This is a placeholder, indicating the expected type
			"Items":    Items,              // Actual menu items and links
			"HTTPVerb": request.HTTPMethod, // Capturing the HTTP verb
			"Stage":    apiGatewayStage,    // Capturing the API Gateway stage
		}
		schemaBytes, _ := json.Marshal(schema)
		return events.APIGatewayProxyResponse{
			Headers:    map[string]string{"content-type": "application/json"},
			Body:       string(schemaBytes),
			StatusCode: 200,
		}, nil
	}

	// Read the embedded logo.svg
	logoContent, err := content.ReadFile("logo.svg")
	if err != nil {
		return events.APIGatewayProxyResponse{
			StatusCode: 500,
			Body:       "Failed to read logo content",
		}, err
	}

	data := TemplateData{
		LogoSVG: template.HTML(logoContent),
		Items:   Items,
		Stage:   apiGatewayStage,
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
