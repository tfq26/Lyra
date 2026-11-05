#!/usr/bin/env bash
set -e

echo "🔐 [Lyra AWS] Setting up non-expiring Bedrock service credentials..."

# 1. Check if user is authenticated with AWS CLI
if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "⚠️  AWS CLI is not currently logged in. Launching 'aws login'..."
  aws login
fi

echo "✅ Authenticated as: $(aws sts get-caller-identity --query 'Arn' --output text)"

USER_NAME="lyra-bedrock-runner"

# 2. Create IAM User if it does not already exist
if aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  echo "ℹ️  IAM user '$USER_NAME' already exists."
else
  echo "👤 Creating IAM user '$USER_NAME'..."
  aws iam create-user --user-name "$USER_NAME"
fi

# 3. Attach scoped Bedrock-only inline policy
echo "📜 Attaching scoped Bedrock-only policy..."
aws iam put-user-policy \
  --user-name "$USER_NAME" \
  --policy-name LyraBedrockInferenceOnly \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:ListFoundationModels"
        ],
        "Resource": "*"
      }
    ]
  }'

# 4. Generate new Access Key
echo "🔑 Generating non-expiring access keys..."
KEY_JSON=$(aws iam create-access-key --user-name "$USER_NAME" --output json)

ACCESS_KEY_ID=$(echo "$KEY_JSON" | grep -o '"AccessKeyId": "[^"]*' | cut -d'"' -f4)
SECRET_ACCESS_KEY=$(echo "$KEY_JSON" | grep -o '"SecretAccessKey": "[^"]*' | cut -d'"' -f4)

# 5. Write to .env.local
ENV_LOCAL_PATH="$(pwd)/.env.local"
cat <<EOF > "$ENV_LOCAL_PATH"
# Lyra Dedicated Non-Expiring AWS Bedrock Credentials
AWS_REGION=us-east-1
AWS_DEFAULT_REGION=us-east-1
AWS_ACCESS_KEY_ID=$ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=$SECRET_ACCESS_KEY
EOF

chmod 600 "$ENV_LOCAL_PATH"
echo "🎉 Non-expiring AWS Bedrock credentials successfully configured in .env.local!"
echo "✨ Lyra background daemons, Night Shift, and Proof Sandboxes will now run 24/7 without session expiration."
