#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Lyra Architecture 1: AWS Ephemeral Cloud Runner Deployment Script
#
# Deploys the scale-to-zero ECS Fargate runner, Bedrock IAM policies, and
# control plane to your AWS account.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${LYRA_STACK_NAME:-lyra-cloud-swarm}"
ECR_REPO_NAME="lyra-cloud-runner"
IMAGE_TAG="$(git rev-parse --short HEAD 2>/dev/null || echo 'latest')"

echo "🌌 [Lyra Cloud Swarm] Deploying Architecture 1 to AWS..."
echo "📍 Target Region: $REGION"
echo "📦 CloudFormation Stack: $STACK_NAME"

# 1. Verify AWS Authentication
echo ""
echo "🔑 Step 1: Checking AWS Credentials..."
if ! CALLER_ID=$(aws sts get-caller-identity --output json 2>&1); then
  echo "❌ AWS Authentication failed or session has expired."
  echo ""
  echo "👉 Please run one of the following in your terminal to re-authenticate:"
  echo "   aws login"
  echo "   or: aws sso login"
  echo ""
  exit 1
fi

ACCOUNT_ID=$(echo "$CALLER_ID" | grep -o '"Account": "[^"]*' | cut -d'"' -f4)
echo "✅ Authenticated as AWS Account: $ACCOUNT_ID"

# 2. Ensure ECR Repository Exists
echo ""
echo "📦 Step 2: Preparing Amazon ECR Repository ($ECR_REPO_NAME)..."
if ! aws ecr describe-repositories --repository-names "$ECR_REPO_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "Creating ECR repository: $ECR_REPO_NAME..."
  aws ecr create-repository \
    --repository-name "$ECR_REPO_NAME" \
    --region "$REGION" \
    --image-scanning-configuration scanOnPush=true \
    --output json >/dev/null
fi

ECR_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO_NAME"
echo "✅ ECR Registry: $ECR_URI"

# 3. Build & Push Docker Image
echo ""
echo "🐳 Step 3: Building & Pushing Cloud Runner Image ($ECR_URI:$IMAGE_TAG)..."
echo "Logging into Amazon ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

echo "Building Docker container for linux/amd64 (Fargate)..."
docker build \
  --platform linux/amd64 \
  -t "$ECR_URI:$IMAGE_TAG" \
  -t "$ECR_URI:latest" \
  .

echo "Pushing image to ECR..."
docker push "$ECR_URI:$IMAGE_TAG"
docker push "$ECR_URI:latest"
echo "✅ Image successfully pushed to $ECR_URI:$IMAGE_TAG"

# 4. Deploy Bedrock Execution Role
echo ""
echo "🛡️ Step 4: Ensuring Bedrock Execution Role Exists..."
aws cloudformation deploy \
  --template-file infra/aws/lyra-bedrock-iam.yaml \
  --stack-name lyra-bedrock-role \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$REGION" \
  --no-fail-on-empty-changeset

BEDROCK_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/LyraAgentRunnerRole"
echo "✅ Bedrock Role Active: $BEDROCK_ROLE_ARN"

# 5. Deploy CloudFormation Fargate Runner Stack
echo ""
echo "🚀 Step 5: Deploying CloudFormation Stack ($STACK_NAME)..."
CURRENT_STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "")
if [ "$CURRENT_STACK_STATUS" = "ROLLBACK_COMPLETE" ]; then
  echo "⚠️ Stack $STACK_NAME is in ROLLBACK_COMPLETE state. Cleaning up rolled-back stack before re-deploying..."
  aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"
  echo "✅ Rolled back stack cleaned up."
fi

aws cloudformation deploy \
  --template-file infra/aws/template.yaml \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
  --region "$REGION" \
  --parameter-overrides \
      LyraImageUri="$ECR_URI:$IMAGE_TAG" \
      BedrockRoleArn="$BEDROCK_ROLE_ARN" \
      TenantId="lyra-personal" \
  --no-fail-on-empty-changeset

# 6. Retrieve Outputs & Configure Local Environment
echo ""
echo "📋 Step 6: Retrieving Stack Outputs..."
STACK_OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query "Stacks[0].Outputs" --output json)

API_ENDPOINT=$(echo "$STACK_OUTPUTS" | grep -A 2 '"OutputKey": "ApiEndpoint"' | grep '"OutputValue":' | cut -d'"' -f4 || echo '')
CLUSTER_NAME=$(echo "$STACK_OUTPUTS" | grep -A 2 '"OutputKey": "EcsClusterName"' | grep '"OutputValue":' | cut -d'"' -f4 || echo '')
TASK_DEF_ARN=$(echo "$STACK_OUTPUTS" | grep -A 2 '"OutputKey": "RunnerTaskDefinitionArn"' | grep '"OutputValue":' | cut -d'"' -f4 || echo '')

echo "================================================================="
echo "🎉 Lyra Architecture 1 Cloud Infrastructure Successfully Deployed!"
echo "================================================================="
echo "☁️ Cloud Gateway URL:  ${API_ENDPOINT:-"(Configured behind ALB)"}"
echo "📦 ECS Cluster:         $CLUSTER_NAME"
echo "⚙️ Runner Task Def:     $TASK_DEF_ARN"
echo "🤖 Bedrock IAM Role:    $BEDROCK_ROLE_ARN"
echo "================================================================="
echo ""
echo "Next: Use 'bun run dispatch' or the VS Code extension to dispatch tasks"
echo "directly to your ephemeral cloud cluster without running any local servers!"
