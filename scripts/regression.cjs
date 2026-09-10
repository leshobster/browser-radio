const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const executable = process.env.BROWSER_RADIO_EXECUTABLE || require('electron');
const tag = `regression-${Date.now()}`;
const env = { ...process.env, RADIO_TEST_PROFILE: path.resolve('artifacts', tag), RADIO_TEST_OUTPUT: path.resolve('artifacts'), RADIO_TEST_REPORT: tag };
delete env.ELECTRON_RUN_AS_NODE;
async function run(phase) {
  const args = process.env.BROWSER_RADIO_EXECUTABLE ? ['--smoke-test'] : ['.', '--smoke-test'];
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: process.cwd(), env: { ...env, RADIO_TEST_PHASE: phase }, windowsHide: true, stdio: 'inherit' });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('App did not finish and exit')); }, Number(env.RADIO_TEST_DURATION || 90000) * 2 + 120000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`App exited with code ${code}`)); });
  });
  const report = JSON.parse(fs.readFileSync(path.resolve('artifacts', `${tag}-${phase}.json`), 'utf8'));
  if (!report.passed || !report.normalQuit || report.uncaught || report.unhandled) throw new Error(JSON.stringify(report));
  console.log(JSON.stringify(report, null, 2));
}
(async () => { await run('write'); await run('read'); })().catch(error => { console.error(error); process.exitCode = 1; });
