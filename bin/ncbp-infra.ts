#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { NcbpInfraStack } from "../lib/ncbp-infra-stack";
import { ContainerProperties, createStack } from "../lib/ncbp-ecs-stack";

const app = new cdk.App();
const ncbpInfraStack = new NcbpInfraStack(app, "NcbpInfraStack", {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */
  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },
  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

const stackName = `FargateServiceStack`;

const dockerProperties: ContainerProperties[] = [
  {
    repoName: 'user-service',
    containerPort: 80,
    id: 'UserService',
    conditions: [
      elbv2.ListenerCondition.pathPatterns(['/users*'])],
    environment: {  },
    secretArn: "arn:aws:secretsmanager:us-east-1:637423235266:secret:user-service-nnU3A6",
    healthCheckPath: "/users/health"
  },
  {
    repoName: "workspace-service",
    containerPort: 80,
    id: "WorkspaceService",
    conditions: [elbv2.ListenerCondition.pathPatterns(["/workspaces*"])],
    environment: {},
    secretArn:
      "arn:aws:secretsmanager:us-east-1:637423235266:secret:workspace-service-8IHfUx",
    healthCheckPath: "/workspaces/health",
  },
  {
    repoName: "dataset-service",
    containerPort: 80,
    id: "DatasetService",
    conditions: [elbv2.ListenerCondition.pathPatterns(["/datasets*"])],
    environment: {},
    secretArn:
      "arn:aws:secretsmanager:us-east-1:637423235266:secret:datasets-service-HOyAye",
    healthCheckPath: "/datasets/health",
  },
  {
    repoName: "key-management-service",
    containerPort: 80,
    id: "KeyManagementService",
    conditions: [elbv2.ListenerCondition.pathPatterns(["/domains*"])],
    environment: {},
    secretArn:
      "arn:aws:secretsmanager:us-east-1:637423235266:secret:key-management-service-VB54Ld",
    healthCheckPath: "/domains/health",
  },
  {
    repoName: "bot-service",
    containerPort: 80,
    id: "BotService",
    conditions: [elbv2.ListenerCondition.pathPatterns(["/bot*"])],
    environment: {
    },
    secretArn: "arn:aws:secretsmanager:us-east-1:637423235266:secret:bot-service-ZY9VSs",
    healthCheckPath: "/bot/health",
  },
  {
    repoName: "langchain-embedding-service",
    containerPort: 80,
    id: "LangchainEmbeddingService",
    conditions: [elbv2.ListenerCondition.pathPatterns(["/*"])],
    environment: {},
    healthCheckPath: "/",
    secretArn: "",
    dockerHub: true,
    dockerHubUsername: "zohaibazam58",
  },
];

const stackTags: { name: string; value: string }[] = [
  { name: 'UserService', value: 'starter-app' },
  // { name: "WorkspaceService", value: "starter-app" },
  { name: "DatasetService", value: "starter-app" },
  { name: "BotService", value: "starter-app" },
  { name: 'LangchainEmbeddingService', value: 'starter-app' },
];
createStack(app, stackName, dockerProperties, stackTags, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  ncbpTable: ncbpInfraStack.dynamoTable,
  s3Bucket: ncbpInfraStack.s3Bucket,
});

app.synth();
