// Content script for scanning downloadable files on the page

// Supported file extensions
const SUPPORTED_EXTENSIONS = [
  // Images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods',
  // Videos
  'mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv',
  // Audio
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
  // Archives
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2'
];

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scanFiles') {
    const files = scanForFiles();
    sendResponse({ files });
  }
  return true; // Keep the message channel open for async response
});

// Main scanning function
function scanForFiles() {
  const files = new Map(); // Use Map to deduplicate by URL

  // Scan anchor tags
  scanAnchorTags(files);

  // Scan image tags
  scanImageTags(files);

  // Scan video/audio source tags
  scanMediaTags(files);

  // Scan object/embed tags
  scanEmbedTags(files);

  // Convert Map to array and add metadata
  return Array.from(files.values()).map(file => ({
    ...file,
    selected: false
  }));
}

// Scan <a> tags for downloadable links
function scanAnchorTags(files) {
  const anchors = document.querySelectorAll('a[href]');

  anchors.forEach(anchor => {
    const href = anchor.href;
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;

    const fileInfo = extractFileInfo(href);
    if (fileInfo && isSupported(fileInfo.extension)) {
      files.set(href, fileInfo);
    }
  });
}

// Scan <img> tags
function scanImageTags(files) {
  const images = document.querySelectorAll('img[src]');

  images.forEach(img => {
    const src = img.src;
    if (!src || src.startsWith('data:')) return;

    const fileInfo = extractFileInfo(src);
    if (fileInfo && isSupported(fileInfo.extension)) {
      files.set(src, fileInfo);
    }
  });

  // Also check srcset
  const imagesWithSrcset = document.querySelectorAll('img[srcset]');
  imagesWithSrcset.forEach(img => {
    const srcset = img.srcset;
    const urls = parseSrcset(srcset);
    urls.forEach(url => {
      const fileInfo = extractFileInfo(url);
      if (fileInfo && isSupported(fileInfo.extension)) {
        files.set(url, fileInfo);
      }
    });
  });
}

// Scan <video> and <audio> tags
function scanMediaTags(files) {
  const mediaElements = document.querySelectorAll('video[src], audio[src], video source[src], audio source[src]');

  mediaElements.forEach(el => {
    const src = el.src;
    if (!src) return;

    const fileInfo = extractFileInfo(src);
    if (fileInfo && isSupported(fileInfo.extension)) {
      files.set(src, fileInfo);
    }
  });
}

// Scan <object> and <embed> tags
function scanEmbedTags(files) {
  const objects = document.querySelectorAll('object[data], embed[src]');

  objects.forEach(el => {
    const src = el.data || el.src;
    if (!src) return;

    const fileInfo = extractFileInfo(src);
    if (fileInfo && isSupported(fileInfo.extension)) {
      files.set(src, fileInfo);
    }
  });
}

// Extract file information from URL
function extractFileInfo(url) {
  try {
    const urlObj = new URL(url, window.location.href);
    const pathname = urlObj.pathname;

    // Get filename from path
    const pathParts = pathname.split('/');
    let filename = pathParts[pathParts.length - 1] || '';

    // Decode URL-encoded characters
    filename = decodeURIComponent(filename);

    // Remove query parameters from filename display
    const filenameWithoutQuery = filename.split('?')[0];

    // Extract extension
    const extensionMatch = filenameWithoutQuery.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';

    if (!extension) {
      // Try to get extension from URL query params (some CDNs use this)
      const formatParam = urlObj.searchParams.get('format') || urlObj.searchParams.get('ext');
      if (formatParam && isSupported(formatParam.toLowerCase())) {
        return {
          url: urlObj.href,
          filename: filenameWithoutQuery || 'file',
          extension: formatParam.toLowerCase()
        };
      }
      return null;
    }

    return {
      url: urlObj.href,
      filename: filenameWithoutQuery || `file.${extension}`,
      extension
    };
  } catch (e) {
    return null;
  }
}

// Parse srcset attribute
function parseSrcset(srcset) {
  const urls = [];
  const parts = srcset.split(',');

  parts.forEach(part => {
    const trimmed = part.trim();
    const url = trimmed.split(/\s+/)[0];
    if (url) {
      try {
        const fullUrl = new URL(url, window.location.href).href;
        urls.push(fullUrl);
      } catch (e) {
        // Invalid URL, skip
      }
    }
  });

  return urls;
}

// Check if extension is supported
function isSupported(extension) {
  return SUPPORTED_EXTENSIONS.includes(extension.toLowerCase());
}
