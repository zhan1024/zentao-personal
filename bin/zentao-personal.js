#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { select, input, interactive, Cancelled } from '../lib/prompts.js';
import { tools, installPath, installSkill, exists } from '../lib/install.js';
import { detectPython, hasKeyring, runPython, setupCredentials } from '../lib/python.js';
import { workspaceContext, validBranch, hasGit } from '../lib/context.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const argv = process.argv.slice(2);

function usage() {
  console.log(`zentao-personal ${pkg.version} · 禅道个人 Bug 技能\n
  npx zentao-personal                         打开交互向导
  npx zentao-personal install                 选择工具与安装范围
  npx zentao-personal install --user --tools codex,claude,cursor --yes
  npx zentao-personal install --project --tools cursor --yes
  npx zentao-personal configure               配置自己的禅道账号
  npx zentao-personal credentials             Windows/Linux 凭据支持
  npx zentao-personal assigned                查询分配给我的 Bug
  npx zentao-personal bug 123                 查询 Bug 详情
  npx zentao-personal context [--json]        项目与分支引导（只读）
  npx zentao-personal doctor                  检查本机环境

安装到当前目录请加 --project；更新已有技能请加 --force。
需要 Node.js 20+；查询需要 Python 3.9+。Windows 与 macOS 均可使用。`);
}

async function install(args) {
  const flags = new Set();
  let requested;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tools') requested = args[++i]?.split(',');
    else if (args[i].startsWith('--tools=')) requested = args[i].slice(8).split(',');
    else if (['--user', '--project', '--yes', '-y', '--force'].includes(args[i])) flags.add(args[i]);
    else throw new Error(`未知参数：${args[i]}`);
  }
  if (flags.has('--user') && flags.has('--project')) throw new Error('--user 与 --project 只能选择一个。');
  const yes = flags.has('--yes') || flags.has('-y');
  let scope = flags.has('--project') ? 'project' : flags.has('--user') ? 'user' : null;
  if (!interactive() && (!scope || !requested?.length || !yes)) throw new Error('非交互安装须指定 --user 或 --project、--tools 和 --yes。');
  scope ||= await select('技能安装到哪里？', [
    { value: 'user', label: '当前用户：所有项目可用（推荐）' },
    { value: 'project', label: `当前项目：${process.cwd()}` },
  ]);
  requested ||= await select('安装到哪些工具？', tools, { multiple: true, initial: ['codex', 'claude', 'cursor'] });
  requested = [...new Set(requested)];
  if (!requested.length || requested.some(t => !tools.some(o => o.value === t))) throw new Error('--tools 可选 codex、claude、cursor，以逗号分隔。');
  const destinations = requested.map(tool => ({ tool, target: installPath(tool, scope) }));
  console.log('安装目标：');
  destinations.forEach(({ tool, target }) => console.log(`  ${tool}: ${target}`));
  if (!yes && await select('确认安装这些技能文件？', [{ value: 'yes', label: '安装' }, { value: 'no', label: '取消' }]) !== 'yes') throw new Cancelled();
  for (const { target } of destinations) {
    let overwrite = flags.has('--force');
    if (await exists(target) && !overwrite && interactive() && !yes) {
      overwrite = await select(`已有技能：${target}`, [{ value: true, label: '更新此技能目录' }, { value: false, label: '跳过' }]);
      if (!overwrite) continue;
    }
    await installSkill(root, target, { overwrite });
    console.log(`已安装：${target}`);
  }
  console.log('在工具中使用“读取我的禅道 Bug”或“修复 Bug 123”。若未发现技能，重新打开工具。');
  if (interactive() && !yes && await select('是否现在配置自己的禅道？', [{ value: 'yes', label: '现在配置' }, { value: 'no', label: '稍后运行 configure' }]) === 'yes') return configure();
  return 0;
}

async function configure() {
  if (!interactive()) throw new Error('账号配置需要交互终端；请在自己的终端运行 npx zentao-personal configure。');
  let python = detectPython();
  if (process.platform !== 'darwin' && !hasKeyring(python)) {
    const choice = await select('如何使用禅道凭据？', [
      { value: 'store', label: '启用系统凭据保存（推荐，自动准备独立 Python 环境）' },
      { value: 'ask', label: '每次在终端输入密码（AI 后台查询需要先保存凭据）' },
    ]);
    if (choice === 'store') { setupCredentials(); python = detectPython(); }
  }
  return runPython(python, [path.join(root, 'scripts', 'zentao_read.py'), 'configure']);
}

