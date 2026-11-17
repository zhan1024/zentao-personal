import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('箭头菜单确认与取消均恢复终端，进程正常退出', () => {
  for (const keys of ['\u001b[A\r', '\u001b', '\u0003']) {
    const source = `
      import { PassThrough } from 'node:stream';
      import { select, Cancelled } from './lib/prompts.js';
      const input = new PassThrough();
      input.isTTY = true;
      input.isRaw = false;
      input.setRawMode = value => { input.isRaw = value; };
      const output = new PassThrough();
      output.isTTY = true;
      let drawn = '';
      output.on('data', chunk => { drawn += chunk; });
      Object.defineProperty(process, 'stdin', { value: input });
      Object.defineProperty(process, 'stdout', { value: output });
      process.env.TERM = 'xterm';
      const pending = select('请选择', [{value:'install',label:'安装'}, {value:'exit',label:'退出'}]);
      input.write(${JSON.stringify(keys)});
      let value;
      try { value = await pending; } catch (error) { if (!(error instanceof Cancelled)) throw error; value = 'cancelled'; }
      process.stderr.write(JSON.stringify({value,raw:input.isRaw,paused:input.isPaused(),listeners:input.listenerCount('keypress'),cursorRestored:drawn.endsWith('\\x1b[?25h')}));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stderr), { value: keys === '\u001b[A\r' ? 'exit' : 'cancelled', raw: false, paused: true, listeners: 0, cursorRestored: true });
  }
});
