const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
if (!fs.existsSync(indexPath)) {
  throw new Error('dist/index.html was not found. Run the Expo web export first.');
}

const index = fs.readFileSync(indexPath, 'utf8');
const pwaHead = `
    <link rel="manifest" href="/manifest.json" />
    <link rel="icon" href="/icon.png" type="image/png" />
    <link rel="apple-touch-icon" href="/icon.png" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="E-SHIELD" />
`;

if (!index.includes('rel="manifest"')) {
  fs.writeFileSync(indexPath, index.replace('</head>', `${pwaHead}</head>`));
}
