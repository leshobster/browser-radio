const { spawn } = require('node:child_process');
const electron = process.env.BROWSER_RADIO_EXECUTABLE || require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, process.argv.slice(2), { stdio: 'inherit', windowsHide: true, env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
