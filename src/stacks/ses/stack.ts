import { CfnOutput, RemovalPolicy, StackProps } from 'aws-cdk-lib'
import { HostedZone } from 'aws-cdk-lib/aws-route53'
import {
  ConfigurationSet,
  CfnConfigurationSetEventDestination,
  EmailIdentity,
  Identity,
} from 'aws-cdk-lib/aws-ses'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions'
import { Construct } from 'constructs'
import { SesAttributes } from '../../config'
import TaggingStack from '../../tagging'

const reqEventTypes = ['reject', 'bounce', 'complaint']
const deliveryEventTypes = ['send', 'delivery', 'open']

interface SesStackProps extends StackProps {
  // readonly config: AppEnvConfig;
  readonly ses: SesAttributes
}

export class SesStack extends TaggingStack {
  public readonly sesFromAddress: string

  constructor(scope: Construct, id: string, props: SesStackProps) {
    super(scope, id, props)

    // define resources here...
    const { emailList, notifyList, sendDeliveryNotifications, domainAttr } =
      props.ses

    if (
      domainAttr == null ||
      domainAttr.zoneName == null ||
      domainAttr.zoneName == ''
    ) {
      throw new Error('A domain zoneName is required')
    }
    const { zoneName, hostedZoneId } = domainAttr

    // Create a default Configuration Set for the domain
    const configurationSetName = 'defaultConfigSet'

    // Add an SNS Destination for SES notifications
    const sesNotificationsTopic = new Topic(this, 'sesNotificationsTopic', {
      topicName: 'sesNotifications',
      displayName: 'SES Email Notifications',
    })

    // Add email addresses to the SNS notification topic
    notifyList.forEach((email: string) =>
      sesNotificationsTopic.addSubscription(new EmailSubscription(email)),
    )

    const matchingEventTypes = [...reqEventTypes]
    if (sendDeliveryNotifications) {
      matchingEventTypes.push(...deliveryEventTypes)
    }

    const configSet = new ConfigurationSet(this, 'defaultConfigSet', {
      sendingEnabled: true,
      configurationSetName: configurationSetName,
    })

    const snsDest = new CfnConfigurationSetEventDestination(
      this,
      'defaultNotifications',
      {
        configurationSetName: configSet.configurationSetName,
        eventDestination: {
          enabled: true,
          snsDestination: {
            topicArn: sesNotificationsTopic.topicArn,
          },
          matchingEventTypes: matchingEventTypes,
        },
      },
    )
    snsDest.applyRemovalPolicy(RemovalPolicy.DESTROY)

    // Add and verify Domain using DKIM
    let identity = Identity.domain(zoneName)
    // We need to add records to route53 if a hostedZoneId was provided
    // Rely on cdk to do this for us instead of doing this ourselves
    // We assume this will be a public hosted zone
    if (hostedZoneId != null && hostedZoneId != '') {
      let zone = HostedZone.fromHostedZoneAttributes(this, 'zone', {
        hostedZoneId,
        zoneName,
      })
      identity = Identity.publicHostedZone(zone)
    }

    const domainIdentity = new EmailIdentity(this, 'domainIdentity', {
      identity: identity,
      configurationSet: configSet,
      mailFromDomain: `mail.${zoneName}`,
    })
    domainIdentity.applyRemovalPolicy(RemovalPolicy.DESTROY)

    // Assuming there are always 3 tokens returned as that is what all the docs indicate
    const dkimTokens = [
      domainIdentity.dkimDnsTokenName1,
      domainIdentity.dkimDnsTokenName2,
      domainIdentity.dkimDnsTokenName3,
    ]
    // Add DKIM tokens to domain (or just output for manual entry)
    dkimTokens.forEach((token, i) => {
      const recordName = `${token}._domainkey.${zoneName}`

      new CfnOutput(this, `CnameRecordOutput${i + 1}`, {
        description: `DKIM CNAME Record ${i + 1}`,
        value: `${recordName} CNAME ${token}.dkim.amazonses.com`,
      })
    })

    // Add email addresses and send verification emails
    emailList.forEach((email, i) => {
      const ident = new EmailIdentity(this, `EmailIdentity${i}`, {
        identity: Identity.email(email),
      })
      ident.applyRemovalPolicy(RemovalPolicy.DESTROY)
    })
    this.sesFromAddress = `hello@${zoneName}`
    // end resource definitions
  }
}
