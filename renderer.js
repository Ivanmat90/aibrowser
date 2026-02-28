/**
 * AIBrowser - Renderer Process
 * Основной скрипт управления интерфейсом браузера
 */

const { ipcRenderer, shell } = require('electron');

// ============================================
// Глобальные переменные
// ============================================
let tabs = [];
let activeTabId = null;
let isIncognito = false;
let settings = {
  theme: 'dark',
  searchEngine: 'duckduckgo'
};
let downloads = [];
let bookmarks = [];
let history = [];
let tabCounter = 0;
let draggedTab = null;

// Поисковые системы
const searchEngines = {
  google: 'https://www.google.com/search?q=',
  yandex: 'https://yandex.ru/search/?text=',
  duckduckgo: 'https://duckduckgo.com/?q='
};

// ============================================
// DOM элементы
// ============================================
const tabsContainer = document.getElementById('tabs');
const webviewContainer = document.getElementById('webview-container');
const addressBar = document.getElementById('address-bar');
const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
const bookmarksList = document.getElementById('bookmarks-list');
const downloadsPanel = document.getElementById('downloads-panel');
const downloadsList = document.getElementById('downloads-list');
const historyPanel = document.getElementById('history-panel');
const historyList = document.getElementById('history-list');
const mainMenu = document.getElementById('main-menu');
const statusText = document.getElementById('status-text');
const loadingIndicator = document.getElementById('loading-indicator');
const bookmarkBtn = document.getElementById('bookmark-btn');
const downloadBadge = document.getElementById('download-badge');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');

// ============================================
// Инициализация
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  setupKeyboardShortcuts();
  await loadBookmarks();
  await loadDownloadHistory();
  createTab(); // Создаём первую вкладку
});

// Загрузка истории загрузок
async function loadDownloadHistory() {
  try {
    const history = await ipcRenderer.invoke('get-downloads-history');
    if (history && history.length > 0) {
      // Добавляем только завершённые загрузки из истории
      history.forEach(d => {
        if (d.state === 'completed' || d.state === 'interrupted') {
          downloads.push({
            id: d.id,
            fileName: d.fileName,
            savePath: d.savePath,
            url: d.url,
            state: d.state,
            progress: d.state === 'completed' ? 1 : 0,
            date: d.date
          });
        }
      });
      renderDownloads();
    }
  } catch (error) {
    console.error('Ошибка загрузки истории загрузок:', error);
  }
}

// ============================================
// Управление вкладками
// ============================================
function createTab(url = null, active = true) {
  const tabId = `tab-${Date.now()}-${tabCounter++}`;
  
  const tab = {
    id: tabId,
    title: 'Новая вкладка',
    url: url || 'newtab.html',
    favicon: null,
    loading: false,
    canGoBack: false,
    canGoForward: false
  };
  
  tabs.push(tab);
  
  // Создаём DOM элемент вкладки
  const tabElement = document.createElement('div');
  tabElement.className = 'tab';
  tabElement.dataset.tabId = tabId;
  tabElement.draggable = true;
  tabElement.innerHTML = `
    <img class="tab-favicon" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="">
    <span class="tab-title">Новая вкладка</span>
    <span class="tab-close">×</span>
  `;
  
  // Drag and drop
  tabElement.addEventListener('dragstart', (e) => handleTabDragStart(e, tabId));
  tabElement.addEventListener('dragover', (e) => handleTabDragOver(e, tabId));
  tabElement.addEventListener('drop', (e) => handleTabDrop(e, tabId));
  tabElement.addEventListener('dragend', handleTabDragEnd);
  
  // Клики
  tabElement.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      e.stopPropagation();
      closeTab(tabId);
    } else {
      switchToTab(tabId);
    }
  });
  
  // Средняя кнопка мыши
  tabElement.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tabId);
    }
  });
  
  tabsContainer.appendChild(tabElement);
  
  // Создаём webview
  const webview = document.createElement('webview');
  webview.id = `webview-${tabId}`;
  webview.src = tab.url;
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no');
  
  setupWebviewListeners(webview, tabId);
  webviewContainer.appendChild(webview);
  
  if (active) {
    switchToTab(tabId);
  }
  
  return tabId;
}

function switchToTab(tabId) {
  if (activeTabId === tabId) return;
  
  // Деактивируем текущую вкладку
  if (activeTabId) {
    const currentTab = document.querySelector(`.tab[data-tab-id="${activeTabId}"]`);
    const currentWebview = document.getElementById(`webview-${activeTabId}`);
    if (currentTab) currentTab.classList.remove('active');
    if (currentWebview) currentWebview.classList.remove('active');
  }
  
  // Активируем новую вкладку
  const newTab = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  const newWebview = document.getElementById(`webview-${tabId}`);
  
  if (newTab) newTab.classList.add('active');
  if (newWebview) newWebview.classList.add('active');
  
  activeTabId = tabId;
  
  // Обновляем UI
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    updateAddressBar(tab.url);
    updateNavigationButtons(tab);
    updateBookmarkButton(tab.url);
  }
}

function closeTab(tabId) {
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;
  
  const tab = tabs[tabIndex];
  
  // Удаляем DOM элементы
  const tabElement = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  const webview = document.getElementById(`webview-${tabId}`);
  
  if (tabElement) tabElement.remove();
  if (webview) {
    webview.stop();
    webview.remove();
  }
  
  // Удаляем из массива
  tabs.splice(tabIndex, 1);
  
  // Если закрыли активную вкладку
  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      // Переключаемся на соседнюю вкладку
      const newIndex = Math.min(tabIndex, tabs.length - 1);
      switchToTab(tabs[newIndex].id);
    } else {
      // Все вкладки закрыты - создаём новую
      activeTabId = null;
      createTab();
    }
  }
}

