/** How the server authenticates against GitHub: the GitHub CLI or Git Credential Manager. */
export const GITHUB_STRATEGIES = ['gh', 'gcm'] as const
export type GitHubVia = (typeof GITHUB_STRATEGIES)[number]

/** GitHub accepts letters, digits, '.', '-' and '_' in repository names ('.' and '..' are reserved). */
export const GITHUB_REPO_NAME_RE = /^(?!\.\.?$)[\w.-]{1,100}$/

/** GitHub user and organization logins. */
export const GITHUB_OWNER_RE = /^[A-Za-z\d][A-Za-z\d-]{0,38}$/

/**
 * The github.com page of a remote URL in HTTPS, SSH or scp-like form
 * (`git@github.com:owner/repo.git`), or null when the remote is not on github.com.
 */
export function githubWebUrl(remoteUrl: string): string | null {
  const m =
    /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|(?:[^@/]+@)?github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(
      remoteUrl.trim(),
    )
  if (!m || !GITHUB_OWNER_RE.test(m[1]) || !GITHUB_REPO_NAME_RE.test(m[2])) return null
  return `https://github.com/${m[1]}/${m[2]}`
}
