import { RemovalPolicy, StackProps } from 'aws-cdk-lib'
import {
  IOriginAccessIdentity,
  OriginAccessIdentity,
} from 'aws-cdk-lib/aws-cloudfront'
import { BlockPublicAccess, Bucket, IBucket } from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
import TaggingStack from '../../tagging'

interface Props extends StackProps {
  readonly stage: string
}

export class CommonStack extends TaggingStack {
  cloudfrontBucket: IBucket
  pipelineArtifactsBucket: IBucket
  cloudfrontWebAppOAI: IOriginAccessIdentity

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    // Tags.of(this).add('ServiceName', this.node.tryGetContext('service_name'));
    this.cloudfrontBucket = new Bucket(this, 'CommonBucket', {
      websiteIndexDocument: 'index.html',
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    this.cloudfrontWebAppOAI = new OriginAccessIdentity(this, 'CloudFrontOAI')

    this.pipelineArtifactsBucket = new Bucket(
      this,
      'CodepipelineArtifactsBucket',
      {
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      },
    )
  }
}
