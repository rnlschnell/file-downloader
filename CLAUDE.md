# Bulk File Downloader - Chrome Extension

## Project Overview

A Chrome extension that scans webpages for downloadable files and allows bulk downloading with a single click.

## Architecture

```
file-downloader/
├── manifest.json          # Chrome extension manifest (v3)
├── popup/                 # Extension popup UI
│   ├── popup.html         # Popup markup
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic & state management
├── content/               # Content scripts (injected into pages)
│   └── content-script.js  # DOM scanning for downloadable files
├── background/            # Service worker
│   └── service-worker.js  # Download management
└── icons/                 # Extension icons (16, 48, 128px)
```

## Key Components

### Content Script (`content/content-script.js`)
- Scans the DOM for downloadable file links
- Searches `<a>`, `<img>`, `<video>`, `<audio>`, `<source>`, `<object>`, `<embed>` tags
- Extracts filename and extension from URLs
- Deduplicates files by URL

### Popup (`popup/`)
- Displays scanned files in a selectable list
- Provides filtering by file type (images, documents, videos, audio, archives)
- Select all / deselect all functionality
- Triggers downloads for selected files

### Service Worker (`background/service-worker.js`)
- Handles download requests from popup
- Uses Chrome's `downloads` API
- Sanitizes filenames for safe saving
- Processes downloads sequentially with small delays

## Supported File Types

| Category   | Extensions                                              |
|------------|--------------------------------------------------------|
| Images     | jpg, jpeg, png, gif, webp, svg, bmp, ico               |
| Documents  | pdf, doc, docx, xls, xlsx, ppt, pptx, txt, rtf, odt    |
| Videos     | mp4, webm, avi, mov, mkv, flv, wmv                     |
| Audio      | mp3, wav, ogg, flac, aac, m4a                          |
| Archives   | zip, rar, 7z, tar, gz, bz2                             |

## Development

### Loading the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `file-downloader` directory

### Testing

1. Navigate to any webpage with downloadable files
2. Click the extension icon in the toolbar
3. Click "Scan Page" to find files
4. Select files and click "Download Selected"

### Adding Icons

Create PNG icons at these sizes and place in `icons/`:
- `icon16.png` (16x16) - Toolbar icon
- `icon48.png` (48x48) - Extension management page
- `icon128.png` (128x128) - Chrome Web Store

## Chrome APIs Used

- `chrome.tabs` - Query active tab
- `chrome.runtime` - Message passing between components
- `chrome.downloads` - Trigger file downloads

## Permissions

- `activeTab` - Access the current tab when user clicks extension
- `downloads` - Trigger and manage file downloads

## Future Enhancements

- [ ] ZIP bundling of multiple files (requires JSZip)
- [ ] Download progress tracking UI
- [ ] Retry failed downloads automatically
- [ ] Custom filename patterns
- [ ] Save download history
- [ ] Keyboard shortcuts
- [ ] Dark mode support
