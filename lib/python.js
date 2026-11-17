import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

export const runtimeHome = path.join(os.homedir(), '.config', 'zentao-personal', 'runtime');
export function runtimePython(platform = process.platform, root = runtimeHome) {
  return platform === 'win32' ? path.win32.join(root, 'Scripts', 'python.exe') : path.join(root, 'bin', 'python');
}

export function pythonCandidates(platform = process.platform) {
  return platform === 'win32'
    ? [{ command: 'py', args: ['-3'] }, { command: 'python', args: [] }, { command: 'python3', args: [] }]
    : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
}

export function detectPython({ platform = process.platform, run = spawnSync, useRuntime = true } = {}) {
  const local = runtimePython(platform);
  const candidates = useRuntime && existsSync(local) ? [{ command: local, args: [] }, ...pythonCandidates(platform)] : pythonCandidates(platform);
  for (const candidate of candidates) {
    const result = run(candidate.command, [...candidate.args, '-c', 'import sys; print("%d.%d" % sys.version_info[:2]); sys.exit(0 if sys.version_info >= (3, 9) else 1)'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (!result.error && result.status === 0) return { ...candidate, version: result.stdout.trim() };
  }
  throw new Error('未找到 Python 3.9+。请先安装 Python（Windows 勾选添加到 PATH），重新打开终端后运行 doctor。');
}

export function hasKeyring(python) {
  const result = spawnSync(python.command, [...python.args, '-c', 'import keyring; import sys; sys.exit(0 if keyring.get_keyring().priority > 0 else 1)'], { stdio: 'ignore', timeout: 15000, windowsHide: true });
  return !result.error && result.status === 0;
}

export function runPython(python, args, options = {}) {
  const result = spawnSync(python.command, [...python.args, ...args], {
    stdio: 'inherit', windowsHide: true, ...options,
    env: { ...process.env, PYTHONUTF8: '1', ...options.env },
  });
  if (result.error) throw new Error(`无法启动 Python：${result.error.code || '未知错误'}`);
  return result.status ?? 1;
}

export function setupCredentials() {
  if (process.platform === 'darwin') { console.log('macOS 使用系统钥匙串，无需安装额外依赖。'); return; }
  const base = detectPython({ useRuntime: false });
  mkdirSync(path.dirname(runtimeHome), { recursive: true });
  if (!existsSync(runtimePython())) {
    if (runPython(base, ['-m', 'venv', runtimeHome])) throw new Error('无法创建独立 Python 环境；请检查 Python 是否包含 venv。');
  }
  const isolated = { command: runtimePython(), args: [] };
  if (runPython(isolated, ['-m', 'pip', 'install', 'keyring>=25,<26'])) throw new Error('keyring 安装失败，请检查网络后重新运行 credentials。');
  if (!hasKeyring(isolated)) throw new Error('未检测到可用的系统凭据后端；可在交互终端按次输入密码。');
  console.log('系统凭据支持已准备好。请运行 configure 配置自己的账号。');
}
