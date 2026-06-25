# LRCInject – Custom Lyrics for Apple Music Web

A Chrome Manifest V3 extension that lets you import and display time-synced lyrics on Apple Music Web (`music.apple.com`) for songs that don't have native lyrics.

## Features

- Import `.lrc`, `.srt`, or enhanced `.json` lyrics files
- Automatic lyrics sync with playback (play, pause, seek)
- Apple Music fullscreen-style lyrics display with blur/fade effects
- Track change detection and automatic lyrics loading
- Per-song timing offset adjustment (-2.00s to +2.00s)
- Word-level karaoke highlighting (with enhanced JSON format)
- Persists lyrics bindings locally via `chrome.storage.local`
- Handles Apple Music SPA navigation without page reload
- Works alongside native lyrics (with option to override)

## Installation

1. Open Chrome or Edge and navigate to `chrome://extensions/` (or `edge://extensions/`)
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `LRCInject` folder
5. The extension icon will appear in your toolbar

## Usage

1. Navigate to [music.apple.com](https://music.apple.com) and sign in
2. Play any song
3. Click the LRCInject extension icon in the toolbar
4. Click **Import .lrc / .srt / .json** and select your lyrics file
5. Open the fullscreen player (click the lyrics button or expand the player)
6. Your custom lyrics will appear with Apple Music-style visuals
7. Use the popup to adjust timing offset if lyrics are early/late

### Supported File Formats

**LRC (Line-level sync)**
```
[00:41.00]First line of lyrics
[00:44.20]Second line of lyrics
```

**Enhanced LRC (Word-level sync via angle-bracket timestamps)**
```
[00:10.00]<00:10.00>Hello <00:10.35>world
[00:12.50]<00:12.50>This <00:12.80>is <00:13.10>word-by-word
```
LRCInject parses `<mm:ss.xx>` angle-bracket word tags and renders karaoke-style word highlighting automatically.

**SRT (SubRip)**
```
1
00:00:41,000 --> 00:00:44,200
First line of lyrics

2
00:00:44,200 --> 00:00:48,000
Second line of lyrics
```

**Enhanced JSON (Word-level sync)**
```json
[
  {
    "start": 41.0,
    "end": 44.2,
    "text": "First line of lyrics",
    "words": [
      { "text": "First", "start": 41.0, "end": 41.215 },
      { "text": "line", "start": 41.215, "end": 41.616 },
      { "text": "of", "start": 41.616, "end": 41.910 },
      { "text": "lyrics", "start": 41.910, "end": 42.223 }
    ]
  }
]
```

## How It Works

The extension injects a content script into Apple Music Web that:

1. Bridges the page's audio/MusicKit state to the content script via `postMessage`
2. Detects the currently playing track using MusicKit API, Media Session, or DOM scraping
3. Matches imported lyrics to the current track by catalog ID or normalized title+artist+duration
4. Renders a custom lyrics overlay in the fullscreen player area using `requestAnimationFrame`-based sync
5. Uses `MutationObserver` to handle Apple Music's SPA navigation and dynamic UI changes

## Create Word-by-Word Lyrics with SyncSong

You can create Enhanced LRC files with per-word timestamps using [SyncSong (forked by Astear17)](https://github.com/Astear17/SyncSong):

1. Run the below code in CMD/PowerShell to clone and run the site locally
> [!NOTE]
> Make sure you have Node.js installed.
```bash
git clone https://github.com/Astear17/SyncSong
cd SyncSong
npm install
npm run dev
```
2. Enter the localhost domain it gives you (in the terminal window
3. Import audio file by dragging or click to choose
4. Import or paste your lyrics.
5. Sync line timestamps first (press Enter or click Mark for each line).
6. Enable **Word mode** toggle in the sync view.
7. Mark each word: play the audio, press `Tab` when you hear each word, and it auto-advances.
8. Alternatively, click **Auto All** to generate rough word timings, then refine manually.
9. Export as **Enhanced LRC** (select the Enhanced LRC radio button in the export view).
10. Import the exported `.lrc` file into LRCInject.

### Minimal Example

```
[00:10.00]<00:10.00>Hello <00:10.35>world
[00:12.50]<00:12.50>This <00:12.80>is <00:13.10>karaoke
```

Each `<mm:ss.xx>` tag marks when the following word should be highlighted during playback.

## File Structure

```
LRCInject/
├── manifest.json              # MV3 manifest
├── background.js              # Service worker
├── content/
│   ├── content.js             # Main content script (orchestrator)
│   ├── content.css            # Lyrics overlay styles
│   └── inject.js              # Page-world script for player state
├── lib/
│   ├── utils.js               # Shared utilities
│   ├── lrc-parser.js          # LRC file parser
│   ├── srt-parser.js          # SRT file parser
│   ├── json-parser.js         # Enhanced JSON parser
│   ├── storage.js             # chrome.storage.local wrapper
│   ├── media-bridge.js        # Content-script side of player bridge
│   ├── track-detector.js      # Track identity detection
│   ├── sync-engine.js         # RAF-based lyrics synchronization
│   └── renderer.js            # DOM overlay rendering
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.js               # Popup logic
│   └── popup.css              # Popup styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Limitations

- **Apple Music DOM changes**: The extension uses stable `data-testid` selectors where possible, but Apple may change their DOM structure. If lyrics stop appearing after an Apple Music update, selectors may need updating.
- **Line-level sync only for standard LRC**: Standard LRC files without angle-bracket word tags only get line-level timing. For word/syllable-level karaoke animation, use Enhanced LRC with `<mm:ss.xx>` word tags or the enhanced JSON format with word timing data.
- **Native lyrics detection**: The extension checks for native lyrics via the `<amp-lyrics>` Shadow DOM. If Apple changes how native lyrics are rendered, this detection may need adjustment.
- **No copyrighted lyrics included**: The extension does not include any lyrics files. Users must provide their own `.lrc` or `.srt` files.
- **Local only**: All data is stored locally in `chrome.storage.local`. No data is sent to any server.
- **Single browser**: Lyrics bindings are stored per-browser. They don't sync across devices.

## Debug Mode

Enable debug mode in the popup to see console logs from the extension. Look for `[LRCInject]` prefixed messages in the DevTools console.
