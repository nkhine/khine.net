package main

import (
	"context"
	"log"

	"github.com/sethvargo/go-envconfig"
)

type Config struct {
	SlackToken string `env:"SLACK_TOKEN,required"`
	ChannelId  string `env:"CHANNEL_ID,required"`
}

func readConfigFromEnv() Config {
	var config Config
	ctx := context.Background()

	err := envconfig.Process(ctx, &config)
	if err != nil {
		log.Fatalln(err)
	}
	return config
}
