// Service worker for handling downloads

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadFiles') {
    downloadFiles(request.files);
    sendResponse({ success: true });
  }
  return true;
});

// Download multiple files
async function downloadFiles(files) {
  for (const file of files) {
    try {
      await downloadFile(file);
      // Small delay between downloads to avoid overwhelming the browser
      await sleep(200);
    } catch (error) {
      console.error(`Failed to download ${file.filename}:`, error);
    }
  }
}

// Download a single file
function downloadFile(file) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: file.url,
      filename: sanitizeFilename(file.filename),
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(downloadId);
      }
    });
  });
}

// Sanitize filename to remove invalid characters
function sanitizeFilename(filename) {
  // Remove or replace characters that are invalid in filenames
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200); // Limit filename length
}

// Helper sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Track download progress (optional enhancement)
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state) {
    if (delta.state.current === 'complete') {
      console.log(`Download ${delta.id} completed`);
    } else if (delta.state.current === 'interrupted') {
      console.log(`Download ${delta.id} failed:`, delta.error);
    }
  }
});
