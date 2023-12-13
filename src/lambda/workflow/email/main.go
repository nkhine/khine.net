package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	v4 "github.com/aws/aws-sdk-go/aws/signer/v4"
	"github.com/aws/aws-sdk-go/service/ses"
	log "github.com/sirupsen/logrus"
)

type Input struct {
	Email   string `json:"email"`
	UserSub string `json:"userSub,omitempty"`
	State   State  `json:"state"`
	Message string `json:"message"`
}

type Output struct {
	State         State  `json:"state"`
	EmailVerified bool   `json:"EmailVerified"`
	Message       string `json:"message"`
}

type State string

const (
	StateSuccess State = "SUCCESS"
	StateFailed  State = "FAILED"
)

// The time for which the links in terms emails will be valid
const validPeriod = 24 * time.Hour

func handler(config Config, sess *session.Session, ctx context.Context, req Input) (Output, error) {
	output := Output{}

	verifiedUrl, err := generatePresignedUrl(config, sess, map[string]string{
		"verified": "true",
		"email":    req.Email,
		"UserSub":  req.UserSub,
	})
	if err != nil {
		log.Errorf("error in generating accept url: %v", err.Error())
		output.State = StateFailed
		output.Message = fmt.Sprintf("error in generating accept url: %s", err.Error())
		return output, nil
	}

	sessvc := ses.New(sess)
	emailBody, err := generateEmailBody(EmailTemplateInput{
		VerifiedUrl: verifiedUrl,
	})
	if err != nil {
		log.WithFields(log.Fields{
			"presigned_url": verifiedUrl,
		}).Errorf("error in executing template: %v", err.Error())
		output.EmailVerified = false
		output.State = StateFailed
		output.Message = fmt.Sprintf("error in executing template: %v", err.Error())
		return output, nil
	}

	toAddress := fetchDestination(config.SesTestToAddress, req.Email)

	resp, err := sessvc.SendEmail(&ses.SendEmailInput{
		Destination: &ses.Destination{
			ToAddresses: aws.StringSlice([]string{toAddress}),
		},
		Source: aws.String(config.SesFromAddress),
		Message: &ses.Message{
			Subject: &ses.Content{
				Data: aws.String(config.SesSubject),
			},
			Body: &ses.Body{
				Html: &ses.Content{
					Data: aws.String(emailBody),
				},
			},
		},
	})
	if err != nil {
		output.EmailVerified = false
		output.Message = fmt.Sprintf("error in sending email: %v", err.Error())
		output.State = StateFailed
		return output, nil
	}

	output.Message = fmt.Sprintf("Your email verification url link is %s. ses message id is %s", verifiedUrl, *resp.MessageId)
	output.State = StateSuccess
	output.EmailVerified = true
	return output, nil
}

// Generate a Pre-Signed URL for email verification
func generatePresignedUrl(config Config, sess *session.Session, params map[string]string) (string, error) {
	// Create a new request to the desired URL with the appropriate query parameters.
	req, err := http.NewRequest(http.MethodGet, config.ApiGatewayUrl, nil)
	if err != nil {
		return "", fmt.Errorf("error in generating request: %w", err)
	}

	// Add the query parameters.
	q := req.URL.Query()
	for key, value := range params {
		q.Add(key, value)
	}
	req.URL.RawQuery = q.Encode()

	// Create a new signer using the session credentials.
	signer := v4.NewSigner(sess.Config.Credentials)

	// Sign the request. The second argument is the request body, which is nil for GET requests.
	_, err = signer.Presign(req, nil, "execute-api", *sess.Config.Region, validPeriod, time.Now())
	if err != nil {
		return "", fmt.Errorf("error in presigning request: %w", err)
	}

	return req.URL.String(), nil
}

func main() {
	config := readConfigFromEnv()

	sess := session.Must(session.NewSession(&aws.Config{
		Region: aws.String(config.Region),
	}))

	lambda.Start(func(ctx context.Context, req Input) (Output, error) {
		return handler(config, sess, ctx, req)
	})
}
