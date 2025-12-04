/**
 * Hive - Backup System
 * Provides periodic snapshot backups for vault data to prevent data loss.
 * Supports hourly and daily backups with configurable retention.
 * 
 * Backup Structure:
 * data/
 *   backups/
 *     {vaultId}/
 *       hourly/
 *         2025-12-03T14:00:00/
 *           _state.ydoc
 *           file1.md
 *           file2.md
 *       daily/
 *         2025-12-03/
 *           ...
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const VAULTS_PATH = process.env.VAULTS_PATH || './data/vaults';
const BACKUPS_PATH = process.env.BACKUPS_PATH || './data/backups';

// Retention settings
const HOURLY_RETENTION = 24; // Keep last 24 hourly backups
const DAILY_RETENTION = 7;   // Keep last 7 daily backups

// Backup intervals
const HOURLY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Track backup intervals for cleanup
let hourlyBackupInterval: NodeJS.Timeout | null = null;

/**
 * Backup info for a single backup
 */
export interface BackupInfo {
  timestamp: string;
  type: 'hourly' | 'daily';
  path: string;
  size?: number;
}

/**
 * Ensure the backups directory exists for a vault
 */
async function ensureBackupDirectories(vaultId: string): Promise<void> {
  const sanitizedId = vaultId.replace(/[^a-zA-Z0-9_-]/g, '');
  const hourlyDir = path.resolve(BACKUPS_PATH, sanitizedId, 'hourly');
  const dailyDir = path.resolve(BACKUPS_PATH, sanitizedId, 'daily');
  
  await fs.mkdir(hourlyDir, { recursive: true });
  await fs.mkdir(dailyDir, { recursive: true });
}

/**
 * Get the path to a vault directory
 */
function getVaultPath(vaultId: string): string {
  const sanitizedId = vaultId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.resolve(VAULTS_PATH, sanitizedId);
}

/**
 * Get the backup directory for a vault
 */
function getBackupBasePath(vaultId: string): string {
  const sanitizedId = vaultId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.resolve(BACKUPS_PATH, sanitizedId);
}

/**
 * Generate a timestamp string for backup naming
 * Uses ISO format but replaces colons with dashes for filesystem compatibility
 */
function getBackupTimestamp(): string {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
}

/**
 * Get just the date part of a timestamp (for daily backups)
 */
function getDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Copy a directory recursively
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Get the total size of a directory in bytes
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    }
  } catch {
    // Directory might not exist or be inaccessible
  }
  
  return totalSize;
}

/**
 * Create a snapshot backup of a vault
 * @param vaultId - The vault to backup
 * @param type - The type of backup (hourly or daily)
 * @returns The path to the created backup
 */
export async function createSnapshot(vaultId: string, type: 'hourly' | 'daily' = 'hourly'): Promise<string> {
  const vaultPath = getVaultPath(vaultId);
  const backupBase = getBackupBasePath(vaultId);
  
  // Check if vault exists
  try {
    await fs.access(vaultPath);
  } catch {
    throw new Error(`Vault ${vaultId} does not exist`);
  }
  
  await ensureBackupDirectories(vaultId);
  
  // Generate backup path
  const timestamp = type === 'daily' ? getDateString() : getBackupTimestamp();
  const backupPath = path.join(backupBase, type, timestamp);
  
  // Check if backup already exists (for daily backups on same day)
  try {
    await fs.access(backupPath);
    if (type === 'daily') {
      console.log(`[Backup] Daily backup already exists for ${vaultId} on ${timestamp}`);
      return backupPath;
    }
    // For hourly, remove existing and create new
    await fs.rm(backupPath, { recursive: true, force: true });
  } catch {
    // Backup doesn't exist, continue
  }
  
  // Copy vault directory to backup
  await copyDirectory(vaultPath, backupPath);
  
  console.log(`[Backup] Created ${type} backup for vault ${vaultId}: ${timestamp}`);
  
  return backupPath;
}

/**
 * List all backups for a vault
 * @param vaultId - The vault to list backups for
 * @returns Array of backup info objects sorted by timestamp (newest first)
 */
export async function listBackups(vaultId: string): Promise<BackupInfo[]> {
  const backupBase = getBackupBasePath(vaultId);
  const backups: BackupInfo[] = [];
  
  for (const type of ['hourly', 'daily'] as const) {
    const typeDir = path.join(backupBase, type);
    
    try {
      const entries = await fs.readdir(typeDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const backupPath = path.join(typeDir, entry.name);
          const size = await getDirectorySize(backupPath);
          
          backups.push({
            timestamp: entry.name,
            type,
            path: backupPath,
            size,
          });
        }
      }
    } catch {
      // Directory might not exist
    }
  }
  
  // Sort by timestamp, newest first
  return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Prune old backups beyond retention limits
 * @param vaultId - The vault to prune backups for
 * @returns Number of backups pruned
 */
