package main

import (
	"context"
	"log"

	"github.com/sethvargo/go-envconfig"
)

type Config struct {
	ApiGatewayUrl    string `env:"API_GATEWAY_URL,required"`
	Region           string `env:"REGION,required"`
	SesTestToAddress string `env:"SES_TEST_TO_ADDRESS,required"`
	SesFromAddress   string `env:"SES_FROM_ADDRESS,required"`
	SesSubject       string `env:"SES_SUBJECT,required"`
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
