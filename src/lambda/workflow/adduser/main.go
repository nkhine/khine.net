package main

import (
	"fmt"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/awserr"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/cognitoidentityprovider"
	"github.com/sethvargo/go-password/password"
	log "github.com/sirupsen/logrus"
)

type State string

const (
	StateSuccess    State = "SUCCESS"
	StateFailed     State = "FAILED"
	StateUserAdded  State = "USER_ADDED"
	StateUserExists State = "USER_EXISTS"
)

type Input struct {
	Email string `json:"email"`
}

type Output struct {
	Email            string `json:"email"`
	UserSub          string `json:"userSub,omitempty"`
	UserPoolId       string `json:"userPoolId,omitempty"`
	UserPoolClientId string `json:"userPoolClientId,omitempty"`
	State            State  `json:"state"`
	Message          string `json:"message"`
	SignInMethod     string `json:"signInMethod,omitempty"`
}

func main() {
	lambda.Start(handler)
}

func handler(input Input) (Output, error) {
	// Set up AWS session and create Cognito service client
	sess := session.Must(session.NewSession())
	svc := cognitoidentityprovider.New(sess)

	password, err := generateRandomPassword()
	if err != nil {
		log.WithError(err).Error("Error generating random password")
		return Output{
			State:   StateFailed,
			Message: "Error generating random password",
		}, err
	}
	userPoolId := os.Getenv("USER_POOL_ID")
	userPoolClientId := os.Getenv("USER_POOL_CLIENT_ID")

	userInput := &cognitoidentityprovider.AdminCreateUserInput{
		UserPoolId:        aws.String(userPoolId), // Use the corrected variable
		Username:          aws.String(input.Email),
		TemporaryPassword: aws.String(password),
		UserAttributes: []*cognitoidentityprovider.AttributeType{
			{Name: aws.String("email"), Value: aws.String(input.Email)},
		},
		MessageAction: aws.String("SUPPRESS"),
	}

	// Attempt to create user
	userResponse, err := svc.AdminCreateUser(userInput)
	if err != nil {
		return handleCreateUserError(input.Email, err)
	}
	// Successfully created user
	output := Output{
		Email:            input.Email,
		State:            StateUserAdded,
		UserPoolId:       userPoolId,
		UserPoolClientId: userPoolClientId,
		Message:          "User has been added to Cognito.",
		SignInMethod:     "MAGIC_LINK",
	}

	// Extract user sub (unique identifier) if available
	if userResponse.User != nil {
		output.UserSub = extractUserSub(userResponse.User.Attributes)
	}

	log.WithFields(log.Fields{
		"Output": output,
	}).Info("User successfully added to Cognito")

	return output, nil
}

// handleCreateUserError handles the errors returned from the AdminCreateUser call.
func handleCreateUserError(inputEmail string, err error) (Output, error) {
	output := Output{
		State: StateFailed,
		Email: inputEmail, // Include the email that was being processed
	}

	if aerr, ok := err.(awserr.Error); ok {
		output.Message = fmt.Sprintf("Error adding user to Cognito: %s", aerr.Error())

		if aerr.Code() == cognitoidentityprovider.ErrCodeUsernameExistsException {
			output.State = StateUserExists
			output.Message = "UsernameExistsException: An account with the given email already exists."
			output.SignInMethod = "MAGIC_LINK"
			log.WithError(err).Warn("User already exists in Cognito")
			// Return early since we've handled this specific case.
			return output, nil
		}
	} else {
		// Handle non-AWS errors.
		output.Message = fmt.Sprintf("Error adding user to Cognito: %v", err)
	}

	log.WithFields(log.Fields{
		"Message": output.Message,
	}).Error("Error while adding user to Cognito")

	// Return the output along with the wrapped original error.
	return output, fmt.Errorf("error adding user to Cognito: %w", err)
}

// extractUserSub extracts the user's sub attribute from a list of attributes.
func extractUserSub(attributes []*cognitoidentityprovider.AttributeType) string {
	for _, attr := range attributes {
		if *attr.Name == "sub" {
			return *attr.Value
		}
	}
	return ""
}

func generateRandomPassword() (string, error) {
	// Define password generator configuration
	generator, err := password.NewGenerator(&password.GeneratorInput{
		Symbols: "!@#$%^&*()-_+=",
	})
	if err != nil {
		log.WithError(err).Error("Error creating password generator")
		return "", err
	}

	// Generate a password that meets AWS Cognito's default policy requirements:
	// Minimum length: 8 characters
	// At least one uppercase letter
	// At least one lowercase letter
	// At least one number
	// At least one special character
	// The length of the password is the sum of required characters plus additional to meet the minimum length
	totalLength := 12   // 12 characters total length
	minDigits := 1      // At least one number
	minSymbols := 1     // At least one special character
	minUpper := 1       // At least one uppercase letter
	minLower := 1       // At least one lowercase letter
	noUpper := false    // Allow uppercase characters
	allowRepeat := true // Allow characters to be repeated

	// The totalLength must be large enough to accommodate all requirements
	if totalLength < (minDigits + minSymbols + minUpper + minLower) {
		totalLength = minDigits + minSymbols + minUpper + minLower
	}

	res, err := generator.Generate(totalLength, minDigits, minSymbols, noUpper, allowRepeat)
	if err != nil {
		log.WithError(err).Error("Error generating password")
		return "", err
	}

	return res, nil
}
