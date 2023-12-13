package main

import (
	"encoding/json"
	"math/rand"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/sfn"

	log "github.com/sirupsen/logrus"
)

func main() {
	sess := session.Must(session.NewSession())
	config := readConfigFromEnv()

	// Seed the PRNG
	rand.Seed(time.Now().UnixNano())

	lambda.Start(func(evt events.S3Event) error {
		return handler(sess, config, evt)
	})
}

func handler(sess *session.Session, config Config, evts events.S3Event) error {
	sfnsvc := sfn.New(sess)

	for _, evt := range evts.Records {
		name := generateRandomString(32)

		ip, err := json.Marshal(evt)
		if err != nil {
			log.WithFields(log.Fields{
				"name":              name,
				"step_function_arn": config.StepFunctionArn,
				"body":              evt,
			}).Errorf("error in marshalling body: %v", err)
			continue
		}

		resp, err := sfnsvc.StartExecution(&sfn.StartExecutionInput{
			Name:            aws.String(name),
			StateMachineArn: aws.String(config.StepFunctionArn),
			Input:           aws.String(string(ip)),
		})
		if err != nil {
			log.WithFields(log.Fields{
				"name":              name,
				"step_function_arn": config.StepFunctionArn,
			}).Errorf("error in starting step function: %v", err)
			continue
		}

		log.WithFields(log.Fields{
			"name":              name,
			"step_function_arn": config.StepFunctionArn,
			"execution_arn":     *resp.ExecutionArn,
			"time":              resp.StartDate.Format(time.RFC3339),
		}).Infoln("started step function")
	}

	return nil
}

const letterBytes = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ1234567890"

func generateRandomString(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = letterBytes[rand.Int63()%int64(len(letterBytes))]
	}
	return string(b)
}
