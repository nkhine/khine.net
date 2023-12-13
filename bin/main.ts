#!/usr/bin/env node

import { App } from 'aws-cdk-lib'
import { CiCdPipelineStack } from '../src/cicd'
import { Config } from '../src/config'

const config = new Config('config.yml')
const app = new App()

// Use to deploy the pipeline stack
new CiCdPipelineStack(app, 'X11CiCdStack', {
  repo: config.cicd.repo,
  env: config.cicd.env,
  dev: config.dev,
  production: config.production,
  githubTokenArn: config.cicd.githubTokenArn,
  centralised: config.centralised,
  ses: config.ses,
})
