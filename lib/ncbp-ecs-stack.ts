import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import "dotenv/config";

interface NcbpEcsStackProps extends cdk.StackProps {
  readonly ncbpTable: dynamodb.Table;
  readonly s3Bucket: s3.Bucket;
}

export interface ContainerProperties {
  // The name of the repository
  repoName: string;
  // The container port
  containerPort: number;
  // Unique id of the service
  id: string;
  // Environment variables for the container
  environment: { [key: string]: string };
  secretArn: string;
  // Define the path or host header for routing traffic
  conditions: elbv2.ListenerCondition[];
  // The health check path
  healthCheckPath: string;
  dockerHub?: boolean;
  dockerHubUsername?: string;
}

export interface Tag {
  name: string;
  value: string;
}

const createTaskDefinition = (
  id: string,
  stack: cdk.Stack,
  containerProperties: ContainerProperties,
  // taskRole: iam.Role,
  tags: Tag[]
) => {
  let secret = null;

  if (containerProperties.secretArn !== "") {
    secret = secretsmanager.Secret.fromSecretCompleteArn(
      stack,
      `${id}Secret`,
      containerProperties.secretArn
    );
  }

  const taskDefinition = new ecs.FargateTaskDefinition(
    stack,
    `${id}TaskDefinition`,
    {
      cpu:
        containerProperties.repoName in
        ["workspace-service", "key-management-service"]
          ? 512
          : 256,
      memoryLimitMiB:
        containerProperties.repoName in
        ["workspace-service", "key-management-service"]
          ? 1024
          : 512,
      taskRole: new iam.Role(stack, `${id}TaskRole`, {
        roleName: `${id}TaskRole`,
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "AmazonDynamoDBFullAccess"
          ),
        ],
      }),
    }
  );

  taskDefinition
    .addContainer(`${id}Container`, {
      image: containerProperties.dockerHub
        ? ecs.ContainerImage.fromRegistry(
            `${containerProperties.dockerHubUsername}/${containerProperties.repoName}`
          )
        : ecs.ContainerImage.fromEcrRepository(
            ecr.Repository.fromRepositoryName(
              stack,
              `${id}Repo`,
              containerProperties.repoName
            ),
            "latest"
          ),
      memoryLimitMiB:
        containerProperties.repoName in
        ["workspace-service", "key-management-service"]
          ? 4096
          : 512,
      cpu:
        containerProperties.repoName in
        ["workspace-service", "key-management-service"]
          ? 512
          : 256,
      environment: containerProperties.environment,

      secrets: secret
        ? { SECRET: ecs.Secret.fromSecretsManager(secret) }
        : undefined,
      logging: new ecs.AwsLogDriver({ streamPrefix: `${id}` }),
    })
    .addPortMappings({
      containerPort: containerProperties.containerPort,
      protocol: ecs.Protocol.TCP,
    });
  tags.forEach((tag) => cdk.Tags.of(taskDefinition).add(tag.name, tag.value));
  return taskDefinition;
};

