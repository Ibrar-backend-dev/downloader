const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function getConfig() {
  return {
    keyId: process.env.B2_KEY_ID?.trim(),
    applicationKey: process.env.B2_APPLICATION_KEY?.trim(),
    bucket: process.env.B2_BUCKET?.trim(),
    endpoint: process.env.B2_ENDPOINT?.trim(),
    region: process.env.B2_REGION?.trim() || 'us-west-004',
    publicUrl: process.env.B2_PUBLIC_URL?.trim(),
  };
}

function isB2Configured() {
  const config = getConfig();
  return Boolean(config.keyId && config.applicationKey && config.bucket && config.endpoint);
}

function createClient(config) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey,
    },
  });
}

function contentTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  return {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  }[ext] || 'application/octet-stream';
}

function objectKeyFor(filename, downloadId) {
  const safeFilename = path.basename(filename).replace(/[^A-Za-z0-9._ -]/g, '_');
  return `downloads/${downloadId}-${safeFilename}`;
}

async function uploadFile({ filePath, filename, downloadId, log }) {
  const config = getConfig();
  if (!isB2Configured()) {
    return { uploaded: false, reason: 'not-configured' };
  }

  const key = objectKeyFor(filename, downloadId);
  const client = createClient(config);
  const fileSize = fs.statSync(filePath).size;

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentLength: fileSize,
    ContentType: contentTypeFor(filename),
  }));

  const url = config.publicUrl
    ? `${config.publicUrl.replace(/\/$/, '')}/${encodeURIComponent(key).replace(/%2F/g, '/')}`
    : await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: 3600 });

  if (log) log.info('storage.b2.uploaded', { bucket: config.bucket, key, fileSize });
  return { uploaded: true, url, key, fileSize };
}

module.exports = { isB2Configured, uploadFile };
