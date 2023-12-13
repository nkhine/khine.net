package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"net/url"
	"os"
	"strings"
	"time"

	emailverifier "github.com/AfterShip/email-verifier"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/sfn"
)

var (
	verifier = emailverifier.NewVerifier()
)

// Embed the account.html into the binary.
//
//go:embed account.html email.html
var content embed.FS

type Item struct {
	Id, Label, Request, Origin, Target string
	RequiresValidation                 bool
}

type User struct {
	Email        string
	Token        string
	ErrorMessage string
}
type Output struct {
	ExecutionArn *string
	StartDate    *time.Time
	User         *User
}

type TemplateData struct {
	User         *User
	Items        []Item
	Busy         bool
	ErrorMessage string
}

func BuildEmailResponse(email string, token string, errorMessage string) (string, error) {
	emailTemplateContent, err := content.ReadFile("email.html")
	if err != nil {
		return "", err
	}

	tmpl, err := template.New("emailTemplate").Parse(string(emailTemplateContent))
	if err != nil {
		return "", err
	}

	data := User{
		Email:        email,
		Token:        token,
		ErrorMessage: errorMessage,
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, data)
	if err != nil {
		return "", err
	}

	return buf.String(), nil
}

func BuildPage(data TemplateData) *bytes.Buffer {
	var bodyBuffer bytes.Buffer

	// Load the embedded account.html template
	htmlContent, _ := content.ReadFile("account.html")
	t := template.New("template")
	var templates = template.Must(t.Parse(string(htmlContent)))
	templates.Execute(&bodyBuffer, data)
	return &bodyBuffer
}

