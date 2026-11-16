const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { exec, execFile } = require('child_process');

let mainWin;
let loadingWin;
let backendProcess;
let backendPort; // Store discovered backend port for late delivery to renderer

// Ensure a single running instance so we don't spawn multiple backends / lock the DB
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
}

function createLoadingWindow() {
  loadingWin = new BrowserWindow({
    width: 450,
    height: 600,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
    },
  });
  loadingWin.loadURL(`file://${path.join(__dirname, '..', 'loading.html')}`, {
    // Disable caching to ensure the latest version is always loaded
    extraHeaders: 'pragma: no-cache\n'
  });
  loadingWin.on('closed', () => {
    loadingWin = null;
  });
  loadingWin.webContents.on('did-finish-load', () => {
    loadingWin.show();
  });
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Keep hidden until ready
    icon: path.join(__dirname, '..', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: true,
      contextIsolation: true,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  mainWin.loadURL(isDev ? 'http://localhost:5173' : `file://${path.join(__dirname, '..', 'dist', 'index.html')}`);

  // When the renderer has finished loading, send the backend port if we already have it
  mainWin.webContents.on('did-finish-load', () => {
    if (backendPort) {
      console.log(`Sending backend port to renderer on did-finish-load: ${backendPort}`);
      mainWin.webContents.send('set-backend-port', backendPort);
    }
  });

  // Use 'ready-to-show' which is the most reliable event for this purpose
  mainWin.once('ready-to-show', () => {
    if (loadingWin) {
      loadingWin.close();
    }
    mainWin.maximize();
    mainWin.show();
  });

  mainWin.on('closed', () => {
    mainWin = null;
  });
}

// Simple helper to find a free port without ESM deps
function getFreePort(preferredPort) {
  return new Promise((resolve) => {
    const server = net.createServer();

    const listen = (portToTry) => {
      server.once('error', () => {
        // If preferred is taken, fallback to an ephemeral port
        if (portToTry && portToTry !== 0) {
          listen(0);
        } else {
          // As a last resort
          resolve(3000);
        }
      });
      server.listen(portToTry || 0, '127.0.0.1', () => {
        const address = server.address();
        const freePort = typeof address === 'object' && address ? address.port : 3000;
        server.close(() => resolve(freePort));
      });
    };

    listen(preferredPort);
  });
}

const readJsonSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.warn('Failed to read JSON file:', filePath, error);
    return null;
  }
};

const writeJsonSafe = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn('Failed to write JSON file:', filePath, error);
  }
};

const buildBackupName = () => {
  const timestamp = new Date().toISOString()
    .replace(/:/g, '-')
    .replace(/\./g, '-')
    .slice(0, 19);
  return `database_backup_${timestamp}.sqlite`;
};

const ensureSeedDatabase = async ({ dataDir, isDev }) => {
  if (isDev) return;

  const targetDbPath = path.join(dataDir, 'database.sqlite');
  const appPath = app.getAppPath();
  const seedDbPath = path.join(appPath, 'backend', 'database.sqlite');
  const seedInfoPath = path.join(dataDir, 'seed-info.json');
  const appVersion = app.getVersion();
  const existingSeedInfo = readJsonSafe(seedInfoPath) || {};
  const alreadyHandled = existingSeedInfo.version === appVersion;

  if (!fs.existsSync(seedDbPath)) {
    console.warn(`Seed database not found at ${seedDbPath}. Skipping seed copy.`);
    return;
  }

  if (fs.existsSync(targetDbPath)) {
    if (alreadyHandled) return;

    const warningResult = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['استبدال مع حفظ نسخة', 'الإبقاء على قاعدة البيانات الحالية'],
      defaultId: 1,
      cancelId: 1,
      title: 'تحذير استبدال قاعدة البيانات',
      message: 'يوجد ملف قاعدة بيانات حالي في الجهاز.',
      detail: 'سيتم استبدال قاعدة البيانات الحالية بقاعدة البيانات الافتراضية القادمة مع التطبيق، وقد يؤدي ذلك إلى فقدان جميع البيانات الحالية. سيتم حفظ نسخة احتياطية تلقائية إذا اخترت الاستبدال.'
    });

    if (warningResult.response === 0) {
      const backupsDir = path.join(dataDir, 'backups');
      if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
      }
      const backupName = buildBackupName();
      const backupPath = path.join(backupsDir, backupName);
      fs.copyFileSync(targetDbPath, backupPath);
      fs.copyFileSync(seedDbPath, targetDbPath);
      writeJsonSafe(seedInfoPath, {
        version: appVersion,
        action: 'replaced',
        backup: backupName,
        at: new Date().toISOString()
      });
    } else {
      writeJsonSafe(seedInfoPath, {
        version: appVersion,
        action: 'kept',
        at: new Date().toISOString()
      });
    }
    return;
  }

  fs.copyFileSync(seedDbPath, targetDbPath);
  writeJsonSafe(seedInfoPath, {
    version: appVersion,
    action: 'copied',
    at: new Date().toISOString()
  });
};

