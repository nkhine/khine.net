### Summary

![API Infra](./docs/diagram.png "API Infra")

https://github.com/aws-samples/amazon-cognito-passwordless-auth/tree/main
https://blog.amanpreet.dev/why-every-web-developer-should-know-htmx

https://www.youtube.com/watch?v=2hMrk7A8Wf0
https://www.youtube.com/watch?v=K-Qbr0IIJBw

## Deploying

```terminal
npx cdk deploy --verbose --profile x11-cicd CDKPipelineStack
```

## Passwordless authentication using AWS Cognito

1. Request Authentication Code:

Endpoint: /v1/auth/request-code
Method: POST
Description: This endpoint initiates the passwordless authentication process by sending a unique code/link to the provided email.
Body:

```json
{
  "email": "user@domain.tld"
}
```

2. Verify Authentication Code:

Endpoint: /v1/auth/verify-code
Method: POST
Description: This endpoint verifies the provided authentication code. If it's correct, it logs the user in and possibly returns a JWT token or similar for maintaining the session.
Body:

```json
{
  "email": "user@domain.tld",
  "code": "123456"
}
```

3. Current Session Status:

Endpoint: /v1/auth/session-status
Method: GET
Description: It returns the current session status - whether the user is authenticated or not, and possibly some basic user information.

4. Logout:
   Endpoint: /v1/auth/logout
   Method: POST
   Description: It invalidates the user's session, logging them out.
   Body:

```json
{
  "token": "jwt_token_or_session_id"
}
```

## Cleanup and Troubleshooting

<details>
<summary>Click to go through this step</summary>
#### Destroy the **LandingPagePipelineStack**

You can easily destroy the **LandingPagePipelineStack** and free up the deployed AWS resources on the CICD account:

```
cdk destroy --profile cicd
```

> Deleting the pipeline stack doesn't delete the **LandingPageStack** from the Staging and Prod accounts. You have to delete them manually whether through the AWS CloudFormation console or the AWS CLI.

### Step 5 - Notes

<details>
<summary>Click to see this step</summary>

1. This project creates a single S3 bucket to hold the built artifacts which will be served via cloudfront. This bucket is set to be destroyed on stack removal.
   The files related to each cloudfront instance are saved in a unique directory. The name of this directory is derived using,

```
${distribution-key}
```

For example, With input,

```yaml
main:
  branch: "main"
  certificate: "arn:aws:acm:us-east-1:********:certificate/ffdcd965-b157-4ac7-bd00-ad520e8c0c64"
  domain:
    - dev.domain.tld
```

`distribution-key` is `main`.

2. This project creates a single bucket to hold fleet web ui pipeline artifacts which will be destroyed on stack removal.
</details>

#### Troubleshooting

- If you get a CloudFormation Internal Failure error while deploying the stack, please check you have properly created the GITHUB_TOKEN secret
- If you get an error 400 message as a detailed error message when CodeBuild fails, please check you have properly modify your cdk.json file
- If you get an error message stating _Cannot have more thant 1 builds in queue for the account_ as a detailed error message when CodeBuild fails, please retry the step in CodePipeline. You get this error because your AWS account is new. After a few retry, the limit will automatically increase.
- You cannot have duplicate domain aliases across accounts and will get the following error:

```text
Resource handler returned message: "Invalid request provided: One or more of the CNAMEs you provided are already associated with a different resource.
```

https://aws.amazon.com/premiumsupport/knowledge-center/resolve-cnamealreadyexists-error/

</details>

## Get all domains

```terminal
aws cloudfront list-distributions --profile ops-dev | jq '.DistributionList.Items[] | select(.Aliases.Items != null) | "\(.Id),\(.DomainName),\u0027\(.Aliases.Items | join(","))\u0027"'
```

| CloudFront ID | URL                     | Aliases    | Git repo | Git branch | API            |
| ------------- | ----------------------- | ---------- | -------- | ---------- | -------------- |
| \*\*\*\*      | **\*\***.cloudfront.net | dev.domain.tld | website  | main       | dev.domain.tld/api |