func Handler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {

	apiGatewayStage := fmt.Sprintf(`/%s/`, os.Getenv("STAGE"))
	switch request.HTTPMethod {
	case "POST":
		// Extract email from form data
		emailValues, err := url.ParseQuery(request.Body)
		if err != nil {
			// Handle the error
			return events.APIGatewayProxyResponse{
				Headers:    map[string]string{"content-type": "text/plain"},
				Body:       "Invalid form data",
				StatusCode: 400,
			}, nil
		}

		email := emailValues.Get("email")
		// Perform email validation
		isValid, validationMsg := IsEmailValidated(email)
		if !isValid {
			responseData, err := BuildEmailResponse(email, "", validationMsg)
			if err != nil {
				// Handle error in building email response
				return events.APIGatewayProxyResponse{
					Headers:    map[string]string{"content-type": "text/plain"},
					Body:       "Failed to generate email response",
					StatusCode: 500,
				}, nil
			}

			return events.APIGatewayProxyResponse{
				Headers: map[string]string{
					"content-type": "text/html",
				},
				Body:       responseData,
				StatusCode: 200,
			}, nil
		}
		// TODO: Handle the email logic, e.g., sending a magic link, storing the email, etc.
		// Start the SFN
		// Prepare the input for the state machine
		stateMachineInput := map[string]string{
			"email":   email,
			"restart": "false",
		}
		inputJSON, err := json.Marshal(stateMachineInput)
		if err != nil {
			return events.APIGatewayProxyResponse{
				Headers:    map[string]string{"content-type": "text/plain"},
				Body:       "Failed to marshal state machine input",
				StatusCode: 500,
			}, nil
		}

		// Create a session and start the execution of the state machine
		sess := session.Must(session.NewSession())
		sfnClient := sfn.New(sess)
		stateMachineArn := os.Getenv("STATE_MACHINE_ARN")
		output, err := sfnClient.StartExecution(&sfn.StartExecutionInput{
			StateMachineArn: aws.String(stateMachineArn),
			Input:           aws.String(string(inputJSON)),
		})
		if err != nil {
			return events.APIGatewayProxyResponse{
				Headers:    map[string]string{"content-type": "text/plain"},
				Body:       fmt.Sprintf("Failed to start state machine execution: %s", err.Error()),
				StatusCode: 500,
			}, nil
		}
		// End SFN
		// Extract the UUID from the ExecutionArn
		executionArn := aws.StringValue(output.ExecutionArn)
		arnParts := strings.Split(executionArn, ":")
		uuid := arnParts[len(arnParts)-1] // UUID is the last part of the ARN
		responseData, err := BuildEmailResponse(email, uuid, "")
		if err != nil {
			return events.APIGatewayProxyResponse{
				Headers:    map[string]string{"content-type": "text/text"},
				Body:       "Failed to generate email response",
				StatusCode: 500,
			}, nil
		}

		return events.APIGatewayProxyResponse{
			Headers: map[string]string{
				"content-type": "text/html",
			},
			Body:       responseData,
			StatusCode: 200,
		}, nil

	case "GET":
		commonItems := []Item{
			{"FaceOrTouch", "Sign in with face or touch", "get", "todo", "#account", false},
			{"MagicLink", "Sign in with magic link", "get", "todo", "#account", false},
			{"ChangeUser", "Sign-in as another user", "get", "todo", "#account", false},
			{"WithPassKey", "Sign in with passkey", "get", "todo", "#account", true},
		}
		// Initialize the items slice with capacity
		Items := make([]Item, 0, len(commonItems)+1)

		for _, info := range commonItems {
			Items = append(Items, Item{
				Id:                 info.Id,
				Label:              info.Label,
				Request:            info.Request,
				Origin:             apiGatewayStage + info.Origin,
				Target:             info.Target,
				RequiresValidation: info.RequiresValidation,
			})
		}
		// Add the email item separately since it has different properties
		Items = append(Items, Item{
			Id:                 "Email",
			Label:              "Enter your e-mail address to sign in or register:",
			Request:            "post",
			Origin:             apiGatewayStage + "account",
			Target:             "#unauthenticated",
			RequiresValidation: true,
		})
		// If the schema query parameter is present, return the schema
		if _, exists := request.QueryStringParameters["schema"]; exists {
			schema := map[string]interface{}{
				"User": &User{
					Email: "string", // Expected type
				},
				"Busy":         "bool",   // Expected type
				"ErrorMessage": "string", // Expected type
				"Items":        Items,
				"HTTPVerb":     request.HTTPMethod,
			}
			schemaBytes, _ := json.Marshal(schema)
			return events.APIGatewayProxyResponse{
				Headers:    map[string]string{"content-type": "application/json"},
				Body:       string(schemaBytes),
				StatusCode: 200,
			}, nil
		}
		var user *User
		data := TemplateData{
			User:         user,
			Items:        Items,
			Busy:         false, // This would come from an actual source, e.g., session, token, etc.
			ErrorMessage: "",
		}

		// Filter items based on user's email validation status

		filteredItems := []Item{}
		for _, item := range Items {
			if data.User == nil && item.RequiresValidation {
				filteredItems = append(filteredItems, item)
			} else if data.User != nil && (!item.RequiresValidation) {
				filteredItems = append(filteredItems, item)
			}
		}
		data.Items = filteredItems

		return events.APIGatewayProxyResponse{
			Headers:    map[string]string{"content-type": "text/html"},
			Body:       BuildPage(data).String(),
			StatusCode: 200,
		}, nil

	default:
		// Handle other methods or return a method not allowed error
		return events.APIGatewayProxyResponse{
			Headers:    map[string]string{"content-type": "text/plain"},
			Body:       "Method not allowed",
			StatusCode: 405,
		}, nil
	}
}

func IsEmailValidated(email string) (bool, string) {
	// Extract domain from email
	domain := strings.Split(email, "@")[1]

	// Check MX records
	mx, err := verifier.CheckMX(domain)
	if err != nil || mx == nil {
		msg := fmt.Sprintf("Failed to get MX records for domain: %s", domain)
		fmt.Println(msg)
		return false, msg
	}

	// Check if the domain is disposable
	if verifier.IsDisposable(domain) {
		msg := fmt.Sprintf("Email domain is disposable: %s", domain)
		fmt.Println(msg)
		return false, msg
	}

	return true, "Email is valid."
}

func main() {
	lambda.Start(Handler)
}
