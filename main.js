const { app, BrowserWindow, ipcMain, dialog, session, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Глобальные переменные
let mainWindow;
let incognitoWindow = null;
let settingsWindow = null;
const userDataPath = app.getPath('userData');
const dataFilePath = path.join(userDataPath, 'browser-data.json');

// Данные браузера
let browserData = {
  bookmarks: [],
  history: [],
  downloads: [],
  settings: {
    theme: 'dark',
    searchEngine: 'duckduckgo',
    downloadPath: path.join(os.homedir(), 'Downloads'),
    saveHistory: true
  }
};

// Поисковые системы
const searchEngines = {
  google: 'https://www.google.com/search?q=',
  yandex: 'https://yandex.ru/search/?text=',
  duckduckgo: 'https://duckduckgo.com/?q='
};

// Загрузка данных
function loadData() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
      browserData = { ...browserData, ...data };
      // Ограничение истории
      if (browserData.history.length > 1000) {
        browserData.history = browserData.history.slice(-1000);
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
  }
}

// Сохранение данных
function saveData() {
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(browserData, null, 2));
  } catch (error) {
    console.error('Ошибка сохранения данных:', error);
  }
}

// Создание главного окна
function createMainWindow(isIncognito = false) {
  const windowOptions = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      partition: isIncognito ? 'persist:incognito' : 'persist:main'
    },
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png')
  };

  const win = new BrowserWindow(windowOptions);

  win.loadFile('index.html');

  win.once('ready-to-show', () => {
    win.show();
    if (isIncognito) {
      win.webContents.send('set-incognito-mode');
    } else {
      win.webContents.send('load-settings', browserData.settings);
    }
  });

  // Обработка закрытия
  win.on('close', (e) => {
    if (isIncognito) {
      incognitoWindow = null;
    } else if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
  });

  win.on('closed', () => {
    if (!isIncognito) {
      mainWindow = null;
    }
  });

  // Обработка загрузки файлов
  win.webContents.session.on('will-download', (event, item, webContents) => {
    const fileName = item.getFilename();
    const savePath = path.join(browserData.settings.downloadPath, fileName);
    const downloadId = Date.now().toString();
    
    item.setSavePath(savePath);

    // Отправка начала загрузки в renderer
    win.webContents.send('download-started', {
      id: downloadId,
      fileName: fileName,
      url: item.getURL(),
      savePath: savePath,
      totalBytes: item.getTotalBytes(),
      startTime: new Date().toISOString()
    });

    // Отправка прогресса в renderer
    item.on('updated', (event, state) => {
      const receivedBytes = item.getReceivedBytes();
      const totalBytes = item.getTotalBytes();
      const progress = totalBytes > 0 ? receivedBytes / totalBytes : 0;
      
      win.webContents.send('download-progress', {
        id: downloadId,
        fileName: fileName,
        progress: progress,
        receivedBytes: receivedBytes,
        totalBytes: totalBytes,
        state: state
      });
    });

    item.once('done', (event, state) => {
      win.webContents.send('download-complete', {
        id: downloadId,
        fileName: fileName,
        state: state,
        savePath: savePath
      });
      
      // Сохраняем в историю загрузок
      if (!browserData.downloads) browserData.downloads = [];
      browserData.downloads.unshift({
        id: downloadId,
        fileName: fileName,
        url: item.getURL(),
        savePath: savePath,
        state: state,
        date: new Date().toISOString()
      });
      // Ограничиваем историю загрузок
      if (browserData.downloads.length > 100) {
        browserData.downloads = browserData.downloads.slice(0, 100);
      }
      saveData();
    });
  });

  return win;
}

