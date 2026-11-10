import { SignJWT, importPKCS8 } from 'jose';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

const API = 'https://api.github.com';
type GithubRepo = { full_name: string; name: string; owner: { login: string }; default_branch: string; private: boolean; html_url: string };
type GithubFile = { type: string; path: string; size?: number; content?: string; encoding?: string; html_url?: string };
type UserInstallation = { installationId: string; accountLogin: string; accountType: string; repositorySelection: string };

function config() {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new ApiError(503, 'GITHUB_NOT_CONFIGURED', 'MAX GitHub App access is not configured yet.');
  return { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY.split(String.fromCharCode(92) + 'n').join(String.fromCharCode(10)) };
}
async function appJwt() {
  const { appId, privateKey } = config();
  const key = await importPKCS8(privateKey, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuedAt(now - 30).setIssuer(appId).setExpirationTime(now + 8 * 60).sign(key);
}
async function installationToken(installationId: string) {
  const jwt = await appJwt();
  const response = await fetch(`${API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({})) as { token?: string; message?: string };
  if (!response.ok || !data.token) throw new ApiError(502, 'GITHUB_AUTH_FAILED', data.message ?? 'Could not obtain a GitHub installation token.');
  return data.token;
}
async function github<T>(installationId: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = await installationToken(installationId);
  const response = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...(init.headers ?? {}) }, signal: init.signal ?? AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new ApiError(response.status === 404 ? 404 : response.status === 403 ? 403 : 502, 'GITHUB_API_ERROR', data.message ?? `GitHub request failed (${response.status}).`);
  return data as T;
}
async function userInstallations(authSubject?: string): Promise<UserInstallation[]> {
  if (!authSubject) throw new ApiError(403, 'GITHUB_NOT_CONNECTED', 'Connect GitHub in MAX Auth before using repository tools.');
  if (!env.MAX_AUTH_SERVICE_TOKEN) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'MAX Auth service integration is not configured.');
  const internalBase = env.MAX_AUTH_INTERNAL_URL.endsWith('/') ? env.MAX_AUTH_INTERNAL_URL.slice(0, -1) : env.MAX_AUTH_INTERNAL_URL;
  const response = await fetch(`${internalBase}/users/${encodeURIComponent(authSubject)}/github/installations`, {
    headers: { Accept: 'application/json', 'X-MAX-Auth-Service-Token': env.MAX_AUTH_SERVICE_TOKEN, 'X-MAX-User-Id': authSubject },
    signal: AbortSignal.timeout(8000)
  });
  const body = await response.json().catch(() => ({})) as { data?: { installations?: UserInstallation[] }; installations?: UserInstallation[] };
  if (!response.ok) throw new ApiError(503, 'GITHUB_ACCESS_LOOKUP_FAILED', 'MAX Auth could not verify your GitHub repository access.');
  const installations = body.data?.installations ?? body.installations ?? [];
  if (!installations.length) throw new ApiError(403, 'GITHUB_NOT_CONNECTED', 'Connect the MAX GitHub App to a GitHub account or organisation in MAX Auth.');
  return installations;
}
async function installationForRepository(authSubject: string | undefined, owner: string, repo: string) {
  const installations = await userInstallations(authSubject);
  for (const installation of installations) {
    const data = await github<{ repositories: GithubRepo[] }>(installation.installationId, '/installation/repositories?per_page=100');
    if ((data.repositories ?? []).some((item) => item.owner.login.toLowerCase() === owner.toLowerCase() && item.name.toLowerCase() === repo.toLowerCase())) return installation;
  }
  throw new ApiError(403, 'GITHUB_REPOSITORY_NOT_GRANTED', 'This repository is not included in the GitHub App access granted to MAX.');
}
function safePart(value: string, label: string) {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(value) || value === '.' || value === '..') throw new ApiError(400, 'GITHUB_INVALID_INPUT', `Invalid GitHub ${label}.`);
  return value;
}
export async function listGithubRepositories(authSubject?: string) {
  const installations = await userInstallations(authSubject);
  const repositories: GithubRepo[] = [];
  for (const installation of installations) {
    const data = await github<{ repositories: GithubRepo[] }>(installation.installationId, '/installation/repositories?per_page=100');
    repositories.push(...(data.repositories ?? []));
  }
  return repositories.map((r) => ({ name: r.name, fullName: r.full_name, owner: r.owner.login, defaultBranch: r.default_branch, private: r.private, url: r.html_url }));
}
export async function listGithubDirectory(ownerInput: string, repoInput: string, pathInput = '', ref?: string, authSubject?: string) {
  const owner = safePart(ownerInput, 'owner');
  const repo = safePart(repoInput, 'repository');
  const installation = await installationForRepository(authSubject, owner, repo);
  const path = pathInput.split('/').filter(Boolean).join('/');
  if (path.split('/').some((part) => part === '.' || part === '..')) throw new ApiError(400, 'GITHUB_INVALID_PATH', 'Invalid repository directory path.');
  const encodedPath = path ? '/' + path.split('/').map(encodeURIComponent).join('/') : '';
  const data = await github<Array<{ type: string; name: string; path: string; size?: number; html_url?: string }>>(installation.installationId, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${encodedPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
  if (!Array.isArray(data)) throw new ApiError(400, 'GITHUB_NOT_A_DIRECTORY', 'The requested path is not a directory.');
  return data.map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size ?? null, url: item.html_url ?? null }));
}
export async function getGithubFile(ownerInput: string, repoInput: string, pathInput: string, ref?: string, authSubject?: string) {
  const owner = safePart(ownerInput, 'owner');
  const repo = safePart(repoInput, 'repository');
  const installation = await installationForRepository(authSubject, owner, repo);
  const path = pathInput.split('/').map((part) => { if (!part || part === '.' || part === '..') throw new ApiError(400, 'GITHUB_INVALID_PATH', 'Invalid repository file path.'); return encodeURIComponent(part); }).join('/');
  const file = await github<GithubFile>(installation.installationId, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
  if (file.type !== 'file') throw new ApiError(400, 'GITHUB_NOT_A_FILE', 'The requested path is not a file.');
  return { path: file.path, size: file.size, content: file.encoding === 'base64' && file.content ? Buffer.from(file.content.replaceAll(String.fromCharCode(10), ''), 'base64').toString('utf8') : '', url: file.html_url };
}
type ProposedFile = { path: string; content: string };
export async function createGithubPullRequest(input: { owner: string; repo: string; baseBranch: string; branchName: string; title: string; body: string; files: ProposedFile[] }, authSubject?: string) {
  const owner = safePart(input.owner, 'owner');
  const repo = safePart(input.repo, 'repository');
  const installation = await installationForRepository(authSubject, owner, repo);
  const baseBranch = input.baseBranch.trim();
  const branchName = input.branchName.trim();
  if (!baseBranch || baseBranch.length > 200 || !/^[A-Za-z0-9._/-]{1,200}$/.test(branchName) || branchName.startsWith('/') || branchName.endsWith('/') || branchName.includes('..')) throw new ApiError(400, 'GITHUB_INVALID_BRANCH', 'The base branch or proposed branch name is invalid.');
  if (branchName === baseBranch) throw new ApiError(400, 'GITHUB_BRANCH_PROTECTED', 'MAX must create a separate branch; it cannot commit directly to the base branch.');
  if (!input.title.trim() || input.title.length > 250 || input.body.length > 10000) throw new ApiError(400, 'GITHUB_INVALID_PR', 'The pull request title or description is invalid.');
  if (!input.files.length || input.files.length > 30) throw new ApiError(400, 'GITHUB_FILE_LIMIT', 'A change must contain between 1 and 30 files.');
  const seen = new Set<string>();
  const files = input.files.map((file) => {
    const path = file.path.trim().replace(/^\\/+/, '');
    if (!path || path.length > 400 || path.split('/').some((p) => !p || p === '.' || p === '..') || path.includes('\\\\')) throw new ApiError(400, 'GITHUB_INVALID_PATH', `Invalid repository path: ${file.path}`);
    if (path.startsWith('.git/')) throw new ApiError(403, 'GITHUB_RESERVED_PATH', 'MAX cannot write into Git internals.');
    if (path.startsWith('.github/workflows/')) throw new ApiError(403, 'GITHUB_WORKFLOW_PROTECTED', 'MAX cannot modify GitHub Actions workflows through this tool.');
    if (seen.has(path)) throw new ApiError(400, 'GITHUB_DUPLICATE_PATH', `Duplicate file path: ${path}`);
    seen.add(path);
    if (Buffer.byteLength(file.content, 'utf8') > 100000) throw new ApiError(413, 'GITHUB_FILE_TOO_LARGE', `File exceeds 100 KB: ${path}`);
    return { path, content: file.content };
  });
  const o = encodeURIComponent(owner), r = encodeURIComponent(repo);
  const repoInfo = await github<{ permissions?: { push?: boolean }; html_url: string }>(installation.installationId, `/repos/${o}/${r}`);
  if (repoInfo.permissions?.push === false) throw new ApiError(403, 'GITHUB_NO_WRITE_ACCESS', 'The installed GitHub App does not have write access to this repository.');
  const baseRef = await github<{ object: { sha: string } }>(installation.installationId, `/repos/${o}/${r}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  const baseCommit = await github<{ tree: { sha: string } }>(installation.installationId, `/repos/${o}/${r}/git/commits/${baseRef.object.sha}`);
  const tree = await github<{ sha: string }>(installation.installationId, `/repos/${o}/${r}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) }) });
  const commit = await github<{ sha: string; html_url: string }>(installation.installationId, `/repos/${o}/${r}/git/commits`, { method: 'POST', body: JSON.stringify({ message: input.title.trim(), tree: tree.sha, parents: [baseRef.object.sha] }) });
  await github(installation.installationId, `/repos/${o}/${r}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commit.sha }) });
  const pr = await github<{ number: number; html_url: string; state: string }>(installation.installationId, `/repos/${o}/${r}/pulls`, { method: 'POST', body: JSON.stringify({ title: input.title.trim(), body: input.body, head: branchName, base: baseBranch, draft: false }) });
  return { success: true, repository: `${owner}/${repo}`, branch: branchName, commitSha: commit.sha, commitUrl: commit.html_url, pullRequestNumber: pr.number, pullRequestUrl: pr.html_url, state: pr.state, filesChanged: files.map((f) => f.path), repositoryUrl: repoInfo.html_url };
}
