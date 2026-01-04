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

// MIME type to extension mapping for Content-Type detection
const MIME_TO_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'application/rtf': 'rtf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/x-flv': 'flv',
  'video/x-ms-wmv': 'wmv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
  'application/x-tar': 'tar',
  'application/gzip': 'gz',
  'application/x-bzip2': 'bz2',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'application/vnd.ms-fontobject': 'eot',
  'application/octet-stream': null // Generic binary - need filename to determine
};

// State for live scanning
let liveScanEnabled = false;
let observer = null;
let pendingChanges = false;
let debounceTimer = null;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scanFiles') {
    const files = scanForFiles();
    sendResponse({ files });
  } else if (request.action === 'enableLiveScan') {
    enableLiveScan();
    sendResponse({ success: true });
  } else if (request.action === 'disableLiveScan') {
    disableLiveScan();
    sendResponse({ success: true });
  } else if (request.action === 'getLiveScanStatus') {
    sendResponse({ enabled: liveScanEnabled });
  }
  return true; // Keep the message channel open for async response
});

// Enable MutationObserver for dynamic content detection
function enableLiveScan() {
  if (observer) return; // Already enabled

  liveScanEnabled = true;

  observer = new MutationObserver((mutations) => {
    // Check if any mutations contain relevant elements
    let hasRelevantChanges = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        // Check added nodes for downloadable content
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (isRelevantElement(node) || hasRelevantDescendants(node)) {
              hasRelevantChanges = true;
              break;
            }
          }
        }
      } else if (mutation.type === 'attributes') {
        // Check if attribute changes affect href, src, etc.
        const relevantAttrs = ['href', 'src', 'srcset', 'data', 'download'];
        if (relevantAttrs.includes(mutation.attributeName)) {
          hasRelevantChanges = true;
        }
      }

      if (hasRelevantChanges) break;
    }

    if (hasRelevantChanges) {
      // Debounce to avoid excessive scanning
      pendingChanges = true;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (pendingChanges) {
          pendingChanges = false;
          // Notify popup that new files may be available
          chrome.runtime.sendMessage({
            action: 'filesChanged',
            files: scanForFiles()
          }).catch(() => {
            // Popup might be closed, ignore error
          });
        }
      }, 500); // 500ms debounce
    }
  });

  // Observe the entire document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href', 'src', 'srcset', 'data', 'download']
  });
}

// Disable MutationObserver
function disableLiveScan() {
  liveScanEnabled = false;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  clearTimeout(debounceTimer);
  pendingChanges = false;
}

// Check if element is relevant for file scanning
function isRelevantElement(element) {
  const tagName = element.tagName?.toLowerCase();
  const relevantTags = ['a', 'img', 'video', 'audio', 'source', 'object', 'embed'];
  return relevantTags.includes(tagName);
}

// Check if element has relevant descendants
function hasRelevantDescendants(element) {
  if (!element.querySelectorAll) return false;
  const relevant = element.querySelectorAll('a[href], img[src], video[src], audio[src], source[src], object[data], embed[src]');
  return relevant.length > 0;
}

// Main scanning function
function scanForFiles() {
  const files = new Map(); // Use Map to deduplicate by URL

  // Get all roots to scan (document + all shadow roots)
  const roots = getAllRoots(document);

  for (const root of roots) {
    // Scan anchor tags
    scanAnchorTags(files, root);

    // Scan image tags
    scanImageTags(files, root);

    // Scan video/audio source tags
    scanMediaTags(files, root);

    // Scan object/embed tags
    scanEmbedTags(files, root);
  }

  // Also scan iframes (same-origin only)
  scanIframes(files);

  // Convert Map to array and add metadata
  return Array.from(files.values()).map(file => ({
    ...file,
    selected: false
  }));
}

// Recursively get all shadow roots in the document
function getAllRoots(root, collected = []) {
  collected.push(root);

  // Find all elements that might have shadow roots
  const allElements = root.querySelectorAll ? root.querySelectorAll('*') : [];

  for (const element of allElements) {
    // Check for open shadow roots
    if (element.shadowRoot) {
      getAllRoots(element.shadowRoot, collected);
    }
  }

  return collected;
}