// Drag and drop для вкладок
function handleTabDragStart(e, tabId) {
  draggedTab = tabId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleTabDragOver(e, tabId) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleTabDrop(e, targetTabId) {
  e.preventDefault();
  
  if (!draggedTab || draggedTab === targetTabId) return;
  
  const draggedIndex = tabs.findIndex(t => t.id === draggedTab);
  const targetIndex = tabs.findIndex(t => t.id === targetTabId);
  
  if (draggedIndex === -1 || targetIndex === -1) return;
  
  // Меняем местами в массиве
  const [removed] = tabs.splice(draggedIndex, 1);
  tabs.splice(targetIndex, 0, removed);
  
  // Перестраиваем DOM
  const draggedElement = document.querySelector(`.tab[data-tab-id="${draggedTab}"]`);
  const targetElement = document.querySelector(`.tab[data-tab-id="${targetTabId}"]`);
  
  if (draggedElement && targetElement) {
    tabsContainer.insertBefore(draggedElement, targetTabId === tabs[tabs.length - 1].id 
      ? targetElement.nextSibling 
      : targetElement);
  }
  
  draggedTab = null;
}

function handleTabDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedTab = null;
}

// ============================================
// Webview обработчики
// ============================================
function setupWebviewListeners(webview, tabId) {
  const tab = tabs.find(t => t.id === tabId);
  
  // Загрузка началась
  webview.addEventListener('did-start-loading', () => {
    if (tab) {
      tab.loading = true;
      updateTabUI(tabId, { loading: true });
      if (activeTabId === tabId) {
        loadingIndicator.classList.add('active');
        statusText.textContent = 'Загрузка...';
      }
    }
  });
  
  // Загрузка завершена
  webview.addEventListener('did-stop-loading', () => {
    if (tab) {
      tab.loading = false;
      updateTabUI(tabId, { loading: false });
      updateNavigationState(webview, tabId);
      
      if (activeTabId === tabId) {
        loadingIndicator.classList.remove('active');
        statusText.textContent = 'Готово';
      }
      
      // Добавляем в историю
      if (!isIncognito && !tab.url.includes('newtab.html')) {
        addToHistory(tab.title, tab.url);
      }
    }
  });
  
  // Изменение заголовка
  webview.addEventListener('page-title-updated', (e) => {
    if (tab) {
      tab.title = e.title;
      updateTabUI(tabId, { title: e.title });
    }
  });
  
  // Изменение favicon
  webview.addEventListener('page-favicon-updated', (e) => {
    if (tab && e.favicons.length > 0) {
      tab.favicon = e.favicons[0];
      updateTabUI(tabId, { favicon: e.favicons[0] });
    }
  });
  
  // Навигация
  webview.addEventListener('did-navigate', (e) => {
    if (tab) {
      tab.url = e.url;
      if (activeTabId === tabId) {
        updateAddressBar(e.url);
        updateNavigationState(webview, tabId);
        updateBookmarkButton(e.url);
      }
    }
  });
  
  // Внутренняя навигация
  webview.addEventListener('did-navigate-in-page', (e) => {
    if (tab && e.isMainFrame) {
      tab.url = e.url;
      if (activeTabId === tabId) {
        updateAddressBar(e.url);
      }
    }
  });
  
  // Обновление статуса
  webview.addEventListener('update-target-url', (e) => {
    if (activeTabId === tabId) {
      statusText.textContent = e.url || 'Готово';
    }
  });
  
  // Ошибка загрузки
  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode !== -3 && !e.validatedURL.includes('newtab.html')) { // -3 = aborted
      webview.src = `error.html?url=${encodeURIComponent(e.validatedURL)}&code=${e.errorCode}`;
    }
  });
  
  // Новое окно
  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    createTab(e.url);
  });
  
  // Контекстное меню
  webview.addEventListener('context-menu', (e) => {
    const { params } = e;
    
    // Определяем тип контекста
    if (params.isEditable) {
      // Поле ввода
      showInputContextMenuForWebview(e, params);
    } else if (params.selectionText && params.selectionText.length > 0) {
      // Выделенный текст
      showTextContextMenu(e, params.selectionText);
    } else if (params.srcURL && params.mediaType === 'image') {
      // Картинка
      showImageContextMenu(e, params.srcURL);
    } else if (params.linkURL) {
      // Ссылка
      showLinkContextMenu(e, params.linkURL, params.linkText || params.linkURL);
    } else {
      // Обычное меню страницы
      showPageContextMenu(e);
    }
  });
}

function updateTabUI(tabId, updates) {
  const tabElement = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (!tabElement) return;
  
  const faviconEl = tabElement.querySelector('.tab-favicon');
  const titleEl = tabElement.querySelector('.tab-title');
  
  if (updates.title !== undefined) {
    titleEl.textContent = updates.title || 'Без названия';
  }
  
  if (updates.favicon !== undefined) {
    faviconEl.src = updates.favicon;
  }
  
  if (updates.loading !== undefined) {
    if (updates.loading) {
      faviconEl.style.opacity = '0.5';
    } else {
      faviconEl.style.opacity = '1';
    }
  }
}

