package main

import (
	"context"
	"log"

	"github.com/sethvargo/go-envconfig"
)

type Config struct {
	StepFunctionArn string `env:"STEP_FUNCTION_ARN,required"`
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
