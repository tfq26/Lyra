export interface GitHubPrInput {
  repoOwner: string;
  repoName: string;
  baseBranch: string;
  branchName: string;
  title: string;
  body: string;
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
   * Creates a GitHub Pull Request using GitHub REST API.
   */
  public async createPullRequest(input: GitHubPrInput): Promise<GitHubPrResult> {
    const token = input.githubToken || process.env.GITHUB_TOKEN;
    if (!token) {
      return {
        success: false,
        error: 'GITHUB_TOKEN not configured in environment; skipped remote PR creation.',
      };
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${input.repoOwner}/${input.repoName}/pulls`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Lyra-NightShift-Agent',
        },
        body: JSON.stringify({
          title: input.title,
          head: input.branchName,
          base: input.baseBranch,
          body: input.body,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: (err as any).message || `GitHub returned ${res.status}` };
      }

      const data = (await res.json()) as any;
      return {
        success: true,
        prUrl: data.html_url,
        prNumber: data.number,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
      };
    }
  }
}

export const prReporter = new PrReporter();
