# Seal Web App

A modern web-based video/audio downloader interface for yt-dlp, inspired by and based on the [Seal Android app](https://github.com/JunkFood02/Seal) by JunkFood02. This application provides a user-friendly web interface for downloading videos and audio from YouTube, Vimeo, and many other supported platforms.

## Features

### 🎥 Video/Audio Downloading
- Download videos from 1000+ supported sites including YouTube, Vimeo, TikTok, and more
- Audio-only downloads with format selection (MP3, M4A, FLAC, etc.)
- Video quality selection (4K, 1080p, 720p, etc.)
- Real-time download progress tracking

### 🎛️ Advanced Options
- Multiple format support
- Quality presets and custom settings
- Playlist support (coming soon)
- Custom output templates (coming soon)

### 🔄 Real-time Updates
- Live download progress with Socket.IO
- Real-time status updates
- Error reporting and handling

### 📱 Modern UI
- Responsive Material Design interface
- Dark/light theme support (coming soon)
- Mobile-friendly design
- Intuitive user experience

### 📁 File Management
- Download history with file details
- File size and creation date tracking
- Easy file deletion
- Organized downloads folder

## Tech Stack

### Backend
- **Node.js** with Express.js
- **Socket.IO** for real-time communication
- **yt-dlp** as the download engine
- **Helmet** for security
- **CORS** for cross-origin requests
- **Morgan** for logging

### Frontend
- **React 18** with TypeScript
- **Material-UI (MUI)** for components
- **Socket.IO Client** for real-time updates
- **Axios** for HTTP requests
- **Emotion** for styling

## Prerequisites

Before running this application, make sure you have:

1. **Node.js** (v16 or higher)
2. **npm** or **yarn**
3. **yt-dlp** installed and available in PATH

### Installing yt-dlp

#### On Ubuntu/Debian:
```bash
sudo apt update
sudo apt install yt-dlp
```

#### On macOS:
```bash
brew install yt-dlp
```

#### On Windows:
Download from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) and add to PATH.

## Installation

1. **Clone or navigate to the project directory:**
```bash
cd "Seal Web App"
```

2. **Install root dependencies:**
```bash
npm install
```

3. **Install all dependencies (root + client):**
```bash
npm run install:all
```

## Development

### Start the development server:
```bash
npm run dev
```

This will start:
- Backend server on `http://localhost:5000`
- Frontend development server on `http://localhost:3000`

### Start servers individually:

**Backend only:**
```bash
npm run server:dev
```

**Frontend only:**
```bash
npm run client:dev
```

## Production

### Build the application:
```bash
npm run build
```

### Start production server:
```bash
npm start
```

The production server will serve the built React app and API on the same port (5000).

## API Endpoints

### Download Endpoints
- `POST /api/download` - Start a download. Send `{ "url": "...", "formatId": "137" }` after calling `/api/info`; `quality` remains supported for legacy clients.
- `GET /api/download/list` - Get list of downloaded files
- `DELETE /api/download/:filename` - Delete a downloaded file

### Information Endpoints
- `GET /api/info?url=<video_url>` - Get structured video information, including `formats`, `format_id`, dimensions, codecs, and estimated sizes
- `GET /api/info/playlist?url=<playlist_url>` - Get playlist information

### Format Endpoints
- `GET /api/formats?url=<video_url>` - Legacy endpoint that parses yt-dlp's human-readable `--list-formats` output
- `GET /api/formats/quality-presets` - Get quality presets

## Socket.IO Events

### Client → Server
- `connection` - Client connects
- `disconnect` - Client disconnects

### Server → Client
- `download-start` - Download started
- `download-progress` - Download progress update
- `download-complete` - Download completed
- `download-error` - Download error occurred

## Configuration

### Environment Variables

Set these variables in the shell before starting the server:

```powershell
$env:PORT = "5000"
$env:NODE_ENV = "development"
```

For TikTok videos, TikTok may require a browser session to pass its anti-bot check. Set one of these before starting the server:

