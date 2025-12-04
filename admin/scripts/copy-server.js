/**
 * Copy compiled server files to bundled-server directory for packaging
 */

const fs = require('fs');
const path = require('path');

const serverDir = path.join(__dirname, '../../server');
const targetDir = path.join(__dirname, '../bundled-server');

// Files/directories to copy
const toCopy = [
  { src: 'dist', dest: 'dist' },
  { src: 'package.json', dest: 'package.json' },
  { src: 'package-lock.json', dest: 'package-lock.json' },
];

// Clean and create target directory
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true });
}
fs.mkdirSync(targetDir, { recursive: true });

// Create data directory
fs.mkdirSync(path.join(targetDir, 'data'), { recursive: true });

// Copy function
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    const files = fs.readdirSync(src);
    for (const file of files) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Copy files
for (const item of toCopy) {
  const srcPath = path.join(serverDir, item.src);
  const destPath = path.join(targetDir, item.dest);
  
  if (fs.existsSync(srcPath)) {
    console.log(`Copying ${item.src}...`);
    copyRecursive(srcPath, destPath);
  } else {
    console.warn(`Warning: ${item.src} not found`);
  }
}

// Copy node_modules (only production dependencies)
const nodeModulesDir = path.join(serverDir, 'node_modules');
const targetNodeModules = path.join(targetDir, 'node_modules');

if (fs.existsSync(nodeModulesDir)) {
  console.log('Copying node_modules (this may take a moment)...');
  copyRecursive(nodeModulesDir, targetNodeModules);
}

console.log('Server files copied to bundled-server/');

