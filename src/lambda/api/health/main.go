package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func main() {
	lambda.Start(handler)
}

func handler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	region := os.Getenv("REGION")

	responseContent := fmt.Sprintf(`
		<h2>Dynamically Loaded Content</h2>
		<p>This content was loaded from the Go backend!</p>
		<p>Running in region: %s</p>
	`, region)

	return events.APIGatewayProxyResponse{
		Body:       responseContent,
		StatusCode: http.StatusOK,
		Headers: map[string]string{
			"Content-Type": "text/html",
		},
	}, nil
}
