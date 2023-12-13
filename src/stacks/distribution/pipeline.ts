import { Duration, StackProps } from 'aws-cdk-lib'
import {
  BuildSpec,
  ComputeType,
  LinuxBuildImage,
  PipelineProject,
  Project,
} from 'aws-cdk-lib/aws-codebuild'
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline'
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions'
import {
  CodeBuildAction,
  LambdaInvokeAction,
  ManualApprovalAction,
  S3DeployAction,
} from 'aws-cdk-lib/aws-codepipeline-actions'
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda'
import { LogRetention, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { IBucket } from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
import { Distribution, RepositoryConfig } from '../../config'
import { DistributionInfra } from './stack'
import TaggingStack from '../../tagging'

interface Props extends StackProps {
  readonly config: {
    [dist: string]: DistributionInfra
  }
  readonly repo: RepositoryConfig
  readonly codestarConnectionArn: string
  readonly envName: string
  readonly distributions: {
    [dist: string]: Distribution
  }
  webappBucket: IBucket
  artifactsBucket: IBucket
}

export class DistributionPipelineStack extends TaggingStack {
  props: Props

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    this.props = props

    // Tags.of(this).add('ServiceName', this.node.tryGetContext('service_name'));

    for (let dist in props.config) {
      let config = props.config[dist]
      this.createPipeline(dist, props.distributions[dist], config)
    }
  }

  createPipeline(
    distName: string,
    distribution: Distribution,
    config: DistributionInfra,
  ) {
    // const npmToken = SecretValue.secretsManager(this.props.repo.npm_token);
    // const sentryToken = SecretValue.secretsManager(this.props.repo.sentryToken);
    const srcArtifact = new Artifact()

    const pullSourceCodeAction =
      new codepipeline_actions.CodeStarConnectionsSourceAction({
        actionName: `Pull_Code_${distName}`,
        connectionArn: this.props.codestarConnectionArn,
        output: srcArtifact,
        owner: this.props.repo.owner,
        repo: distribution.repo,
        branch: distribution.branch,
      })

    let pipeline = new Pipeline(this, `Pipeline_${distName}`, {
      pipelineName: `Distribution-${distName}`,
      artifactBucket: this.props.artifactsBucket,
      stages: [
        {
          stageName: 'Pull_Source_Code',
          actions: [pullSourceCodeAction],
        },
      ],
    })

    const buildOutput = new Artifact()
    const buildAction = new CodeBuildAction({
      actionName: `Build_${distName}`,
      input: srcArtifact,
      outputs: [buildOutput],
      runOrder: 1,
      project: new PipelineProject(this, `PipelineProject_${distName}`, {
        environment: {
          computeType: ComputeType.MEDIUM,
          buildImage: LinuxBuildImage.STANDARD_5_0,
          environmentVariables: {
            GIT_COMMIT_HASH: { value: pullSourceCodeAction.variables.commitId },
          },
        },
        buildSpec: BuildSpec.fromSourceFilename('buildspec.yml'),
        // buildSpec: BuildSpec.fromObject({
        //   version: 0.2,
        //   phases: {
        //     install: {
        //       'runtime-versions': {
        //         nodejs: 14,
        //       },
        //       commands: [
        //         // 'npm install -g tailwindcss@latest',  // Installing TailwindCSS globally
        //         'npm install',
        //         // Add any other installation commands if required
        //       ],
        //     },
        //     build: {
        //       commands: [
        //         'echo "Building using TailwindCSS..."',
        //         'npx tailwindcss -i assets/css/input.css -o assets/css/output.css --minify', // Running the tailwindcss command
        //         // Add any other build commands if required
        //       ],
        //     },
        //     post_build: {
        //       commands: [
        //         'echo "Listing current directory:"',
        //         'ls -al',
        //         'rm -rf .git README.md templates',
        //         'echo "Build completed, preparing artifacts for the next stage..."',
        //       ],
        //     },
        //   },
        //   artifacts: {
        //     files: ['**/**'],
        //   },
        // }),
      }),
    })

    pipeline.addStage({
      stageName: 'Build',
      actions: [buildAction],
    })

    if (this.props.envName !== 'dev') {
      pipeline.addStage({
        stageName: 'ApproveDeploymentToS3',
        actions: [
          new ManualApprovalAction({
            actionName: 'ApproveDeployment',
            externalEntityLink: config.distributionEndpoint,
          }),
        ],
      })
    }

    // Create a lambda which will invalidate cloudfront cache
    const invalidator = new Function(this, `CfInvalidator${distName}`, {
      runtime: Runtime.NODEJS_16_X,
      handler: 'index.handler',
      timeout: Duration.seconds(60),
      environment: {
        DIST_ID: config.distribution.distributionId,
      },

      code: Code.fromInline(`
        const AWS = require('aws-sdk');

        exports.handler = async function(event, context) {
          const cf = new AWS.CloudFront();
          const cp = new AWS.CodePipeline();
          const jobId = event["CodePipeline.job"].id;

          await cf.createInvalidation({
            DistributionId: process.env.DIST_ID,
            InvalidationBatch: {
              CallerReference: Math.floor(new Date().getTime() / 1000).toString(),
              Paths: {
                Quantity: 1,
                Items: [
                  "/*",
                ]
              }
            }
          }).promise().then(async (ok) => {
            // Write success result
            await cp.putJobSuccessResult({
              jobId: jobId,
            }).promise().then(ok => {
              context.succeed("invalidated cache");
            }, err => {
              context.fail("failed to update result after invalidating cache");
              console.error(err);
            })
          }, async (err) => {
            await cp.putJobFailureResult({
              jobId: jobId,
              failureDetails: {
                message: JSON.stringify(err),
                type: "JobFailed",
                externalExecutionId: context.awsRequestId,
              },
            }).promise().then(ok => {
              context.fail("failed to invalidate cache");
            }, err => {
              context.fail("failed to invalidate cache and update result");
              console.error(err);
            })
          });
        }
      `),
    })

    // CodePipeline permissions
    invalidator.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudfront:CreateInvalidation',
          'codepipeline:PutJobSuccessResult',
          'codepipeline:PutJobFailureResult',
        ],
        resources: ['*'],
      }),
    )

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new S3DeployAction({
          actionName: 'DeployToS3',
          bucket: this.props.webappBucket,
          objectKey: config.originPath,
          input: buildOutput,
          extract: true,
          runOrder: 1,
        }),
        new LambdaInvokeAction({
          actionName: 'Invalidate_Cache',
          lambda: invalidator,
          runOrder: 2,
        }),
      ],
    })

    let logRetentionPeriod = RetentionDays.TWO_WEEKS
    switch (this.props.envName) {
      case 'dev':
        logRetentionPeriod = RetentionDays.ONE_WEEK
        break
      case 'staging':
        logRetentionPeriod = RetentionDays.ONE_WEEK
        break
      case 'production':
        logRetentionPeriod = RetentionDays.THREE_MONTHS
        break
      default:
        logRetentionPeriod = RetentionDays.TWO_WEEKS
    }

    // Force all codebuild jobs to have the specified amount of log retention
    this.node.findAll().forEach((construct, index) => {
      if (construct instanceof Project) {
        new LogRetention(
          this,
          `${distName}${this.props.envName}LogRetention${index}`,
          {
            logGroupName: `/aws/codebuild/${construct.projectName}`,
            retention: logRetentionPeriod,
          },
        )
      }
    })
  }
}
