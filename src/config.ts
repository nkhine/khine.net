import * as fs from 'fs'
import * as YAML from 'yaml'

export interface Env {
  readonly account: string
  readonly region: string
}

export interface RepositoryConfig {
  readonly owner: string
  readonly repo: string
  readonly branch: string
  readonly path: string
  readonly npm_token: string
  readonly pipelineName: string
  readonly sentryToken: string
}

export interface AccountConfig {
  id: string
  name: string
}

export interface CentralisedConfig {
  logs: {
    env: Env
    accounts: AccountConfig[]
  }
}
export interface HostedZoneAttributes {
  readonly zoneName: string
  readonly hostedZoneId?: string
}

export interface SesAttributes {
  readonly emailList: string[]
  readonly notifyList: string[]
  readonly sendDeliveryNotifications: boolean
  readonly domainAttr: HostedZoneAttributes
}

export interface PasswordlessConfig {
  readonly allowedOrigins: string[]
  readonly allowedRelyingPartyIds: string[]
  readonly sesFromAddress?: string
  readonly clientMetadataTokenKeys?: string[]
  readonly relyingPartyName?: string
  readonly attestation?: string
  readonly userVerification?: string
}
export interface CognitoAttributes {
  readonly userPoolName: string
}

export interface BaseAppConfig {
  readonly env: Env
  readonly passwordless?: PasswordlessConfig
}

export interface Distribution {
  readonly domain: string[]
  readonly certificate: string
  readonly owner: string
  readonly repo: string
  readonly branch: string
  readonly geoRestriction?: GeoRestriction
}

export interface GeoRestriction {
  readonly locations: string[]
  readonly restrictionType: string
}

export interface CiCdStackConfig extends BaseAppConfig {
  readonly repo: RepositoryConfig
  readonly githubTokenArn: string
}

export interface BaseInfraConfig extends BaseAppConfig {
  readonly codestarConnectionArn: string
  readonly distributions: {
    [name: string]: Distribution
  }
  readonly cognito: CognitoAttributes
}

export interface InfraStackConfig extends BaseInfraConfig {
  readonly repo: RepositoryConfig
}

export interface DevStackConfig extends BaseInfraConfig {
  readonly repos: RepositoryConfig[]
}

export class Config {
  readonly cicd: CiCdStackConfig
  readonly centralised: CentralisedConfig
  readonly ses: SesAttributes
  readonly dev: DevStackConfig
  readonly production: InfraStackConfig

  constructor(fileName?: string) {
    const filename = fileName || 'config.yml'
    const file = fs.readFileSync(filename, 'utf-8')

    const yaml = YAML.parse(file)

    this.cicd = yaml.cicd
    this.centralised = yaml.centralised
    this.ses = yaml.ses
    this.dev = yaml.dev
    this.production = yaml.production

    console.log(this)

    if (!this.validate()) {
      console.error('config is invalid')
      process.exit(1)
    }
  }

  validate(): boolean {
    let environments = [
      {
        name: 'dev',
        object: this.dev,
      },
      { name: 'production', object: this.production },
    ]

    for (let env of environments) {
      for (let dist_name in env.object.distributions) {
        if (
          new Set(env.object.distributions[dist_name].domain).size !=
          env.object.distributions[dist_name].domain.length
        ) {
          console.error(
            `Found duplicate domains for environment ${env.name} domains ${env.object.distributions[dist_name].domain}`,
          )

          return false
        }
      }
    }

    return true
  }
}