// Function to kill the backend process
function killBackendProcess() {
  if (backendProcess) {
    console.log('Killing backend process...');
    if (process.platform === 'win32') {
      // On Windows, we need to kill the entire process tree
      const { exec } = require('child_process');
      exec(`taskkill /pid ${backendProcess.pid} /T /F`, (err) => {
        if (err) {
          console.error('Failed to kill backend process:', err);
        } else {
          console.log('Backend process killed successfully');
        }
      });
    } else {
      // On Unix-like systems
      backendProcess.kill('SIGTERM');
    }
    backendProcess = null;
  }
}

// Handle app quit
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    killBackendProcess();
    app.quit();
  }
});

// Handle app quit on Windows/Linux
app.on('will-quit', (event) => {
  if (backendProcess) {
    event.preventDefault();
    killBackendProcess();
    // Give the process a moment to shut down
    setTimeout(() => {
      app.exit(0);
    }, 1000);
  }
});

if (gotInstanceLock) {
  app.whenReady().then(async () => {
  const isDev = !app.isPackaged;

  // Resolve data directory: force Local AppData on Windows under a fixed app folder name
  const isWin = process.platform === 'win32';
  const localAppData = isWin ? process.env.LOCALAPPDATA : null;
  const appDataFolderName = 'gov-hr-suite';
  const dataDir = (isWin && localAppData)
    ? path.join(localAppData, appDataFolderName)
    : app.getPath('userData');

  // Point Electron's userData to the chosen directory and ensure it exists
  app.setPath('userData', dataDir);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  await ensureSeedDatabase({ dataDir, isDev });

  // Prepare backend log file in the data directory
  const backendLogPath = path.join(dataDir, 'backend.log');
  const backendLogStream = fs.createWriteStream(backendLogPath, { flags: 'a' });
  console.log(`Backend log path: ${backendLogPath}`);
  const writeLog = (chunk) => {
    try {
      const s = typeof chunk === 'string' ? chunk : chunk.toString();
      backendLogStream.write(s);
    } catch (_) {}
  };

  // Start the backend process based on the environment
  const backendCwd = isDev
    ? path.join(__dirname, '..') // In dev, cwd is the project root
    : path.join(process.resourcesPath, '..'); // In prod, it's relative to the resources path

  let backendCommand = 'npm run backend';
  let backendScriptPath = null;
  if (!isDev) {
    const backendCandidates = [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'dist', 'index.js'),
      path.join(process.resourcesPath, 'app.asar', 'backend', 'dist', 'index.js'),
      path.join(app.getAppPath(), 'backend', 'dist', 'index.js'),
    ];
    backendScriptPath = backendCandidates.find((candidate) => fs.existsSync(candidate)) || null;
    if (!backendScriptPath) {
      const message = `Backend script not found. Checked:\n${backendCandidates.join('\n')}`;
      console.error(message);
      writeLog(`[main] ${message}\n`);
      dialog.showErrorBox('فشل تشغيل الباك إند', 'تعذر العثور على ملف تشغيل الباك إند. الرجاء إعادة تثبيت التطبيق أو التواصل مع الدعم الفني.');
      return;
    }
    console.log(`Resolved production backend script: ${backendScriptPath}`);
  }

  const lockPath = path.join(dataDir, 'database.lock');
  const LOCK_STALE_MS = Number(process.env.LOCK_STALE_MS || 2 * 60 * 1000);
  let backendRestartAttempts = 0;
  let backendLockDetected = false;

  const isProcessAlive = (pid) => {
    if (!pid || Number.isNaN(pid)) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      return true;
    }
  };

  const readLockInfoSafe = () => {
    try {
      if (!fs.existsSync(lockPath)) return null;
      return JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    } catch {
      return null;
    }
  };

  const tryResolveLockAndRestart = async () => {
    if (backendRestartAttempts >= 1) return;
    const lockInfo = readLockInfoSafe();
    if (!lockInfo) return;

    const lastSeen = lockInfo.lastSeen || lockInfo.startedAt;
    const lastSeenTime = lastSeen ? Date.parse(lastSeen) : NaN;
    const isStale = Number.isFinite(lastSeenTime) ? (Date.now() - lastSeenTime) > LOCK_STALE_MS : false;
    const alive = lockInfo.pid ? isProcessAlive(lockInfo.pid) : false;

    if (isStale || !alive) {
      try {
        fs.unlinkSync(lockPath);
        writeLog(`[main] Removed stale lock file at ${lockPath}\n`);
        backendRestartAttempts += 1;
        await startBackend();
      } catch (error) {
        writeLog(`[main] Failed to remove lock file: ${error?.message || error}\n`);
      }
      return;
    }

    const instanceLabel = lockInfo.appInstance ? `(${lockInfo.appInstance})` : '';
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['تنظيف القفل وإعادة التشغيل', 'إلغاء'],
      defaultId: 0,
      cancelId: 1,
      title: 'قفل قاعدة البيانات',
      message: 'تم اكتشاف قفل قاعدة البيانات من عملية أخرى.',
      detail: `PID: ${lockInfo.pid} ${instanceLabel}\nإذا كنت متأكدًا أن التطبيق الآخر مغلق يمكنك تنظيف القفل وإعادة التشغيل.`
    });
    if (result.response === 0) {
      try {
        fs.unlinkSync(lockPath);
        writeLog(`[main] Removed lock file manually at ${lockPath}\n`);
        backendRestartAttempts += 1;
        await startBackend();
      } catch (error) {
        writeLog(`[main] Failed to remove lock file: ${error?.message || error}\n`);
      }
    }
  };

  const startBackend = async () => {
    backendLockDetected = false;

    if (!backendPort) {
      console.log(`Starting backend with ${isDev ? `command: ${backendCommand}` : `Electron as Node with script: ${backendScriptPath}`} in ${backendCwd}`);
      // Prefer configured port, but fall back to a free one if it's busy
      const preferredPort = Number(process.env.BACKEND_PORT || process.env.PORT || 3106);
      backendPort = String(await getFreePort(preferredPort));
      console.log(`DATA_DIR for backend: ${dataDir}`);
      console.log(`Using backend port: ${backendPort}`);
      writeLog(`[main] DATA_DIR: ${dataDir}\n`);
      writeLog(`[main] Using backend port: ${backendPort}\n`);
    }

    if (isDev) {
      backendProcess = exec(backendCommand, {
        cwd: backendCwd,
        env: { 
          ...process.env, 
          DATA_DIR: dataDir, 
          PORT: backendPort,
          APP_INSTANCE: 'electron'
        },
      });
    } else {
      // Run Electron binary as Node to execute backend script without relying on system Node
      backendProcess = execFile(process.execPath, [backendScriptPath], {
        cwd: backendCwd,
        env: { 
          ...process.env, 
          ELECTRON_RUN_AS_NODE: '1', 
          DATA_DIR: dataDir, 
          PORT: backendPort,
          APP_INSTANCE: 'electron'
        },
      });
    }
    backendProcess.on('error', (error) => {
      console.error('Backend process failed to start:', error);
      writeLog(`[main] Backend process failed to start: ${error?.message || error}\n`);
    });
    backendProcess.stdout.on('data', (data) => {
      const dataStr = data.toString();
      console.log(`Backend stdout: ${dataStr}`);
      writeLog(dataStr);

      if (dataStr.includes('Database is already in use')) {
        backendLockDetected = true;
      }

      // Check for the special port message
      if (dataStr.includes('BACKEND_PORT_IS::')) {
        const port = dataStr.split('::')[1].trim();
        if (port) {
          backendPort = port;
          if (mainWin && !mainWin.isDestroyed()) {
            console.log(`Backend port found: ${port}. Sending to renderer...`);
            mainWin.webContents.send('set-backend-port', backendPort);
          } else {
            console.log(`Backend port found before window ready: ${port}. Will send after window loads.`);
          }
        }
      }
    });
    backendProcess.stderr.on('data', (data) => {
      const dataStr = data.toString();
      console.error(`Backend stderr: ${dataStr}`);
      writeLog(dataStr);
      if (dataStr.includes('Database is already in use')) {
        backendLockDetected = true;
      }
    });
    backendProcess.on('close', (code) => {
      console.log(`Backend process exited with code ${code}`);
      writeLog(`[main] Backend process exited with code ${code}\n`);
      if (backendLockDetected) {
        void tryResolveLockAndRestart();
      }
    });
  };

  await startBackend();

  // Allow the renderer to explicitly request the backend port at any time
  const { ipcMain } = require('electron');
  ipcMain.on('request-backend-port', (event) => {
    if (backendPort) {
      event.sender.send('set-backend-port', backendPort);
    }
  });
  ipcMain.handle('get-backend-port', () => backendPort || null);
  ipcMain.handle('select-force-word-file', async () => {
    const result = await dialog.showOpenDialog(mainWin, {
      title: 'اختيار كشف قوة الإدارة العامة',
      properties: ['openFile'],
      filters: [
        { name: 'Word Documents', extensions: ['doc', 'docx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  // 1. Create and show the loading window first.
  createLoadingWindow();

  // 2. Wait for 3 seconds to ensure the backend is ready, mimicking the successful pattern.
  setTimeout(() => {
    createMainWindow();
  }, 1000);
  });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
