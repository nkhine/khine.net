#!/bin/bash

LAMBDA_SRC="./dist/sam-local"
LAMBDA_METADATA="./src/lambda"

# Begin the template
cat <<EOL > template.yml
AWSTemplateFormatVersion: '2010-09-09'
Transform: 'AWS::Serverless-2016-10-31'
Description: An auto-generated SAM template for Lambda functions.

Resources:
EOL

# Iterate over the directories in $LAMBDA_SRC
for dir in $(ls $LAMBDA_SRC); do
  # Extract methods from metadata.json
  METADATA_FILE="$LAMBDA_METADATA/$dir/metadata.json"
  
  if [ -f "$METADATA_FILE" ]; then
    METHODS=$(jq -r '.httpMethods[]' "$METADATA_FILE")
  else
    echo "Warning: metadata.json not found for $dir. Using default method GET."
    METHODS="GET"
  fi
  
  cat <<EOL >> template.yml

  ${dir^}Function: # Capitalize the first letter
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: $LAMBDA_SRC/$dir/
      Handler: bootstrap
      Runtime: go1.x
      Tracing: Active
      Environment:
        Variables:
          REGION: eu-west-1
          STAGE: v1
      Events:
EOL

  # Add each method for the lambda function to the template
  for method in $METHODS; do
    cat <<EOL >> template.yml
        ${method^}Event: # Capitalize the method for the event name
          Type: Api
          Properties:
            Path: /v1/$dir
            Method: $method
EOL
  done
done

# End the template
cat <<EOL >> template.yml

Outputs:
  ApiUrl:
    Description: "API Gateway endpoint URL for Prod environment"
    Value: !Sub "https://${ServerlessRestApi}.execute-api.${AWS::Region}.amazonaws.com/v1/"
EOL
