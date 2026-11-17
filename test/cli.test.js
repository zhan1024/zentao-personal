import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceContext } from '../lib/context.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = path.join(root, 'bin', 'zentao-personal.js');
function run(args, cwd = root) { return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', timeout: 20000 }); }

test('帮助与非法参数不访问禅道', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Windows/);
  assert.equal(run(['bug', '../anything']).status, 1);
  assert.equal(run(['install', '--user', '--project', '--yes', '--tools', 'cursor']).status, 1);
  assert.equal(run(['install', '--user', '--yes', '--tools', 'unknown']).status, 1);
});

test('非交互安装到带空格中文路径，可运行所安装技能的入口', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zentao-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, '中文 项目');
  await mkdir(cwd);
  const result = run(['install', '--project', '--tools', 'codex,claude,cursor', '--yes'], cwd);
  assert.equal(result.status, 0, result.stderr);
  for (const folder of ['.agents', '.claude', '.cursor']) {
    const installed = path.join(cwd, folder, 'skills', 'zentao-personal');
    assert.match(await readFile(path.join(installed, 'SKILL.md'), 'utf8'), /zentao-personal/);
    const check = spawnSync(process.execPath, [path.join(installed, 'bin', 'zentao-personal.js'), '--version'], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /1\.0\.0/);
  }
  assert.equal(run(['install', '--project', '--tools', 'cursor', '--yes'], cwd).status, 1);
  assert.equal(run(['install', '--project', '--tools', 'cursor', '--yes', '--force'], cwd).status, 0);
});

test('工作区扫描识别多个仓库、当前分支和未提交改动，不写入仓库', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zentao-context-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of ['项目 A', 'project-b']) {
    const cwd = path.join(dir, name);
    await mkdir(cwd);
    const init = spawnSync('git', ['init', cwd], { encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    assert.equal(spawnSync('git', ['-C', cwd, 'symbolic-ref', 'HEAD', 'refs/heads/main']).status, 0);
  }
  await writeFile(path.join(dir, '项目 A', 'untracked.txt'), 'test');
  const result = await workspaceContext(dir);
  assert.equal(result.repositories.length, 2);
  assert.equal(result.repositories.find(r => r.path.endsWith('项目 A')).dirty, true);
  assert.equal(result.repositories.find(r => r.path.endsWith('project-b')).branch, 'main');
  const json = run(['context', '--json'], dir);
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).repositories.length, 2);
  assert.equal(spawnSync('git', ['-C', path.join(dir, '项目 A'), 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), 'main');
});