```Client session storage localStorage.setItem("Passwordless.clientId.userName.session", "value");
{"Passwordless.3kn6faea765ij684vn0b5sskij.582417fd-2783-40af-a4b9-00d0cc0643e2.session":"AYABeGjjRMeFWOwmHDpSaB6_rscAHQABAAdTZXJ2aWNlABBDb2duaXRvVXNlclBvb2xzAAEAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo0NTU0NTg0OTMwODE6a2V5L2FiN2U3M2UzLWU2NDEtNDk5Zi1iNzc0LWZkZmM1MWM3NzFhYQC4AQIBAHihtNjBNPX7R1Ds_2P2VTDeEpnIJtQerCAqskdijFK4pgEVKXsPx3RrBdW9WN0dNJdSAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMasSgvuyh9t7P2_nqAgEQgDtIABERzzl7-UitbxE7PWC-1Ukidhva4SdDWOeSs6e_RZfusNCii1IvVlJqmy1VtPachSQwoNREL6BeGgIAAAAADAAAEAAAAAAAAAAAAAAAAAAcspy_mTHR9l3OzjBIMLZ-_____wAAAAEAAAAAAAAAAAAAAAEAAAFwvJofRTvrX6G-ZLL-bUTIBrhQ2CxFa7a-JwJ920u2N-9bxoxUneOEJryN5LkOjDE601bLpLSEnsZWLzM9HX5ewWghDs2_2_4vY4kZrgjM0dxjt_qbeJ_5nH1JzxbcB_rG0GwoxtCV14vese5wnhMJ5TGw2leA9_2UVg-tuaknD4NIlIfcpYpUYKnaiHnBMROdWRxrBfUGcZNBnVi6SdLQs-V-QhrIvvBhIRwSlRAyx59bxEfUZvHVYAfP9iRvfYcGNvdizuLwM2tmjUl33mnZrvqAwqNUMGT4S7uKGw0qJrYZsGIz7YXaAVpnzxEO-gBPfmc34Awtry0QPjqszBNKLUhLQAYWtWz6mi15i7rwjO1VzPFJDN-6oWlJ-N6FGoq9lOkXOWjVu3GunU7eQIoL5dCsyNMl3CPvpl7GDid0xJe8maliwpp9ObEaq_OU7WnErFxjiepcGq-brSo2Xhqi2gzLzYwMAXjKRbTMAlGRbznZ_lGh-Z-zicwhsRF9K9_6"}
```

```PasswordlessStack-SecretsTablePasswordless
{
  "userNameHash": {
    "B": "Re+Xe6rLc134V+f4o/HEgknehDXgloN+OPwbm7mwAfI="
  },
  "exp": {
    "N": "1700320584"
  },
  "iat": {
    "N": "1700319684"
  },
  "kmsKeyId": {
    "S": "alias/Passwordless-Dev-PasswordlessStack"
  },
  "signatureHash": {
    "B": "iEwz0ZO1g8We87vQa1r/1RKD7n1xKMr7vaBnQNUo3ag="
  }
}
```

```DefineAuthChallenge(1) Input
{
    "version": "1",
    "region": "eu-west-1",
    "userPoolId": "eu-west-1_ndklsp3Y4",
    "userName": "582417fd-2783-40af-a4b9-00d0cc0643e2",
    "callerContext": {
        "awsSdkVersion": "aws-sdk-unknown-unknown",
        "clientId": "3kn6faea765ij684vn0b5sskij"
    },
    "triggerSource": "DefineAuthChallenge_Authentication",
    "request": {
        "userAttributes": {
            "sub": "582417fd-2783-40af-a4b9-00d0cc0643e2",
            "cognito:user_status": "FORCE_CHANGE_PASSWORD",
            "given_name": "cognito:default_val",
            "family_name": "cognito:default_val",
            "email": "norman+18-1233@khine.net"
        },
        "session": []
    },
    "response": {
        "challengeName": null,
        "issueTokens": null,
        "failAuthentication": null
    }
}
```



```VerifyAuthChallenge
{
    "version": "1",
    "region": "eu-west-1",
    "userPoolId": "eu-west-1_ndklsp3Y4",
    "userName": "582417fd-2783-40af-a4b9-00d0cc0643e2",
    "callerContext": {
        "awsSdkVersion": "aws-sdk-unknown-unknown",
        "clientId": "3kn6faea765ij684vn0b5sskij"
    },
    "triggerSource": "VerifyAuthChallengeResponse_Authentication",
    "request": {
        "userAttributes": {
            "sub": "582417fd-2783-40af-a4b9-00d0cc0643e2",
            "cognito:user_status": "FORCE_CHANGE_PASSWORD",
            "given_name": "cognito:default_val",
            "family_name": "cognito:default_val",
            "email": "norman+18-1233@khine.net"
        },
        "privateChallengeParameters": {
            "challenge": "PROVIDE_AUTH_PARAMETERS",
            "fido2options": "{\"challenge\":\"utk5te1B_MhhgLTtFsZ4_2BivaU4xH7ELpj3sXsTQWONI6lXnRLj-k9BM_eew-zczOWJUaMmVoFcncaforVZLQ\",\"credentials\":[],\"timeout\":120000,\"userVerification\":\"required\"}"
        },
        "challengeAnswer": "__dummy__",
        "clientMetadata": {
            "redirectUri": "http://localhost:5173/",
            "alreadyHaveMagicLink": "no",
            "signInMethod": "MAGIC_LINK"
        }
    },
    "response": {
        "answerCorrect": false
    }
}
```

