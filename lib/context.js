import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
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
    const root = git(candidate, ['rev-parse', '--show-toplevel']);
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
    const head = git(root, ['rev-parse', '--short', 'HEAD']);
    const status = git(root, ['status', '--porcelain', '--untracked-files=normal']);
    repositories.push({ path: root, branch, head, detached: !branch && Boolean(head), dirty: Boolean(status) });
  }
  return { cwd, repositories };
}

export function validBranch(name, cwd) {
  return Boolean(name && !name.startsWith('-') && git(cwd, ['check-ref-format', '--branch', name]) !== null);
}
