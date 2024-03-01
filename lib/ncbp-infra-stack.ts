import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { S3CdnBucket } from "./constructs/s3-cdn-bucket";

export class NcbpInfraStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly dynamoTable: dynamodb.Table;
  public readonly s3Bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // dynamodb table: stores data for users, analysis
    this.dynamoTable = new dynamodb.Table(this, "NcbpTable", {
      tableName: "ncbp",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // add global secondary indexes based on business logic
    this.dynamoTable.addGlobalSecondaryIndex({
      indexName: "GSIInverted",
      partitionKey: {
        name: "SK",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING,
      },
    });

    this.dynamoTable.addGlobalSecondaryIndex({
      indexName: "GSIType",
      partitionKey: {
        name: "type",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "SK",
        type: dynamodb.AttributeType.STRING,
      },
    })

    // s3 bucket: stores user uploads
    this.s3Bucket = new S3CdnBucket(this, "NcbpS3Bucket", {
      bucketName: "ncbp-assets-bucket",
      removalPolicy: false
    }).assetsBucket

    // Cognito UserPool and UserPoolClient for authentication
    this.userPool = new cognito.UserPool(this, "NcbpPool", {
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        preferredUsername: {
          required: true,
          mutable: false,
        },
        email: {
          required: true,
          mutable: false,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        address: {
          required: false,
          mutable: true,
        },
        birthdate: {
          required: false,
          mutable: true,
        },
      },
    });

    const domain = this.userPool.addDomain("NcbpUserPoolDomain", {
      cognitoDomain: {
        domainPrefix: "ncbp-user-pool",
      },
    });

    // cognito user pool client: User pool client to store authentication information, uses id and secret to authenticate
    // const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
    //   this,
    //   "googleProviderForAdjacentPossible",
    //   {
    //     userPool,
    //     clientId: googleClientId,
    //     clientSecretValue: cdk.SecretValue.unsafePlainText(googleClientSecret),
    //     attributeMapping: {
    //       email: cognito.ProviderAttribute.GOOGLE_EMAIL,
    //       givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
    //       phoneNumber: cognito.ProviderAttribute.GOOGLE_PHONE_NUMBERS,
    //       custom: {
    //         agreeToTerms: cognito.ProviderAttribute.GOOGLE_NAME,
    //         companyName: cognito.ProviderAttribute.GOOGLE_NAME,
    //       },
    //     },
    //     scopes: ["profile", "email", "openid"],
    //   }
    // );
    // userPool.registerIdentityProvider(googleProvider);

    this.userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: this.userPool,
      //   supportedIdentityProviders: [
      //     cognito.UserPoolClientIdentityProvider.GOOGLE,
      //   ],
      //   oAuth: {
      //     callbackUrls: ["http://frontend-lb-731922503.us-east-2.elb.amazonaws.com/", "http://localhost:3000/"],
      //     logoutUrls: ["http://frontend-lb-731922503.us-east-2.elb.amazonaws.com/", "http://localhost:3000/"],
      //   },
    });

    // Lmabda layer that contains aws sdk packages

    // Lambda function to create user in dynamodb
    const createUserLambda = new lambda.Function(this, "createUserLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("src/functions/authentication/createUser"),
      handler: "index.handler",
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: this.dynamoTable.tableName,
      },
    });

    this.dynamoTable.grantReadWriteData(createUserLambda);

    const cognitoPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["cognito-idp:AdminGetUser"],
      resources: ["*"],
    });
    createUserLambda.addToRolePolicy(cognitoPolicy);

    this.userPool.addTrigger(
      cognito.UserPoolOperation.POST_CONFIRMATION,
      createUserLambda
    );

    this.exportValue(this.dynamoTable.tableArn);
    this.exportValue(this.userPool.userPoolArn);
    this.exportValue(this.userPoolClient.userPoolClientId);
    this.exportValue(this.s3Bucket.bucketArn);
  }
}
