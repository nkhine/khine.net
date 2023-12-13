import { Stack, StackProps, Tags } from 'aws-cdk-lib'
import { Construct } from 'constructs'

export default class TaggingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
    Tags.of(this).add('Application', 'x11')
    Tags.of(this).add('BusinessUnit', 'DevOps')
    Tags.of(this).add('Description', 'HTMX - Cognito - Passwordless on AWS')
    Tags.of(this).add('TechnicalOwner', 'norman@khine.net')
    Tags.of(this).add('ManagedBy', 'nkhine')
    Tags.of(this).add('Tier', 'Infrastructure')
  }
}