async function context(args) {
  if (args.some(a => a !== '--json')) throw new Error('context 仅支持 --json。');
  const result = await workspaceContext();
  if (args.includes('--json') || !interactive()) { console.log(JSON.stringify(result, null, 2)); return 0; }
  if (!result.repositories.length) { console.log('当前目录及直接子目录没有 Git 仓库。请进入需要处理的项目后重试。'); return 0; }
  let repo = result.repositories[0];
  if (result.repositories.length > 1) {
    const index = await select('这次处理哪个项目？', [
      ...result.repositories.map((r, i) => ({ value: i, label: `${r.path} · ${r.branch || '分离 HEAD'} · ${r.dirty ? '有未提交改动' : '干净'}` })),
      { value: -1, label: '只分析工作区，暂不选择项目' },
    ]);
    if (index === -1) { console.log(JSON.stringify({ ...result, action: 'analyze' }, null, 2)); return 0; }
    repo = result.repositories[index];
  }
  console.log(`项目：${repo.path}\n当前分支：${repo.branch || '分离 HEAD'}\n工作区：${repo.dirty ? '有未提交改动' : '干净'}`);
  const options = [
    ...(repo.branch ? [{ value: 'current', label: `在当前分支 ${repo.branch} 修复` }] : []),
    { value: 'new', label: '从当前 HEAD 新建修复分支' },
    { value: 'analyze', label: '只分析，不修改代码' },
  ];
  const action = await select('希望如何处理 Bug？', options);
  let branch = repo.branch;
  if (action === 'new') {
    do { branch = await input('新分支名称（例如 bug/123）'); } while (!validBranch(branch, repo.path));
  }
  console.log('以下是交给 AI 工具的处理选择；本命令只读取上下文，没有切换或创建分支：');
  console.log(JSON.stringify({ project: repo.path, action, branch, base: repo.head, dirty: repo.dirty }, null, 2));
  return 0;
}

async function doctor() {
  console.log(`zentao-personal ${pkg.version}\n系统：${process.platform} ${os.arch()}\nNode：${process.version}`);
  console.log(`Git：${hasGit() ? '可用' : '未找到（项目与分支引导需要 Git）'}`);
  let ok = true;
  try {
    const python = detectPython();
    console.log(`Python：${python.version} (${python.command})`);
    console.log(`凭据：${process.platform === 'darwin' ? 'macOS 钥匙串（查询时检查访问权限）' : hasKeyring(python) ? 'keyring 后端可用（查询时检查凭据）' : '尚未启用；请运行 credentials，或交互查询时输入密码'}`);
    const check = runPython(python, [path.join(root, 'scripts', 'zentao_read.py'), 'doctor']);
    if (check) ok = false;
  } catch (error) { ok = false; console.log(error.message); }
  for (const tool of tools) console.log(`${tool.label} 用户技能目录：${installPath(tool.value, 'user')}`);
  console.log('环境诊断不会登录禅道或读取密码。');
  return ok ? 0 : 1;
}

async function main() {
  let [command, ...args] = argv;
  if (!command) {
    command = await select('禅道个人 Bug · 请选择操作', [
      { value: 'install', label: '安装／更新技能' },
      { value: 'configure', label: '配置自己的禅道账号' },
      { value: 'assigned', label: '读取分配给我的 Bug' },
      { value: 'bug', label: '读取指定 Bug' },
      { value: 'context', label: '选择项目与修复分支' },
      { value: 'doctor', label: '检查环境' },
      { value: 'exit', label: '退出' },
    ]);
    if (command === 'bug') args = [await input('Bug 编号')];
  }
  if (['--help', '-h', 'help'].includes(command)) { usage(); return 0; }
  if (['--version', '-v'].includes(command)) { console.log(pkg.version); return 0; }
  if (command === 'install') return install(args);
  if (command === 'context') return context(args);
  if (command === 'doctor') { if (args.length) throw new Error('doctor 不接受额外参数。'); return doctor(); }
  if (command === 'configure' || command === 'credentials') {
    if (args.length) throw new Error(`${command} 不接受额外参数。`);
    if (command === 'configure') return configure();
    setupCredentials(); return 0;
  }
  if (command === 'assigned' || command === 'bug') {
    if (command === 'assigned' ? args.length : args.length !== 1 || !/^[1-9]\d*$/.test(args[0])) throw new Error(command === 'assigned' ? 'assigned 不接受额外参数。' : '请指定有效的正整数 Bug 编号。');
    return runPython(detectPython(), [path.join(root, 'scripts', 'zentao_read.py'), command, ...args]);
  }
  if (command === 'exit') return 0;
  throw new Error(`未知命令：${command}，请运行 --help。`);
}

try { process.exitCode = await main(); }
catch (error) { console.error(error.message); process.exitCode = error instanceof Cancelled ? 0 : 1; }