```powershell
$env:YTDLP_COOKIES_FROM_BROWSER = "chrome"
```

Alternatively, export cookies in Netscape format and configure the file path:

```powershell
$env:YTDLP_COOKIES_FILE = "C:\path\to\cookies.txt"
```

The browser option reads cookies from the local Chrome profile. Use the browser where you are signed in to TikTok, then restart the server before retrying.

TikTok also fingerprints the TLS handshake, not just the request headers. When the
`curl_cffi` package is installed the server automatically adds `--impersonate`, which
is what stops TikTok from answering with a JS challenge that fails extraction before
any video data is fetched. Install it with:

```powershell
pip install "yt-dlp[default,curl-cffi]"
```

The server logs `impersonation.available` or `impersonation.unavailable` at startup,
so you can confirm which mode it is running in.

These tune the engine's retry and logging behaviour:

```powershell
$env:LOG_LEVEL = "debug"            # error | warn | info | debug | trace
$env:YTDLP_VERBOSE = "1"            # pass --verbose to yt-dlp
$env:YTDLP_MAX_ATTEMPTS = "3"       # attempts per download before giving up
$env:YTDLP_RETRY_DELAY_MS = "2000"  # pause between attempts
$env:YTDLP_IMPERSONATE = "chrome"   # impersonation target
```

### Download Directory

Downloads are saved to `./downloads/` by default. The directory is automatically created if it doesn't exist.

## Supported Sites

This application supports the same sites as yt-dlp, including:

- YouTube (videos, playlists, channels)
- Vimeo
- TikTok
- Instagram
- Twitter
- Facebook
- Twitch
- And 1000+ more sites

For a complete list, run: `yt-dlp --list-extractors`

## Security Considerations

- Input validation for URLs
- File path sanitization
- CORS configuration
- Helmet security headers
- No arbitrary command execution

## Troubleshooting

### Common Issues

1. **yt-dlp not found:**
   - Ensure yt-dlp is installed and in your PATH
   - Test with: `yt-dlp --version`

2. **Permission errors:**
   - Check write permissions for the downloads directory
   - Run with appropriate user permissions

3. **Download failures:**
   - Check if the URL is supported
   - Verify internet connectivity
   - Some sites may require authentication

4. **TikTok fails immediately at 0%:**
   - Look for `Unable to extract universal data for rehydration` in the log. That is
     TikTok's JS challenge, and it fails during extraction before any bytes are
     fetched -- the video itself is fine.
   - Install `curl_cffi` (see Environment Variables) so the server can impersonate a
     real browser handshake, and let the built-in retries handle the rest.

### Reading the Logs

Every request gets its own correlation id and a running elapsed time, so a failure can
be placed exactly on the timeline:

```
INFO  [download:1788236943786] + 4401ms format.selected  | formatCount=1 formats=h264_540p_800567-1
INFO  [download.try1:...]      + 4977ms download.first-byte | totalSize=2.62MiB
INFO  [download.try1:...]      + 5591ms download.progress | percent=38.1 of=2.62MiB speed=1.62MiB/s
ERROR [download:...]           +10499ms download.failed  | diagnosis="failed during extraction ..." percentReached=0
```

The `download.failed` line always carries a `diagnosis` naming the stage that broke
and a `percentReached`, which distinguishes the three cases that look identical from
the UI: a failure before the transfer started, a stall part-way through, and a
transfer that completed but failed in post-processing.

### Debug Mode

Enable debug logging by setting:
```bash
DEBUG=seal-web-app:* npm run dev
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the WTFPL - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **[JunkFood02/Seal](https://github.com/JunkFood02/Seal)** - This project's idea and core functionality are based on this excellent Android application
- **yt-dlp** team for the powerful download engine
- **Material-UI** for the beautiful components
- **React** and **Node.js** communities

## Support

If you encounter any issues or have questions:

1. Check the [troubleshooting section](#troubleshooting)
2. Search existing issues
3. Create a new issue with detailed information

---

**Note:** This application is for personal use only. Please respect copyright laws and terms of service of the platforms you download content from.
