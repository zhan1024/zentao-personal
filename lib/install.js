import os from 'node:os';
import path from 'node:path';
import { cp, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';

export const tools = [
  { value: 'codex', label: 'Codex' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
];
export const payload = ['SKILL.md', 'scripts/zentao_read.py', 'references', 'bin', 'lib', 'package.json', 'LICENSE'];

export function installPath(tool, scope, { home = os.homedir(), cwd = process.cwd(), platform = process.platform } = {}) {
  if (!tools.some(t => t.value === tool)) throw new Error(`未知工具：${tool}`);
  if (!['user', 'project'].includes(scope)) throw new Error(`未知安装范围：${scope}`);
  const p = platform === 'win32' ? path.win32 : path.posix;
  const folder = { codex: '.agents', claude: '.claude', cursor: '.cursor' }[tool];
  return p.join(scope === 'user' ? home : cwd, folder, 'skills', 'zentao-personal');
}

export async function exists(target) {
  try { await lstat(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function installSkill(source, destination, { overwrite = false } = {}) {
  if (path.resolve(source) === path.resolve(destination)) throw new Error('来源与目标是同一目录，无需重复安装。');
  if (await exists(destination)) {
    const info = await lstat(destination);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`目标不是普通目录，请手动检查：${destination}`);
    if (!overwrite) throw new Error(`技能已存在，更新请添加 --force：${destination}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(destination), '.zentao-install-'));
  const backup = `${stage}-backup`;
  let backedUp = false;
  try {
    for (const item of payload) {
      await mkdir(path.dirname(path.join(stage, item)), { recursive: true });
      await cp(path.join(source, item), path.join(stage, item), { recursive: true });
    }
    if (await exists(destination)) { await rename(destination, backup); backedUp = true; }
    try { await rename(stage, destination); }
    catch (error) { if (backedUp) await rename(backup, destination); throw error; }
    if (backedUp) await rm(backup, { recursive: true });
  } finally { await rm(stage, { recursive: true, force: true }); }
}