// Scan same-origin iframes
function scanIframes(files) {
  const iframes = document.querySelectorAll('iframe');

  for (const iframe of iframes) {
    try {
      // This will throw for cross-origin iframes (which is expected)
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const iframeRoots = getAllRoots(iframeDoc);
        for (const root of iframeRoots) {
          scanAnchorTags(files, root);
          scanImageTags(files, root);
          scanMediaTags(files, root);
          scanEmbedTags(files, root);
        }
      }
    } catch (e) {
      // Cross-origin iframe, skip silently
    }
  }
}

// Scan <a> tags for downloadable links
function scanAnchorTags(files, root = document) {
  const anchors = root.querySelectorAll('a[href]');

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
    const anchorText = anchor.textContent.trim();

    // Check for download attribute (explicit download intent)
    if (anchor.hasAttribute('download')) {
      const downloadAttr = anchor.getAttribute('download');
      const filename = downloadAttr || extractBestFilename(anchor, href);
      return {
        url: href,
        filename: filename,
        extension: extractExtensionFromFilename(filename),
        isInferredDownload: true
      };
    }

    // Check for download-related keywords in URL path
    const downloadPathPatterns = ['/download', '/get/', '/fetch/', '/file/', '/files/', '/dl/', '/d/'];
    const hasDownloadPath = downloadPathPatterns.some(pattern => pathname.includes(pattern));

    // Check for download-related keywords in link text
    const anchorTextLower = anchorText.toLowerCase();
    const downloadTextPatterns = ['download', 'get file', 'save', 'export'];
    const hasDownloadText = downloadTextPatterns.some(pattern => anchorTextLower.includes(pattern));

    // Check for download-related classes or data attributes
    const hasDownloadClass = anchor.className.toLowerCase().includes('download');
    const hasDownloadData = Array.from(anchor.attributes).some(attr =>
      attr.name.startsWith('data-') && attr.value.toLowerCase().includes('download')
    );

    if (hasDownloadPath || hasDownloadText || hasDownloadClass || hasDownloadData) {
      const filename = extractBestFilename(anchor, href);
      return {
        url: href,
        filename: filename,
        extension: extractExtensionFromFilename(filename),
        isInferredDownload: true
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

// Extract the best filename from anchor context
function extractBestFilename(anchor, href) {
  // 1. Try title attribute (but skip if it's just a file size like "144 K")
  const title = anchor.getAttribute('title');
  if (title && isUsefulFilename(title) && !title.match(/^\d+\s*[KMG]?B?$/i)) {
    return cleanFilename(title);
  }

  // 2. Try data-filename or similar attributes
  for (const attr of anchor.attributes) {
    if (attr.name.includes('filename') || attr.name.includes('name')) {
      if (attr.value && isUsefulFilename(attr.value)) {
        return cleanFilename(attr.value);
      }
    }
  }

  // 3. Try anchor text (often contains the actual name like "Roboto Bold")
  const anchorText = anchor.textContent.trim();
  if (isUsefulFilename(anchorText)) {
    return cleanFilename(anchorText);
  }

  // 4. Try aria-label
  const ariaLabel = anchor.getAttribute('aria-label');
  if (ariaLabel && isUsefulFilename(ariaLabel)) {
    return cleanFilename(ariaLabel);
  }

  // 5. Check URL query parameters for filename hints
  const queryFilename = extractFilenameFromQuery(href);
  if (queryFilename) {
    return queryFilename;
  }

  // 6. Look for nearby context (parent element text, nearby headings)
  const contextFilename = extractFilenameFromContext(anchor);
  if (contextFilename) {
    return contextFilename;
  }

  // 7. Try page title or main heading as last resort
  const pageFilename = extractFilenameFromPage();
  if (pageFilename) {
    return pageFilename;
  }

  // 8. Fall back to URL path extraction
  const urlFilename = extractFilenameFromUrl(href);
  if (urlFilename && isUsefulFilename(urlFilename)) {
    return urlFilename;
  }

  return 'download';
}

// Extract filename from URL query parameters
function extractFilenameFromQuery(href) {
  try {
    const url = new URL(href, window.location.href);

    // Common parameter names for filenames
    const filenameParams = ['f', 'file', 'name', 'filename', 'fn', 'title', 'n', 'font'];

    for (const param of filenameParams) {
      const value = url.searchParams.get(param);
      if (value && value.length >= 2 && value.length <= 100) {
        // Convert underscores/dashes to spaces and clean up
        const cleaned = value
          .replace(/[_-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (isUsefulFilename(cleaned)) {
          return cleanFilename(cleaned);
        }
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

// Extract filename from page title or main heading
function extractFilenameFromPage() {
  // Try h1 first (usually the main title)
  const h1 = document.querySelector('h1');
  if (h1) {
    const h1Text = h1.textContent.trim();
    // Avoid generic titles
    if (isUsefulFilename(h1Text) && h1Text.length <= 60) {
      return cleanFilename(h1Text);
    }
  }

  // Try page title (but clean it - often has site name appended)
  const pageTitle = document.title;
  if (pageTitle) {
    // Remove common suffixes like " - DaFont", " | FontSite", etc.
    const cleaned = pageTitle
      .split(/\s*[-|–—•·]\s*/)[0]
      .trim();

    if (isUsefulFilename(cleaned) && cleaned.length <= 60) {
      return cleanFilename(cleaned);
    }
  }

  return null;
}

// Check if a string is a useful filename (not just "download", "dl", etc.)
function isUsefulFilename(str) {
  if (!str || str.length < 2) return false;

  const normalized = str.toLowerCase().trim();
  const uselessNames = [
    'download', 'dl', 'get', 'save', 'export', 'file', 'click here',
    'click to download', 'download file', 'download now', 'get file',
    'save file', 'here', 'link', 'button'
  ];

  return !uselessNames.includes(normalized) && normalized.length <= 100;
}

// Clean a string to be used as a filename
function cleanFilename(str) {
  return str
    .trim()
    .replace(/[\r\n]+/g, ' ')  // Replace newlines with spaces
    .replace(/\s+/g, ' ')       // Collapse multiple spaces
    .replace(/[<>:"/\\|?*]/g, '-')  // Replace invalid chars
    .substring(0, 80);          // Limit length
}

// Extract extension from filename if present
function extractExtensionFromFilename(filename) {
  const match = filename.match(/\.([a-zA-Z0-9]+)$/);
  if (match && SUPPORTED_EXTENSIONS.includes(match[1].toLowerCase())) {
    return match[1].toLowerCase();
  }
  return 'download';
}

// Try to find filename from surrounding context
function extractFilenameFromContext(anchor) {
  // Look at parent elements for text content
  let parent = anchor.parentElement;
  let depth = 0;

  while (parent && depth < 3) {
    // Check for headings or strong text nearby
    const heading = parent.querySelector('h1, h2, h3, h4, h5, h6, strong, b');
    if (heading) {
      const headingText = heading.textContent.trim();
      if (isUsefulFilename(headingText) && headingText !== anchor.textContent.trim()) {
        return cleanFilename(headingText);
      }
    }

    // Check for elements with class names suggesting a title/name
    const titleEl = parent.querySelector('[class*="title"], [class*="name"], [class*="font-name"]');
    if (titleEl) {
      const titleText = titleEl.textContent.trim();
      if (isUsefulFilename(titleText)) {
        return cleanFilename(titleText);
      }
    }

    parent = parent.parentElement;
    depth++;
  }

  return null;
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
function scanImageTags(files, root = document) {
  const images = root.querySelectorAll('img[src]');

  images.forEach(img => {
    const src = img.src;
    if (!src || src.startsWith('data:')) return;

    const fileInfo = extractFileInfo(src);
    if (fileInfo && isSupported(fileInfo.extension)) {
      files.set(src, fileInfo);
    }
  });

  // Also check srcset
  const imagesWithSrcset = root.querySelectorAll('img[srcset]');
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
function scanMediaTags(files, root = document) {
  const mediaElements = root.querySelectorAll('video[src], audio[src], video source[src], audio source[src]');

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
function scanEmbedTags(files, root = document) {
  const objects = root.querySelectorAll('object[data], embed[src]');

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
