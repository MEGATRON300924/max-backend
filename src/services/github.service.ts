import { SignJWT, importPKCS8 } from 'jose';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

const API = 'https://api.github.com';
type GithubRepo = { full_name: string; name: string; owner: { login: string }; default_branch: string; private: boolean; html_url: string };
type GithubFile = { type: string; path: string; size?: number; content?: string; encoding?: string; html_url?: string };

function config() {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_APP_INSTALLATION_ID) throw new ApiError(503, 'GITHUB_NOT_CONFIGURED', 'MAX GitHub access is not configured yet.');
  return { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'), installationId: env.GITHUB_APP_INSTALLATION_ID };
}
async function appJwt() {
  const { appId, privateKey } = config();
  const key = await importPKCS8(privateKey, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuedAt(now - 30).setIssuer(appId).setExpirationTime(now + 8 * 60).sign(key);
}
async function installationToken() {
  const { installationId } = config();
  const jwt = await appJwt();
  const response = await fetch(`${API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({})) as { token?: string; message?: string };
  if (!response.ok || !data.token) throw new ApiError(502, 'GITHUB_AUTH_FAILED', data.message ?? 'Could not obtain a GitHub installation token.');
  return data.token;
}
async function github<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await installationToken();
  const response = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...(init.headers ?? {}) }, signal: init.signal ?? AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new ApiError(response.status === 404 ? 404 : response.status === 403 ? 403 : 502, 'GITHUB_API_ERROR', data.message ?? `GitHub request failed (${response.status}).`);
  return data as T;
}
function allowedMaxUser(authSubject?: string) {
  const allowed = env.GITHUB_ALLOWED_AUTH_SUBJECTS.split(',').map((value) => value.trim()).filter(Boolean);
  if (!authSubject || !allowed.length || !allowed.includes(authSubject)) throw new ApiError(403, 'GITHUB_USER_NOT_ALLOWED', 'This MAX account is not authorised to use GitHub code editing yet.');
}
function allowedOwner(owner: string) {
  const allowed = env.GITHUB_ALLOWED_OWNERS.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length || !allowed.includes(owner.toLowerCase())) throw new ApiError(403, 'GITHUB_OWNER_NOT_ALLOWED', 'This GitHub owner is not on MAX’s configured allowlist.');
}
function safePart(value: string, label: string) {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(value) || value === '.' || value === '..') throw new ApiError(400, 'GITHUB_INVALID_INPUT', `Invalid GitHub ${label}.`);
  return value;
}
export async function listGithubRepositories(authSubject?: string) {
  allowedMaxUser(authSubject);
  const data = await github<{ repositories: GithubRepo[] }>('/installation/repositories?per_page=100');
  return (data.repositories ?? []).map((r) => ({ name: r.name, fullName: r.full_name, owner: r.owner.login, defaultBranch: r.default_branch, private: r.private, url: r.html_url }));
}
export async function getGithubFile(ownerInput: string, repoInput: string, pathInput: string, ref?: string, authSubject?: string) {
  allowedMaxUser(authSubject);
  const owner = safePart(ownerInput, 'owner'); const repo = safePart(repoInput, 'repository'); allowedOwner(owner);
  const path = pathInput.split('/').map((part) => { if (!part || part === '.' || part === '..') throw new ApiError(400, 'GITHUB_INVALID_PATH', 'Invalid repository file path.'); return encodeURIComponent(part); }).join('/');
  const file = await github<GithubFile>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
  if (file.type !== 'file') throw new ApiError(400, 'GITHUB_NOT_A_FILE', 'The requested path is not a file.');
  return { path: file.path, size: file.size, content: file.encoding === 'base64' && file.content ? Buffer.from(file.content.replace(/\\n/g, ''), 'base64').toString('utf8') : '', url: file.html_url };
}
type ProposedFile = { path: string; content: string };
export async function createGithubPullRequest(input: { owner: string; repo: string; baseBranch: string; branchName: string; title: string; body: string; files: ProposedFile[] }, authSubject?: string) {
  allowedMaxUser(authSubject);
  const owner = safePart(input.owner, 'owner'); const repo = safePart(input.repo, 'repository'); allowedOwner(owner);
  const baseBranch = input.baseBranch.trim(); const branchName = input.branchName.trim();
  if (!baseBranch || baseBranch.length > 200 || !/^[A-Za-z0-9._/-]{1,200}$/.test(branchName) || branchName.startsWith('/') || branchName.endsWith('/') || branchName.includes('..')) throw new ApiError(400, 'GITHUB_INVALID_BRANCH', 'The base branch or proposed branch name is invalid.');
  if (branchName === baseBranch) throw new ApiError(400, 'GITHUB_BRANCH_PROTECTED', 'MAX must create a separate branch; it cannot commit directly to the base branch.');
  if (!input.title.trim() || input.title.length > 250 || input.body.length > 10000) throw new ApiError(400, 'GITHUB_INVALID_PR', 'The pull request title or description is invalid.');
  if (!input.files.length || input.files.length > 30) throw new ApiError(400, 'GITHUB_FILE_LIMIT', 'A change must contain between 1 and 30 files.');
  const seen = new Set<string>();
  const files = input.files.map((file) => {
    const path = file.path.trim().replace(/^\\/+/, '');
    if (!path || path.length > 400 || path.split('/').some((p) => !p || p === '.' || p === '..') || path.includes('\\')) throw new ApiError(400, 'GITHUB_INVALID_PATH', `Invalid repository path: ${file.path}`);
    if (path.startsWith('.git/')) throw new ApiError(403, 'GITHUB_RESERVED_PATH', 'MAX cannot write into Git internals.');
    if (path.startsWith('.github/workflows/')) throw new ApiError(403, 'GITHUB_WORKFLOW_PROTECTED', 'MAX cannot modify GitHub Actions workflows through this tool.');
    if (seen.has(path)) throw new ApiError(400, 'GITHUB_DUPLICATE_PATH', `Duplicate file path: ${path}`);
    seen.add(path);
    if (Buffer.byteLength(file.content, 'utf8') > 100000) throw new ApiError(413, 'GITHUB_FILE_TOO_LARGE', `File exceeds 100 KB: ${path}`);
    return { path, content: file.content };
  });
  const o = encodeURIComponent(owner), r = encodeURIComponent(repo);
  const repoInfo = await github<{ permissions?: { push?: boolean }; html_url: string }>(`/repos/${o}/${r}`);
  if (repoInfo.permissions?.push === false) throw new ApiError(403, 'GITHUB_NO_WRITE_ACCESS', 'The installed GitHub App does not have write access to this repository.');
  const baseRef = await github<{ object: { sha: string } }>(`/repos/${o}/${r}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  const baseCommit = await github<{ tree: { sha: string } }>(`/repos/${o}/${r}/git/commits/${baseRef.object.sha}`);
  const tree = await github<{ sha: string }>(`/repos/${o}/${r}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) }) });
  const commit = await github<{ sha: string; html_url: string }>(`/repos/${o}/${r}/git/commits`, { method: 'POST', body: JSON.stringify({ message: input.title.trim(), tree: tree.sha, parents: [baseRef.object.sha] }) });
  await github(`/repos/${o}/${r}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commit.sha }) });
  const pr = await github<{ number: number; html_url: string; state: string }>(`/repos/${o}/${r}/pulls`, { method: 'POST', body: JSON.stringify({ title: input.title.trim(), body: input.body, head: branchName, base: baseBranch, draft: false }) });
  return { success: true, repository: `${owner}/${repo}`, branch: branchName, commitSha: commit.sha, commitUrl: commit.html_url, pullRequestNumber: pr.number, pullRequestUrl: pr.html_url, state: pr.state, filesChanged: files.map((f) => f.path), repositoryUrl: repoInfo.html_url };
}
