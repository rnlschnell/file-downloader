// File type definitions
const FILE_TYPES = {
  images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods'],
  videos: ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
  fonts: ['ttf', 'otf', 'woff', 'woff2', 'eot'],
  downloads: ['download']
};

// File type icons
const FILE_ICONS = {
  images: '🖼️',
  documents: '📄',
  videos: '🎬',
  audio: '🎵',
  archives: '📦',
  fonts: '🔤',
  downloads: '⬇️',
  default: '📎'
};

// State
let files = [];
let filteredFiles = [];

// DOM Elements
const scanBtn = document.getElementById('scanBtn');
const filterType = document.getElementById('filterType');
const selectAllBtn = document.getElementById('selectAll');
const deselectAllBtn = document.getElementById('deselectAll');
const fileCount = document.getElementById('fileCount');
const fileList = document.getElementById('fileList');
const downloadBtn = document.getElementById('downloadBtn');
const selectedCount = document.getElementById('selectedCount');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  scanBtn.addEventListener('click', scanPage);
  filterType.addEventListener('change', applyFilter);
  selectAllBtn.addEventListener('click', selectAll);
  deselectAllBtn.addEventListener('click', deselectAll);
  downloadBtn.addEventListener('click', downloadSelected);
});

// Set button loading state
function setButtonLoading(button, isLoading) {
  const btnText = button.querySelector('.btn-text');
  const btnLoading = button.querySelector('.btn-loading');

  if (isLoading) {
    button.disabled = true;
    button.classList.add('scanning');
    if (btnText) btnText.classList.add('hidden');
    if (btnLoading) btnLoading.classList.remove('hidden');
  } else {
    button.disabled = false;
    button.classList.remove('scanning');
    if (btnText) btnText.classList.remove('hidden');
    if (btnLoading) btnLoading.classList.add('hidden');
  }
}

// Scan the current page for files
async function scanPage() {
  setButtonLoading(scanBtn, true);

  try {
    // Get the current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Execute content script to scan for files
    const results = await chrome.tabs.sendMessage(tab.id, { action: 'scanFiles' });

    if (results && results.files) {
      files = results.files;
      filteredFiles = [...files];
      renderFiles();
    } else {
      showEmptyState('No downloadable files found on this page');
    }
  } catch (error) {
    console.error('Scan error:', error);
    showEmptyState('Error scanning page. Try refreshing the page.');
  } finally {
    setButtonLoading(scanBtn, false);
  }
}

// Get file category
function getFileCategory(extension) {
  for (const [category, extensions] of Object.entries(FILE_TYPES)) {
    if (extensions.includes(extension.toLowerCase())) {
      return category;
    }
  }
  return 'default';
}

// Apply filter
function applyFilter() {
  const filter = filterType.value;

  if (filter === 'all') {
    filteredFiles = [...files];
  } else {
    const extensions = FILE_TYPES[filter] || [];
    filteredFiles = files.filter(file => extensions.includes(file.extension.toLowerCase()));
  }

  renderFiles();
}

// Render files list
function renderFiles() {
  if (filteredFiles.length === 0) {
    showEmptyState('No files match the current filter');
    return;
  }

  fileList.innerHTML = filteredFiles.map((file, index) => {
    const category = getFileCategory(file.extension);
    const icon = FILE_ICONS[category] || FILE_ICONS.default;

    return `
      <div class="file-item" data-index="${index}">
        <input type="checkbox" id="file-${index}" ${file.selected ? 'checked' : ''}>
        <div class="file-icon">${icon}</div>
        <div class="file-info">
          <div class="file-name" title="${file.filename}">${file.filename}</div>
          <div class="file-meta">
            <span class="file-type">${file.extension}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add checkbox listeners
  fileList.querySelectorAll('input[type="checkbox"]').forEach((checkbox, index) => {
    checkbox.addEventListener('change', (e) => {
      filteredFiles[index].selected = e.target.checked;
      // Also update in the main files array
      const fileUrl = filteredFiles[index].url;
      const mainIndex = files.findIndex(f => f.url === fileUrl);
      if (mainIndex !== -1) {
        files[mainIndex].selected = e.target.checked;
      }
      updateSelectedCount();
    });
  });

  updateFileCount();
  updateSelectedCount();
}

// Show empty state
function showEmptyState(message) {
  fileList.innerHTML = `<div class="empty-state"><p>${message}</p></div>`;
  fileCount.textContent = '0 files found';
  updateSelectedCount();
}

// Update file count display
function updateFileCount() {
  fileCount.textContent = `${filteredFiles.length} file${filteredFiles.length !== 1 ? 's' : ''} found`;
}

// Update selected count and download button
function updateSelectedCount() {
  const count = files.filter(f => f.selected).length;
  selectedCount.textContent = count;
  downloadBtn.disabled = count === 0;
}

// Select all visible files
function selectAll() {
  filteredFiles.forEach(file => {
    file.selected = true;
    const mainIndex = files.findIndex(f => f.url === file.url);
    if (mainIndex !== -1) {
      files[mainIndex].selected = true;
    }
  });
  renderFiles();
}

// Deselect all files
function deselectAll() {
  files.forEach(file => file.selected = false);
  renderFiles();
}

// Download selected files
async function downloadSelected() {
  const selectedFiles = files.filter(f => f.selected);

  if (selectedFiles.length === 0) return;

  setButtonLoading(downloadBtn, true);

  try {
    // Send download request to background script
    await chrome.runtime.sendMessage({
      action: 'downloadFiles',
      files: selectedFiles
    });

    // Show success state briefly
    const btnText = downloadBtn.querySelector('.btn-text');
    const btnLoading = downloadBtn.querySelector('.btn-loading');

    if (btnLoading) btnLoading.classList.add('hidden');
    if (btnText) {
      btnText.innerHTML = `
        <svg viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/>
        </svg>
        Downloads Started!
      `;
      btnText.classList.remove('hidden');
    }

    setTimeout(() => {
      resetDownloadButton();
    }, 2000);
  } catch (error) {
    console.error('Download error:', error);

    const btnText = downloadBtn.querySelector('.btn-text');
    const btnLoading = downloadBtn.querySelector('.btn-loading');

    if (btnLoading) btnLoading.classList.add('hidden');
    if (btnText) {
      btnText.innerHTML = `
        <svg viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/>
        </svg>
        Error
      `;
      btnText.classList.remove('hidden');
    }

    setTimeout(() => {
      resetDownloadButton();
    }, 2000);
  }
}

// Reset download button to default state
function resetDownloadButton() {
  const btnText = downloadBtn.querySelector('.btn-text');
  const count = files.filter(f => f.selected).length;

  if (btnText) {
    btnText.innerHTML = `
      <svg viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z"/>
        <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z"/>
      </svg>
      Download Selected (<span id="selectedCount">${count}</span>)
    `;
  }

  downloadBtn.disabled = count === 0;
  downloadBtn.classList.remove('scanning');
}