const configureClusterAndServices = (
  id: string,
  stack: cdk.Stack,
  cluster: ecs.Cluster,
  namespace: servicediscovery.PrivateDnsNamespace,
  // taskRole: iam.Role,
  // certificate: cm.ICertificate,
  containerProperties: ContainerProperties[],
  tags: Tag[],
  commonSecurityGroup: ec2.SecurityGroup
) => {
  const services = containerProperties.map(
    (container) =>
      new ecs.FargateService(stack, `${container.id}FargateService`, {
        cluster,
        taskDefinition: createTaskDefinition(
          `${container.id}`,
          stack,
          container,
          tags
        ),
        cloudMapOptions: {
          cloudMapNamespace: namespace,
          name: container.repoName,
        },
        securityGroups: [commonSecurityGroup],
      })
  );

  const loadBalancer = new elbv2.ApplicationLoadBalancer(
    stack,
    `${id}LoadBalancer`,
    {
      vpc: cluster.vpc,
      internetFacing: true,
      idleTimeout: cdk.Duration.minutes(15)
    }
  );
  // createHttpsRedirect(id, stack, loadBalancer);

  const listener = loadBalancer.addListener(`${id}HttpsListener`, {
    port: 80,
    // certificates: [elbv2.ListenerCertificate.fromArn(certificate.certificateArn)],
  });

  services.forEach((service, i) =>
    service.registerLoadBalancerTargets({
      containerName: `${containerProperties[i].id}Container`,
      containerPort: containerProperties[i].containerPort,
      newTargetGroupId: `${containerProperties[i].id}TargetGroup`,
      listener: ecs.ListenerConfig.applicationListener(listener, {
        protocol: elbv2.ApplicationProtocol.HTTP,
        priority: 10 + i * 10,
        conditions: containerProperties[i].conditions,
        healthCheck: {
          path: containerProperties[i].healthCheckPath,
          interval: cdk.Duration.seconds(120),
          timeout: cdk.Duration.seconds(90),
          healthyThresholdCount: 5,
          unhealthyThresholdCount: 5,
        },
        
        stickinessCookieDuration: cdk.Duration.hours(1),
      }),
    })
  );

  listener.addAction(`${id}FixedResponse`, {
    action: elbv2.ListenerAction.fixedResponse(404, {
      messageBody: "Not Found",
    }),
  });
  return { loadBalancer, services };
};
export const createStack = (
  scope: cdk.App,
  id: string,
  containerProperties: ContainerProperties[],
  // domainProperties: DomainProperties,
  tags: Tag[],
  props: NcbpEcsStackProps,
  vpc?: ec2.Vpc
) => {
  const stack = new cdk.Stack(scope, id, props);
  tags.forEach((tag) => cdk.Tags.of(stack).add(tag.name, tag.value));

  // const certificate = cm.Certificate.fromCertificateArn(stack, `${id}Certificate`,
  //   domainProperties.domainCertificateArn);

  // NOTE: Limit AZs to avoid reaching resource quotas
  const vpcInUse = new ec2.Vpc(stack, `${id}Vpc`, { maxAzs: 2 });

  const dnsNamespace = new servicediscovery.PrivateDnsNamespace(
    stack,
    `${id}DnsNamespace`,
    {
      name: "services",
      vpc: vpcInUse,
    }
  );

  const commonSecurityGroup = new ec2.SecurityGroup(
    stack,
    "CommonEcsSecurityGroup",
    {
      vpc: vpcInUse,
      description: "Allow communication between ECS services",
      allowAllOutbound: true, // Typical requirement, adjust based on your needs
    }
  );

  commonSecurityGroup.addIngressRule(
    commonSecurityGroup,
    ec2.Port.tcp(80),
    "Allow communication between ECS services"
  );

  // const taskRole = new iam.Role(stack, "ecsTaskExecutionRole", {
  //   roleName: `${id}TaskExecutionRole`,
  //   assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
  // });

  // taskRole.addManagedPolicy(
  //   iam.ManagedPolicy.fromAwsManagedPolicyName(
  //     "service-role/AmazonECSTaskExecutionRolePolicy"
  //   )
  // );

  // props?.ncbpTable.grantReadWriteData(taskRole);
  // props?.s3Bucket.grantReadWrite(taskRole);

  const cluster = new ecs.Cluster(stack, `${id}Cluster`, { vpc: vpcInUse });
  const { loadBalancer, services } = configureClusterAndServices(
    id,
    stack,
    cluster,
    dnsNamespace,
    containerProperties,
    tags,
    commonSecurityGroup
  );
  // services.forEach((service, i) => {
  //   props?.ncbpTable.grantReadWriteData(service.taskDefinition.taskRole);
  //   props?.s3Bucket.grantReadWrite(service.taskDefinition.taskRole);
  // });

  // const zone = route53.HostedZone.fromLookup(stack, `${id}Zone`, {
  //   domainName: domainProperties.domainName
  // });

  // new route53.CnameRecord(stack, `${id}Site`, {
  //   zone,
  //   recordName: domainProperties.subdomainName,
  //   domainName: loadBalancer.loadBalancerDnsName,
  // });

  // Output the DNS name where you can access your service
  new cdk.CfnOutput(stack, `${id}DNS`, {
    value: loadBalancer.loadBalancerDnsName,
  });
  // new cdk.CfnOutput(stack, `SiteDNS`, { value: `${domainProperties.subdomainName}.${domainProperties.domainName}` });
  return stack;
};