function updateNavigationState(webview, tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    tab.canGoBack = webview.canGoBack();
    tab.canGoForward = webview.canGoForward();
    if (activeTabId === tabId) {
      updateNavigationButtons(tab);
    }
  }
}

function updateNavigationButtons(tab) {
  backBtn.disabled = !tab.canGoBack;
  forwardBtn.disabled = !tab.canGoForward;
}

// ============================================
// Навигация
// ============================================
function navigateTo(url) {
  const webview = document.getElementById(`webview-${activeTabId}`);
  if (!webview) return;
  
  // Обработка URL
  let processedUrl = url.trim();
  
  if (!processedUrl) return;
  
  // Проверка на поисковый запрос
  const isUrl = /^(https?:\/\/)?[\w\-\.]+\.[a-z]{2,}/i.test(processedUrl);
  const hasSpace = processedUrl.includes(' ');
  
  if (!isUrl || hasSpace) {
    const searchUrl = searchEngines[settings.searchEngine] || searchEngines.duckduckgo;
    processedUrl = searchUrl + encodeURIComponent(processedUrl);
  } else if (!processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
    processedUrl = 'https://' + processedUrl;
  }
  
  try {
    webview.src = processedUrl;
  } catch (error) {
    console.error('Navigation error:', error);
    webview.src = `error.html?url=${encodeURIComponent(processedUrl)}&code=-6`;
  }
}

function updateAddressBar(url) {
  if (url.includes('newtab.html')) {
    addressBar.value = '';
  } else if (url.includes('error.html')) {
    addressBar.value = '';
  } else {
    addressBar.value = url;
  }
}

// ============================================
// Автодополнение
// ============================================
let autocompleteIndex = -1;

async function updateAutocomplete(query) {
  if (!query || query.length < 2) {
    hideAutocomplete();
    return;
  }
  
  const suggestions = await ipcRenderer.invoke('get-autocomplete', query);
  
  if (suggestions.length === 0) {
    hideAutocomplete();
    return;
  }
  
  autocompleteDropdown.innerHTML = '';
  autocompleteIndex = -1;
  
  suggestions.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'autocomplete-item';
    div.dataset.index = index;
    div.dataset.url = item.url;
    div.innerHTML = `
      <span class="autocomplete-icon">${item.type === 'bookmark' ? '★' : '🕐'}</span>
      <div class="autocomplete-info">
        <div class="autocomplete-title">${escapeHtml(item.title)}</div>
        <div class="autocomplete-url">${escapeHtml(item.url)}</div>
      </div>
    `;
    
    div.addEventListener('click', () => {
      navigateTo(item.url);
      hideAutocomplete();
    });
    
    autocompleteDropdown.appendChild(div);
  });
  
  autocompleteDropdown.classList.add('visible');
}

function hideAutocomplete() {
  autocompleteDropdown.classList.remove('visible');
  autocompleteDropdown.innerHTML = '';
  autocompleteIndex = -1;
}

function selectAutocompleteItem(index) {
  const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === index);
  });
  autocompleteIndex = index;
}

// ============================================
// Закладки
// ============================================
async function loadBookmarks() {
  bookmarks = await ipcRenderer.invoke('get-bookmarks');
  renderBookmarks();
}

function renderBookmarks() {
  bookmarksList.innerHTML = '';
  
  bookmarks.forEach(bookmark => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    item.title = bookmark.url;
    item.innerHTML = `
      <img class="bookmark-favicon" src="${bookmark.favicon || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}" alt="">
      <span class="bookmark-title">${escapeHtml(bookmark.title)}</span>
      <span class="bookmark-delete">×</span>
    `;
    
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('bookmark-delete')) {
        e.stopPropagation();
        removeBookmark(bookmark.id);
      } else {
        navigateTo(bookmark.url);
      }
    });
    
    bookmarksList.appendChild(item);
  });
}

async function addBookmark(title, url) {
  const webview = document.getElementById(`webview-${activeTabId}`);
  const favicon = tabs.find(t => t.id === activeTabId)?.favicon || '';
  
  const result = await ipcRenderer.invoke('add-bookmark', {
    title: title || 'Без названия',
    url: url,
    favicon: favicon
  });
  
  if (result.success) {
    await loadBookmarks();
    bookmarkBtn.classList.add('active');
    showNotification('Закладка добавлена');
  }
}

async function removeBookmark(id) {
  await ipcRenderer.invoke('remove-bookmark', id);
  await loadBookmarks();
  updateBookmarkButton(addressBar.value);
}

function updateBookmarkButton(url) {
  const isBookmarked = bookmarks.some(b => b.url === url);
  bookmarkBtn.classList.toggle('active', isBookmarked);
}

function showBookmarkDialog() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || tab.url.includes('newtab.html')) return;
  
  document.getElementById('bookmark-title').value = tab.title;
  document.getElementById('bookmark-url').value = tab.url;
  document.getElementById('bookmark-dialog').classList.remove('hidden');
}

// ============================================
// История
// ============================================
async function loadHistory() {
  history = await ipcRenderer.invoke('get-history');
  renderHistory();
}

