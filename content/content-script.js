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
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot'
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
    } else {
      // Check for download links without obvious extensions
      const downloadInfo = detectDownloadLink(anchor, href);
      if (downloadInfo) {
        files.set(href, downloadInfo);
      }
    }
  });
}

// Detect download links that don't have obvious file extensions
function detectDownloadLink(anchor, href) {
  try {
    const urlObj = new URL(href, window.location.href);
    const pathname = urlObj.pathname.toLowerCase();
    const anchorText = anchor.textContent.toLowerCase().trim();

    // Check for download attribute (explicit download intent)
    if (anchor.hasAttribute('download')) {
      const downloadAttr = anchor.getAttribute('download');
      const filename = downloadAttr || extractFilenameFromUrl(href) || 'download';
      return {
        url: href,
        filename: filename,
        extension: 'download',
        isInferredDownload: true
      };
    }

    // Check for download-related keywords in URL path
    const downloadPathPatterns = ['/download', '/get/', '/fetch/', '/file/', '/files/', '/dl/', '/d/'];
    const hasDownloadPath = downloadPathPatterns.some(pattern => pathname.includes(pattern));

    // Check for download-related keywords in link text
    const downloadTextPatterns = ['download', 'get file', 'save', 'export'];
    const hasDownloadText = downloadTextPatterns.some(pattern => anchorText.includes(pattern));

    // Check for download-related classes or data attributes
    const hasDownloadClass = anchor.className.toLowerCase().includes('download');
    const hasDownloadData = Array.from(anchor.attributes).some(attr =>
      attr.name.startsWith('data-') && attr.value.toLowerCase().includes('download')
    );

    if (hasDownloadPath || hasDownloadText || hasDownloadClass || hasDownloadData) {
      const filename = extractFilenameFromUrl(href) || anchorText.substring(0, 50) || 'download';
      return {
        url: href,
        filename: filename,
        extension: 'download',
        isInferredDownload: true
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

// Extract a reasonable filename from URL
function extractFilenameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(p => p);
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart && lastPart.length > 0 && lastPart.length < 100) {
      return decodeURIComponent(lastPart);
    }
    return null;
  } catch (e) {
    return null;
  }
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
