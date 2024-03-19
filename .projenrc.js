const { awscdk } = require("projen");
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: "2.110.0",
  cdkVersionPinning: false,
  defaultReleaseBranch: "main",
  name: "khine.net",
  description: "CloudFronts",
  authorName: "Norman Khine",
  authorEmail: "norman@khine.us",
  repository: "https://github.com/nkhine/khine.net",
  authorOrganization: "khine.net",
  entrypoint: "bin/main.ts",
  licensed: false,
  gitignore: [
    "!lib/*.ts",
    "!bin/*.ts",
    "!src/lambda/workflow/email/email.html",
  ],
  deps: [
    "yaml",
    "amazon-cognito-passwordless-auth@0.13.1",
  ] /* Runtime dependencies of this module. */,
  devDeps: [
    "cdk-dia",
    "@sentry/cli",
    "@types/aws-lambda",
  ] /* Build dependencies for this module. */,
  prettier: true,
  prettierOptions: {
    overrides: [
      {
        files: "*.ts",
        options: {
          parser: "typescript",
          singleQuote: true,
          trailingComma: "all",
          bracketSpacing: true,
          semi: false,
          printWidth: 80,
          // ... [any other TypeScript-specific Prettier configurations]
        },
      },
      // For Go, if you had a plugin for it:
      /*
      {
        files: "*.go",
        options: {
          parser: "go",
          // ... [Go-specific Prettier configurations]
        }
      }
      */
    ],
    ignoreFile: true,
    ignoreFileOptions: {
      // Patterns for files to ignore
      patterns: ["src/**/*.html"],
    },
  },

  dependabot: false,
  buildWorkflow: false,
  releaseWorkflow: false,
  github: false,
  jest: false,
  appEntrypoint: "main.ts",
  buildCommand: "make",
  clobber: false,
  srcdir: "bin",
  context: {
    service_name: "infrastructure",
  },
});
project.prettier.addIgnorePattern("*.html");
project.addTask("gen-dia", {
  cwd: "./docs",
  exec: `
    npx cdk-dia --tree ../cdk.out/tree.json  \
      --include CloudFrontCDKPipelineStack \
      --include CloudFrontCDKPipelineStack/Dev/CloudFrontSharedStack \
      --include CloudFrontCDKPipelineStack/Dev/CloudFrontStack \
      --include CloudFrontCDKPipelineStack/Dev/CloudFrontPipelineStack
  `,
});

project.synth();
