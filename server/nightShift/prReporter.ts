import { issueForgeAdapter, type ForgeType } from '../issueForgeAdapter';

export interface GitHubPrInput {
  forge?: ForgeType;
  baseUrl?: string;
  repoOwner: string;
  repoName: string;
  baseBranch: string;
  branchName: string;
  title: string;
  body: string;
  draft?: boolean;
  githubToken?: string;
}

export interface GitHubPrResult {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}

export class PrReporter {
  /**
   * Creates a Pull Request on GitHub or Forgejo (Draft PR by default).
   */
  public async createPullRequest(input: GitHubPrInput): Promise<GitHubPrResult> {
    return issueForgeAdapter.createPullRequest({
      forge: input.forge || 'github',
      baseUrl: input.baseUrl,
      owner: input.repoOwner,
      repo: input.repoName,
      base: input.baseBranch,
      head: input.branchName,
      title: input.title,
      body: input.body,
      draft: input.draft ?? true,
      token: input.githubToken,
    });
  }
}

export const prReporter = new PrReporter();
