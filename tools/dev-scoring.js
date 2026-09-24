const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const scoringDir = path.join(root, 'apps', 'scoring');

const winVenv = path.join(scoringDir, '.venv', 'Scripts', 'python.exe');
const unixVenv = path.join(scoringDir, '.venv', 'bin', 'python');

let py = process.platform === 'win32' ? winVenv : unixVenv;
if (!fs.existsSync(py)) {
    py = process.platform === 'win32' ? 'python' : 'python3';
}

const child = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000'], {
    cwd: scoringDir,
    stdio: 'inherit',
});

child.on('exit', (code) => {
    process.exit(code || 0);
});
