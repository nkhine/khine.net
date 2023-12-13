package main

import (
	"net/http"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func main() {
	lambda.Start(handler)
}

func handler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract the tab name from query parameters
	tabName := request.QueryStringParameters["name"]

	var content string
	switch tabName {
	case "tab1":
		content = "This is the content for Tab 1."
	case "tab2":
		content = "This is the content for Tab 2."
	case "tab3":
		content = "This is the content for Tab 3."
	default:
		return events.APIGatewayProxyResponse{
			Body:       "Invalid tab selected",
			StatusCode: http.StatusBadRequest,
			Headers: map[string]string{
				"Content-Type": "text/html",
			},
		}, nil
	}

	return events.APIGatewayProxyResponse{
		Body:       content,
		StatusCode: http.StatusOK,
		Headers: map[string]string{
			"Content-Type": "text/html",
		},
	}, nil
}