// Создание окна настроек
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 700,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    frame: false,
    resizable: false,
    title: 'Настройки - AIBrowser'
  });

  settingsWindow.loadFile('settings.html');

  settingsWindow.once('ready-to-show', () => {
    settingsWindow.webContents.send('load-settings-data', browserData);
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// IPC обработчики
ipcMain.handle('get-search-engine', () => {
  return searchEngines[browserData.settings.searchEngine] || searchEngines.duckduckgo;
});

ipcMain.handle('add-bookmark', (event, bookmark) => {
  const exists = browserData.bookmarks.find(b => b.url === bookmark.url);
  if (!exists) {
    browserData.bookmarks.push({
      ...bookmark,
      id: Date.now(),
      dateAdded: new Date().toISOString()
    });
    saveData();
    return { success: true };
  }
  return { success: false, message: 'Закладка уже существует' };
});

ipcMain.handle('remove-bookmark', (event, id) => {
  browserData.bookmarks = browserData.bookmarks.filter(b => b.id !== id);
  saveData();
  return { success: true };
});

ipcMain.handle('get-bookmarks', () => {
  return browserData.bookmarks;
});

ipcMain.handle('add-history', (event, entry) => {
  if (!browserData.settings.saveHistory) return;
  
  // Проверка на дубликат за последние 5 минут
  const recentEntry = browserData.history.find(h => 
    h.url === entry.url && 
    (new Date() - new Date(h.timestamp)) < 300000
  );
  
  if (!recentEntry) {
    browserData.history.push({
      ...entry,
      id: Date.now(),
      timestamp: new Date().toISOString()
    });
    
    // Ограничение истории
    if (browserData.history.length > 1000) {
      browserData.history = browserData.history.slice(-1000);
    }
    
    saveData();
  }
});

ipcMain.handle('get-history', () => {
  return browserData.history.sort((a, b) => 
    new Date(b.timestamp) - new Date(a.timestamp)
  );
});

ipcMain.handle('clear-history', () => {
  browserData.history = [];
  saveData();
  return { success: true };
});

ipcMain.handle('clear-data', (event, options) => {
  const { cookies, cache } = options;
  const promises = [];

  if (cookies) {
    promises.push(
      session.defaultSession.clearStorageData({ storages: ['cookies'] })
    );
  }
  
  if (cache) {
    promises.push(
      session.defaultSession.clearCache()
    );
  }

  return Promise.all(promises);
});

ipcMain.handle('save-settings', (event, newSettings) => {
  browserData.settings = { ...browserData.settings, ...newSettings };
  saveData();
  
  // Уведомляем все окна об изменении настроек
  if (mainWindow) {
    mainWindow.webContents.send('settings-changed', browserData.settings);
  }
  
  return { success: true };
});

ipcMain.handle('select-download-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Выберите папку для загрузок'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    browserData.settings.downloadPath = result.filePaths[0];
    saveData();
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

ipcMain.handle('open-download-folder', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('get-downloads-path', () => {
  return path.join(os.homedir(), 'Downloads');
});

ipcMain.handle('get-downloads-history', () => {
  return browserData.downloads || [];
});

// Window control handlers
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
      win.webContents.send('window-unmaximized');
    } else {
      win.maximize();
      win.webContents.send('window-maximized');
    }
  }
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.handle('open-incognito', () => {
  if (!incognitoWindow || incognitoWindow.isDestroyed()) {
    incognitoWindow = createMainWindow(true);
  } else {
    incognitoWindow.focus();
  }
});

ipcMain.handle('open-new-window', (event, url) => {
  const newWin = createMainWindow();
  newWin.webContents.once('did-finish-load', () => {
    newWin.webContents.send('load-url', url);
  });
});

ipcMain.handle('open-settings', () => {
  createSettingsWindow();
});

ipcMain.handle('close-settings', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
});

ipcMain.handle('get-autocomplete', (event, query) => {
  if (!query || query.length < 2) return [];
  
  const lowerQuery = query.toLowerCase();
  const suggestions = [];
  
  // Поиск в закладках
  browserData.bookmarks.forEach(b => {
    if (b.title.toLowerCase().includes(lowerQuery) || 
        b.url.toLowerCase().includes(lowerQuery)) {
      suggestions.push({ type: 'bookmark', ...b });
    }
  });
  
  // Поиск в истории
  browserData.history.forEach(h => {
    if (h.title.toLowerCase().includes(lowerQuery) || 
        h.url.toLowerCase().includes(lowerQuery)) {
      const exists = suggestions.find(s => s.url === h.url);
      if (!exists) {
        suggestions.push({ type: 'history', ...h });
      }
    }
  });
  
  return suggestions.slice(0, 10);
});

// Инициализация приложения
app.whenReady().then(() => {
  loadData();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Блокировка новых окон (открывать в новой вкладке)
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    if (mainWindow) {
      mainWindow.webContents.send('new-tab-request', navigationUrl);
    }
  });
});
