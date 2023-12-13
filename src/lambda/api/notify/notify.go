package main

import (
	"fmt"
	"io"
	"path/filepath"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	log "github.com/sirupsen/logrus"
	"github.com/slack-go/slack"
)

type State string

const (
	SKIPPED State = "SKIPPED"
	FAILED  State = "FAILED"
	SUCCESS State = "SUCCESS"
)

type Output struct {
	State State `json:"state"`
}

func main() {
	config := readConfigFromEnv()
	sess := session.Must(session.NewSession())

	lambda.Start(func(evt events.S3EventRecord) (Output, error) {
		return handler(config, sess, evt)
	})
}

func handler(config Config, sess *session.Session, evt events.S3EventRecord) (Output, error) {
	output := Output{}
	s3svc := s3.New(sess)
	file, err := s3svc.GetObject(&s3.GetObjectInput{
		Bucket: aws.String(evt.S3.Bucket.Name),
		Key:    aws.String(evt.S3.Object.Key),
	})
	if err != nil {
		log.WithFields(log.Fields{
			"bucket": evt.S3.Bucket.Name,
			"key":    evt.S3.Object.Key,
		}).Errorf("error in downloading file: %v", err.Error())

		output.State = FAILED
		return output, nil
	}

	msg := generateMessage(evt)

	err = postMessage(config, msg, evt, file.Body)
	if err != nil {
		log.WithFields(log.Fields{
			"msg": msg,
			// mask token in logs
			"masked_slack_token": config.SlackToken[:len(config.SlackToken)-6] + "XXXXXX",
			"channel_id":         config.ChannelId,
		}).Errorf("could not send message: %v", err.Error())

		output.State = FAILED
		return output, nil
	}

	log.WithFields(log.Fields{
		"channel_id": config.ChannelId,
	}).Infoln("sent a message to slack")

	output.State = SUCCESS
	return output, nil
}

func postMessage(config Config, msg []slack.Block, evt events.S3EventRecord, file io.ReadCloser) error {
	defer file.Close()

	fileName := filepath.Base(evt.S3.Object.Key)
	sclient := slack.New(config.SlackToken)

	// Send the message first!
	_, timestamp, err := sclient.PostMessage(config.ChannelId, slack.MsgOptionBlocks(msg...))
	if err != nil {
		return fmt.Errorf("error in sending message: %w", err)
	}

	// Upload file
	_, err = sclient.UploadFile(slack.FileUploadParameters{
		Filename:        fileName,
		Channels:        []string{config.ChannelId},
		ThreadTimestamp: timestamp,
		Reader:          file,
		InitialComment:  fileName,
	})
	if err != nil {
		return fmt.Errorf("error in uploading file: %w", err)
	}

	return nil
}

func generateMessage(evt events.S3EventRecord) []slack.Block {
	blocks := []slack.Block{
		slack.NewSectionBlock(&slack.TextBlockObject{
			Type: "mrkdwn",
			Text: "*New File Upload*",
		}, nil, nil),

		slack.NewDividerBlock(),

		slack.NewSectionBlock(&slack.TextBlockObject{
			Type: "mrkdwn",
			Text: fmt.Sprintf("*Bucket Name:* %s", evt.S3.Bucket.Name),
		}, nil, nil),

		slack.NewSectionBlock(&slack.TextBlockObject{
			Type: "mrkdwn",
			Text: fmt.Sprintf("*Key:* %s", evt.S3.Object.Key),
		}, nil, nil),

		slack.NewDividerBlock(),

		slack.NewSectionBlock(&slack.TextBlockObject{
			Type: "mrkdwn",
			Text: fmt.Sprintf("*Timestamp:* %s", evt.EventTime.Format(time.RFC3339)),
		}, nil, nil),
	}

	return blocks
}
