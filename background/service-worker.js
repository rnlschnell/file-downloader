// Service worker for handling downloads

// MIME type to extension mapping
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
  'application/vnd.ms-fontobject': 'eot'
};

// Cache for HEAD request results to avoid duplicate requests
const headCache = new Map();
const HEAD_CACHE_TTL = 60000; // 1 minute cache

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadFiles') {
    downloadFiles(request.files);
    sendResponse({ success: true });
  } else if (request.action === 'enrichFiles') {
    // Enrich files with HEAD request data
    enrichFilesWithMetadata(request.files).then(enrichedFiles => {
      sendResponse({ files: enrichedFiles });
    });
    return true; // Keep channel open for async response
  }
  return true;
});

// Enrich files with metadata from HEAD requests
async function enrichFilesWithMetadata(files) {
  const enrichmentPromises = files.map(file => enrichFileMetadata(file));

  // Use Promise.allSettled to handle failures gracefully
  const results = await Promise.allSettled(enrichmentPromises);

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    // If enrichment failed, return original file
    return files[index];
  });
}

// Enrich a single file with HEAD request metadata
async function enrichFileMetadata(file) {
  // Skip if file already has a good filename (has extension and isn't generic)
  const hasGoodFilename = file.filename &&
    file.extension &&
    file.extension !== 'download' &&
    !file.isInferredDownload &&
    file.filename !== 'file' &&
    !file.filename.match(/^[a-f0-9-]{32,}$/i); // Skip UUID-like filenames

  if (hasGoodFilename) {
    return file;
  }

  // Check cache first
  const cacheKey = file.url;
  const cached = headCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < HEAD_CACHE_TTL) {
    return { ...file, ...cached.data };
  }

  try {
    const metadata = await fetchFileMetadata(file.url);

    // Cache the result
    headCache.set(cacheKey, {
      timestamp: Date.now(),
      data: metadata
    });

    // Clean up old cache entries periodically
    if (headCache.size > 500) {
      cleanupCache();
    }

    return {
      ...file,
      ...metadata,
      enriched: true
    };
  } catch (error) {
    console.warn(`Failed to enrich metadata for ${file.url}:`, error.message);
    return file;
  }
}

// Fetch file metadata using HEAD request
async function fetchFileMetadata(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      credentials: 'include', // Include cookies for authenticated downloads
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const metadata = {};

    // Parse Content-Disposition header for filename
    const contentDisposition = response.headers.get('Content-Disposition');
    if (contentDisposition) {
      const filename = parseContentDisposition(contentDisposition);
      if (filename) {
        metadata.filename = filename;
        // Extract extension from the filename
        const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
        if (extMatch) {
          metadata.extension = extMatch[1].toLowerCase();
        }
      }
    }

    // Parse Content-Type header for file type
    const contentType = response.headers.get('Content-Type');
    if (contentType && !metadata.extension) {
      const mimeType = contentType.split(';')[0].trim().toLowerCase();
      const extFromMime = MIME_TO_EXTENSION[mimeType];
      if (extFromMime) {
        metadata.extension = extFromMime;
        // If we got extension from MIME but no filename, create one
        if (!metadata.filename) {
          metadata.filename = `file.${extFromMime}`;
        }
      }
    }

    // Parse Content-Length for file size
    const contentLength = response.headers.get('Content-Length');
    if (contentLength) {
      metadata.size = parseInt(contentLength, 10);
    }

    // Get final URL (after redirects)
    if (response.url !== url) {
      metadata.finalUrl = response.url;
      // Try to extract filename from final URL if we don't have one
      if (!metadata.filename) {
        const finalFilename = extractFilenameFromUrl(response.url);
        if (finalFilename && finalFilename !== 'download') {
          metadata.filename = finalFilename;
          const extMatch = finalFilename.match(/\.([a-zA-Z0-9]+)$/);
          if (extMatch) {
            metadata.extension = extMatch[1].toLowerCase();
          }
        }
      }
    }

    return metadata;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Parse Content-Disposition header to extract filename
function parseContentDisposition(header) {
  if (!header) return null;

  // Try RFC 5987 format first: filename*=UTF-8''encoded%20name.pdf
  const rfc5987Match = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''(.+?)(?:;|$)/i);
  if (rfc5987Match) {
    try {
      return decodeURIComponent(rfc5987Match[1].trim());
    } catch (e) {
      // Fall through to other methods
    }
  }

  // Try quoted filename: filename="name.pdf"
  const quotedMatch = header.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch) {
    return quotedMatch[1].trim();
  }

  // Try unquoted filename: filename=name.pdf
  const unquotedMatch = header.match(/filename\s*=\s*([^;\s]+)/i);
  if (unquotedMatch) {
    return unquotedMatch[1].trim();
  }

  // Try inline filename patterns
  const inlineMatch = header.match(/name\s*=\s*"?([^";\s]+)"?/i);
  if (inlineMatch) {
    return inlineMatch[1].trim();
  }

  return null;
}

// Extract filename from URL
function extractFilenameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const pathParts = pathname.split('/').filter(p => p);
    const lastPart = pathParts[pathParts.length - 1];

    if (lastPart) {
      // Decode URL encoding
      const decoded = decodeURIComponent(lastPart);
      // Remove query string artifacts
      return decoded.split('?')[0];
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Clean up old cache entries
function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of headCache.entries()) {
    if (now - value.timestamp > HEAD_CACHE_TTL) {
      headCache.delete(key);
    }
  }
}

// Download multiple files with collision handling
async function downloadFiles(files) {
  // Build a map of filename -> count for collision detection
  const filenameCount = new Map();
  const processedFiles = [];

  for (const file of files) {
    const sanitized = sanitizeFilename(file.filename);
    const baseFilename = sanitized;

    // Track how many times we've seen this filename
    const count = filenameCount.get(baseFilename) || 0;
    filenameCount.set(baseFilename, count + 1);

    let finalFilename = baseFilename;
    if (count > 0) {
      // Add counter for duplicate filenames
      finalFilename = addFilenameCounter(baseFilename, count);
    }

    processedFiles.push({
      ...file,
      finalFilename
    });
  }

  // Download files sequentially
  for (const file of processedFiles) {
    try {
      await downloadFile(file);
      // Small delay between downloads to avoid overwhelming the browser
      await sleep(200);
    } catch (error) {
      console.error(`Failed to download ${file.filename}:`, error);
    }
  }
}

// Add counter to filename before extension
function addFilenameCounter(filename, count) {
  const lastDotIndex = filename.lastIndexOf('.');

  if (lastDotIndex === -1) {
    // No extension
    return `${filename} (${count})`;
  }

  const name = filename.slice(0, lastDotIndex);
  const ext = filename.slice(lastDotIndex);
  return `${name} (${count})${ext}`;
}

// Download a single file
function downloadFile(file) {
  return new Promise((resolve, reject) => {
    // Use finalUrl if available (from redirects), otherwise use original url
    const downloadUrl = file.finalUrl || file.url;
    const filename = file.finalFilename || sanitizeFilename(file.filename);

    chrome.downloads.download({
      url: downloadUrl,
      filename: filename,
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
  if (!filename) {
    return 'download';
  }

  return filename
    // Remove or replace characters that are invalid in filenames
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    // Replace multiple spaces/underscores with single
    .replace(/[\s_]+/g, ' ')
    // Remove leading/trailing spaces and dots
    .trim()
    .replace(/^\.+|\.+$/g, '')
    // Limit filename length (leaving room for counter suffix)
    .slice(0, 180)
    // Ensure we have a filename
    || 'download';
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