function renderHistory(filter = '') {
  historyList.innerHTML = '';
  
  const filtered = filter 
    ? history.filter(h => 
        h.title.toLowerCase().includes(filter.toLowerCase()) ||
        h.url.toLowerCase().includes(filter.toLowerCase())
      )
    : history;
  
  if (filtered.length === 0) {
    historyList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">История пуста</div>';
    return;
  }
  
  // Группировка по датам
  let currentDate = '';
  
  filtered.forEach(item => {
    const date = new Date(item.timestamp);
    const dateStr = formatDate(date);
    
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      const header = document.createElement('div');
      header.className = 'history-group-header';
      header.textContent = dateStr;
      historyList.appendChild(header);
    }
    
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <img class="history-favicon" src="${item.favicon || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}" alt="">
      <div class="history-info">
        <div class="history-title">${escapeHtml(item.title)}</div>
        <div class="history-url">${escapeHtml(item.url)}</div>
      </div>
      <span class="history-date">${formatTime(date)}</span>
    `;
    
    div.addEventListener('click', () => {
      navigateTo(item.url);
      historyPanel.classList.add('hidden');
    });
    
    historyList.appendChild(div);
  });
}

async function addToHistory(title, url) {
  const tab = tabs.find(t => t.id === activeTabId);
  await ipcRenderer.invoke('add-history', {
    title: title || 'Без названия',
    url: url,
    favicon: tab?.favicon || ''
  });
}

async function clearAllHistory() {
  await ipcRenderer.invoke('clear-history');
  history = [];
  renderHistory();
}

// ============================================
// Загрузки
// ============================================
function addOrUpdateDownload(download) {
  // Преобразуем id в строку для согласованности
  const downloadId = String(download.id);
  
  const existingIndex = downloads.findIndex(d => String(d.id) === downloadId);
  
  if (existingIndex !== -1) {
    // Обновляем существующую загрузку
    downloads[existingIndex] = { ...downloads[existingIndex], ...download, id: downloadId };
  } else {
    // Добавляем новую загрузку в начало списка
    downloads.unshift({ ...download, id: downloadId });
  }
  
  renderDownloads();
  updateDownloadBadge();
}

function renderDownloads() {
  downloadsList.innerHTML = '';
  
  if (downloads.length === 0) {
    downloadsList.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: var(--text-muted);"><div style="font-size: 32px; margin-bottom: 10px;">⬇️</div><div>Нет загрузок</div><div style="font-size: 12px; margin-top: 8px;">Загруженные файлы будут отображаться здесь</div></div>';
    return;
  }
  
  downloads.forEach(download => {
    const div = document.createElement('div');
    div.className = 'download-item';
    div.dataset.downloadId = download.id;
    
    const isComplete = download.state === 'completed';
    const isFailed = download.state === 'interrupted' || download.state === 'cancelled';
    const isProgressing = download.state === 'progressing';
    const progress = download.progress || 0;
    const percent = Math.round(progress * 100);
    
    // Форматирование размера
    const formatBytes = (bytes) => {
      if (!bytes || bytes === 0) return '';
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
    };
    
    const sizeText = download.totalBytes 
      ? `${formatBytes(download.receivedBytes || 0)} / ${formatBytes(download.totalBytes)}`
      : '';
    
    // Создаём элементы через DOM API вместо innerHTML для обработчиков событий
    const header = document.createElement('div');
    header.className = 'download-header';
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between;';
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
        <span style="font-size: 16px;">${isComplete ? '✅' : isFailed ? '❌' : '📥'}</span>
        <div style="flex: 1; min-width: 0;">
          <div class="download-filename" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(download.fileName)}</div>
          ${sizeText ? `<div style="font-size: 11px; color: var(--text-muted);">${sizeText}</div>` : ''}
        </div>
      </div>
      <span class="download-status" style="flex-shrink: 0; margin-left: 10px; font-size: 12px; color: var(--text-secondary);">
        ${isComplete ? 'Готово' : isFailed ? 'Ошибка' : percent + '%'}
      </span>
    `;
    div.appendChild(header);
    
    // Прогресс-бар
    if (isProgressing) {
      const progressContainer = document.createElement('div');
      progressContainer.className = 'download-progress-bar';
      progressContainer.style.cssText = 'margin: 10px 0; height: 4px; background: var(--bg-hover); border-radius: 2px; overflow: hidden;';
      
      const progressFill = document.createElement('div');
      progressFill.className = 'download-progress-fill';
      progressFill.style.cssText = `width: ${percent}%; height: 100%; background: var(--accent-primary); transition: width 0.3s ease;`;
      
      progressContainer.appendChild(progressFill);
      div.appendChild(progressContainer);
    }
    
    // Кнопки действий
    const actions = document.createElement('div');
    actions.className = 'download-actions';
    actions.style.cssText = 'margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;';
    
    if (isComplete) {
      const openFolderBtn = document.createElement('button');
      openFolderBtn.className = 'action-btn';
      openFolderBtn.innerHTML = '📂 Открыть папку';
      openFolderBtn.style.cssText = 'padding: 6px 12px; background: var(--bg-hover); border: none; border-radius: 6px; color: var(--text-secondary); font-size: 12px; cursor: pointer;';
      openFolderBtn.addEventListener('click', () => openDownloadFolder(download.savePath));
      actions.appendChild(openFolderBtn);
      
      const openFileBtn = document.createElement('button');
      openFileBtn.className = 'action-btn';
      openFileBtn.innerHTML = '▶️ Открыть файл';
      openFileBtn.style.cssText = 'padding: 6px 12px; background: var(--accent-primary); border: none; border-radius: 6px; color: white; font-size: 12px; cursor: pointer;';
      openFileBtn.addEventListener('click', () => shell.openPath(download.savePath));
      actions.appendChild(openFileBtn);
    }
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'action-btn danger';
    removeBtn.innerHTML = '🗑️ Удалить';
    removeBtn.style.cssText = 'padding: 6px 12px; background: transparent; border: 1px solid var(--danger); border-radius: 6px; color: var(--danger); font-size: 12px; cursor: pointer;';
    removeBtn.addEventListener('click', () => removeDownload(download.id));
    actions.appendChild(removeBtn);
    
    div.appendChild(actions);
    downloadsList.appendChild(div);
  });
}

