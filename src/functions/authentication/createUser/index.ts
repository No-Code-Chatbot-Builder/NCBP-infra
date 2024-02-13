import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
const dynamodbClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);

const cognito = new CognitoIdentityProviderClient({});

async function getUserDetails(userName: string, userPoolId: string) {
  const getUserCommand = new AdminGetUserCommand({
    UserPoolId: userPoolId,
    Username: userName,
  });

  try {
    const data = await cognito.send(getUserCommand);
    return data;
  } catch (error) {
    console.error("Error fetching user details:", error);
    throw error;
  }
}

exports.handler = async (event: any) => {
  console.log("Event => ", event);

  const queryCommand = new QueryCommand({
    TableName: process.env.TABLE_NAME!,
    IndexName: "GSIType",
    KeyConditionExpression: "#type = :typeVal AND SK = :sk",
    ExpressionAttributeNames: {
      "#type": "type",
    },
    ExpressionAttributeValues: {
      ":typeVal": `User`,
      ":sk": `USEREMAIL#${event.request.userAttributes.email}`,
    },
    ConsistentRead: true
  });
  try {
    const response = await dynamodb.send(queryCommand);
    if (response.Count !== 0) {
      console.log(response.Items);
      console.log("User already exists in dynamodb");
      return event;
    }
  } catch (error) {
    console.error("Error fetching user from dynamodb:", error);
    throw error;
  }

  const userPoolId = event.userPoolId;
  const userName = event.userName;

  const userDetails = await getUserDetails(userName, userPoolId);

  console.log("User Details => ", userDetails);

  const sub = userDetails.UserAttributes!.find(
    (attr: any) => attr.Name === "sub"
  )!.Value;

  const user = {
    PK: `USER#${sub}`,
    SK: `USEREMAIL#${event.request.userAttributes.email}`,
    id: sub,
    username: event.request.userAttributes.preferred_username,
    email: event.request.userAttributes.email,
    name: event.request.userAttributes.given_name,
    dateOfBirth: event.request.userAttributes.birthdate,
    address: event.request.userAttributes.address,  
    workspaces: {},
    type: "User",
  };

  const putCommand = new PutCommand({
    Item: user,
    TableName: process.env.TABLE_NAME!,
    ConditionExpression: "attribute_not_exists(SK)",
  });
  try {
    await dynamodb.send(putCommand);
    return event;
  } catch (error) {
    const err: any = error;
    console.log("Error From Creating User => ", err);

    let errorMessage = "Could not create User";

    if (err.code === "ConditionalCheckFailedException") {
      errorMessage = "User with this email ID has already registered.";
    }

    throw new Error(errorMessage);
  }
};
