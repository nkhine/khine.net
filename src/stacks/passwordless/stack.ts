import * as fs from 'fs'
import * as path from 'path'
import {
  CfnOutput,
  Duration,
  // PhysicalName,
  RemovalPolicy,
  StackProps,
  aws_lambda_nodejs,
} from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { BillingMode } from 'aws-cdk-lib/aws-dynamodb'
import { Passwordless } from 'amazon-cognito-passwordless-auth/cdk'
import {
  AuthorizationType,
  JsonSchemaType,
  Cors,
  LambdaIntegration,
} from 'aws-cdk-lib/aws-apigateway'

import {
  Architecture,
  Code,
  Function,
  Runtime,
  Tracing,
  IFunction,
} from 'aws-cdk-lib/aws-lambda'
// import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  Choice,
  Condition,
  DefinitionBody,
  Fail,
  JsonPath,
  Pass,
  StateMachine,
  Succeed,
  // TaskInput,
} from 'aws-cdk-lib/aws-stepfunctions'
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks'
import {
  AccountRecovery,
  // ClientAttributes,
  StringAttribute,
  UserPool,
  // UserPoolClient,
  // UserPoolClientIdentityProvider,
  UserPoolEmail,
} from 'aws-cdk-lib/aws-cognito'
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam'
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import TaggingStack from '../../tagging'

interface Props extends StackProps {
  readonly userPoolName: string
  readonly sesDomainName: string
  readonly stage: string
  readonly sesFromAddress: string
}

export class PasswordlessStack extends TaggingStack {
  passwordless: Passwordless
  public readonly fido2ApiGatewayEndpoint: string
  public readonly fido2ApiGatewayId: string
  public readonly fido2AStageName: string
  public readonly userPool: UserPool
  // public readonly userPoolClient: UserPoolClient

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    const region = TaggingStack.of(this).region
    const account = TaggingStack.of(this).account
    // 👇 User Pool
    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: props.userPoolName,
      selfSignUpEnabled: true,
      signInAliases: {
        username: false,
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: {
        country: new StringAttribute({ mutable: true }),
        city: new StringAttribute({ mutable: true }),
        isAdmin: new StringAttribute({ mutable: true }),
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
      email: UserPoolEmail.withSES({
        sesRegion: region,
        fromEmail: props.sesFromAddress,
        fromName: 'X11US',
        replyTo: props.sesFromAddress,
      }),
    })

