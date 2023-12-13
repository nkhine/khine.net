package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	awsLambda "github.com/aws/aws-sdk-go/service/lambda"
	log "github.com/sirupsen/logrus"
)

type VerifyAuthChallengeFnInput struct {
	Token string `json:"token"`
	// StepFunctionId: string `json:"stepFunctionId"`
}

func main() {
	lambda.Start(Handler)
}

func Handler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Infof("Received request: %+v", request)

	switch request.HTTPMethod {
	case "GET":
		if token, exists := request.QueryStringParameters["token"]; exists {
			log.Infof("Processing token: %s", token)
			return processTokenAndRedirect(token)
		}

		if _, exists := request.QueryStringParameters["schema"]; exists {
			log.Info("Returning schema")
			schema := map[string]interface{}{
				"Busy":         "bool",
				"ErrorMessage": "string",
				"HTTPVerb":     request.HTTPMethod,
			}
			schemaBytes, _ := json.Marshal(schema)
			return events.APIGatewayProxyResponse{
				Headers:    map[string]string{"content-type": "application/json"},
				Body:       string(schemaBytes),
				StatusCode: 200,
			}, nil
		}
	}

	log.Warnf("Method not allowed: %s", request.HTTPMethod)
	return events.APIGatewayProxyResponse{
		Headers:    map[string]string{"content-type": "text/plain"},
		Body:       "Method not allowed",
		StatusCode: 405,
	}, nil
}

func processTokenAndRedirect(token string) (events.APIGatewayProxyResponse, error) {
	log.Infof("Invoking verify-auth-challenge-response with token: %s", token)
	result, err := invokeVerifyAuthChallengeFn(token)
	if err != nil {
		log.Errorf("Error invoking verify-auth-challenge-response Fn: %v", err)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusInternalServerError,
			Body:       fmt.Sprintf("Error invoking verify-auth-challenge-response Fn: %v", err),
		}, nil
	}

	log.Info("Redirecting to https://dev.domain.tld/")
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusFound,
		Headers: map[string]string{
			"Location": "https://dev.domain.tld/",
		},
		Body: result,
	}, nil
}

func invokeVerifyAuthChallengeFn(token string) (string, error) {
	sess := session.Must(session.NewSession())
	svc := awsLambda.New(sess)

	input := VerifyAuthChallengeFnInput{Token: token}
	payload, err := json.Marshal(input)
	if err != nil {
		log.Errorf("Error marshaling input: %v", err)
		return "", fmt.Errorf("error marshaling input: %v", err)
	}

	result, err := svc.Invoke(&awsLambda.InvokeInput{
		FunctionName: aws.String(os.Getenv("VERIFY_AUTH_CHALLENGE_RESPONSE_FN_NAME")),
		Payload:      payload,
	})
	if err != nil {
		log.Errorf("Error: invoking verify-auth-challenge-response Fn function: %v", err)
		return "", fmt.Errorf("error: invoking verify-auth-challenge-response Fn function: %v", err)
	}

	responseString := string(result.Payload)
	log.Infof("Received response from verify-auth-challenge-response: %s", responseString)
	return responseString, nil
}
