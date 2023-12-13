import { Duration, StackProps } from 'aws-cdk-lib'
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager'
import {
  CloudFrontAllowedCachedMethods,
  CloudFrontAllowedMethods,
  CloudFrontWebDistribution,
  // HeadersFrameOption,
  // HeadersReferrerPolicy,
  IOriginAccessIdentity,
  OriginProtocolPolicy,
  PriceClass,
  // ResponseHeadersPolicy,
  ViewerCertificate,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront'
// import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { IBucket } from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
import { BaseInfraConfig, Distribution, RepositoryConfig } from '../../config'
import TaggingStack from '../../tagging'

interface Props extends StackProps {
  readonly stage: string
  readonly loggingBucket: IBucket
  readonly webappBucket: IBucket
  readonly webappOAI: IOriginAccessIdentity
  readonly repo: RepositoryConfig
  readonly config: BaseInfraConfig
  readonly fido2ApiGatewayEndpoint: string
  readonly fido2ApiGatewayId: string
  readonly fido2AStageName: string
}

export interface DistributionInfra {
  distribution: CloudFrontWebDistribution
  distributionEndpoint: string
  originPath: string
}

export class DistributionStack extends TaggingStack {
  readonly infra: {
    [dist: string]: DistributionInfra
  }

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    this.infra = {}

    let stage = props.stage.toUpperCase()
    // Tags.of(this).add('Stage', stage);
    // Tags.of(this).add('ServiceName', this.node.tryGetContext('service_name'));
    // new Secret(this, 'OriginVerifySecret', {
    //   secretName: 'OriginVerifySecret',
    //   generateSecretString: {
    //     secretStringTemplate: JSON.stringify({ HEADERVALUE: "RandomPassword" }),
    //     generateStringKey: 'HEADERVALUE',
    //     excludePunctuation: true,
    //   }
    // });
    // const responseHeadersPolicy = new ResponseHeadersPolicy(
    //   this,
    //   `Headers${id}`,
    //   {
    //     securityHeadersBehavior: {
    //       contentSecurityPolicy: {
    //         contentSecurityPolicy:
    //           "default-src 'self'; font-src 'self' data:; connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com; img-src *;",
    //         override: true,
    //       },
    //       contentTypeOptions: {
    //         override: true,
    //       },
    //       frameOptions: {
    //         frameOption: HeadersFrameOption.DENY,
    //         override: true,
    //       },
    //       referrerPolicy: {
    //         referrerPolicy:
    //           HeadersReferrerPolicy.SAME_ORIGIN,
    //         override: true,
    //       },
    //       strictTransportSecurity: {
    //         includeSubdomains: true,
    //         override: true,
    //         preload: true,
    //         accessControlMaxAge: Duration.days(365),
    //       },
    //       xssProtection: {
    //         override: true,
    //         protection: true,
    //         modeBlock: true,
    //       },
    //     },
    //   }
    // );
    // Create infra stack for all the distributions
    for (let distribution in props.config.distributions) {
      let fido2ApiGatewayName = `${props.fido2ApiGatewayId}.execute-api.${this.region}.amazonaws.com`
      let data = props.config.distributions[distribution]
      this.infra[distribution] = this.createDistribution(
        distribution,
        data,
        stage,
        props.loggingBucket,
        props.webappBucket,
        props.webappOAI,
        fido2ApiGatewayName,
        props.fido2AStageName,
        // responseHeadersPolicy,
      )
    }
  }

  createDistribution(
    distribution: string,
    data: Distribution,
    stage: string,
    loggingBucket: IBucket,
    webappBucket: IBucket,
    webappOAI: IOriginAccessIdentity,
    // apiDomainName: string,
    fido2ApiGatewayName: string,
    fido2AStageName: string,
    // responseHeadersPolicy: ResponseHeadersPolicy,
  ): DistributionInfra {
    const certificate = Certificate.fromCertificateArn(
      this,
      `Certificate${distribution}`,
      data.certificate,
    )
    const viewerCertificate = ViewerCertificate.fromAcmCertificate(
      certificate,
      {
        aliases: data.domain,
      },
    )

    // We need to save built artifacts for each instance in a unique directory. This should be unique _enough_
    const originPath = `${distribution}`
    const webDistribution = new CloudFrontWebDistribution(
      this,
      `Distribution${distribution}`,
      {
        // geoRestriction: {
        //   // Country codes according to their ISO-3166 shortcode.
        //   // https://en.wikipedia.org/wiki/ISO_3166
        //   locations: ['DE', 'GB'],
        //   restrictionType: 'whitelist',
        // },
        viewerCertificate,
        loggingConfig: {
          bucket: loggingBucket,
          prefix: `${stage}/${distribution}/cloudfront`,
        },

        originConfigs: [
          {
            s3OriginSource: {
              s3BucketSource: webappBucket,
              originAccessIdentity: webappOAI,
              originPath: `/${originPath}`,
            },
            behaviors: [
              {
                isDefaultBehavior: true,
              },
            ],
          },
          {
            customOriginSource: {
              domainName: fido2ApiGatewayName,
              originProtocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
            },
            behaviors: [
              {
                pathPattern: `/${fido2AStageName}/*`,
                allowedMethods: CloudFrontAllowedMethods.ALL,
                cachedMethods: CloudFrontAllowedCachedMethods.GET_HEAD_OPTIONS,
                defaultTtl: Duration.seconds(0),
                forwardedValues: {
                  queryString: true,
                  headers: ['Authorization', 'Origin'], // Forward the Origin header
                  cookies: { forward: 'all' },
                },
                // Add any other necessary configuration
                // responseHeadersPolicy: responseHeadersPolicy
              },
            ],
          },
        ],
        priceClass: PriceClass.PRICE_CLASS_200,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    )

    return {
      originPath,
      distribution: webDistribution,
      distributionEndpoint: `https://${webDistribution.distributionDomainName}`,
    }
  }
}
