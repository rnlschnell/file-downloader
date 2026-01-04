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
let currentTabId = null;

// DOM Elements
const filterType = document.getElementById('filterType');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const fileCount = document.getElementById('fileCount');
const fileList = document.getElementById('fileList');
const downloadBtn = document.getElementById('downloadBtn');
const selectedCount = document.getElementById('selectedCount');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  filterType.addEventListener('change', applyFilter);
  selectAllCheckbox.addEventListener('change', toggleSelectAll);
  downloadBtn.addEventListener('click', downloadSelected);

  // Listen for file updates from content script (live scan)
  chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.action === 'filesChanged' && sender.tab?.id === currentTabId) {
      handleFilesChanged(request.files);
    }
  });

  // Auto-scan on popup open
  scanPage();
});

// Handle files changed from live scan
function handleFilesChanged(newFiles) {
  // Preserve selection state from existing files
  const selectionMap = new Map(files.map(f => [f.url, f.selected]));

  files = newFiles.map(file => ({
    ...file,
    selected: selectionMap.get(file.url) || false
  }));

  applyFilter();

  // Show a subtle indicator that files were updated
  fileCount.classList.add('updated');
  setTimeout(() => fileCount.classList.remove('updated'), 1000);
}

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
  showLoadingState('Scanning page...');

  try {
    // Get the current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;

    // Execute content script to scan for files
    const results = await chrome.tabs.sendMessage(tab.id, { action: 'scanFiles' });

    if (results && results.files && results.files.length > 0) {
      // Show files immediately
      files = results.files;
      filteredFiles = [...files];
      renderFiles();

      // Then enrich files with HEAD request metadata in the background
      enrichFiles(files);
    } else {
      showEmptyState('No downloadable files found on this page');
    }

    // Enable live scanning to detect dynamically loaded content
    enableLiveScan();
  } catch (error) {
    console.error('Scan error:', error);
    showEmptyState('Error scanning page. Try refreshing.');
  }
}

// Enable live scanning for dynamic content
async function enableLiveScan() {
  if (!currentTabId) return;

  try {
    await chrome.tabs.sendMessage(currentTabId, { action: 'enableLiveScan' });
  } catch (error) {
    // Silently fail - live scan is a nice-to-have
    console.warn('Could not enable live scan:', error.message);
  }
}

// Enrich files with metadata from HEAD requests
async function enrichFiles(filesToEnrich) {
  // Only enrich files that need it (inferred downloads, missing extensions, etc.)
  const filesNeedingEnrichment = filesToEnrich.filter(f =>
    f.isInferredDownload ||
    f.extension === 'download' ||
    !f.extension ||
    f.filename === 'file' ||
    f.filename.match(/^[a-f0-9-]{32,}$/i) // UUID-like filenames
  );

  if (filesNeedingEnrichment.length === 0) return;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'enrichFiles',
      files: filesNeedingEnrichment
    });

    if (response && response.files) {
      // Update files with enriched data
      const enrichedMap = new Map(response.files.map(f => [f.url, f]));

      files = files.map(file => {
        const enriched = enrichedMap.get(file.url);
        if (enriched) {
          return {
            ...file,
            ...enriched,
            selected: file.selected // Preserve selection
          };
        }
        return file;
      });

      // Re-apply filter and re-render
      applyFilter();
    }
  } catch (error) {
    console.error('Failed to enrich files:', error);
  } finally {
    updateFileCount();
  }
}

// Show loading state
function showLoadingState(message) {
  fileList.innerHTML = `
    <div class="empty-state loading">
      <span class="spinner"></span>
      <p>${message}</p>
    </div>
  `;
  fileCount.textContent = 'Scanning...';
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

// Format file size for display
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '';

  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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
    const sizeDisplay = file.size ? formatFileSize(file.size) : '';
    const enrichedClass = file.enriched ? 'enriched' : '';
    const inferredClass = file.isInferredDownload ? 'inferred' : '';

    return `
      <div class="file-item ${enrichedClass} ${inferredClass}" data-index="${index}">
        <input type="checkbox" id="file-${index}" ${file.selected ? 'checked' : ''}>
        <div class="file-icon">${icon}</div>
        <div class="file-info">
          <div class="file-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</div>
          <div class="file-meta">
            <span class="file-type">${file.extension}</span>
            ${sizeDisplay ? `<span class="file-size">${sizeDisplay}</span>` : ''}
            ${file.enriched ? '<span class="enriched-badge" title="Filename resolved from server">✓</span>' : ''}
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

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  updateSelectAllCheckbox();
}

// Toggle select all based on checkbox state
function toggleSelectAll() {
  const shouldSelect = selectAllCheckbox.checked;

  filteredFiles.forEach(file => {
    file.selected = shouldSelect;
    const mainIndex = files.findIndex(f => f.url === file.url);
    if (mainIndex !== -1) {
      files[mainIndex].selected = shouldSelect;
    }
  });

  renderFiles();
}

// Update the select all checkbox state based on current selection
function updateSelectAllCheckbox() {
  const visibleSelected = filteredFiles.filter(f => f.selected).length;
  const totalVisible = filteredFiles.length;

  if (totalVisible === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else if (visibleSelected === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else if (visibleSelected === totalVisible) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = true;
  }
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
    const btnIcon = downloadBtn.querySelector(':scope > svg');
    const btnLoading = downloadBtn.querySelector('.btn-loading');

    if (btnLoading) btnLoading.classList.add('hidden');
    if (btnText) {
      btnText.textContent = 'Downloads Started!';
      btnText.classList.remove('hidden');
    }
    if (btnIcon) {
      btnIcon.innerHTML = `<path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/>`;
    }

    setTimeout(() => {
      resetDownloadButton();
    }, 2000);
  } catch (error) {
    console.error('Download error:', error);

    const btnText = downloadBtn.querySelector('.btn-text');
    const btnIcon = downloadBtn.querySelector(':scope > svg');
    const btnLoading = downloadBtn.querySelector('.btn-loading');

    if (btnLoading) btnLoading.classList.add('hidden');
    if (btnText) {
      btnText.textContent = 'Error';
      btnText.classList.remove('hidden');
    }
    if (btnIcon) {
      btnIcon.innerHTML = `<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/>`;
    }

    setTimeout(() => {
      resetDownloadButton();
    }, 2000);
  }
}

// Reset download button to default state
function resetDownloadButton() {
  const btnText = downloadBtn.querySelector('.btn-text');
  const btnIcon = downloadBtn.querySelector(':scope > svg');
  const count = files.filter(f => f.selected).length;

  if (btnText) {
    btnText.textContent = `Download Selected (${count})`;
  }

  // Restore the download icon
  if (btnIcon) {
    btnIcon.innerHTML = `
      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z"/>
      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z"/>
    `;
  }

  downloadBtn.disabled = count === 0;
  downloadBtn.classList.remove('scanning');
}
