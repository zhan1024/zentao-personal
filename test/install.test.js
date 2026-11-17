import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { installPath, installSkill, payload } from '../lib/install.js';
import { detectPython, pythonCandidates, runtimePython } from '../lib/python.js';

test('Windows 和 macOS 安装目录均使用各自路径规则', () => {
  for (const [tool, folder] of [['codex', '.agents'], ['claude', '.claude'], ['cursor', '.cursor']]) {
    assert.equal(installPath(tool, 'user', { platform: 'win32', home: 'C:\\Users\\测试 用户' }), `C:\\Users\\测试 用户\\${folder}\\skills\\zentao-personal`);
    assert.equal(installPath(tool, 'project', { platform: 'win32', cwd: 'D:\\工作 项目' }), `D:\\工作 项目\\${folder}\\skills\\zentao-personal`);
    assert.equal(installPath(tool, 'user', { platform: 'darwin', home: '/Users/test 用户' }), `/Users/test 用户/${folder}/skills/zentao-personal`);
    assert.equal(installPath(tool, 'project', { platform: 'darwin', cwd: '/tmp/项目' }), `/tmp/项目/${folder}/skills/zentao-personal`);
  }
});

test('Windows 识别 py -3 并在失败时回退', () => {
  const calls = [];
  const python = detectPython({ platform: 'win32', useRuntime: false, run(command, args) {
    calls.push([command, args]);
    return command === 'python' ? { status: 0, stdout: '3.12\n' } : { status: 1, stdout: '' };
  } });
  assert.equal(calls[0][0], 'py');
  assert.equal(calls[0][1][0], '-3');
  assert.equal(python.command, 'python');
  assert.equal(python.version, '3.12');
  assert.equal(runtimePython('win32', 'C:\\Users\\test\\runtime'), 'C:\\Users\\test\\runtime\\Scripts\\python.exe');
  assert.equal(pythonCandidates('darwin')[0].command, 'python3');
});

test('无可用 Python 时给出明确安装提示', () => {
  assert.throws(() => detectPython({ useRuntime: false, run: () => ({ status: 1 }) }), /Python 3.9/);
});

test('完整安装，阻止意外覆盖，更新后不泄漏额外文件', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zentao-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, '源文件');
  const target = path.join(dir, '目标', 'zentao-personal');
  for (const item of payload) {
    const file = ['bin', 'lib', 'references'].includes(item) ? path.join(source, item, 'fixture') : path.join(source, item);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'version-one');
  }
  await writeFile(path.join(source, 'config.json'), '{"private":"do-not-copy"}');
  await installSkill(source, target);
  assert.equal(await readFile(path.join(target, 'scripts', 'zentao_read.py'), 'utf8'), 'version-one');
  assert.equal((await readdir(target)).includes('config.json'), false);
  await assert.rejects(installSkill(source, target), /--force/);
  await writeFile(path.join(source, 'SKILL.md'), 'version-two');
  await installSkill(source, target, { overwrite: true });
  assert.equal(await readFile(path.join(target, 'SKILL.md'), 'utf8'), 'version-two');
  assert.equal((await readdir(path.dirname(target))).length, 1);
});

test('缺失源文件不会破坏已经安装的技能', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zentao-failure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source');
  const target = path.join(dir, 'installed');
  await mkdir(source);
  await mkdir(target);
  await writeFile(path.join(target, 'SKILL.md'), 'keep-me');
  await assert.rejects(installSkill(source, target, { overwrite: true }));
  assert.equal(await readFile(path.join(target, 'SKILL.md'), 'utf8'), 'keep-me');
});
