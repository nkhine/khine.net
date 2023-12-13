import { CfnOutput, Duration, RemovalPolicy, StackProps } from 'aws-cdk-lib'
import { AccountPrincipal, Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import {
  Bucket,
  BucketAccessControl,
  BucketEncryption,
  ObjectOwnership,
  StorageClass,
} from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
// import { CodePipelineMonitoringStack } from './codepipeline-monitor/stack';
import { CentralisedConfig } from '../../config'
import TaggingStack from '../../tagging'

interface Props extends StackProps {
  readonly config: CentralisedConfig
}

export class CentralisedStack extends TaggingStack {
  public readonly logsBucketArn: string
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    const accountsArray = props.config.logs.accounts.map(
      (account) => account.id,
    )
    const principals = accountsArray.map(
      (accountId) => new AccountPrincipal(accountId),
    )
    // define resources here...
    const account = TaggingStack.of(this).account
    const region = TaggingStack.of(this).region

    const logsBucket = new Bucket(this, 'LogsBucket', {
      bucketName: `logs-${account}-${region}`,
      encryption: BucketEncryption.S3_MANAGED,
      accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_PREFERRED,
      blockPublicAccess: {
        // https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html#access-control-block-public-access-options
        blockPublicAcls: true,
        blockPublicPolicy: true,
        // This lets us ignore putobject calls with a public ACL
        // cloudfront will be putting objects with private acl
        // but leave this disabled anyway!
        ignorePublicAcls: false,
        // This disables all cross account access
        // and limits activity to authenticated users in the owner's account
        // so this should be false
        restrictPublicBuckets: false,
      },
      removalPolicy: RemovalPolicy.DESTROY,
      versioned: true,
    })

    // // Allow CloudTrail to put objects in this S3 bucket
    // logsBucket.addToResourcePolicy(
    //   new PolicyStatement({
    //     sid: 'AllowPutObjectOpForCloudTrailIn',
    //     effect: Effect.ALLOW,
    //     actions: ['s3:PutObject'],
    //     principals: [new ServicePrincipal('cloudtrail.amazonaws.com')],
    //     resources: [logsBucket.arnForObjects('*')],
    //     conditions: {
    //       StringEquals: {
    //         'aws:SourceAccount': accountsArray,
    //       },
    //     },
    //   }),
    // );

    // // Allow CloudTrail to get and put bucket ACL
    // logsBucket.addToResourcePolicy(
    //   new PolicyStatement({
    //     sid: 'AllowGetAndPutBucketAclForCloudTrailIn',
    //     effect: Effect.ALLOW,
    //     actions: ['s3:GetBucketAcl', 's3:PutBucketAcl'],
    //     principals: [new ServicePrincipal('cloudtrail.amazonaws.com')],
    //     resources: [logsBucket.bucketArn],
    //   }),
    // );

    // Allow Cloudfront instances in all accounts to write to this S3 bucket
    // NOTE: Cloudfront log path is configured in _that_ instance.
    // We can not restrict the paths it's allowed to write here because cloudfront
    // will be updating Bucket ACL and give `awslogsdelivery` account full control to this bucket
    // Please make sure the logs delivery path is configured correctly in cloudfront
    // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html#access-logs-choosing-s3-bucket
    // prefix should be account id
    logsBucket.addToResourcePolicy(
      new PolicyStatement({
        sid: 'AllowCloudfrontToWrite',
        effect: Effect.ALLOW,
        actions: ['s3:GetBucketAcl', 's3:PutBucketAcl'],
        principals: principals,
        resources: [logsBucket.bucketArn],
      }),
    )

    // // Allow VPCs in all accounts to write to this S3 bucket
    // vpcLogsBucket.addToResourcePolicy(
    //   new PolicyStatement({
    //     sid: `AllowPutObjectOpForCloudwatch`,
    //     effect: Effect.ALLOW,
    //     actions: ['s3:PutObject'],
    //     principals: [new ServicePrincipal('delivery.logs.amazonaws.com')],
    //     resources: [vpcLogsBucket.arnForObjects('*')],
    //     conditions: {
    //       StringEquals: {
    //         'aws:SourceAccount': accountsArray,
    //         's3:x-amz-acl': 'bucket-owner-full-control',
    //       },
    //     },
    //   }),
    // );

    // vpcLogsBucket.addToResourcePolicy(
    //   new PolicyStatement({
    //     sid: `AllowGetBucketAclOpForCloudwatch`,
    //     effect: Effect.ALLOW,
    //     actions: ['s3:GetBucketAcl'],
    //     principals: [new ServicePrincipal('delivery.logs.amazonaws.com')],
    //     resources: [vpcLogsBucket.bucketArn],
    //     conditions: {
    //       StringEquals: {
    //         'aws:SourceAccount': accountsArray,
    //       },
    //     },
    //   }),
    // );

    // apigwLogsBucket.addToResourcePolicy(
    //   new PolicyStatement({
    //     sid: 'AllowAccountsToReplicate',
    //     effect: Effect.ALLOW,
    //     principals: principals,
    //     actions: ['s3:PutObject', 's3:ReplicateObject', 's3:ReplicateDelete'],
    //     resources: [apigwLogsBucket.arnForObjects('*')],
    //   }),
    // );

    // for (let paccount of accountsArray) {
    // Allow API Gateway to push logs to replicate into this bucket

    //   const localBusArn = `arn:aws:events:${this.region}:${paccount.id}:event-bus/local-bus`;
    //   const rule = new Rule(this, `logsFrom${paccount.id}`, {
    //     eventBus: logsEventBus,
    //     ruleName: `logsFrom${paccount.id}`,
    //     eventPattern: {
    //       account: [{ 'anything-but': paccount.id }] as any[],
    //     },
    //   });
    //   rule.addTarget(
    //     new EventBusTarget(
    //       EventBus.fromEventBusArn(this, `localBus${paccount.id}`, localBusArn),
    //     ),
    //   );

    /*
     * Uncomment this to allow whole account permissions to put and list objects
     * in their folder
     * logsBucket.addToResourcePolicy(
     *   new PolicyStatement({
     *     effect: Effect.ALLOW,
     *     // s3:ListBucket allows listobjectsv2 API call
     *     actions: ['s3:PutObject', 's3:ListBucket'],
     *     resources: [
     *       logsBucket.arnForObjects(`${paccount.id}/*`),
     *       logsBucket.arnForObjects(paccount.id),
     *     ],
     *     principals: [new AccountPrincipal(paccount.id)],
     *   }),
     * );
     */

    // Allow VPCs in `paccount` to write to this S3 bucket

    //   albLogsBucket.addToResourcePolicy(
    //     new PolicyStatement({
    //       sid: `AllowGetBucketPutObjectOpForElasticLoadBalancerIn${paccount}`,
    //       effect: Effect.ALLOW,
    //       actions: ['s3:PutObject', 's3:PutObjectAcl'],
    //       principals: [
    //         new ServicePrincipal('elasticloadbalancing.amazonaws.com'),
    //       ],
    //       resources: [albLogsBucket.arnForObjects(`${paccount}/*`)],
    //       conditions: {
    //         StringEquals: {
    //           'aws:SourceAccount': paccount,
    //         },
    //       },
    //     }),
    //   );
    // End
    // }

    logsBucket.addLifecycleRule({
      enabled: true,
      transitions: [
        {
          storageClass: StorageClass.INFREQUENT_ACCESS,
          transitionAfter: Duration.days(30),
        },
        {
          storageClass: StorageClass.GLACIER,
          transitionAfter: Duration.days(180),
        },
      ],
      noncurrentVersionTransitions: [
        {
          storageClass: StorageClass.INFREQUENT_ACCESS,
          transitionAfter: Duration.days(30),
        },
        {
          storageClass: StorageClass.GLACIER,
          transitionAfter: Duration.days(180),
        },
      ],
      noncurrentVersionExpiration: Duration.days(360),
    })
    this.logsBucketArn = logsBucket.bucketArn
    // end resource definitions
    new CfnOutput(this, 'LogsBucketArn', {
      value: logsBucket.bucketArn,
      exportName: 'LogsBucketArn',
    })
  }
}
