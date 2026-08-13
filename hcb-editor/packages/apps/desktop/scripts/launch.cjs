'use strict';
// 启动器：清除 ELECTRON_RUN_AS_NODE 后以浏览器主进程模式拉起 Electron。
// 该环境变量若被继承，electron.exe 会退化为纯 Node 进程，
// 导致 require('electron') 返回 npm 包路径而非内建 API。
const { spawn } = require('node:child_process');
const path = require('node:path');

delete process.env.ELECTRON_RUN_AS_NODE;

// 在 Node 语境下 require('electron') 返回 electron.exe 的绝对路径。
const electronPath = require('electron');

const child = spawn(electronPath, ['.'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