export async function pruneOldBackups(vaultId: string): Promise<number> {
  const backupBase = getBackupBasePath(vaultId);
  let pruned = 0;
  
  for (const type of ['hourly', 'daily'] as const) {
    const typeDir = path.join(backupBase, type);
    const retention = type === 'hourly' ? HOURLY_RETENTION : DAILY_RETENTION;
    
    try {
      const entries = await fs.readdir(typeDir, { withFileTypes: true });
      
      // Get directories sorted by name (timestamp), newest first
      const backupDirs = entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort((a, b) => b.localeCompare(a));
      
      // Remove backups beyond retention limit
      for (let i = retention; i < backupDirs.length; i++) {
        const backupPath = path.join(typeDir, backupDirs[i]);
        
        try {
          await fs.rm(backupPath, { recursive: true, force: true });
          console.log(`[Backup] Pruned old ${type} backup for ${vaultId}: ${backupDirs[i]}`);
          pruned++;
        } catch (err) {
          console.error(`[Backup] Failed to prune backup ${backupPath}:`, err);
        }
      }
    } catch {
      // Directory might not exist
    }
  }
  
  return pruned;
}

/**
 * Restore a vault from a backup
 * @param vaultId - The vault to restore
 * @param timestamp - The backup timestamp to restore from
 * @param type - The type of backup (hourly or daily)
 * @returns true if restore was successful
 */
export async function restoreFromBackup(
  vaultId: string,
  timestamp: string,
  type: 'hourly' | 'daily' = 'hourly'
): Promise<boolean> {
  const vaultPath = getVaultPath(vaultId);
  const backupBase = getBackupBasePath(vaultId);
  const backupPath = path.join(backupBase, type, timestamp);
  
  // Check if backup exists
  try {
    await fs.access(backupPath);
  } catch {
    throw new Error(`Backup not found: ${type}/${timestamp}`);
  }
  
  // Create a pre-restore backup of current state
  try {
    await fs.access(vaultPath);
    const preRestoreTimestamp = `pre-restore-${getBackupTimestamp()}`;
    const preRestorePath = path.join(backupBase, 'hourly', preRestoreTimestamp);
    await copyDirectory(vaultPath, preRestorePath);
    console.log(`[Backup] Created pre-restore backup: ${preRestoreTimestamp}`);
  } catch {
    // Vault doesn't exist, nothing to backup
  }
  
  // Remove current vault contents
  try {
    await fs.rm(vaultPath, { recursive: true, force: true });
  } catch {
    // Vault might not exist
  }
  
  // Restore from backup
  await copyDirectory(backupPath, vaultPath);
  
  console.log(`[Backup] Restored vault ${vaultId} from ${type}/${timestamp}`);
  
  return true;
}

/**
 * Get all vault IDs that exist
 */
async function getAllVaultIds(): Promise<string[]> {
  const vaultsDir = path.resolve(VAULTS_PATH);
  
  try {
    const entries = await fs.readdir(vaultsDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);
  } catch {
    return [];
  }
}

/**
 * Run hourly backup for all vaults
 */
async function runHourlyBackup(): Promise<void> {
  console.log('[Backup] Starting hourly backup run...');
  
  const vaultIds = await getAllVaultIds();
  
  for (const vaultId of vaultIds) {
    try {
      await createSnapshot(vaultId, 'hourly');
      await pruneOldBackups(vaultId);
      
      // Check if we should create a daily backup (first hourly of the day)
      const dailyPath = path.join(getBackupBasePath(vaultId), 'daily', getDateString());
      try {
        await fs.access(dailyPath);
        // Daily backup already exists
      } catch {
        // Create daily backup
        await createSnapshot(vaultId, 'daily');
      }
    } catch (err) {
      console.error(`[Backup] Failed to backup vault ${vaultId}:`, err);
    }
  }
  
  console.log('[Backup] Hourly backup run complete');
}

/**
 * Initialize the backup scheduler
 * Starts hourly backup interval and runs initial backup
 */
export function initializeBackupScheduler(): void {
  console.log('[Backup] Initializing backup scheduler...');
  
  // Run initial backup after a short delay (let server start up first)
  setTimeout(() => {
    runHourlyBackup().catch(err => {
      console.error('[Backup] Initial backup run failed:', err);
    });
  }, 5000);
  
  // Schedule hourly backups
  hourlyBackupInterval = setInterval(() => {
    runHourlyBackup().catch(err => {
      console.error('[Backup] Scheduled backup run failed:', err);
    });
  }, HOURLY_INTERVAL_MS);
  
  console.log(`[Backup] Backup scheduler initialized (hourly interval: ${HOURLY_INTERVAL_MS / 1000 / 60} minutes)`);
}

/**
 * Stop the backup scheduler
 */
export function stopBackupScheduler(): void {
  if (hourlyBackupInterval) {
    clearInterval(hourlyBackupInterval);
    hourlyBackupInterval = null;
    console.log('[Backup] Backup scheduler stopped');
  }
}

/**
 * Trigger a manual backup for a specific vault
 * @param vaultId - The vault to backup
 * @returns The backup info
 */
export async function triggerManualBackup(vaultId: string): Promise<BackupInfo> {
  const backupPath = await createSnapshot(vaultId, 'hourly');
  const size = await getDirectorySize(backupPath);
  
  return {
    timestamp: path.basename(backupPath),
    type: 'hourly',
    path: backupPath,
    size,
  };
}

