import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
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
  // Define the path or host header for routing traffic
  conditions: elbv2.ListenerCondition[];
  // The health check path
  healthCheckPath: string;
}

export interface Tag {
  name: string;
  value: string;
}

const createTaskDefinition = (
  id: string,
  stack: cdk.Stack,
  containerProperties: ContainerProperties,
  tags: Tag[]
) => {
  const taskDefinition = new ecs.FargateTaskDefinition(
    stack,
    `${id}TaskDefinition`,
    {
      cpu: 2048,
      memoryLimitMiB: 8192
    }
  );
  const repo = ecr.Repository.fromRepositoryName(stack, `${containerProperties.repoName}Repo`, containerProperties.repoName)
  taskDefinition
    .addContainer(`${id}Container`, {
      image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      memoryLimitMiB: 2048,
      cpu: 512,
      environment: containerProperties.environment,
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
  // certificate: cm.ICertificate,
  containerProperties: ContainerProperties[],
  tags: Tag[]
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
          name: container.repoName
        }
      })
  );

  const loadBalancer = new elbv2.ApplicationLoadBalancer(
    stack,
    `${id}LoadBalancer`,
    {
      vpc: cluster.vpc,
      internetFacing: true,
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
          interval: cdk.Duration.seconds(60),
          timeout: cdk.Duration.seconds(30),
        }
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
  props: cdk.StackProps,
  vpc?: ec2.Vpc,
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
  )

  const cluster = new ecs.Cluster(stack, `${id}Cluster`, { vpc: vpcInUse });
  const { loadBalancer, services } = configureClusterAndServices(
    id,
    stack,
    cluster,
    dnsNamespace,
    containerProperties,
    tags,
  );

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