function removeDownload(id) {
  downloads = downloads.filter(d => String(d.id) !== String(id));
  renderDownloads();
  updateDownloadBadge();
}

function clearAllDownloads() {
  downloads = [];
  renderDownloads();
  updateDownloadBadge();
}

function updateDownloadBadge() {
  const activeDownloads = downloads.filter(d => d.state === 'progressing').length;
  downloadBadge.textContent = activeDownloads;
  downloadBadge.classList.toggle('hidden', activeDownloads === 0);
}

function openDownloadFolder(filePath) {
  ipcRenderer.invoke('open-download-folder', filePath);
}

// Open folder for downloads
ipcRenderer.on('open-folder', (event, folderPath) => {
  shell.openPath(folderPath);
});

// IPC handlers for window controls
ipcRenderer.on('window-maximized', () => {
  document.getElementById('maximize-btn').textContent = '❐';
});

ipcRenderer.on('window-unmaximized', () => {
  document.getElementById('maximize-btn').textContent = '□';
});

// ============================================
// События
// ============================================
function setupEventListeners() {
  // Кнопки навигации
  backBtn.addEventListener('click', () => {
    const webview = document.getElementById(`webview-${activeTabId}`);
    if (webview) webview.goBack();
  });
  
  forwardBtn.addEventListener('click', () => {
    const webview = document.getElementById(`webview-${activeTabId}`);
    if (webview) webview.goForward();
  });
  
  document.getElementById('refresh-btn').addEventListener('click', () => {
    const webview = document.getElementById(`webview-${activeTabId}`);
    if (webview) webview.reload();
  });
  
  document.getElementById('home-btn').addEventListener('click', () => {
    const webview = document.getElementById(`webview-${activeTabId}`);
    if (webview) webview.src = 'newtab.html';
  });
  
  // Новая вкладка
  document.getElementById('new-tab-btn').addEventListener('click', () => createTab());
  
  // Адресная строка
  addressBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      navigateTo(addressBar.value);
      hideAutocomplete();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
      if (items.length > 0) {
        autocompleteIndex = Math.min(autocompleteIndex + 1, items.length - 1);
        selectAutocompleteItem(autocompleteIndex);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      autocompleteIndex = Math.max(autocompleteIndex - 1, -1);
      selectAutocompleteItem(autocompleteIndex);
      if (autocompleteIndex === -1) {
        addressBar.value = addressBar.dataset.originalValue || '';
      } else {
        const item = autocompleteDropdown.querySelectorAll('.autocomplete-item')[autocompleteIndex];
        if (item) addressBar.value = item.dataset.url;
      }
    } else if (e.key === 'Escape') {
      hideAutocomplete();
    } else {
      addressBar.dataset.originalValue = addressBar.value;
      setTimeout(() => updateAutocomplete(addressBar.value), 100);
    }
  });
  
  addressBar.addEventListener('blur', () => {
    setTimeout(hideAutocomplete, 200);
  });
  
  addressBar.addEventListener('focus', () => {
    addressBar.select();
  });
  
  // Закладки
  bookmarkBtn.addEventListener('click', () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab || tab.url.includes('newtab.html')) return;
    
    const isBookmarked = bookmarks.some(b => b.url === tab.url);
    if (isBookmarked) {
      const bookmark = bookmarks.find(b => b.url === tab.url);
      removeBookmark(bookmark.id);
    } else {
      showBookmarkDialog();
    }
  });
  
  document.getElementById('add-bookmark-quick').addEventListener('click', showBookmarkDialog);
  
  // Диалог закладок
  document.getElementById('bookmark-save').addEventListener('click', () => {
    const title = document.getElementById('bookmark-title').value;
    const url = document.getElementById('bookmark-url').value;
    addBookmark(title, url);
    document.getElementById('bookmark-dialog').classList.add('hidden');
  });
  
  document.getElementById('bookmark-cancel').addEventListener('click', () => {
    document.getElementById('bookmark-dialog').classList.add('hidden');
  });
  
  // Загрузки
  document.getElementById('downloads-btn').addEventListener('click', () => {
    downloadsPanel.classList.toggle('hidden');
    historyPanel.classList.add('hidden');
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('close-downloads').addEventListener('click', () => {
    downloadsPanel.classList.add('hidden');
  });
  
  document.getElementById('clear-downloads').addEventListener('click', clearAllDownloads);
  
  document.getElementById('open-downloads-folder').addEventListener('click', async () => {
    const downloadPath = await ipcRenderer.invoke('get-downloads-path');
    shell.openPath(downloadPath);
  });
  
  // История
  document.getElementById('history-btn').addEventListener('click', () => {
    loadHistory();
    historyPanel.classList.toggle('hidden');
    downloadsPanel.classList.add('hidden');
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('close-history').addEventListener('click', () => {
    historyPanel.classList.add('hidden');
  });
  
  document.getElementById('history-search').addEventListener('input', (e) => {
    renderHistory(e.target.value);
  });
  
  document.getElementById('clear-all-history').addEventListener('click', () => {
    showConfirmDialog(
      'Очистить историю',
      'Вы уверены, что хотите удалить всю историю просмотров?',
      clearAllHistory
    );
  });
  
  // Инкогнито
  document.getElementById('incognito-btn').addEventListener('click', () => {
    ipcRenderer.invoke('open-incognito');
  });
  
  // Меню
  document.getElementById('menu-btn').addEventListener('click', () => {
    mainMenu.classList.toggle('hidden');
    downloadsPanel.classList.add('hidden');
    historyPanel.classList.add('hidden');
  });
  
  // Пункты меню
  document.getElementById('menu-new-tab').addEventListener('click', () => {
    createTab();
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('menu-new-incognito').addEventListener('click', () => {
    ipcRenderer.invoke('open-incognito');
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('menu-bookmarks').addEventListener('click', () => {
    const bar = document.getElementById('bookmarks-bar');
    bar.classList.toggle('hidden');
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('menu-history').addEventListener('click', () => {
    loadHistory();
    historyPanel.classList.remove('hidden');
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('menu-downloads').addEventListener('click', () => {
    downloadsPanel.classList.remove('hidden');
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('menu-zoom-in').addEventListener('click', () => {
    const webview = document.getElementById(`webview-${activeTabId}`);
    if (webview) {
      const current = webview.getZoomLevel();
      webview.setZoomLevel(current + 1);
    }
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('menu-zoom-out').addEventListener('click', () => {
    const webview = document.getElementById(`webview-${activeTabId}`);
    if (webview) {
      const current = webview.getZoomLevel();
      webview.setZoomLevel(current - 1);
    }
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('menu-zoom-reset').addEventListener('click', () => {
    const webview = document.getElementById(`webview-${activeTabId}`);
    if (webview) webview.setZoomLevel(0);
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('menu-settings').addEventListener('click', () => {
    ipcRenderer.invoke('open-settings');
    mainMenu.classList.add('hidden');
  });
  
  document.getElementById('menu-about').addEventListener('click', () => {
    alert('AIBrowser v1.0.0\nСовременный браузер на Electron\nС тёмной темой и красными акцентами');
    mainMenu.classList.add('hidden');
  });
  
  // Управление окном
  document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send('window-minimize');
  });
  
  document.getElementById('maximize-btn').addEventListener('click', () => {
    ipcRenderer.send('window-maximize');
  });
  
  document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('window-close');
  });
  
  // Закрытие меню по клику вне
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#main-menu') && !e.target.closest('#menu-btn')) {
      mainMenu.classList.add('hidden');
    }
  });
  
  // Контекстное меню
  setupContextMenu();
}

// ============================================
// Контекстное меню
// ============================================
function setupContextMenu() {
  const contextMenu = document.getElementById('context-menu');
  
  // Закрытие контекстного меню
  document.addEventListener('click', () => {
    contextMenu.classList.add('hidden');
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      contextMenu.classList.add('hidden');
    }
  });
}

// Показать контекстное меню для страницы
function showPageContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();
  
  const contextMenu = document.getElementById('context-menu');
  const contextMenuItems = document.getElementById('context-menu-items');
  const webview = document.getElementById(`webview-${activeTabId}`);
  
  if (!webview) return;
  
  const canGoBack = webview.canGoBack();
  const canGoForward = webview.canGoForward();
  
  const items = [
    { icon: '←', text: 'Назад', action: () => webview.goBack(), disabled: !canGoBack, shortcut: 'Alt+←' },
    { icon: '→', text: 'Вперёд', action: () => webview.goForward(), disabled: !canGoForward, shortcut: 'Alt+→' },
    { icon: '↻', text: 'Перезагрузить', action: () => webview.reload(), shortcut: 'F5' },
    { separator: true },
    { icon: '💾', text: 'Сохранить как...', action: () => webview.executeJavaScript('window.print()') },
    { icon: '🖨️', text: 'Печать...', action: () => webview.print() },
    { separator: true },
    { icon: '👁️', text: 'Смотреть код страницы', action: () => viewPageSource() }
  ];
  
  renderContextMenu(items, e.clientX, e.clientY);
}

// Показать контекстное меню для ссылки
function showLinkContextMenu(e, linkUrl, linkText) {
  e.preventDefault();
  e.stopPropagation();
  
  const items = [
    { icon: '🔗', text: 'Открыть ссылку в новой вкладке', action: () => createTab(linkUrl) },
    { icon: '🪟', text: 'Открыть ссылку в новом окне', action: () => ipcRenderer.invoke('open-new-window', linkUrl) },
    { separator: true },
    { icon: '💾', text: 'Сохранить ссылку как...', action: () => downloadLink(linkUrl, linkText) },
    { icon: '📋', text: 'Копировать адрес ссылки', action: () => copyToClipboard(linkUrl) }
  ];
  
  renderContextMenu(items, e.clientX, e.clientY);
}

// Показать контекстное меню для изображения
function showImageContextMenu(e, imageSrc) {
  e.preventDefault();
  e.stopPropagation();
  
  const items = [
    { icon: '🖼️', text: 'Открыть картинку в новой вкладке', action: () => createTab(imageSrc) },
    { icon: '💾', text: 'Сохранить картинку как...', action: () => downloadImage(imageSrc) },
    { separator: true },
    { icon: '📋', text: 'Копировать картинку', action: () => copyImage(imageSrc) },
    { icon: '🔗', text: 'Копировать адрес картинки', action: () => copyToClipboard(imageSrc) }
  ];
  
  renderContextMenu(items, e.clientX, e.clientY);
}

// Показать контекстное меню для выделенного текста
function showTextContextMenu(e, selectedText) {
  e.preventDefault();
  e.stopPropagation();
  
  const searchUrl = getSearchUrl(selectedText);
  const searchEngineName = getSearchEngineName();
  
  const items = [
    { icon: '📋', text: 'Копировать', action: () => copyToClipboard(selectedText), shortcut: 'Ctrl+C' },
    { separator: true },
    { icon: '🔍', text: `Найти «${truncateText(selectedText, 20)}» в ${searchEngineName}`, action: () => createTab(searchUrl) },
    { separator: true },
    { icon: '🖨️', text: 'Печать', action: () => window.print() }
  ];
  
  renderContextMenu(items, e.clientX, e.clientY);
}

// Показать контекстное меню для поля ввода
function showInputContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();
  
  const target = e.target;
  const hasSelection = target.selectionStart !== target.selectionEnd;
  const hasValue = target.value && target.value.length > 0;
  
  const items = [
    { icon: '✂️', text: 'Вырезать', action: () => document.execCommand('cut'), disabled: !hasSelection, shortcut: 'Ctrl+X' },
    { icon: '📋', text: 'Копировать', action: () => document.execCommand('copy'), disabled: !hasSelection, shortcut: 'Ctrl+C' },
    { icon: '📌', text: 'Вставить', action: () => document.execCommand('paste'), shortcut: 'Ctrl+V' },
    { separator: true },
    { icon: '☐', text: 'Выделить всё', action: () => target.select(), disabled: !hasValue, shortcut: 'Ctrl+A' }
  ];
  
  renderContextMenu(items, e.clientX, e.clientY);
}

// Показать контекстное меню для поля ввода в webview
function showInputContextMenuForWebview(e, params) {
  const hasSelection = params.selectionText && params.selectionText.length > 0;
  
  const items = [
    { icon: '✂️', text: 'Вырезать', action: () => e.sender.executeJavaScript('document.execCommand("cut")'), disabled: !hasSelection, shortcut: 'Ctrl+X' },
    { icon: '📋', text: 'Копировать', action: () => e.sender.executeJavaScript('document.execCommand("copy")'), disabled: !hasSelection, shortcut: 'Ctrl+C' },
    { icon: '📌', text: 'Вставить', action: () => e.sender.executeJavaScript('document.execCommand("paste")'), shortcut: 'Ctrl+V' },
    { separator: true },
    { icon: '☐', text: 'Выделить всё', action: () => e.sender.executeJavaScript('document.execCommand("selectAll")'), shortcut: 'Ctrl+A' }
  ];
  
  // Получаем координаты из события
  const rect = webviewContainer.getBoundingClientRect();
  renderContextMenu(items, rect.left + params.x, rect.top + params.y);
}

// Отрисовка контекстного меню
function renderContextMenu(items, x, y) {
  const contextMenu = document.getElementById('context-menu');
  const contextMenuItems = document.getElementById('context-menu-items');
  
  contextMenuItems.innerHTML = '';
  
  items.forEach(item => {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      contextMenuItems.appendChild(separator);
    } else {
      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu-item';
      if (item.disabled) {
        menuItem.classList.add('disabled');
      }
      
      menuItem.innerHTML = `
        <span class="icon">${item.icon}</span>
        <span class="text">${item.text}</span>
        ${item.shortcut ? `<span class="shortcut">${item.shortcut}</span>` : ''}
      `;
      
      if (!item.disabled) {
        menuItem.addEventListener('click', () => {
          item.action();
          contextMenu.classList.add('hidden');
        });
      }
      
      contextMenuItems.appendChild(menuItem);
    }
  });
  
  // Позиционирование меню
  const menuWidth = 280;
  const menuHeight = Math.min(items.length * 40, 400);
  
  let posX = x;
  let posY = y;
  
  // Проверка границ экрана
  if (posX + menuWidth > window.innerWidth) {
    posX = window.innerWidth - menuWidth - 10;
  }
  if (posY + menuHeight > window.innerHeight) {
    posY = window.innerHeight - menuHeight - 10;
  }
  
  contextMenu.style.left = `${posX}px`;
  contextMenu.style.top = `${posY}px`;
  contextMenu.classList.remove('hidden');
}

// Вспомогательные функции
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showNotification('Скопировано в буфер обмена');
  });
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function getSearchUrl(query) {
  const engines = {
    google: 'https://www.google.com/search?q=',
    yandex: 'https://yandex.ru/search/?text=',
    duckduckgo: 'https://duckduckgo.com/?q='
  };
  return (engines[settings.searchEngine] || engines.duckduckgo) + encodeURIComponent(query);
}
  
function getSearchEngineName() {
  const names = {
    google: 'Google',
    yandex: 'Яндексе',
    duckduckgo: 'DuckDuckGo'
  };
  return names[settings.searchEngine] || 'поиске';
}

function viewPageSource() {
  const webview = document.getElementById(`webview-${activeTabId}`);
  if (webview) {
    const currentUrl = webview.getURL();
    createTab('view-source:' + currentUrl);
  }
}

function downloadLink(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  a.click();
}

function downloadImage(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = 'image';
  a.click();
}

function copyImage(url) {
  // Для копирования изображения нужно использовать canvas
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => {
      navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]).then(() => {
        showNotification('Картинка скопирована');
      });
    });
  };
  img.src = url;
}

// ============================================
// Горячие клавиши
// ============================================
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 't':
          e.preventDefault();
          createTab();
          break;
        case 'w':
          e.preventDefault();
          closeTab(activeTabId);
          break;
        case 'h':
          e.preventDefault();
          loadHistory();
          historyPanel.classList.remove('hidden');
          break;
        case 'b':
          e.preventDefault();
          document.getElementById('bookmarks-bar').classList.toggle('hidden');
          break;
        case 'l':
          e.preventDefault();
          addressBar.focus();
          addressBar.select();
          break;
        case 'r':
          e.preventDefault();
          const webview = document.getElementById(`webview-${activeTabId}`);
          if (webview) webview.reload();
          break;
      }
      
      if (e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        ipcRenderer.invoke('open-incognito');
      }
    }
    
    // F5 - обновить
    if (e.key === 'F5') {
      e.preventDefault();
      const webview = document.getElementById(`webview-${activeTabId}`);
      if (webview) webview.reload();
    }
    
    // Alt+Left/Right - назад/вперёд
    if (e.altKey) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const webview = document.getElementById(`webview-${activeTabId}`);
        if (webview) webview.goBack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const webview = document.getElementById(`webview-${activeTabId}`);
        if (webview) webview.goForward();
      }
    }
    
    // Ctrl+C/X/V/A для активного элемента
    if (e.ctrlKey || e.metaKey) {
      const activeElement = document.activeElement;
      
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
        // Стандартные действия работают автоматически для полей ввода
        // Дополнительная логика не требуется
      } else if (e.key.toLowerCase() === 'c') {
        // Копирование выделенного текста из webview
        e.preventDefault();
        const webview = document.getElementById(`webview-${activeTabId}`);
        if (webview) {
          webview.executeJavaScript('window.getSelection().toString()').then(selectedText => {
            if (selectedText) {
              navigator.clipboard.writeText(selectedText);
              showNotification('Текст скопирован');
            }
          });
        }
      }
    }
  });
}

