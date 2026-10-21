const fs = require('fs');
const https = require('https');

const token = process.env.GITHUB_TOKEN ||;
const filePath = process.argv[2] || 'dist-electron/BudgetingMacApp-0.3.0-mac.zip';
const assetName = process.argv[3] || 'BudgetingMacApp-0.3.0-mac.zip';
const releaseId = process.argv[4] || '400424666';

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const stat = fs.statSync(filePath);
console.log(`Uploading ${assetName} (${(stat.size / 1024 / 1024).toFixed(1)} MB) to release ${releaseId}...`);

const req = https.request({
  hostname: 'uploads.github.com',
  port: 443,
  path: `/repos/Ale410-cpu/App-Budgeting-2/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': assetName.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
    'Content-Length': stat.size,
    'User-Agent': 'Release-Uploader'
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => {
    body += chunk;
  });
  res.on('end', () => {
    console.log(`\nUpload completed with status code: ${res.statusCode}`);
    try {
      const data = JSON.parse(body);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`Success! Download URL: ${data.browser_download_url}`);
      } else {
        console.error('Error response:', data);
        process.exit(1);
      }
    } catch (e) {
      console.log('Response body:', body.slice(0, 500));
    }
  });
});

req.on('error', (err) => {
  console.error('Upload failed with network error:', err);
  process.exit(1);
});

let uploadedBytes = 0;
const readStream = fs.createReadStream(filePath);
readStream.on('data', (chunk) => {
  uploadedBytes += chunk.length;
  const pct = ((uploadedBytes / stat.size) * 100).toFixed(1);
  process.stdout.write(`Progress: ${pct}%\r`);
});

readStream.pipe(req);
