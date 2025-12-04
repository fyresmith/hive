/**
 * Hive - Vault Management System
 * Handles vault creation, file operations, and Y.js document persistence.
 * 
 * Based on Obsidian's vault structure where each vault is a directory
 * containing markdown files and folders.
 * @see https://docs.obsidian.md/Plugins/
 */

import * as Y from 'yjs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { setVaultOwner, deleteAllVaultMembers } from './permissions';

const VAULTS_PATH = process.env.VAULTS_PATH || './data/vaults';

// Store for Y.Doc states (binary snapshots for persistence)
const Y_DOC_EXTENSION = '.ydoc';

/**
 * Sanitize a file path to prevent directory traversal attacks
 * @param filepath - The file path to sanitize
 * @returns Sanitized file path
 * @throws Error if path contains directory traversal
 */
function sanitizePath(filepath: string): string {
  // Normalize the path and remove leading slashes
  const normalized = path.normalize(filepath).replace(/^[/\\]+/, '');
  
  // Check for any remaining directory traversal attempts
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid file path: directory traversal not allowed');
  }
  
  return normalized;
}

/**
 * Atomic file write for text content - writes to temp file then renames
 * This prevents file corruption if the process crashes mid-write
 * @param filepath - The target file path
 * @param content - The text content to write
 */
