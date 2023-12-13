// import { magicLink } from "amazon-cognito-passwordless-auth/custom-auth";

// // Export the solution's handler to be the handler of YOUR Lambda function too:
// export { createAuthChallengeHandler as handler } from "amazon-cognito-passwordless-auth/custom-auth";
// const defaultConfig = magicLink.configure();

// // Configure the magicLink with custom email content
// magicLink.configure({
//   async contentCreator({ secretLoginLink }) {
//     // Calculate expiry time in minutes
//     const expiryTime = Math.floor(defaultConfig.secondsUntilExpiry / 60);
//     return {
//       html: {
//         data: `<html>
//           <body>
//             <p>Your secret sign-in link: <a href="${secretLoginLink}">sign in</a></p>
//             <p>This link is valid for ${expiryTime} minutes</p>
//           </body>
//         </html>`,
//         charSet: "UTF-8",
//       },
//       text: {
//         data: `Your secret sign-in link: ${secretLoginLink}\nThis link is valid for ${expiryTime} minutes`,
//         charSet: 'UTF-8',
//       },
//       subject: {
//         data: 'Your Custom Sign-In Link',
//         charSet: 'UTF-8',
//       },
//     };
//   },
// });

// Custom
import { magicLink, createAuthChallengeHandler } from 'amazon-cognito-passwordless-auth/custom-auth';
import { Context, Callback } from 'aws-lambda';
// Define the expected input structure
interface Input {
  challenge: any;
  executionId: string,
}

// Define the desired output structure
interface Output {
  state: string;
  success: boolean;
  message: string;
  response: any;
}

const defaultConfig = magicLink.configure();

// Configure the magicLink with custom email content
magicLink.configure({
  async contentCreator({ secretLoginLink }) {
    const modifiedLink = secretLoginLink.replace('#', '?token=');
    // Calculate expiry time in minutes
    const expiryTime = Math.floor(defaultConfig.secondsUntilExpiry / 60);
    return {
      html: {
        data: `<html>
          <body>
            <p>Your secret sign-in link: <a href="${modifiedLink}">sign in</a></p>
            <p>This link is valid for ${expiryTime} minutes</p>
          </body>
        </html>`,
        charSet: "UTF-8",
      },
      text: {
        data: `Your secret sign-in link: ${modifiedLink}\nThis link is valid for ${expiryTime} minutes`,
        charSet: 'UTF-8',
      },
      subject: {
        data: 'Your Custom Sign-In Link',
        charSet: 'UTF-8',
      },
    };
  },
});

export const handler = async (event: Input, context: Context, callback: Callback): Promise<Output> => {
  console.log('event - create auth challenge lambda Fn: ', event);
  try {
    // Log relevant parts of the context object
    const contextDetails = {
      awsRequestId: context.awsRequestId,
      logGroupName: context.logGroupName,
      logStreamName: context.logStreamName,
      // Add other relevant context properties as needed
    };
    console.log('Context details', { contextDetails });

    // Call the original createAuthChallengeHandler with the challenge object
    const response = await createAuthChallengeHandler(event.challenge, context, callback);
    console.log('CreateAuthChallengeHandler executed successfully', response);
  return {
      state: 'SUCCESS',
      success: true,
      message: 'CreateAuthChallengeHandler executed successfully',
      response: response
    };
  } catch (error) {
      console.log('Error occurred in handler', { error });
    return {
      state: 'FAILED',
      success: false,
      message: `Error in processing magic link: ${error.message}`,
      response: error
    };
  } finally {
    console.log('Handler completed');
  }
}

