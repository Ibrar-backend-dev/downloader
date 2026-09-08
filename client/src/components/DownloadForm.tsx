import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Box,
  Typography,
  Chip,
  Alert,
  Collapse,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Download as DownloadIcon,
  Info as InfoIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon
} from '@mui/icons-material';
import axios from 'axios';

interface VideoInfo {
  id: string;
  title: string;
  description: string;
  duration: number;
  uploader: string;
  upload_date: string;
  view_count: number;
  thumbnail: string;
  webpage_url: string;
  extractor: string;
  formats: VideoFormat[];
}

interface VideoFormat {
  format_id: string;
  ext: string;
  filesize?: number;
  filesize_approx?: number;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  format_note?: string;
  has_video?: boolean;
  has_audio?: boolean;
}

interface QualityPreset {
  value: string;
  label: string;
  description: string;
}

const DownloadForm: React.FC = () => {
  const [url, setUrl] = useState('');
  const [audioOnly, setAudioOnly] = useState(false);
  const [format, setFormat] = useState('mp3');
  const [quality, setQuality] = useState('best');
  const [formatId, setFormatId] = useState('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [qualityPresets, setQualityPresets] = useState<{
    video: QualityPreset[];
    audio: QualityPreset[];
  }>({ video: [], audio: [] });

  const apiUrl = process.env.NODE_ENV === 'production' 
    ? '/api' 
    : 'http://localhost:5000/api';

  const fetchQualityPresets = useCallback(async () => {
    try {
      // Mock data for development when backend is not available
      if (process.env.NODE_ENV === 'development') {
        const mockPresets = {
          video: [
            { value: '2160', label: '4K (2160p)', description: 'Ultra High Definition' },
            { value: '1440', label: '2K (1440p)', description: 'Quad HD' },
            { value: '1080', label: 'Full HD (1080p)', description: 'High Definition' },
            { value: '720', label: 'HD (720p)', description: 'High Definition' },
            { value: '480', label: 'SD (480p)', description: 'Standard Definition' },
            { value: '360', label: 'Low (360p)', description: 'Low Quality' },
            { value: 'best', label: 'Best Available', description: 'Highest quality available' },
            { value: 'worst', label: 'Worst Available', description: 'Lowest quality available' }
          ],
          audio: [
            { value: 'mp3', label: 'MP3', description: 'Standard audio format' },
            { value: 'm4a', label: 'M4A', description: 'High quality audio' },
            { value: 'wav', label: 'WAV', description: 'Uncompressed audio' },
            { value: 'flac', label: 'FLAC', description: 'Lossless audio' },
            { value: 'ogg', label: 'OGG', description: 'Open source audio' },
            { value: 'best', label: 'Best Available', description: 'Highest quality available' }
          ]
        };
        setQualityPresets(mockPresets);
        return;
      }

      const response = await axios.get(`${apiUrl}/formats/quality-presets`);
      setQualityPresets(response.data);
    } catch (error) {
      console.warn('Backend not available, using mock quality presets');
      // Fallback to mock data
      const mockPresets = {
        video: [
          { value: 'best', label: 'Best Available', description: 'Highest quality available' },
          { value: '1080', label: 'Full HD (1080p)', description: 'High Definition' },
          { value: '720', label: 'HD (720p)', description: 'High Definition' }
        ],
        audio: [
          { value: 'mp3', label: 'MP3', description: 'Standard audio format' },
          { value: 'm4a', label: 'M4A', description: 'High quality audio' }
        ]
      };
      setQualityPresets(mockPresets);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchQualityPresets();
  }, [fetchQualityPresets]);

  const fetchVideoInfo = async () => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    setLoading(true);
    setError('');
    setVideoInfo(null);

    try {
      const response = await axios.get(`${apiUrl}/info`, {
        params: { url }
      });
      const formats = response.data.formats || [];
      const videoFormats = formats.filter((item: VideoFormat) => item.has_video !== false);
      const defaultFormat = videoFormats.find((item: VideoFormat) => item.has_audio) || videoFormats[0];
      setVideoInfo({ ...response.data, formats });
      setFormatId(defaultFormat?.format_id || '');
    } catch (error: any) {
      if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
        setError('Backend server not available. Please start the backend server to use video info features.');
        // Show demo video info
        const mockVideoInfo = {
          id: 'demo123',
          title: 'Demo Video - Seal Web App Preview',
          description: 'This is a demo video showing the Seal Web App interface. The backend server needs to be running for actual video information.',
          duration: 180,
          uploader: 'Seal Web App Demo',
          upload_date: '20250826',
          view_count: 1000,
          thumbnail: 'https://via.placeholder.com/320x180/1976d2/ffffff?text=Demo+Video',
          webpage_url: url,
          extractor: 'demo',
          formats: []
        };
        setVideoInfo(mockVideoInfo);
      } else {
        setError(error.response?.data?.error || 'Failed to fetch video information');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await axios.post(`${apiUrl}/download`, {
        url: url.trim(),
        format: audioOnly ? format : undefined,
        formatId: !audioOnly ? formatId || undefined : undefined,
        quality: !audioOnly ? quality : undefined,
        audioOnly
      });

      if (response.data.success) {
        setSuccess('Download started successfully!');
        setUrl('');
        setVideoInfo(null);
      }
    } catch (error: any) {
      if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
        setError('Backend server not available. To enable downloads: 1) Install yt-dlp, 2) Run "npm install" in the root directory, 3) Start with "npm run dev"');
      } else {
        setError(error.response?.data?.error || 'Download failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return 'size unknown';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h5" gutterBottom>
          Download Video/Audio
        </Typography>

        <Box sx={{ mb: 3 }}>
          <TextField
            fullWidth
            label="Video URL"
            placeholder="Enter video URL (e.g., https://vimeo.com/123456789)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            margin="normal"
          />
          
          <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button
              variant="outlined"
              startIcon={<InfoIcon />}
              onClick={fetchVideoInfo}
              disabled={loading || !url.trim()}
            >
              Get Info
            </Button>
            
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              onClick={handleDownload}
              disabled={loading || !url.trim()}
            >
              Download
            </Button>

            <Tooltip title="Advanced Options">
              <IconButton onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Collapse in={showAdvanced}>
          <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="h6" gutterBottom>
              Download Options
            </Typography>
            
            <FormControlLabel
              control={
                <Switch
                  checked={audioOnly}
                  onChange={(e) => setAudioOnly(e.target.checked)}
                />
              }
              label="Audio Only"
            />

            {audioOnly ? (
              <FormControl fullWidth margin="normal">
                <InputLabel>Audio Format</InputLabel>
                <Select
                  value={format}
                  label="Audio Format"
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {qualityPresets.audio.map((preset) => (
                    <MenuItem key={preset.value} value={preset.value}>
                      <Box>
                        <Typography variant="body1">{preset.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {preset.description}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <FormControl fullWidth margin="normal">
                <InputLabel>Video Quality</InputLabel>
                <Select
                  value={quality}
                  label="Video Quality"
                  onChange={(e) => setQuality(e.target.value)}
                >
                  {qualityPresets.video.map((preset) => (
                    <MenuItem key={preset.value} value={preset.value}>
                      <Box>
                        <Typography variant="body1">{preset.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {preset.description}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        </Collapse>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}

        {videoInfo && (
          <Card variant="outlined" sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Video Information
              </Typography>
              
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                {videoInfo.thumbnail && (
                  <img
                    src={videoInfo.thumbnail}
                    alt="Video thumbnail"
                    style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 4 }}
                  />
                )}
                
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="subtitle1" fontWeight="bold">
                    {videoInfo.title}
                  </Typography>
                  
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    by {videoInfo.uploader}
                  </Typography>
                  
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                    <Chip size="small" label={`Duration: ${formatDuration(videoInfo.duration)}`} />
                    <Chip size="small" label={`Views: ${videoInfo.view_count?.toLocaleString()}`} />
                    <Chip size="small" label={videoInfo.extractor} />
                  </Box>
                </Box>
              </Box>

              {videoInfo.formats?.length > 0 && (
                <FormControl fullWidth>
                  <InputLabel>Video format and size</InputLabel>
                  <Select
                    value={formatId}
                    label="Video format and size"
                    onChange={(e) => setFormatId(e.target.value)}
                  >
                    {videoInfo.formats
                      .filter((item) => item.has_video !== false)
                      .map((item) => (
                        <MenuItem key={item.format_id} value={item.format_id}>
                          {item.height ? `${item.height}p` : 'Video'} · {item.ext.toUpperCase()} · {formatSize(item.filesize || item.filesize_approx)}
                          {item.has_audio ? ' · video + audio' : ' · video only'}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
              )}
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
};

export default DownloadForm;
