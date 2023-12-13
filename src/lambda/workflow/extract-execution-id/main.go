package main

import (
	"context"
	"strings"

	"github.com/aws/aws-lambda-go/lambda"
	log "github.com/sirupsen/logrus"
)

// Input defines the structure of the lambda input.
type Input struct {
	ExecutionArn string `json:"executionArn"`
}

// Output defines the structure of the lambda output.
type Output struct {
	ExecutionId string `json:"executionId"`
	State       string `json:"state"`
	Message     string `json:"message"`
}

// Handler is the Lambda function handler.
func Handler(ctx context.Context, input Input) (Output, error) {
	log.Infof("Received Execution ARN: %s", input.ExecutionArn)

	// Split the ARN by ":" and attempt to get the last element which is the Execution ID
	splitArn := strings.Split(input.ExecutionArn, ":")
	if len(splitArn) == 0 {
		log.Errorf("Failed to split the ARN")
		return Output{
			State:   "FAILED",
			Message: "Failed to extract Execution ID from ARN",
		}, nil
	}
	executionId := splitArn[len(splitArn)-1]

	log.Infof("Extracted Execution ID: %s", executionId)

	// Return success state and the extracted Execution ID
	return Output{
		ExecutionId: executionId,
		State:       "SUCCESS",
		Message:     "Execution ID extracted successfully",
	}, nil
}

func main() {
	lambda.Start(Handler)
}
