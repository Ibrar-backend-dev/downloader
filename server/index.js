const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const http = require('http');
const socketIo = require('socket.io');
const { createLogger } = require('./utils/logger');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
}

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, '../downloads');
fs.ensureDirSync(downloadsDir);

// Routes
app.use('/api/download', require('./routes/download'));
app.use('/api/info', require('./routes/info'));
app.use('/api/formats', require('./routes/formats'));
app.use('/api', require('./routes/stream'));

// Socket.io for real-time download progress
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Export io for use in routes
app.set('socketio', io);

// Serve React app in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Record the toolchain the engine will actually use. A version mismatch or a
// missing binary is the first thing to rule out when downloads fail.
function probe(command, args, onResult) {
  const child = spawn(command, args);
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.on('error', (e) => onResult(null, e));
  child.on('close', () => onResult(out.trim().split('\n')[0], null));
}

function logStartupEnvironment() {
  const log = createLogger('startup');

  log.info('server.config', {
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'development',
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    logLevel: process.env.LOG_LEVEL || 'debug',
    downloadsDir,
  });

  log.info('ytdlp.config', {
    cookiesFromBrowser: process.env.YTDLP_COOKIES_FROM_BROWSER || null,
    cookiesFile: process.env.YTDLP_COOKIES_FILE || null,
    verbose: process.env.YTDLP_VERBOSE === '1',
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffmpegLocation: process.env.FFMPEG_LOCATION || null,
  });

  probe('yt-dlp', ['--version'], (version, error) => {
    if (error) {
      log.error('ytdlp.unavailable', {
        code: error.code,
        message: error.message,
        hint: 'downloads will fail immediately; install yt-dlp or put it on PATH',
      });
    } else {
      log.info('ytdlp.available', { version });
    }
  });

  probe(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], (version, error) => {
    if (error) {
      log.error('ffmpeg.unavailable', {
        code: error.code,
        message: error.message,
        hint: 'merged/streamed downloads will fail; install ffmpeg or set FFMPEG_PATH',
      });
    } else {
      log.info('ffmpeg.available', { version });
    }
  });
}

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logStartupEnvironment();
});

module.exports = app;
