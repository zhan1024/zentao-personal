import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';

export class Cancelled extends Error {
  constructor() { super('已取消。'); }
}

export function interactive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function input(label, fallback = '') {
  if (!interactive()) throw new Error('此操作需要交互终端；请在自己的终端运行。');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
  } finally { rl.close(); }
}

export function select(label, options, { multiple = false, initial = [] } = {}) {
  if (!interactive()) throw new Error('向导需要交互终端；自动安装请使用 install --user --tools codex,claude,cursor --yes。');
  if (process.env.TERM === 'dumb') return numbered(label, options, multiple, initial);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = stdin.isRaw;
    const wasPaused = stdin.isPaused();
    const selected = new Set(initial);
    let cursor = 0;
    let lines = 0;
    const render = () => {
      if (lines) stdout.write(`\x1b[${lines}A\x1b[0J`);
      const body = options.map((option, i) => `${i === cursor ? '›' : ' '} ${multiple ? (selected.has(option.value) ? '[x] ' : '[ ] ') : ''}${option.label}`);
      stdout.write([label, ...body, multiple ? '↑↓ 移动 · 空格多选 · Enter 确认 · Esc 取消' : '↑↓ 移动 · Enter 确认 · Esc 取消'].join('\n') + '\n');
      lines = options.length + 2;
    };
    const finish = (error, value) => {
      stdin.off('keypress', onKey);
      stdin.setRawMode(Boolean(wasRaw));
      if (wasPaused || !wasRaw) stdin.pause();
      stdout.write('\x1b[?25h');
      error ? reject(error) : resolve(value);
    };
    const onKey = (text, key = {}) => {
      if ((key.ctrl && key.name === 'c') || key.name === 'escape') return finish(new Cancelled());
      if (key.name === 'up') cursor = (cursor + options.length - 1) % options.length;
      else if (key.name === 'down') cursor = (cursor + 1) % options.length;
      else if (multiple && key.name === 'space') {
        const value = options[cursor].value;
        selected.has(value) ? selected.delete(value) : selected.add(value);
      } else if (key.name === 'return') {
        if (multiple && !selected.size) return;
        return finish(null, multiple ? options.filter(o => selected.has(o.value)).map(o => o.value) : options[cursor].value);
      }
      render();
    };
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('keypress', onKey);
    stdout.write('\x1b[?25l');
    render();
  });
}

async function numbered(label, options, multiple, initial) {
  console.log(label);
  options.forEach((option, i) => console.log(`${i + 1}. ${option.label}`));
  const defaults = multiple ? options.flatMap((o, i) => initial.includes(o.value) ? [i + 1] : []).join(',') : '1';
  while (true) {
    const answer = await input(multiple ? '输入编号，逗号分隔' : '输入编号', defaults);
    const indexes = answer.split(',').map(s => Number(s.trim()) - 1);
    if (indexes.length && (multiple || indexes.length === 1) && indexes.every(i => Number.isInteger(i) && options[i])) {
      const values = [...new Set(indexes)].map(i => options[i].value);
      return multiple ? values : values[0];
    }
    console.log('请输入有效编号。');
  }
}