    // 👇 Outputs
    new CfnOutput(this, "UserPoolIdOutput", {
      value: this.userPool.userPoolId,
      description: "Cognito User Pool ID",
      exportName: "UserPoolId",
    });
    const userPoolId = this.userPool.userPoolId
    // 👇 Passwordless
    this.passwordless = new Passwordless(this, 'Passwordless', {
      userPool: this.userPool,
      allowedOrigins: [
        'http://localhost:5173',
        'https://dev.domain.tld',
        // ... other origins ...
      ],
      clientMetadataTokenKeys: ['consent_id'],
      magicLink: {
        // Adjust the sesFromAddress based on your setup
        sesFromAddress: props.sesFromAddress,
        sesRegion: region,
        secretsTableProps: {
          removalPolicy: RemovalPolicy.DESTROY,
          billingMode: BillingMode.PAY_PER_REQUEST,
        },
      },
      fido2: {
        authenticatorsTableProps: {
          removalPolicy: RemovalPolicy.DESTROY,
          billingMode: BillingMode.PAY_PER_REQUEST,
        },
        relyingPartyName: 'Passwordless Fido2 Example',
        allowedRelyingPartyIds: ['localhost'],
        attestation: 'none',
        userVerification: 'required',
        updatedCredentialsNotification: {
          sesFromAddress: props.sesFromAddress,
          sesRegion: region,
        },
      },
      smsOtpStepUp: {},
      userPoolClientProps: {
        // perrty short so you see token refreshes in action often:
        idTokenValidity: Duration.minutes(5),
        accessTokenValidity: Duration.minutes(5),
        refreshTokenValidity: Duration.hours(1),
        // while testing/experimenting it's best to set this to false,
        // so that when you try to sign in with a user that doesn't exist,
        // Cognito will tell you that––and you don't wait for a magic link
        // that will never arrive in your inbox:
        preventUserExistenceErrors: false,

      },
      functionProps: {
        defineAuthChallenge: {
          description: 'A define auth challenge Lambda trigger is the first step in a Cognito custom authentication flow.', // It returns the initial custom challenge name to Amazon Cognito. It can also immediately issue tokens based on your custom logic.',
          // entry: path.join(__dirname, "../../../src/lambda/workflow/define-auth-challenge/index.ts"),
          memorySize: 256,
          runtime: Runtime.NODEJS_18_X,
          architecture: Architecture.ARM_64,
          // https://github.com/aws-samples/amazon-cognito-passwordless-auth/issues/90
          bundling: {
            format: aws_lambda_nodejs.OutputFormat.ESM,
            esbuildArgs: {
              "--main-fields": "module,main",
            },
            externalModules: ["@aws-sdk/*", "aws-lambda"],
            banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
          },
          logRetention: RetentionDays.FIVE_DAYS,
        },
        createAuthChallenge: {
          description: 'A create auth challenge Lambda is the second step in a Cognito custom authentication flow. It presents your custom challenge to the user.',
          entry: path.join(__dirname, "../../../src/lambda/workflow/create-auth-challenge/index.ts"),
          memorySize: 256,
          runtime: Runtime.NODEJS_18_X,
          architecture: Architecture.ARM_64,
          // https://github.com/aws-samples/amazon-cognito-passwordless-auth/issues/90
          bundling: {
            format: aws_lambda_nodejs.OutputFormat.ESM,
            esbuildArgs: {
              "--main-fields": "module,main",
            },
            externalModules: ["@aws-sdk/*", "aws-lambda"],
            banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
          },
          logRetention: RetentionDays.FIVE_DAYS,
          timeout: Duration.seconds(15),
        },
        verifyAuthChallengeResponse: {
          description: 'A verify auth challenge Lambda is the third step in a Cognito custom authentication flow. It knows the answer to the challenge issued by your create auth challenge Lambda function.',
          // entry: path.join(__dirname, "../../../src/lambda/workflow/create-auth-challenge/index.ts"),
          memorySize: 256,
          runtime: Runtime.NODEJS_18_X,
          architecture: Architecture.ARM_64,
          // https://github.com/aws-samples/amazon-cognito-passwordless-auth/issues/90
          bundling: {
            format: aws_lambda_nodejs.OutputFormat.ESM,
            esbuildArgs: {
              "--main-fields": "module,main",
            },
            externalModules: ["@aws-sdk/*", "aws-lambda"],
            banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
          },
          logRetention: RetentionDays.FIVE_DAYS,
          // timeout: Duration.seconds(15),
        },
      },
      logLevel: 'DEBUG',

    })
    if (!this.passwordless.fido2Api) {
      throw new Error('fido2Api not available on Passwordless construct.')
    }
    // Give the lambda permissions to SES
    const sesPermissions = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [
        `arn:aws:ses:${region}:${account}:identity/*`,
        `arn:aws:ses:${region}:${account}:configuration-set/defaultConfigSet`
      ],
    })
    // Array of Lambda functions from the Passwordless construct
    const lambdaFunctions = [
      this.passwordless.createAuthChallengeFn,
      this.passwordless.verifyAuthChallengeResponseFn,
      this.passwordless.defineAuthChallengeResponseFn,
      this.passwordless.preSignUpFn,
      this.passwordless.preTokenGenerationFn,
      this.passwordless.fido2Fn,
      this.passwordless.fido2challengeFn,
      this.passwordless.fido2NotificationFn,
    ];

    // Attach the SES permissions to each Lambda function's execution role
    lambdaFunctions.forEach(lambdaFunction => {
      this.attachPermissionsToLambda(sesPermissions, lambdaFunction);
    });

    // ... similarly for other Lambda functions ...

    // Add my own lambdas to the fido2Api
    const api = this.passwordless.fido2Api
    const stageName = api.deploymentStage.stageName
    const createAuthChallengeFn = this.passwordless.createAuthChallengeFn
    const verifyAuthChallengeResponseFn = this.passwordless.verifyAuthChallengeResponseFn

    // Add SFN
    const addUserLambdaMetadata = this.loadLambdaMetadata(
      path.join(__dirname, '../../../src/lambda/workflow/adduser'),
    )
    const addUserLambdaFn = this.createLambdaFunction(
      'adduser',
      addUserLambdaMetadata,
    )

    // const extractExecutionIdMetadata = this.loadLambdaMetadata(
    //   path.join(__dirname, '../../../src/lambda/workflow/extract-execution-id'),
    // )
    // const extractExecutionIdFn = this.createLambdaFunction(
    //  'extract-execution-id',
    //   extractExecutionIdMetadata,
    // )
    const stateMachine = this.generateSfn(
      userPoolId,
      // defineAuthChallengeResponseFn,
      addUserLambdaFn,
      createAuthChallengeFn,
      verifyAuthChallengeResponseFn,
      // extractExecutionIdFn,
      region,
    )
    // Read the lambda directory
    const lambdaDir = path.join(__dirname, '../../../src/lambda/api')
    const lambdaFolders = fs
      .readdirSync(lambdaDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)

    // Loop over each lambda folder and create a Lambda function
    for (const folder of lambdaFolders) {
      const lambdaPath = path.join(lambdaDir, folder)
      const metadata = this.loadLambdaMetadata(lambdaPath)

      const lambdaFunction = this.createLambdaFunction(folder, metadata)
      if (folder === 'account') {
        lambdaFunction.addEnvironment(
          'STATE_MACHINE_ARN',
          stateMachine.stateMachineArn,
        )
        // Grant permission to the Lambda to start the SFN execution
        lambdaFunction.addToRolePolicy(
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['states:StartExecution'],
            resources: [stateMachine.stateMachineArn],
          }),
        )
      }
      if (folder === 'auth') {
        lambdaFunction.addEnvironment(
          'VERIFY_AUTH_CHALLENGE_RESPONSE_FN_NAME',
          verifyAuthChallengeResponseFn.functionName,
        )
        // Grant permission to invoke the verifyAuthChallengeResponseFn
        verifyAuthChallengeResponseFn.grantInvoke(lambdaFunction);

      }
      this.addEndpoint(api, folder, lambdaFunction, metadata)
      // Lambda function depends on the API Gateway to get the stage name, and the
      // API Gateway depends on the Lambda function (as it uses the Lambda function as an integration target).
      // Thus, we have a circular dependency. So we have to hard code this here.
      lambdaFunction.addEnvironment('STAGE', 'v1')
    }

    // addUserLambdaFn.addEnvironment("USER_POOL_ID", userPoolId);
    // Grant permissions to the Lambda to write to Cognito UserPool
    addUserLambdaFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:SignUp', // Add other necessary actions as required
        ],
        resources: [this.userPool.userPoolArn],
      }),
    )
    const userPoolClientId = this.passwordless.userPoolClients!.at(0)!.userPoolClientId
    // Add environment variables to the Lambda functions
    addUserLambdaFn.addEnvironment('USER_POOL_ID', userPoolId)
    addUserLambdaFn.addEnvironment('USER_POOL_CLIENT_ID', userPoolClientId)
    // emailVerificationFn.addEnvironment('REGION', region)
    // emailVerificationFn.addEnvironment('SES_TEST_TO_ADDRESS', 'norman@domain.tld')
    // emailVerificationFn.addEnvironment('SES_FROM_ADDRESS', props.sesFromAddress)
    // emailVerificationFn.addEnvironment(
    //   'SES_SUBJECT',
    //   'Verify your email address',
    // )
    // emailVerificationFn.addEnvironment(
    //   'API_GATEWAY_URL',
    //   `https://jwzk22p6w9.execute-api.${region}.amazonaws.com/v1/` // This is hard coded because we get a Circular dependency error if we use the API Gateway URL from the API construct.
    //   // api.url, // This is the API Gateway URL, not the CloudFront `/v1/` origin in order to calculate the correct signature
    // )

    // End my lambda code
    this.fido2ApiGatewayEndpoint = api.url
    this.fido2ApiGatewayId = api.restApiId
    this.fido2AStageName = stageName

    new CfnOutput(this, 'UserPoolId', {
      value: userPoolId,
    })
    new CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClientId,
    })
    new CfnOutput(this, 'Fido2ApiId', {
      value: api.restApiId,
    })
    new CfnOutput(this, 'Fido2Url', {
      value: api.url,
    })
  }
  private attachPermissionsToLambda(policy: PolicyStatement, lambdaFunction?: IFunction) {
    if (lambdaFunction && lambdaFunction.role) {
      lambdaFunction.role.addToPrincipalPolicy(policy);
    }
  }

  // ... existing imports and setup ...
  private generateSfn(
    userPoolId: string,
    addUserLambdaFn: Function,
    createAuthChallengeFn: IFunction,
    verifyAuthChallengeResponseFn: IFunction,
    // extractExecutionIdFn: Function,
    region: string,
  ): StateMachine {

    const prepareAuthChallengeNoSession = new Pass(this, 'Prepare auth challenge with no session', {
      resultPath: '$.authChallengeInput',
      parameters: {
        'executionId.$': '$$.Execution.Id',
        'challenge': {
          'version': '1',
          'region': region,
          'triggerSource': 'CreateAuthChallenge_Authentication',
          'userName.$': '$.addUserResult.Payload.userSub',
          'request': {
            'userAttributes': {
              'sub.$': '$.addUserResult.Payload.userSub',
              'cognito:user_status': 'FORCE_CHANGE_PASSWORD',
              'given_name': 'cognito:default_val',
              'family_name': 'cognito:default_val',
              'email.$': '$.addUserResult.Payload.email'
            },
            'challengeName': 'CUSTOM_CHALLENGE',
            'session': JsonPath.array(),
          },
          // ... rest of the challenge object ...
          'callerContext': {
            'awsSdkVersion': 'aws-sdk-unknown-unknown',
            'clientId.$': '$.addUserResult.Payload.userPoolClientId'
          },
          'response': {
            'publicChallengeParameters': null,
            'privateChallengeParameters': null,
            'challengeMetadata': null
          }
        },
        // 'email.$': '$.addUserResult.Payload.email',
        // 'userSub.$': '$.addUserResult.Payload.userSub',
        // 'userPoolId.$': '$.addUserResult.Payload.userPoolId',
        // 'userPoolClientId.$': '$.addUserResult.Payload.userPoolClientId',
        // 'signInMethod.$': '$.addUserResult.Payload.signInMethod'
      }
    });

    // 'redirectUri.$': "States.Format('https://dev.domain.tld/v1/auth?id={}', $.extractedExecutionIdResult.Payload.executionId)",
    const prepareAuthChallengeWithSession = new Pass(this, 'Prepare auth challenge with session', {
      resultPath: '$.authChallengeInput',
      parameters: {
        'challenge': {
          'version': '1',
          'region': region,
          'triggerSource': 'CreateAuthChallenge_Authentication',
          'userName.$': '$.addUserResult.Payload.userSub',
          'request': {
            'userAttributes': {
              'sub.$': '$.addUserResult.Payload.userSub',
              'cognito:user_status': 'FORCE_CHANGE_PASSWORD',
              'given_name': 'cognito:default_val',
              'family_name': 'cognito:default_val',
              'email.$': '$.addUserResult.Payload.email'
            },
            'challengeName': 'CUSTOM_CHALLENGE',
            'session': [{
              'challengeName': 'CUSTOM_CHALLENGE',
              'challengeResult': false,
              'challengeMetadata': 'PROVIDE_AUTH_PARAMETERS'
            }],
            'clientMetadata': {
              'redirectUri': 'https://dev.domain.tld/v1/auth',
              'alreadyHaveMagicLink': 'no',
              'signInMethod': 'MAGIC_LINK'
            }
          },
          'callerContext': {
            'awsSdkVersion': 'aws-sdk-unknown-unknown',
            'clientId.$': '$.addUserResult.Payload.userPoolClientId'
          },
          'response': {
            'publicChallengeParameters': null,
            'privateChallengeParameters': null,
            'challengeMetadata': null
          },
        }, 
      }
    });
    // Add the Tasks to the State Machine
    const addUserTask = new LambdaInvoke(this, 'Adding user to Cognito pool', {
      lambdaFunction: addUserLambdaFn,
      resultPath: '$.addUserResult',
    });

    const verifyAuthChallengeResponseTask = new LambdaInvoke(this, 'Verifying auth challenge response', {
      lambdaFunction: verifyAuthChallengeResponseFn,
      inputPath: '$',
      resultPath: '$.verifyAuthChallengeResponseResult',
    });

    const prepareAuthChallengeNoSessionTask = new LambdaInvoke(this, 'Create auth challenge task:- FIDO2 signature', {
      lambdaFunction: createAuthChallengeFn,
      inputPath: '$.authChallengeInput',
      resultPath: '$.authChallengeNoSessionResult',
    });

    // const extractExecutionIdTask = new LambdaInvoke(this, 'Extract Execution ID', {
    //   lambdaFunction: extractExecutionIdFn,
    //   inputPath: '$', // Set to the entire state input, as we'll be using a TaskInput payload to pass the specific data
    //   resultPath: '$.extractedExecutionIdResult',
    //   payload: TaskInput.fromObject({
    //     'executionArn.$': '$$.Execution.Id',
    //   }),
    // });
    const prepareAuthChallengeWithSessionTask = new LambdaInvoke(this, 'Create auth challenge task:- SignInMethod', {
      lambdaFunction: createAuthChallengeFn,
      inputPath: '$.authChallengeInput',
      resultPath: '$.authChallengeWithSessionResult',
    });

    const jobSuccess = new Succeed(this, 'Operation Successful');
    const jobFail = new Fail(this, 'Operation Failed');

  // Define choices and flow for the workflow
  const verifyAuthChallengeResponseChoice = new Choice(this, 'Verify auth challenge Success?')
    .when(Condition.stringEquals('$.verifyAuthChallengeResponseResult.Payload.state', 'SUCCESS'), jobSuccess)
    .otherwise(jobFail);

  const authChallengeWithSessionSuccessChoice = new Choice(this, 'Auth Challenge With Session Success?')
    .when(Condition.stringEquals('$.authChallengeWithSessionResult.Payload.state', 'SUCCESS'), jobSuccess)
    .otherwise(jobFail);

  // const extractExecutionIdChoice = new Choice(this, 'Extract Execution ID?')
  //   .when(Condition.stringEquals('$.extractedExecutionIdResult.Payload.state', 'SUCCESS'),
  //     prepareAuthChallengeWithSession
  //     .next(prepareAuthChallengeWithSessionTask)
  //     .next(authChallengeWithSessionSuccessChoice))
  // .otherwise(jobFail);

  const authChallengeNoSessionSuccessChoice = new Choice(this, 'Auth Challenge No Session Success?')
    .when(Condition.stringEquals('$.authChallengeNoSessionResult.Payload.state', 'SUCCESS'),
      // extractExecutionIdTask
      // .next(extractExecutionIdChoice))
      prepareAuthChallengeWithSession
      .next(prepareAuthChallengeWithSessionTask)
      .next(authChallengeWithSessionSuccessChoice))
    .otherwise(jobFail);
    
  const userAddedChoice = new Choice(this, 'User Added?')
    .when(Condition.stringEquals('$.addUserResult.Payload.state', 'USER_ADDED'),
      prepareAuthChallengeNoSession
        .next(prepareAuthChallengeNoSessionTask)
        .next(authChallengeNoSessionSuccessChoice))
    .when(Condition.stringEquals('$.addUserResult.Payload.state', 'USER_EXISTS'), jobSuccess)
    .otherwise(jobFail);

  // Restart check choice
  const checkRestart = new Choice(this, 'Check if restart is needed')
    .when(Condition.booleanEquals('$.restart', true),
      verifyAuthChallengeResponseTask
      .next(verifyAuthChallengeResponseChoice))
    .otherwise(addUserTask);

  // Linking the flow starting with restart check
  const definition = checkRestart
    .afterwards() // Use afterwards to continue the flow after the choice state
    .next(userAddedChoice);

    const stateMachine = new StateMachine(this, 'StateMachine', {
      definitionBody: DefinitionBody.fromChainable(definition),
      stateMachineName: 'x11' + '-' + userPoolId,
    });

    return stateMachine;
  }


  private mapLogRetention(logRetentionString: string | undefined): RetentionDays {
    const retentionMapping: { [key: string]: RetentionDays } = {
      'ONE_DAY': RetentionDays.ONE_DAY,
      'THREE_DAYS': RetentionDays.THREE_DAYS,
      'FIVE_DAYS': RetentionDays.FIVE_DAYS,
      'ONE_WEEK': RetentionDays.ONE_WEEK,
      // ... add other mappings as necessary
    };

  // Default to ONE_DAY if no logRetentionString is provided
  return logRetentionString ? retentionMapping[logRetentionString] : RetentionDays.ONE_DAY;
}
  private createLambdaFunction(name: string, metadata: any): Function {
    const attributes = metadata.lambdaAttributes || {}
    const logRetention = this.mapLogRetention(attributes.logRetention);
    // Handle the timeout separately
    let timeoutDuration
    if (attributes.timeout) {
      timeoutDuration = Duration.seconds(attributes.timeout)
    }

    let tracingConfig
    switch (attributes.tracing) {
      case 'Active':
        tracingConfig = Tracing.ACTIVE
        break
      case 'PassThrough':
        tracingConfig = Tracing.PASS_THROUGH
        break
      case 'Disabled':
      default:
        tracingConfig = undefined // No tracing configuration means it's disabled
        break
    }

    return new Function(
      this,
      `${name.charAt(0).toUpperCase() + name.slice(1)}Function`,
      {
        ...attributes,
        runtime: Runtime.PROVIDED_AL2,
        architecture: Architecture.ARM_64,
        handler: 'bootstrap',
        code: Code.fromAsset(
          path.resolve(__dirname, '..', '..', '..', 'dist', `${name}.zip`),
        ),
        description: attributes.description || `${name} Lambda Function`,
        logRetention: logRetention,
        environment: {
          REGION: this.region,
        },
        timeout: timeoutDuration,
        tracing: tracingConfig,
      },
    )
  }

  private addEndpoint(
    api: any,
    endpointName: string,
    func: Function,
    metadata: any,
  ) {
    const integration = new LambdaIntegration(func)

    const responseModel200 = api.addModel(`${endpointName}ResponseModel200`, {
      contentType: 'application/json',
      schema: {
        title: `resp200-${endpointName}`,
        type: JsonSchemaType.OBJECT,
        properties: {
          region: { type: JsonSchemaType.STRING },
        },
      },
    })

    const resource = api.root.addResource(endpointName)

    // Dynamically add methods based on metadata
    for (const method of metadata.httpMethods) {
      resource.addMethod(method, integration, {
        authorizationType: AuthorizationType.NONE,
        methodResponses: [
          {
            statusCode: '200',
            responseModels: { 'application/json': responseModel200 },
          },
          {
            statusCode: '400',
          },
          {
            statusCode: '500',
          },
        ],
      })
    }

    if (metadata.requiresCors) {
      resource.addCorsPreflight({
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ['*'],
        maxAge: Duration.days(10),
      })
    }
  }

  private loadLambdaMetadata(lambdaPath: string): any {
    const metadataFilePath = path.join(lambdaPath, 'metadata.json')
    if (fs.existsSync(metadataFilePath)) {
      const rawData = fs.readFileSync(metadataFilePath, 'utf8')
      return JSON.parse(rawData)
    }
    throw new Error(`metadata.json not found for lambda at ${lambdaPath}`)
  }
  // private configureLambdaFunctions(userPoolId: string, userPoolClientId: string) {
  //   // Configure your lambda functions here, including setting environment variables
  //   // For example, setting environment variables for createAuthChallengeFn
  //   const createAuthChallengeFn = this.passwordless.createAuthChallengeFn;
  //   createAuthChallengeFn.addEnvironment('USER_POOL_ID', userPoolId);
  //   createAuthChallengeFn.addEnvironment('USER_POOL_CLIENT_ID', userPoolClientId);

  //   // ... similar configuration for other lambda functions ...
  // }
}
