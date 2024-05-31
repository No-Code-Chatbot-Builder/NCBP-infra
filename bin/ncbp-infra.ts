#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { NcbpInfraStack } from "../lib/ncbp-infra-stack";
import { ContainerProperties, createStack } from "../lib/ncbp-ecs-stack";

const app = new cdk.App();
const version = "-v2"; // Define the version variable with a hyphen

const ncbpInfraProps = {
  tableName: `ncbp${version}`,
  bucketName: `ncbp-assets${version}`,
  userPoolDomainPrefix: `ncbp-user-pool${version}`,
}

const ncbpInfraStack = new NcbpInfraStack(app, `NcbpInfraStack${version}`, {
  // Use version in infra stack name
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  ...ncbpInfraProps
});

const stackName = `FargateServiceStack${version}`; // Use version in service stack name

const dockerProperties: ContainerProperties[] = [
  {
    repoName: `user-service`, // No version in repo name
    containerPort: 80,
    id: `UserService${version}`,
    conditions: [elbv2.ListenerCondition.pathPatterns(["/users*"])],
    environment: {},
    secretArn:
      "arn:aws:secretsmanager:us-east-1:637423235266:secret:user-service-nnU3A6",
    healthCheckPath: "/users/health",
  },
  {
    repoName: "workspace-service", // No version in repo name
    containerPort: 80,
    id: `WorkspaceService${version}`,
    conditions: [elbv2.ListenerCondition.pathPatterns(["/workspaces*"])],
    environment: {},
    secretArn:
      "arn:aws:secretsmanager:us-east-1:637423235266:secret:workspace-service-8IHfUx",
    healthCheckPath: "/workspaces/health",
  },
  {
    repoName: "dataset-service", // No version in repo name
    containerPort: 80,
    id: `DatasetService${version}`,
    conditions: [elbv2.ListenerCondition.pathPatterns(["/datasets*"])],
    environment: {},
    secretArn:
      "arn:aws:secretsmanager:us-east-1:637423235266:secret:datasets-service-HOyAye",
    healthCheckPath: "/datasets/health",
  },
  {
    repoName: "key-management-service", // No version in repo name
    containerPort: 80,
    id: `KeyManagementService${version}`,
    conditions: [elbv2.ListenerCondition.pathPatterns(["/domains*"])],
    environment: {},
    secretArn:
      "arn:aws:secretsmanager:us-east-1:637423235266:secret:key-management-service-VB54Ld",
    healthCheckPath: "/domains/health",
  },
  {
    repoName: "bot-service", // No version in repo name
    containerPort: 80,
    id: `BotService${version}`,
    conditions: [elbv2.ListenerCondition.pathPatterns(["/bot*"])],
    environment: {},
    secretArn:
      "arn:aws:secretsmanager:us-east-1:637423235266:secret:bot-service-ZY9VSs",
    healthCheckPath: "/bot/health",
  },
  {
    repoName: "finetune-service", // No version in repo name
    containerPort: 80,
    id: `FinetuneService${version}`,
    conditions: [elbv2.ListenerCondition.pathPatterns(["/finetune*"])],
    environment: {},
    secretArn: "",
    healthCheckPath: "/finetune/health",
  },
  // {
  //   repoName: "frontend-service", // No version in repo name
  //   containerPort: 80,
  //   id: `FrontendService${version}`,
  //   conditions: [elbv2.ListenerCondition.pathPatterns(["/*"])],
  //   environment: {},
  //   secretArn: "",
  //   healthCheckPath: "/"
  // },
  {
    repoName: "langchain-embedding-service", // No version in repo name
    containerPort: 80,
    id: `LangchainEmbeddingService${version}`,
    conditions: [elbv2.ListenerCondition.pathPatterns(["/*"])],
    environment: {},
    healthCheckPath: "/",
    secretArn: "",
    dockerHub: true,
    dockerHubUsername: "zohaibazam58",
  },
];

const domainProps = {
  domainName: "solcompute.com",
  subdomainName: "api",
  domainCertificateArn:
    "arn:aws:acm:us-east-1:637423235266:certificate/942b10bd-8520-4807-b04a-604ada15543f",
};

const stackTags: { name: string; value: string }[] = [
  { name: `UserService${version}`, value: "starter-app" },
  { name: `DatasetService${version}`, value: "starter-app" },
  { name: `BotService${version}`, value: "starter-app" },
  { name: `LangchainEmbeddingService${version}`, value: "starter-app" },
];

createStack(app, stackName, dockerProperties, domainProps, stackTags, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  ncbpTable: ncbpInfraStack.dynamoTable,
  s3Bucket: ncbpInfraStack.s3Bucket,
});

app.synth();
