# Lyra AWS beta infrastructure scaffold

`template.yaml` describes an AWS-only starting point: an ECS/Fargate API service behind an Application Load Balancer, EFS-backed application data and workspaces, an SQS queue, S3 artifact/session storage, RDS PostgreSQL, Better Auth, Secrets Manager, SES, and a separate Fargate runner task definition. Hosted BYO provider secrets are stored in Secrets Manager, and provider secrets are tenant-prefixed. Better Auth stores user/account/session records in an `auth` PostgreSQL schema. The event journal is in PostgreSQL; file metadata and agent checkpoints remain on EFS.

## Current implementation boundary

This template is **not ready for production or multi-tenant user data**. Better Auth provides email/password login, verified-email flow, password reset, and database-backed sessions, but the current deployment is a single shared tenant. Hosted self-sign-up is disabled by default; provision team accounts with `bun run auth:create-user` in a controlled task, injecting `LYRA_BOOTSTRAP_USER_NAME`, `LYRA_BOOTSTRAP_USER_EMAIL`, and `LYRA_BOOTSTRAP_USER_PASSWORD` from a secure secret source. Team membership and per-tenant access checks are not implemented. The PostgreSQL journal does not yet contain all run/profile/checkpoint state. Native coding dispatches to Fargate only when HTTPS runner connectivity is configured; the existing CLI team coordinator still runs its subprocesses in the API task. GitHub import currently supports public repositories only, and private repository connections are not implemented. The customer Bedrock role parameter supports only the current invite-only setup, not arbitrary per-user AWS roles.

Do not use it to host real customer repositories until those boundaries are implemented and reviewed. This scaffold is useful for building the AWS deployment path and estimating the baseline service footprint.

## Intended deployment shape

1. Build and push the Lyra image to ECR; provide its immutable URI as `LyraImageUri`.
2. Deploy the CloudFormation stack in the target AWS account and region; provide an ACM `CertificateArn` before enabling provider credential entry.
3. Keep HTTPS enabled, configure a verified SES sender, and add team membership/tenant authorization before allowing more than one team per deployment.
4. Move session metadata, provider profiles, checkpoints, approvals, and all run state to tenant-scoped PostgreSQL records; retain EFS for workspace files.
5. Move CLI team-mode execution to the same isolated worker/control path, and add recovery for Fargate task failures and API failover.
6. Add private GitHub connections, Better Auth team membership/tenant checks, AWS Budgets, retention, and managed-model usage metering before inviting beta teams.

The stack intentionally provisions a single-AZ, small RDS instance and one API task by default for development cost exploration. It is not an availability or compliance profile. Review AWS pricing for the chosen region and expected Fargate, database, load balancer, storage, and outbound network usage before offering a fixed monthly tier.
