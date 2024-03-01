import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";

import { Construct } from "constructs";

interface S3CdnBucketProps extends cdk.StackProps {
    bucketName: string;
    removalPolicy?: boolean;    
}

export class S3CdnBucket extends Construct {
    public readonly assetsBucket: s3.Bucket;

    constructor(scope: Construct, id: string, props: S3CdnBucketProps) {
        super(scope, id);

        const { bucketName } = props;
    
        this.assetsBucket = new s3.Bucket(this, `NcbpS3Bucket`, {
            bucketName,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            removalPolicy: props.removalPolicy ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
          });
      
          const originAccessIdentity = new cloudfront.OriginAccessIdentity(
            this,
            `OAI`,
            {
              comment: "Created for prnt assets",
            }
          );
          this.assetsBucket.grantRead(originAccessIdentity);
      
          const cfAssetDistribution = new cloudfront.CloudFrontWebDistribution(
            this,
            "ncbp-assets-distribution",
            {
              originConfigs: [
                {
                  s3OriginSource: {
                    s3BucketSource: this.assetsBucket,
                    originAccessIdentity: originAccessIdentity,
                  },
                  behaviors: [{ isDefaultBehavior: true }],
                },
              ],
            }
          );
      }
}