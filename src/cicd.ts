import { SecretValue, StackProps, Stage, StageProps } from 'aws-cdk-lib'
import { GitHubTrigger } from 'aws-cdk-lib/aws-codepipeline-actions'
import { Bucket } from 'aws-cdk-lib/aws-s3'
import {
  CodePipeline,
  CodePipelineSource,
  // ManualApprovalStep,
  ShellStep,
} from 'aws-cdk-lib/pipelines'
// import { Artifact } from 'aws-cdk-lib/aws-codepipeline';
import { Construct } from 'constructs'
import {
  BaseInfraConfig,
  CentralisedConfig,
  DevStackConfig,
  InfraStackConfig,
  RepositoryConfig,
  SesAttributes,
} from './config'
import { GithubSource } from './constructs/github-trigger'
import { CommonStack } from './stacks/common/stack'
import { CentralisedStack } from './stacks/centralised/stack'
import { SesStack } from './stacks/ses/stack'
import { PasswordlessStack } from './stacks/passwordless/stack'
import { DistributionPipelineStack } from './stacks/distribution/pipeline'
import { DistributionStack } from './stacks/distribution/stack'
import TaggingStack from './tagging'

interface CentralisedStageProps extends StageProps {
  readonly config: CentralisedConfig
}

class CentralisedStage extends Stage {
  constructor(scope: Construct, id: string, props: CentralisedStageProps) {
    super(scope, id, props)

    new CentralisedStack(this, 'CentralisedStack', {
      config: props.config,
    })
  }
}

interface EnvironmentStageProps extends StageProps {
  readonly config: BaseInfraConfig
  readonly repo: RepositoryConfig
  readonly codestarConnectionArn: string
  readonly envName: string
  readonly ses: SesAttributes
}

export class EnvironmentStage extends Stage {
  constructor(scope: Construct, id: string, props: EnvironmentStageProps) {
    super(scope, id, props)

    // We now have a central cloudfront logs bucket, see
    const bucketArn = 'arn:aws:s3:::logs-577584872937-eu-west-1'
    const logsBucket = Bucket.fromBucketArn(
      scope,
      `LogsBucket-${this.stageName}`,
      bucketArn,
    )

    const commonStack = new CommonStack(this, 'CommonStack', {
      stage: id,
    })
    const sesStack = new SesStack(this, 'SesStack', {
      ses: props.ses,
    })

    const passwordlessStack = new PasswordlessStack(this, 'PasswordlessStack', {
      stage: id,
      sesFromAddress: sesStack.sesFromAddress,
      userPoolName: props.config.cognito.userPoolName,
      sesDomainName: props.ses.domainAttr.zoneName,
    })

    const distributionStack = new DistributionStack(this, 'DistributionStack', {
      stage: id,
      loggingBucket: logsBucket,
      config: props.config,
      repo: props.repo,
      webappBucket: commonStack.cloudfrontBucket,
      webappOAI: commonStack.cloudfrontWebAppOAI,
      fido2ApiGatewayEndpoint: passwordlessStack.fido2ApiGatewayEndpoint,
      fido2ApiGatewayId: passwordlessStack.fido2ApiGatewayId,
      fido2AStageName: passwordlessStack.fido2AStageName,
    })

    const distributionPipelineStack = new DistributionPipelineStack(
      this,
      'DistributionPipelineStack',
      {
        codestarConnectionArn: props.codestarConnectionArn,
        config: distributionStack.infra,
        repo: props.repo,
        distributions: props.config.distributions,
        envName: props.envName,
        webappBucket: commonStack.cloudfrontBucket,
        artifactsBucket: commonStack.pipelineArtifactsBucket,
      },
    )

    passwordlessStack.addDependency(sesStack)
    distributionPipelineStack.addDependency(commonStack)
    distributionStack.addDependency(passwordlessStack)
  }
}

