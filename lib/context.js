import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

function git(cwd, args, { optional = false, repositoryProbe = false } = {}) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } });
  if (result.error) throw new Error('Git 不可用或执行超时；项目与分支引导需要安装 Git 并加入 PATH。');
  if (result.status === 0) return result.stdout.trim();
  if (optional || (repositoryProbe && /not a git repository/i.test(result.stderr))) return null;
  throw new Error(`无法检查 Git 工作区：${cwd}；请检查仓库权限和状态。`);
}

export function hasGit() {
  const result = spawnSync('git', ['--version'], { stdio: 'ignore', timeout: 10000, windowsHide: true });
  return !result.error && result.status === 0;
}

export async function workspaceContext(cwd = process.cwd()) {
  const candidates = [cwd];
  const entries = await readdir(cwd, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) candidates.push(path.join(cwd, entry.name));
  }
  const seen = new Set();
  const repositories = [];
  for (const candidate of candidates) {
    const root = git(candidate, ['rev-parse', '--show-toplevel'], { repositoryProbe: true });
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { optional: true });
    const head = git(root, ['rev-parse', '--short', 'HEAD'], { optional: true });
    const status = git(root, ['status', '--porcelain', '--untracked-files=normal']);
    repositories.push({ path: root, branch, head, detached: !branch && Boolean(head), dirty: Boolean(status) });
  }
  return { cwd, repositories };
}

export function validBranch(name, cwd) {
  return Boolean(name && !name.startsWith('-') && git(cwd, ['check-ref-format', '--branch', name], { optional: true }) !== null);
}
