/**
 * AIBrowser - Settings Window Script
 * Обработка настроек браузера
 */

const { ipcRenderer } = require('electron');

// Данные настроек
let currentData = {
  bookmarks: [],
  history: [],
  settings: {
    theme: 'dark',
    searchEngine: 'duckduckgo',
    downloadPath: '',
    saveHistory: true
  }
};

// DOM элементы
const themeDarkBtn = document.getElementById('themeDark');
const themeLightBtn = document.getElementById('themeLight');
const saveHistoryCheckbox = document.getElementById('saveHistory');
const downloadPathDisplay = document.getElementById('downloadPath');
const changePathBtn = document.getElementById('changePathBtn');
const clearDataBtn = document.getElementById('clearDataBtn');
const resetBtn = document.getElementById('resetBtn');
const closeBtn = document.getElementById('closeBtn');
const notification = document.getElementById('notification');

// Загрузка данных
ipcRenderer.on('load-settings-data', (event, data) => {
  currentData = { ...currentData, ...data };
  applySettings();
  updateStats();
});

// Применение настроек к интерфейсу
function applySettings() {
  const settings = currentData.settings;
  
  // Тема
  updateThemeButtons(settings.theme);
  
  // Поисковая система
  const engineRadio = document.querySelector(`input[name="searchEngine"][value="${settings.searchEngine}"]`);
  if (engineRadio) engineRadio.checked = true;
  
  // Папка загрузок
  downloadPathDisplay.textContent = settings.downloadPath || 'Загрузки';
  
  // Сохранять историю
  saveHistoryCheckbox.checked = settings.saveHistory !== false;
}

// Обновление кнопок темы
function updateThemeButtons(theme) {
  themeDarkBtn.classList.toggle('active', theme === 'dark');
  themeLightBtn.classList.toggle('active', theme === 'light');
}

// Обновление статистики
function updateStats() {
  document.getElementById('statBookmarks').textContent = currentData.bookmarks.length;
  document.getElementById('statHistory').textContent = currentData.history.length;
  document.getElementById('statSessions').textContent = '1';
}

// ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================

// Переключение темы
themeDarkBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('save-settings', { theme: 'dark' });
  updateThemeButtons('dark');
  showNotification('🌙 Тёмная тема включена');
});

themeLightBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('save-settings', { theme: 'light' });
  updateThemeButtons('light');
  showNotification('☀️ Светлая тема включена');
});

// Переключение сохранения истории
saveHistoryCheckbox.addEventListener('change', async () => {
  const saveHistory = saveHistoryCheckbox.checked;
  await ipcRenderer.invoke('save-settings', { saveHistory });
  showNotification(saveHistory ? '✓ История будет сохраняться' : '✗ История не будет сохраняться');
});

// Выбор поисковой системы
document.querySelectorAll('input[name="searchEngine"]').forEach(radio => {
  radio.addEventListener('change', async () => {
    if (radio.checked) {
      await ipcRenderer.invoke('save-settings', { searchEngine: radio.value });
      
      const names = {
        duckduckgo: '🦆 DuckDuckGo',
        google: '🔍 Google',
        yandex: '🇷🇺 Яндекс'
      };
      showNotification(`Поисковая система: ${names[radio.value]}`);
    }
  });
});

// Изменение папки загрузок
changePathBtn.addEventListener('click', async () => {
  const result = await ipcRenderer.invoke('select-download-folder');
  if (result.success) {
    downloadPathDisplay.textContent = result.path;
    showNotification('✓ Папка для загрузок изменена');
  }
});

// Очистка данных
clearDataBtn.addEventListener('click', async () => {
  const clearHistoryChecked = document.getElementById('clearHistory').checked;
  const clearCookies = document.getElementById('clearCookies').checked;
  const clearCache = document.getElementById('clearCache').checked;
  
  if (!clearHistoryChecked && !clearCookies && !clearCache) {
    showNotification('⚠️ Выберите данные для очистки', true);
    return;
  }
  
  // Подтверждение
  const confirmed = confirm(
    'Вы уверены, что хотите удалить выбранные данные?\n\n' +
    (clearHistoryChecked ? '• История посещений\n' : '') +
    (clearCookies ? '• Файлы cookie\n' : '') +
    (clearCache ? '• Кэш файлов\n' : '')
  );
  
  if (!confirmed) return;
  
  try {
    if (clearHistoryChecked) {
      await ipcRenderer.invoke('clear-history');
      currentData.history = [];
    }
    
    await ipcRenderer.invoke('clear-data', {
      cookies: clearCookies,
      cache: clearCache
    });
    
    updateStats();
    
    // Сбрасываем чекбоксы
    document.getElementById('clearHistory').checked = false;
    document.getElementById('clearCookies').checked = false;
    document.getElementById('clearCache').checked = false;
    
    showNotification('✓ Данные успешно очищены');
  } catch (error) {
    showNotification('✗ Ошибка при очистке данных', true);
  }
});

// Сброс настроек
resetBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    '⚠️ ВНИМАНИЕ!\n\n' +
    'Вы собираетесь сбросить ВСЕ настройки к значениям по умолчанию.\n' +
    'Это удалит:\n' +
    '• Все закладки\n' +
    '• Всю историю\n' +
    '• Все настройки\n\n' +
    'Это действие НЕЛЬЗЯ отменить!\n\n' +
    'Продолжить?'
  );
  
  if (!confirmed) return;
  
  try {
    const defaultPath = await ipcRenderer.invoke('get-downloads-path');
    const defaultSettings = {
      theme: 'dark',
      searchEngine: 'duckduckgo',
      downloadPath: defaultPath,
      saveHistory: true
    };
    
    await ipcRenderer.invoke('save-settings', defaultSettings);
    await ipcRenderer.invoke('clear-history');
    await ipcRenderer.invoke('clear-data', { cookies: true, cache: true });
    
    currentData.settings = defaultSettings;
    currentData.history = [];
    currentData.bookmarks = [];
    
    applySettings();
    updateStats();
    
    showNotification('✓ Настройки сброшены');
  } catch (error) {
    showNotification('✗ Ошибка при сбросе', true);
  }
});
  
// Закрытие окна
closeBtn.addEventListener('click', () => {
  ipcRenderer.invoke('close-settings');
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// Показ уведомления
function showNotification(message, isError = false) {
  notification.textContent = message;
  notification.classList.toggle('error', isError);
  notification.classList.add('show');
  
  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}
