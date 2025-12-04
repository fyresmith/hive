/**
 * Version bump script for Hive Obsidian Plugin
 * 
 * Usage: 
 *   npm version patch|minor|major
 *   
 * This script is called automatically by npm version and updates:
 *   - manifest.json
 *   - versions.json (for Obsidian compatibility tracking)
 */

import { readFileSync, writeFileSync } from 'fs';

// Read the new version from package.json (already bumped by npm version)
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const newVersion = packageJson.version;

console.log(`Bumping plugin version to ${newVersion}`);

// Update manifest.json
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const minAppVersion = manifest.minAppVersion;
manifest.version = newVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Updated manifest.json`);

// Update versions.json (maps plugin version to minimum Obsidian version)
let versions = {};
try {
  versions = JSON.parse(readFileSync('versions.json', 'utf8'));
} catch {
  // File doesn't exist yet, create it
  console.log('Creating versions.json');
}
versions[newVersion] = minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');
console.log(`Updated versions.json`);

console.log(`\nVersion bump complete!`);
console.log(`\nTo release:`);
console.log(`  git add manifest.json versions.json`);
console.log(`  git commit -m "Bump plugin version to ${newVersion}"`);
console.log(`  git tag plugin-v${newVersion}`);
console.log(`  git push && git push --tags`);