// ============================================
// IPC обработчики
// ============================================
ipcRenderer.on('set-incognito-mode', () => {
  isIncognito = true;
  document.body.classList.add('incognito-mode');
  document.querySelector('#titlebar').classList.add('incognito-indicator');
  
  // Добавляем индикатор инкогнито
  const indicator = document.createElement('div');
  indicator.className = 'incognito-badge';
  indicator.innerHTML = '👤 Режим инкогнито';
  document.getElementById('tabs-container').appendChild(indicator);
});

ipcRenderer.on('load-settings', (event, loadedSettings) => {
  settings = { ...settings, ...loadedSettings };
  applyTheme(settings.theme);
});

ipcRenderer.on('settings-changed', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  applyTheme(settings.theme);
});

ipcRenderer.on('new-tab-request', (event, url) => {
  createTab(url);
});

ipcRenderer.on('load-url', (event, url) => {
  // Ждём создания webview и затем загружаем URL
  setTimeout(() => {
    const webview = document.getElementById(`webview-${activeTabId}`);
    if (webview && url) {
      webview.src = url;
    }
  }, 100);
});

// Обработка загрузок
ipcRenderer.on('download-started', (event, download) => {
  console.log('Download started:', download);
  addOrUpdateDownload({ ...download, state: 'progressing' });
  // Автоматически открываем панель загрузок
  downloadsPanel.classList.remove('hidden');
  historyPanel.classList.add('hidden');
  mainMenu.classList.add('hidden');
});

