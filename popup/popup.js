// File type definitions
const FILE_TYPES = {
  images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods'],
  videos: ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2']
};

// File type icons
const FILE_ICONS = {
  images: '🖼️',
  documents: '📄',
  videos: '🎬',
  audio: '🎵',
  archives: '📦',
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

// Scan the current page for files
async function scanPage() {
  scanBtn.disabled = true;
  scanBtn.classList.add('scanning');
  scanBtn.innerHTML = '<span class="icon">⏳</span> Scanning...';

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
    scanBtn.disabled = false;
    scanBtn.classList.remove('scanning');
    scanBtn.innerHTML = '<span class="icon">🔍</span> Scan Page';
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

  downloadBtn.disabled = true;
  downloadBtn.innerHTML = '<span class="icon">⏳</span> Downloading...';

  try {
    // Send download request to background script
    await chrome.runtime.sendMessage({
      action: 'downloadFiles',
      files: selectedFiles
    });

    downloadBtn.innerHTML = '<span class="icon">✓</span> Downloads Started!';

    setTimeout(() => {
      downloadBtn.innerHTML = `<span class="icon">⬇</span> Download Selected (<span id="selectedCount">${selectedFiles.length}</span>)`;
      downloadBtn.disabled = false;
    }, 2000);
  } catch (error) {
    console.error('Download error:', error);
    downloadBtn.innerHTML = '<span class="icon">✗</span> Error';

    setTimeout(() => {
      downloadBtn.innerHTML = `<span class="icon">⬇</span> Download Selected (<span id="selectedCount">${selectedFiles.length}</span>)`;
      downloadBtn.disabled = false;
    }, 2000);
  }
}
