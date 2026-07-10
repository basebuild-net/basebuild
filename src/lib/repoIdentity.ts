import { gitCurrentBranch, gitRemoteUrl } from "./git";

export type RepoHost = "github" | "gitlab" | "bitbucket" | "generic-git" | "folder";

export type RepoIdentity = {
  host: RepoHost;
  name: string;
  branch: string | null;
  remoteUrl: string | null;
};

/**
 * Parse a git remote URL to extract the host and repo name.
 * Handles both SSH (`git@github.com:org/repo.git`) and HTTPS
 * (`https://github.com/org/repo.git`) formats.
 */
export function parseRemoteUrl(remoteUrl: string): { host: RepoHost; name: string } | null {
  // SSH format: git@github.com:org/repo.git
  const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const host = hostFromDomain(sshMatch[1]);
    const path = sshMatch[2];
    const name = path.split("/").pop() ?? path;
    return { host, name };
  }

  // HTTPS format: https://github.com/org/repo.git
  const httpsMatch = remoteUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    const host = hostFromDomain(httpsMatch[1]);
    const path = httpsMatch[2];
    const name = path.split("/").pop() ?? path;
    return { host, name };
  }

  // Unrecognized format — try to extract something useful.
  const genericMatch = remoteUrl.match(/[:/]([^/]+?)(?:\.git)?$/);
  if (genericMatch) {
    return { host: "generic-git", name: genericMatch[1] };
  }

  return null;
}

function hostFromDomain(domain: string): RepoHost {
  const lower = domain.toLowerCase();
  if (lower.includes("github")) return "github";
  if (lower.includes("gitlab")) return "gitlab";
  if (lower.includes("bitbucket")) return "bitbucket";
  return "generic-git";
}

/**
 * Get repo identity for a project path. Returns `null` for non-git projects
 * (no remote URL and no branch). Falls back to folder identity if git is
 * present but has no remote.
 */
export async function getRepoIdentity(projectPath: string): Promise<RepoIdentity | null> {
  const [remoteUrl, branch] = await Promise.all([
    gitRemoteUrl(projectPath).catch(() => null),
    gitCurrentBranch(projectPath).catch(() => null),
  ]);

  if (!remoteUrl && !branch) return null;

  if (remoteUrl) {
    const parsed = parseRemoteUrl(remoteUrl);
    if (parsed) {
      return { host: parsed.host, name: parsed.name, branch, remoteUrl };
    }
  }

  // Git repo with no remote — use generic git icon and folder name.
  const name = projectPath.split(/[\\/]/).pop() ?? projectPath;
  return { host: branch ? "generic-git" : "folder", name, branch, remoteUrl: null };
}