ipcRenderer.on('download-progress', (event, download) => {
  addOrUpdateDownload(download);
});

ipcRenderer.on('download-complete', (event, download) => {
  addOrUpdateDownload(download);
  showNotification(download.state === 'completed' 
    ? `✓ Загружено: ${download.fileName}` 
    : `✗ Ошибка загрузки: ${download.fileName}`);
  updateDownloadBadge();
});

// ============================================
// Вспомогательные функции
// ============================================
function applyTheme(theme) {
  document.body.classList.remove('dark-theme', 'light-theme');
  document.body.classList.add(`${theme}-theme`);
}

function showConfirmDialog(title, message, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-dialog').classList.remove('hidden');
  
  const yesBtn = document.getElementById('confirm-yes');
  const noBtn = document.getElementById('confirm-no');
  
  const handleYes = () => {
    onConfirm();
    document.getElementById('confirm-dialog').classList.add('hidden');
    yesBtn.removeEventListener('click', handleYes);
    noBtn.removeEventListener('click', handleNo);
  };
  
  const handleNo = () => {
    document.getElementById('confirm-dialog').classList.add('hidden');
    yesBtn.removeEventListener('click', handleYes);
    noBtn.removeEventListener('click', handleNo);
  };
  
  yesBtn.addEventListener('click', handleYes);
  noBtn.addEventListener('click', handleNo);
}

function showNotification(message) {
  // Можно добавить тост-уведомления
  statusText.textContent = message;
  setTimeout(() => {
    statusText.textContent = 'Готово';
  }, 3000);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) {
    return 'Сегодня';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Вчера';
  } else {
    return date.toLocaleDateString('ru-RU', { 
      day: 'numeric', 
      month: 'long',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
    });
  }
}

function formatTime(date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