async function atomicWriteFile(filepath: string, content: string): Promise<void> {
  const tempPath = `${filepath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, filepath);
  } catch (err) {
    // Clean up temp file if rename failed
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Atomic file write for binary content - writes to temp file then renames
 * This prevents file corruption if the process crashes mid-write
 * @param filepath - The target file path
 * @param content - The binary content to write
 */
async function atomicWriteBinary(filepath: string, content: Buffer): Promise<void> {
  const tempPath = `${filepath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filepath);
  } catch (err) {
    // Clean up temp file if rename failed
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Ensure the vaults directory exists
 */
async function ensureVaultsDirectory(): Promise<void> {
  const vaultsDir = path.resolve(VAULTS_PATH);
  await fs.mkdir(vaultsDir, { recursive: true });
}

/**
 * Get the full path to a vault directory
 */
function getVaultPath(vaultId: string): string {
  // Sanitize vault ID to prevent directory traversal
  const sanitizedId = vaultId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.resolve(VAULTS_PATH, sanitizedId);
}

/**
 * Get the path to a vault's Y.Doc state file
 */
function getYDocPath(vaultId: string): string {
  return path.join(getVaultPath(vaultId), `_state${Y_DOC_EXTENSION}`);
}

/**
 * Create a new vault
 * @param vaultId - Unique identifier for the vault
 * @param ownerId - Optional user ID to set as the vault owner
 * @returns true if created successfully, false if already exists
 */
export async function createVault(vaultId: string, ownerId?: number): Promise<boolean> {
  try {
    await ensureVaultsDirectory();
    const vaultPath = getVaultPath(vaultId);
    
    // Check if vault already exists
    try {
      await fs.access(vaultPath);
      return false; // Vault already exists
    } catch {
      // Vault doesn't exist, create it
    }
    
    await fs.mkdir(vaultPath, { recursive: true });
    
    // Initialize with an empty Y.Doc
    const doc = new Y.Doc();
    await saveVaultState(vaultId, doc);
    
    // Set the owner if provided
    if (ownerId !== undefined) {
      await setVaultOwner(vaultId, ownerId);
    }
    
    console.log(`Vault created: ${vaultId}${ownerId ? ` (owner: ${ownerId})` : ''}`);
    return true;
  } catch (err) {
    console.error(`Failed to create vault ${vaultId}:`, err);
    throw err;
  }
}

/**
 * Check if a vault exists
 */
export async function vaultExists(vaultId: string): Promise<boolean> {
  try {
    const vaultPath = getVaultPath(vaultId);
    await fs.access(vaultPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a Y.Doc from disk
 * @param vaultId - The vault identifier
 * @returns Y.Doc instance with loaded state
 */
export async function loadVaultState(vaultId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const yDocPath = getYDocPath(vaultId);
  
  try {
    const state = await fs.readFile(yDocPath);
    Y.applyUpdate(doc, new Uint8Array(state));
    console.log(`Loaded Y.Doc state for vault: ${vaultId}`);
  } catch (err: unknown) {
    // If file doesn't exist, return empty doc
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to load Y.Doc for vault ${vaultId}:`, err);
    }
  }
  
  return doc;
}

/**
 * Save a Y.Doc state to disk using atomic write
 * @param vaultId - The vault identifier
 * @param doc - The Y.Doc to save
 */
export async function saveVaultState(vaultId: string, doc: Y.Doc): Promise<void> {
  try {
    const yDocPath = getYDocPath(vaultId);
    const state = Y.encodeStateAsUpdate(doc);
    await atomicWriteBinary(yDocPath, Buffer.from(state));
    console.log(`Saved Y.Doc state for vault: ${vaultId}`);
  } catch (err) {
    console.error(`Failed to save Y.Doc for vault ${vaultId}:`, err);
    throw err;
  }
}

/**
 * List all files in a vault (excluding system files)
 * @param vaultId - The vault identifier
 * @returns Array of file paths relative to vault root
 */
export async function listVaultFiles(vaultId: string): Promise<string[]> {
  const vaultPath = getVaultPath(vaultId);
  const files: string[] = [];
  
  async function scanDirectory(dirPath: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        // Skip hidden files and Y.Doc state files
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) {
          continue;
        }
        
        const fullPath = path.join(dirPath, entry.name);
        const relPath = path.join(relativePath, entry.name);
        
        if (entry.isDirectory()) {
          await scanDirectory(fullPath, relPath);
        } else {
          files.push(relPath);
        }
      }
    } catch (err) {
      console.error(`Failed to scan directory ${dirPath}:`, err);
    }
  }
  
  await scanDirectory(vaultPath);
  return files.sort();
}

/**
 * Read file content from a vault
 * @param vaultId - The vault identifier
 * @param filepath - Path to file relative to vault root
 * @returns File content as string
 */
export async function readVaultFile(vaultId: string, filepath: string): Promise<string> {
  const sanitizedPath = sanitizePath(filepath);
  const vaultPath = getVaultPath(vaultId);
  const fullPath = path.join(vaultPath, sanitizedPath);
  
  // Double-check the resolved path is within the vault
  const resolvedPath = path.resolve(fullPath);
  const resolvedVaultPath = path.resolve(vaultPath);
  if (!resolvedPath.startsWith(resolvedVaultPath + path.sep) && resolvedPath !== resolvedVaultPath) {
    throw new Error('Invalid file path');
  }
  
  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    return content;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('File not found');
    }
    throw err;
  }
}

/**
 * Write file content to a vault using atomic write
 * @param vaultId - The vault identifier
 * @param filepath - Path to file relative to vault root
 * @param content - Content to write
 */
export async function writeVaultFile(vaultId: string, filepath: string, content: string): Promise<void> {
  const sanitizedPath = sanitizePath(filepath);
  const vaultPath = getVaultPath(vaultId);
  const fullPath = path.join(vaultPath, sanitizedPath);
  
  // Double-check the resolved path is within the vault
  const resolvedPath = path.resolve(fullPath);
  const resolvedVaultPath = path.resolve(vaultPath);
  if (!resolvedPath.startsWith(resolvedVaultPath + path.sep) && resolvedPath !== resolvedVaultPath) {
    throw new Error('Invalid file path');
  }
  
  try {
    // Ensure parent directory exists
    const dirPath = path.dirname(fullPath);
    await fs.mkdir(dirPath, { recursive: true });
    
    // Use atomic write to prevent corruption on crash
    await atomicWriteFile(fullPath, content);
    console.log(`Wrote file: ${filepath} in vault ${vaultId}`);
  } catch (err) {
    console.error(`Failed to write file ${filepath} in vault ${vaultId}:`, err);
    throw err;
  }
}

/**
 * Delete a file from a vault
 * @param vaultId - The vault identifier
 * @param filepath - Path to file relative to vault root
 */
export async function deleteVaultFile(vaultId: string, filepath: string): Promise<void> {
  const sanitizedPath = sanitizePath(filepath);
  const vaultPath = getVaultPath(vaultId);
  const fullPath = path.join(vaultPath, sanitizedPath);
  
  // Double-check the resolved path is within the vault
  const resolvedPath = path.resolve(fullPath);
  const resolvedVaultPath = path.resolve(vaultPath);
  if (!resolvedPath.startsWith(resolvedVaultPath + path.sep) && resolvedPath !== resolvedVaultPath) {
    throw new Error('Invalid file path');
  }
  
  try {
    await fs.unlink(fullPath);
    console.log(`Deleted file: ${filepath} in vault ${vaultId}`);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // File already doesn't exist, that's fine
      return;
    }
    throw err;
  }
}

/**
 * Rename a file in a vault
 * @param vaultId - The vault identifier
 * @param oldPath - Old path relative to vault root
 * @param newPath - New path relative to vault root
 */
export async function renameVaultFile(vaultId: string, oldPath: string, newPath: string): Promise<void> {
  const sanitizedOldPath = sanitizePath(oldPath);
  const sanitizedNewPath = sanitizePath(newPath);
  const vaultPath = getVaultPath(vaultId);
  const fullOldPath = path.join(vaultPath, sanitizedOldPath);
  const fullNewPath = path.join(vaultPath, sanitizedNewPath);
  
  // Double-check both resolved paths are within the vault
  const resolvedOldPath = path.resolve(fullOldPath);
  const resolvedNewPath = path.resolve(fullNewPath);
  const resolvedVaultPath = path.resolve(vaultPath);
  
  if (!resolvedOldPath.startsWith(resolvedVaultPath + path.sep) && resolvedOldPath !== resolvedVaultPath) {
    throw new Error('Invalid old file path');
  }
  if (!resolvedNewPath.startsWith(resolvedVaultPath + path.sep) && resolvedNewPath !== resolvedVaultPath) {
    throw new Error('Invalid new file path');
  }
  
  try {
    // Ensure parent directory exists for new path
    const newDirPath = path.dirname(fullNewPath);
    await fs.mkdir(newDirPath, { recursive: true });
    
    // Rename the file
    await fs.rename(fullOldPath, fullNewPath);
    console.log(`Renamed file: ${oldPath} -> ${newPath} in vault ${vaultId}`);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('File not found');
    }
    throw err;
  }
}

/**
 * List all available vaults
 * @returns Array of vault IDs
 */
export async function listVaults(): Promise<string[]> {
  try {
    await ensureVaultsDirectory();
    const vaultsDir = path.resolve(VAULTS_PATH);
    const entries = await fs.readdir(vaultsDir, { withFileTypes: true });
    
    return entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .sort();
  } catch (err) {
    console.error('Failed to list vaults:', err);
    return [];
  }
}

/**
 * Delete a vault and all its contents
 * @param vaultId - The vault identifier
 */
export async function deleteVault(vaultId: string): Promise<void> {
  const vaultPath = getVaultPath(vaultId);
  
  try {
    // Remove all vault members from the database
    await deleteAllVaultMembers(vaultId);
    
    // Delete the vault directory
    await fs.rm(vaultPath, { recursive: true, force: true });
    console.log(`Deleted vault: ${vaultId}`);
  } catch (err) {
    console.error(`Failed to delete vault ${vaultId}:`, err);
    throw err;
  }
}