interface CiCdPipelineProps extends StackProps {
  readonly repo: RepositoryConfig
  readonly githubTokenArn: string
  readonly dev: DevStackConfig
  readonly production: InfraStackConfig
  readonly centralised: CentralisedConfig
  readonly ses: SesAttributes
}

export class CiCdPipelineStack extends TaggingStack {
  constructor(scope: Construct, id: string, props: CiCdPipelineProps) {
    super(scope, id, props)
    const oauthToken = SecretValue.secretsManager(props.githubTokenArn)
    // const websiteArtifact = new Artifact('WebsiteArtifact');

    const pipeline = new CodePipeline(this, 'CDKPipeline', {
      dockerEnabledForSynth: true,
      pipelineName: props.repo.pipelineName,
      crossAccountKeys: true,
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.gitHub(
          `${props.repo.owner}/${props.repo.repo}`,
          props.repo.branch,
          {
            authentication: oauthToken,
            trigger: GitHubTrigger.NONE,
          },
        ),
        additionalInputs: {
          './website': CodePipelineSource.gitHub('x11-us/website', 'main', {
            authentication: oauthToken,
            trigger: GitHubTrigger.NONE,
          }),
        },
        env: {
          GO_VERSION: '1.19',
        },
        installCommands: [
          'wget https://storage.googleapis.com/golang/go${GO_VERSION}.linux-amd64.tar.gz',
          'tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz',
          'export PATH="/usr/local/go/bin:$PATH" && export GOPATH="$HOME/go" && export PATH="$GOPATH/bin:$PATH"',
        ],
        commands: [
          `cd ./${props.repo.path}`,
          // 'make',
          'ls -al',
          //  'rsync -avm --exclude="*.go" ./website/templates/ ./src/lambda/',
          'rm website',
          'ls -al && pwd',
          'rsync -avm --exclude="*.go"  $CODEBUILD_SRC_DIR_x11_us_website_Source/templates/ $CODEBUILD_SRC_DIR/src/lambda/api/',
          'cd $CODEBUILD_SRC_DIR',
          'yarn install --immutable --immutable-cache --check-cache',
          'npm run build',
          'npx cdk synth',
        ],

        primaryOutputDirectory: `./${props.repo.path}/cdk.out`,
      }),
    })

    pipeline.addStage(
      new CentralisedStage(this, 'CentralisedStack', {
        config: props.centralised,
      }),
    )
    for (let repo of props.dev.repos) {
      // const identifer = `${repo.owner}-${repo.repo}`;
      pipeline.addStage(
        // FIXME make the stage more generic - requires nuking
        new EnvironmentStage(this, 'Dev', {
          env: props.dev.env,
          repo: repo,
          config: {
            ...props.dev,
          },
          codestarConnectionArn: props.dev.codestarConnectionArn,
          ses: props.ses,
          envName: 'dev',
        }),
      )
    }
    // pipeline.addStage(
    //   new EnvironmentStage(this, 'Prod', {
    //     env: props.production.env,
    //     repo: props.production.repo,
    //     config: {
    //       ...props.production,
    //     },
    //     codestarConnectionArn: props.production.codestarConnectionArn,
    //     ses: props.ses,
    //     envName: 'production',
    //   }),
    //   {
    //     pre: [
    //       new ManualApprovalStep('Approve deployment to Production Account'),
    //     ],
    //   },
    // );

    pipeline.buildPipeline()

    const ghSource = new GithubSource(this, 'GithubTrigger', {
      branch: props.repo.branch,
      owner: props.repo.owner,
      repo: props.repo.repo,
      filters: [props.repo.path],
      githubTokenArn: props.githubTokenArn,
      codepipeline: pipeline.pipeline,
    })
    ghSource.node.addDependency(pipeline)

    const websiteGhSource = new GithubSource(this, 'WebsiteGithubTrigger', {
      branch: 'main',
      owner: 'x11-us',
      repo: 'website',
      filters: [props.repo.path],
      githubTokenArn: props.githubTokenArn,
      codepipeline: pipeline.pipeline,
    })
    websiteGhSource.node.addDependency(pipeline)
  }
}
