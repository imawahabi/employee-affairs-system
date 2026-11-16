const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const isWindows = process.platform === 'win32';
const isWsl = !isWindows && os.release().toLowerCase().includes('microsoft');

const toWslPath = (winPath) => {
  const match = /^([A-Za-z]):\\(.*)/.exec(winPath);
  if (!match) return winPath;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
};

const resolveWindowsDataDir = () => {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return path.join(localAppData, 'gov-hr-suite');
  const userProfile = process.env.USERPROFILE;
  if (userProfile) return path.join(userProfile, 'AppData', 'Local', 'gov-hr-suite');
  return 'C:\\Users\\mawah\\AppData\\Local\\gov-hr-suite';
};

const resolveWslDataDir = () => {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return toWslPath(path.join(localAppData, 'gov-hr-suite'));
  const winUser = process.env.WSL_WIN_USER || process.env.USER || 'mawah';
  return `/mnt/c/Users/${winUser}/AppData/Local/gov-hr-suite`;
};

const dataDir = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : (isWindows ? resolveWindowsDataDir() : (isWsl ? resolveWslDataDir() : resolveWindowsDataDir()));

const env = {
  ...process.env,
  PORT: process.env.PORT || '3106',
  DATA_DIR: dataDir,
  APP_INSTANCE: process.env.APP_INSTANCE || 'dev',
};

const backendCwd = path.join(__dirname, '..', 'backend');
const command = isWindows ? 'cmd.exe' : 'npm';
const args = isWindows ? ['/d', '/s', '/c', 'npm', 'start'] : ['start'];
const child = spawn(command, args, {
  cwd: backendCwd,
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
