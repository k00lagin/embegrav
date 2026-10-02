/** How the server authenticates against GitHub: the GitHub CLI or Git Credential Manager. */
export const GITHUB_STRATEGIES = ['gh', 'gcm'] as const
export type GitHubVia = (typeof GITHUB_STRATEGIES)[number]

/** GitHub accepts letters, digits, '.', '-' and '_' in repository names ('.' and '..' are reserved). */
export const GITHUB_REPO_NAME_RE = /^(?!\.\.?$)[\w.-]{1,100}$/

/** GitHub user and organization logins. */
export const GITHUB_OWNER_RE = /^[A-Za-z\d][A-Za-z\d-]{0,38}$/
