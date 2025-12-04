/**
 * Hive - Sync Engine
 * Manages Socket.io connection, Y.js synchronization, and file syncing.
 * Includes offline support with Y.Doc persistence and smart merge on reconnect.
 * 
 * @see https://docs.obsidian.md/Plugins/
 */

import { io, Socket } from 'socket.io-client';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { TFile, Vault, Notice, Events, TFolder } from 'obsidian';
import { OfflineManager, PendingChange } from './offline-manager';
import DiffMatchPatch from 'diff-match-patch';

// Cross-environment base64 utilities that work in both Node.js and browser/Obsidian
function base64ToUint8Array(base64: string): Uint8Array {
  // Try Buffer first (Node.js/Electron), fall back to atob (browser)
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Try Buffer first (Node.js/Electron), fall back to btoa (browser)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Message types matching the server
const MessageType = {
  SYNC: 0,
  AWARENESS: 1,
} as const;

/**
 * Connection state enum
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  AUTHENTICATED = 'authenticated',
  SYNCING = 'syncing',
  SYNCED = 'synced',
  MERGING = 'merging',
}

/**
 * File conflict information for conflict resolution
 */
export interface FileConflict {
  filepath: string;
  localContent: string;
  serverContent: string;
  baseContent?: string;
  mergedContent?: string;
}

/**
 * Resolution choice for a conflict
 */
export interface ConflictResolution {
  filepath: string;
  choice: 'local' | 'server' | 'merged';
  content: string;
}

/**
 * Merge result after smart reconnection
 */
export interface MergeResult {
  conflicts: FileConflict[];
  autoMerged: string[];
  serverOnly: string[];
  localOnly: string[];
}

/**
 * User presence information
 */
export interface UserPresence {
  id: number;
  username: string;
  color: string;
  file?: string;
  cursor?: { line: number; ch: number };
  selection?: { from: { line: number; ch: number }; to: { line: number; ch: number } };
}

/**
 * Vault role type (matches server)
 */
export type VaultRole = 'owner' | 'admin' | 'editor' | 'viewer';

/**
 * Sync engine events
 */
export interface SyncEngineEvents {
  'connection-change': (state: ConnectionState) => void;
  'user-joined': (user: { id: number; username: string; role?: VaultRole }) => void;
  'user-left': (user: { id: number; username: string }) => void;
  'presence-update': (users: UserPresence[]) => void;
  'file-change': (filepath: string, content: string) => void;
  'syncing-files': (files: string[]) => void;
  'sync-progress': (synced: number, total: number) => void;
  'conflicts-detected': (conflicts: FileConflict[]) => void;
  'merge-complete': (result: MergeResult) => void;
  'offline-change': (filepath: string) => void;
  'role-change': (role: VaultRole) => void;
  'permission-denied': (action: string, message: string) => void;
  'error': (error: Error) => void;
}

/**
 * Hive Sync Engine - handles real-time collaboration
 */
export class SyncEngine extends Events {
  private socket: Socket | null = null;
  private doc: Y.Doc;
  private awareness: awarenessProtocol.Awareness;
  private serverUrl: string;
  private token: string;
  private vaultId: string;
  private vault: Vault;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private user: { id: number; username: string; color: string } | null = null;
  private pendingChanges: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs = 300;
  private isProcessingRemoteChange = false;
  private syncingFiles: Set<string> = new Set();
  private receivedSyncStep2 = false;
  
  // Role/permission tracking
  private userRole: VaultRole | null = null;
  
  // Offline support
  private offlineManager: OfflineManager;
  private savedYDocState: Uint8Array | null = null;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private readonly AUTO_SAVE_INTERVAL_MS = 30000; // 30 seconds
  private configDir: string;
  private dmp: DiffMatchPatch;

  constructor(
    serverUrl: string,
    token: string,
    vaultId: string,
    vault: Vault,
    userColor: string,
    configDir: string
  ) {
    super();
    this.serverUrl = serverUrl;
    this.token = token;
    this.vaultId = vaultId;
    this.vault = vault;
    this.configDir = configDir;
    
    // Initialize diff-match-patch for three-way merge
    this.dmp = new DiffMatchPatch();
    
    // Initialize offline manager
    this.offlineManager = new OfflineManager();
    
    // Initialize Y.js document
    this.doc = new Y.Doc();
    
    // Initialize awareness
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    
    // Set up awareness change listener
    this.awareness.on('change', this.handleAwarenessChange.bind(this));
    
    // Set up document update listener
    this.doc.on('update', this.handleDocUpdate.bind(this));
    
    // Set up file map observer to write remote changes to disk
    this.setupFileMapObserver();
    
    // Store user color
    this.user = { id: 0, username: '', color: userColor };
    
    // Start auto-save interval for Y.Doc state
    this.startAutoSave();
  }

  /**
   * Set up observer on the Y.Doc's files map to detect remote changes
   * and write them to the local filesystem
   */
  private setupFileMapObserver(): void {
    const files = this.doc.getMap('files');
    
    // Observe changes to the files map (adds, updates, deletes)
    files.observe((event: Y.YMapEvent<Y.Text>) => {
      // Skip if this change originated locally
      if (event.transaction.local) return;
      
      console.log('[Hive] Remote file map change detected');
      
      // Handle each changed key (filepath)
      event.keysChanged.forEach(async (filepath) => {
        const change = event.changes.keys.get(filepath);
        
        if (change) {
          if (change.action === 'delete') {
            // File was deleted remotely
            console.log(`[Hive] Remote file deleted: ${filepath}`);
            await this.applyRemoteDelete(filepath);
          } else if (change.action === 'add' || change.action === 'update') {
            // File was added or updated
            const text = files.get(filepath) as Y.Text | undefined;
            if (text) {
              const content = text.toString();
              console.log(`[Hive] Writing remote change to file: ${filepath}`);
              await this.applyRemoteChange(filepath, content);
            }
          }
        }
      });
    });
    
    // Also observe deep changes within existing Y.Text objects
    files.observeDeep((events: Y.YEvent<any>[]) => {
      events.forEach(async (event) => {
        // Skip local changes
        if (event.transaction.local) return;
        
        // Find the filepath for this text change
        if (event.target instanceof Y.Text) {
          // Find which file this Y.Text belongs to
          files.forEach((value, key) => {
            if (value === event.target) {
              const content = (event.target as Y.Text).toString();
              console.log(`[Hive] Writing remote text change to file: ${key}`);
              this.applyRemoteChange(key, content);
            }
          });
        }
      });
    });
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === ConnectionState.AUTHENTICATED ||
           this.connectionState === ConnectionState.SYNCING ||
           this.connectionState === ConnectionState.SYNCED;
  }

  /**
   * Get current user's role in the vault
   */
  getRole(): VaultRole | null {
    return this.userRole;
  }

  /**
   * Check if user can write (editor+ role)
   */
  canWrite(): boolean {
    if (!this.userRole) return false;
    return this.userRole === 'owner' || this.userRole === 'admin' || this.userRole === 'editor';
  }

  /**
   * Check if user is read-only (viewer)
   */
  isReadOnly(): boolean {
    return this.userRole === 'viewer';
  }

  /**
   * Check if user can manage members (admin+)
   */
  canManageMembers(): boolean {
    if (!this.userRole) return false;
    return this.userRole === 'owner' || this.userRole === 'admin';
  }

  /**
   * Check if user is the vault owner
   */
  isOwner(): boolean {
    return this.userRole === 'owner';
  }

  /**
   * Connect to the Hive server
   */
  async connect(): Promise<void> {
    if (this.socket?.connected) {
      return;
    }

    // Load local state before connecting (for offline support)
    await this.loadLocalState();
    
    this.setConnectionState(ConnectionState.CONNECTING);

    return new Promise((resolve, reject) => {
      this.socket = io(this.serverUrl, {
        // Start with polling (more reliable), then upgrade to websocket
        transports: ['polling', 'websocket'],
        // Reconnection settings
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
        // Match server timeout settings to avoid premature disconnects
        timeout: 60000,
        // Upgrade from polling to websocket
        upgrade: true,
        // Force new connection on reconnect
        forceNew: false,
        // Disable auto-unref to keep connection alive
        autoUnref: false,
      });

      this.socket.on('connect', () => {
        console.log('[Hive] Socket connected');
        this.setConnectionState(ConnectionState.CONNECTED);
        this.reconnectAttempts = 0;
        
        // Authenticate
        this.socket!.emit('authenticate', this.token);
      });

      this.socket.on('authenticated', (data: { success: boolean; user?: { id: number; username: string }; error?: string }) => {
        if (data.success && data.user) {
          console.log('[Hive] Authenticated as', data.user.username);
          this.user = { ...data.user, color: this.user?.color || '#000000' };
          this.setConnectionState(ConnectionState.AUTHENTICATED);
          
          // Join vault
          this.joinVault();
          resolve();
        } else {
          const error = new Error(data.error || 'Authentication failed');
          this.trigger('error', error);
          reject(error);
        }
      });

      this.socket.on('vault-joined', (data: { vaultId: string; role?: VaultRole }) => {
        console.log('[Hive] Joined vault:', data.vaultId, data.role ? `as ${data.role}` : '');
        if (data.role) {
          this.userRole = data.role;
          this.trigger('role-change', data.role);
        }
        this.offlineManager.setOnline(true);
        this.setConnectionState(ConnectionState.SYNCING);
      });

      this.socket.on('vault-role', (data: { vaultId: string; role: VaultRole }) => {
        console.log('[Hive] Vault role:', data.role);
        this.userRole = data.role;
        this.trigger('role-change', data.role);
      });

      this.socket.on('permission-denied', (data: { action: string; vaultId: string; message: string }) => {
        console.log('[Hive] Permission denied:', data.action, data.message);
        this.trigger('permission-denied', data.action, data.message);
        new Notice(`Permission denied: ${data.message}`, 5000);
      });

      this.socket.on('file-list', (data: { files: string[] }) => {
        console.log('[Hive] Received file list:', data.files.length, 'files');
        this.syncingFiles = new Set(data.files);
        this.trigger('syncing-files', data.files);
      });

      this.socket.on('sync-message', (data: string) => {
        this.handleSyncMessage(data);
      });

      this.socket.on('user-joined', (user: { userId: number; username: string; role?: VaultRole }) => {
        console.log('[Hive] User joined:', user.username, user.role ? `(${user.role})` : '');
        this.trigger('user-joined', { id: user.userId, username: user.username, role: user.role });
        new Notice(`${user.username} joined the Hive`);
      });

      this.socket.on('user-left', (user: { userId: number; username: string }) => {
        console.log('[Hive] User left:', user.username);
        this.trigger('user-left', { id: user.userId, username: user.username });
        new Notice(`${user.username} left the Hive`);
      });

      this.socket.on('disconnect', (reason: string) => {
        console.log('[Hive] Disconnected:', reason);
        this.setConnectionState(ConnectionState.DISCONNECTED);
        
        if (reason === 'io server disconnect') {
          // Server disconnected us, don't auto-reconnect
          new Notice('Disconnected from the Hive');
        }
      });

      this.socket.on('connect_error', (err: Error) => {
        console.error('[Hive] Connection error:', err);
        this.reconnectAttempts++;
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.setConnectionState(ConnectionState.DISCONNECTED);
          this.trigger('error', new Error('Failed to connect to the Hive after multiple attempts'));
          reject(err);
        }
      });

      this.socket.on('error', (data: { message: string }) => {
        console.error('[Hive] Server error:', data.message);
        this.trigger('error', new Error(data.message));
      });

      // Set connection timeout
      setTimeout(() => {
        if (this.connectionState === ConnectionState.CONNECTING) {
          this.disconnect();
          reject(new Error('Hive connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Join the configured vault
   */
  private joinVault(): void {
    if (this.socket && this.vaultId) {
      this.socket.emit('join-vault', this.vaultId);
    }
  }

  /**
   * Disconnect from the Hive
   */
  disconnect(): void {
    // Save state before disconnecting
    this.saveLocalState().catch(err => {
      console.error('[Hive] Failed to save state on disconnect:', err);
    });
    
    if (this.socket) {
      // Leave vault first
      if (this.vaultId) {
        this.socket.emit('leave-vault', this.vaultId);
      }
      
      this.socket.disconnect();
      this.socket = null;
    }
    
    // Mark as offline
    this.offlineManager.setOnline(false);
    
    this.setConnectionState(ConnectionState.DISCONNECTED);
    this.awareness.setLocalState(null);
    this.syncingFiles.clear();
    this.receivedSyncStep2 = false;
  }

  /**
   * Set connection state and emit event
   */
  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    this.trigger('connection-change', state);
  }

  /**
   * Handle incoming sync message from server
   */
  private handleSyncMessage(data: string): void {
    try {
      const message = base64ToUint8Array(data);
      const decoder = decoding.createDecoder(message);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case MessageType.SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MessageType.SYNC);
          
          const syncMessageType = syncProtocol.readSyncMessage(
            decoder,
            encoder,
            this.doc,
            null
          );
          
          // syncMessageType: 0 = SyncStep1 (state vector), 1 = SyncStep2 (document data), 2 = Update
          if (syncMessageType === 0) {
            console.log('[Hive] Received sync step 1 (state vector)');
            // Only respond to SyncStep1 if we're already synced and receiving incremental updates
            // During initial sync, the server will send SyncStep2 right after, so don't respond yet
            if (this.receivedSyncStep2 && encoding.length(encoder) > 1) {
              // Small delay before responding to avoid message flood
              setTimeout(() => {
                if (this.socket?.connected) {
                  const response = uint8ArrayToBase64(encoding.toUint8Array(encoder));
                  this.socket.emit('sync-message', response);
                }
              }, 50);
            }
          } else if (syncMessageType === 1) {
            console.log('[Hive] Received sync step 2 (document data)');
            // Mark that we received the full document state
            this.receivedSyncStep2 = true;
            // Don't set SYNCED yet - wait for file sync to complete
            // NOW pull down all existing files from the server's Y.Doc
            // Use setTimeout to avoid blocking the socket
            setTimeout(() => {
              this.syncAllFilesFromServer();
            }, 100);
          } else if (syncMessageType === 2) {
            console.log('[Hive] Received update from server');
            // Updates are automatically applied to doc
            // Send acknowledgment response if needed
            if (encoding.length(encoder) > 1 && this.socket?.connected) {
              const response = uint8ArrayToBase64(encoding.toUint8Array(encoder));
              this.socket.emit('sync-message', response);
            }
          }
          break;
        }
        
        case MessageType.AWARENESS: {
          const update = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(this.awareness, update, null);
          break;
        }
      }
    } catch (err) {
      console.error('[Hive] Error handling sync message:', err);
    }
  }

  /**
   * Handle awareness changes
   */
  private handleAwarenessChange({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }): void {
    const users: UserPresence[] = [];
    
    this.awareness.getStates().forEach((state, clientId) => {
      if (state.user) {
        users.push({
          id: clientId,
          ...state.user,
        });
      }
    });
    
    this.trigger('presence-update', users);
  }

  /**
   * Handle local document updates
   */
  private handleDocUpdate(update: Uint8Array, origin: unknown): void {
    // Don't send updates that originated from the server
    if (origin === 'remote') return;
    
    // Send update to server
    if (this.socket && this.isConnected()) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MessageType.SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = uint8ArrayToBase64(encoding.toUint8Array(encoder));
      this.socket.emit('sync-message', message);
    }
  }

  /**
   * Get or create Y.Text for a file
   */
  getFileText(filepath: string): Y.Text {
    const files = this.doc.getMap('files');
    let text = files.get(filepath) as Y.Text | undefined;
    
    if (!text) {
      text = new Y.Text();
      files.set(filepath, text);
    }
    
    return text;
  }

  /**
   * Sync all files from the server's Y.Doc to the local vault
   * Called after initial sync to pull down existing files
   * Uses smart merge if there are pending offline changes
   */
  private async syncAllFilesFromServer(): Promise<void> {
    const files = this.doc.getMap('files');
    const fileCount = files.size;
    
    // Check if we have pending offline changes - if so, use smart merge
    if (this.offlineManager.hasPendingChanges()) {
      console.log('[Hive] Pending offline changes detected, using smart merge');
      const result = await this.smartMergeOnReconnect();
      
      const totalChanges = result.autoMerged.length + result.conflicts.length + 
                          result.serverOnly.length + result.localOnly.length;
      
      if (result.conflicts.length > 0) {
        new Notice(`${result.conflicts.length} file(s) need conflict resolution`, 5000);
      } else if (totalChanges > 0) {
        new Notice(`Merged ${result.autoMerged.length} files from Hive`);
      }
      
      // Handle server-only files (create them locally)
      for (const filepath of result.serverOnly) {
        const text = files.get(filepath) as Y.Text | undefined;
        if (text) {
          const content = text.toString();
          try {
            const dir = filepath.substring(0, filepath.lastIndexOf('/'));
            if (dir && !this.vault.getAbstractFileByPath(dir)) {
              await this.vault.createFolder(dir);
            }
            await this.vault.create(filepath, content);
            this.offlineManager.setBaseContent(filepath, content);
            console.log(`[Hive] Created from server: ${filepath}`);
          } catch (err) {
            console.error(`[Hive] Error creating file ${filepath}:`, err);
          }
        }
      }
      
      this.syncingFiles.clear();
      return;
    }
    
    // No pending changes - do regular sync
    if (fileCount === 0) {
      console.log('[Hive] No files to sync from server');
      this.syncingFiles.clear();
      this.setConnectionState(ConnectionState.SYNCED);
      return;
    }
    
    console.log(`[Hive] Syncing ${fileCount} files from server...`);
    
    let synced = 0;
    let created = 0;
    let updated = 0;
    const totalFiles = fileCount;
    
    // Iterate over all files in the Y.Doc
    for (const [filepath, value] of files.entries()) {
      if (!(value instanceof Y.Text)) continue;
      
      const content = value.toString();
      
      try {
        const existingFile = this.vault.getAbstractFileByPath(filepath);
        
        if (existingFile instanceof TFile) {
          // File exists, check if content differs
          const localContent = await this.vault.read(existingFile);
          if (localContent !== content) {
            await this.vault.modify(existingFile, content);
            updated++;
            console.log(`[Hive] Updated: ${filepath}`);
          }
        } else {
          // File doesn't exist, create it
          // Ensure parent directories exist
          const dir = filepath.substring(0, filepath.lastIndexOf('/'));
          if (dir && !this.vault.getAbstractFileByPath(dir)) {
            await this.vault.createFolder(dir);
          }
          await this.vault.create(filepath, content);
          created++;
          console.log(`[Hive] Created: ${filepath}`);
        }
        
        // Store base content for future conflict detection
        this.offlineManager.setBaseContent(filepath, content);
        
        synced++;
        
        // Remove from syncing set and emit progress
        this.syncingFiles.delete(filepath);
        this.trigger('sync-progress', synced, totalFiles);
      } catch (err) {
        console.error(`[Hive] Error syncing file ${filepath}:`, err);
        this.syncingFiles.delete(filepath);
      }
    }
    
    // Clear any remaining syncing files
    this.syncingFiles.clear();
    
    // Update sync time
    this.offlineManager.updateLastSyncTime();
    
    // Save local state for offline support
    await this.saveLocalState();
    
    console.log(`[Hive] Sync complete: ${synced} files processed (${created} created, ${updated} updated)`);
    
    if (created > 0 || updated > 0) {
      new Notice(`Synced ${created + updated} files from Hive`);
    }
    
    // Now that files are synced, set state to SYNCED
    this.setConnectionState(ConnectionState.SYNCED);
  }

  /**
   * Handle local file change from Obsidian
   */
  async onFileChange(file: TFile): Promise<void> {
    if (this.isProcessingRemoteChange) return;
    
    // Block writes if user is read-only viewer
    if (this.isConnected() && this.isReadOnly()) {
      console.log(`[Hive] Blocked file change (read-only): ${file.path}`);
      this.trigger('permission-denied', 'write', 'You have read-only access to this vault');
      return;
    }
    
    // Debounce changes
    const existing = this.pendingChanges.get(file.path);
    if (existing) {
      clearTimeout(existing);
    }
    
    this.pendingChanges.set(file.path, setTimeout(async () => {
      this.pendingChanges.delete(file.path);
      
      try {
        const content = await this.vault.read(file);
        const text = this.getFileText(file.path);
        
        // Track offline change if disconnected
        if (!this.isConnected()) {
          this.trackOfflineChange(file.path, content);
          console.log(`[Hive] Tracked offline change: ${file.path}`);
        }
        
        // Only update if content actually changed
        if (text.toString() !== content) {
          this.doc.transact(() => {
            text.delete(0, text.length);
            text.insert(0, content);
          });
        }
      } catch (err) {
        console.error('[Hive] Error syncing file:', err);
      }
    }, this.debounceMs));
  }

  /**
   * Handle local file rename from Obsidian
   */
  onFileRename(oldPath: string, newPath: string): void {
    if (this.isProcessingRemoteChange) return;
    
    // Block writes if user is read-only viewer
    if (this.isConnected() && this.isReadOnly()) {
      console.log(`[Hive] Blocked file rename (read-only): ${oldPath} -> ${newPath}`);
      this.trigger('permission-denied', 'write', 'You have read-only access to this vault');
      return;
    }
    
    console.log(`[Hive] File renamed: ${oldPath} -> ${newPath}`);
    
    const files = this.doc.getMap('files');
    const oldText = files.get(oldPath) as Y.Text | undefined;
    
    if (oldText) {
      // Get the content from the old Y.Text
      const content = oldText.toString();
      
      // Perform the rename in a single transaction
      this.doc.transact(() => {
        // Create new Y.Text with the same content at the new path
        const newText = new Y.Text();
        newText.insert(0, content);
        files.set(newPath, newText);
        
        // Delete the old entry
        files.delete(oldPath);
      });
      
      // Update offline manager base content
      const baseContent = this.offlineManager.getBaseContent(oldPath);
      if (baseContent !== undefined) {
        this.offlineManager.setBaseContent(newPath, baseContent);
        this.offlineManager.clearBaseContent(oldPath);
      }
      
      console.log(`[Hive] Renamed in Y.Doc: ${oldPath} -> ${newPath}`);
    } else {
      // File wasn't in Y.Doc yet, just add it with new path
      console.log(`[Hive] File not in Y.Doc, will be added on next content change: ${newPath}`);
    }
  }

  /**
   * Handle local file delete from Obsidian
   */
  onFileDelete(filepath: string): void {
    if (this.isProcessingRemoteChange) return;
    
    // Block writes if user is read-only viewer
    if (this.isConnected() && this.isReadOnly()) {
      console.log(`[Hive] Blocked file delete (read-only): ${filepath}`);
      this.trigger('permission-denied', 'write', 'You have read-only access to this vault');
      return;
    }
    
    console.log(`[Hive] File deleted: ${filepath}`);
    
    const files = this.doc.getMap('files');
    
    // Delete from Y.Doc
    if (files.has(filepath)) {
      this.doc.transact(() => {
        files.delete(filepath);
      });
      console.log(`[Hive] Deleted from Y.Doc: ${filepath}`);
    }
    
    // Remove from offline manager
    this.offlineManager.clearBaseContent(filepath);
    this.offlineManager.clearPendingChange(filepath);
  }

  /**
   * Apply remote file change to local vault
   */
  async applyRemoteChange(filepath: string, content: string): Promise<void> {
    this.isProcessingRemoteChange = true;
    
    try {
      const file = this.vault.getAbstractFileByPath(filepath);
      
      if (file instanceof TFile) {
        const currentContent = await this.vault.read(file);
        if (currentContent !== content) {
          await this.vault.modify(file, content);
        }
      } else {
        // Create the file if it doesn't exist
        // Ensure parent directories exist
        const dir = filepath.substring(0, filepath.lastIndexOf('/'));
        if (dir && !this.vault.getAbstractFileByPath(dir)) {
          await this.vault.createFolder(dir);
        }
        await this.vault.create(filepath, content);
      }
    } catch (err) {
      console.error('[Hive] Error applying remote change:', err);
    } finally {
      this.isProcessingRemoteChange = false;
    }
  }

  /**
   * Apply remote file deletion to local vault
   */
  async applyRemoteDelete(filepath: string): Promise<void> {
    this.isProcessingRemoteChange = true;
    
    try {
      const file = this.vault.getAbstractFileByPath(filepath);
      
      if (file instanceof TFile) {
        await this.vault.delete(file);
        console.log(`[Hive] Deleted local file: ${filepath}`);
      }
      
      // Clean up offline manager
      this.offlineManager.clearBaseContent(filepath);
      this.offlineManager.clearPendingChange(filepath);
    } catch (err) {
      console.error('[Hive] Error applying remote delete:', err);
    } finally {
      this.isProcessingRemoteChange = false;
    }
  }

  /**
   * Update local awareness (cursor position, etc.)
   */
  updateAwareness(state: Partial<UserPresence>): void {
    if (!this.user) return;
    
    this.awareness.setLocalStateField('user', {
      ...this.user,
      ...state,
    });
    
    // Send awareness update to server
    if (this.socket && this.isConnected()) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MessageType.AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(
        this.awareness,
        [this.doc.clientID]
      ));
      const message = uint8ArrayToBase64(encoding.toUint8Array(encoder));
      this.socket.emit('sync-message', message);
    }
  }

  /**
   * Get current users in the Hive
   */
  getUsers(): UserPresence[] {
    const users: UserPresence[] = [];
    
    this.awareness.getStates().forEach((state, clientId) => {
      if (state.user) {
        users.push({
          id: clientId,
          ...state.user,
        });
      }
    });
    
    return users;
  }

  /**
   * Get the Y.Doc instance
   */
  getDoc(): Y.Doc {
    return this.doc;
  }

  /**
   * Get the Awareness instance
   */
  getAwareness(): awarenessProtocol.Awareness {
    return this.awareness;
  }

  /**
   * Get list of files currently being synced
   */
  getSyncingFiles(): string[] {
    return Array.from(this.syncingFiles);
  }

  /**
   * Check if initial sync has completed
   */
  hasReceivedInitialSync(): boolean {
    return this.receivedSyncStep2;
  }

  // ==========================================================================
  // Offline Support & Y.Doc Persistence
  // ==========================================================================

  /**
   * Get the offline manager instance
   */
  getOfflineManager(): OfflineManager {
    return this.offlineManager;
  }

  /**
   * Start auto-save interval for Y.Doc state
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    
    this.autoSaveInterval = setInterval(() => {
      this.saveLocalState().catch(err => {
        console.error('[Hive] Auto-save failed:', err);
      });
    }, this.AUTO_SAVE_INTERVAL_MS);
  }

  /**
   * Stop auto-save interval
   */
  private stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  /**
   * Get the path to the Y.Doc state file
   */
  private getStatePath(): string {
    return `${this.configDir}/plugins/collaborative-vault/${this.vaultId}-state.bin`;
  }

  /**
   * Get the path to the offline data file
   */
  private getOfflineDataPath(): string {
    return `${this.configDir}/plugins/collaborative-vault/${this.vaultId}-offline.json`;
  }

  /**
   * Ensure the plugin data directory exists
   */
  private async ensurePluginDir(): Promise<void> {
    const dirPath = `${this.configDir}/plugins/collaborative-vault`;
    try {
      const exists = await this.vault.adapter.exists(dirPath);
      if (!exists) {
        await this.vault.adapter.mkdir(dirPath);
      }
    } catch (err) {
      // Directory might already exist
      console.log('[Hive] Plugin directory check:', err);
    }
  }

  /**
   * Save Y.Doc state to local storage
   */
  async saveLocalState(): Promise<void> {
    try {
      await this.ensurePluginDir();
      
      // Save Y.Doc state
      const state = Y.encodeStateAsUpdate(this.doc);
      const statePath = this.getStatePath();
      await this.vault.adapter.writeBinary(statePath, state);
      
      // Save offline data (pending changes, base contents)
      const offlineData = {
        pendingChanges: this.offlineManager.exportPendingChanges(),
        baseContents: this.offlineManager.exportBaseContents(),
        lastSyncTime: this.offlineManager.getLastSyncTime(),
      };
      const offlinePath = this.getOfflineDataPath();
      await this.vault.adapter.write(offlinePath, JSON.stringify(offlineData));
      
      console.log('[Hive] Saved local state');
    } catch (err) {
      console.error('[Hive] Failed to save local state:', err);
      throw err;
    }
  }

  /**
   * Load Y.Doc state from local storage
   * Returns true if state was loaded, false otherwise
   */
  async loadLocalState(): Promise<boolean> {
    try {
      const statePath = this.getStatePath();
      
      // Check if state file exists
      if (!(await this.vault.adapter.exists(statePath))) {
        console.log('[Hive] No saved state found');
        return false;
      }
      
      // Load Y.Doc state
      const stateBuffer = await this.vault.adapter.readBinary(statePath);
      const state = new Uint8Array(stateBuffer);
      this.savedYDocState = state;
      Y.applyUpdate(this.doc, state, 'local-restore');
      
      // Load offline data
      const offlinePath = this.getOfflineDataPath();
      if (await this.vault.adapter.exists(offlinePath)) {
        const offlineDataStr = await this.vault.adapter.read(offlinePath);
        const offlineData = JSON.parse(offlineDataStr);
        
        if (offlineData.pendingChanges) {
          this.offlineManager.importPendingChanges(offlineData.pendingChanges);
        }
        if (offlineData.baseContents) {
          this.offlineManager.importBaseContents(offlineData.baseContents);
        }
      }
      
      console.log('[Hive] Loaded local state');
      return true;
    } catch (err) {
      console.error('[Hive] Failed to load local state:', err);
      return false;
    }
  }

  /**
   * Get Y.Doc content for a file from saved state (for conflict detection)
   */
  private getSavedYDocContent(filepath: string): string | undefined {
    // First try from offline manager's base content
    const baseContent = this.offlineManager.getBaseContent(filepath);
    if (baseContent !== undefined) {
      return baseContent;
    }
    
    // Otherwise return undefined (no base to compare)
    return undefined;
  }

  /**
   * Apply local content to Y.Doc (for merging offline changes)
   */
  private applyLocalToYDoc(filepath: string, content: string): void {
    const text = this.getFileText(filepath);
    this.doc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, content);
    });
  }

  /**
   * Perform a three-way merge using diff-match-patch
   */
  private threeWayMerge(base: string, local: string, server: string): { merged: string; hasConflict: boolean } {
    // If base is empty/undefined, we can't do a proper three-way merge
    if (!base) {
      // Fall back to simple comparison - if both changed, it's a conflict
      return { merged: local, hasConflict: true };
    }
    
    // Get patches from base to local and base to server
    const localPatches = this.dmp.patch_make(base, local);
    const serverPatches = this.dmp.patch_make(base, server);
    
    // Apply server patches to local version
    const [mergedFromLocal, resultsLocal] = this.dmp.patch_apply(serverPatches, local);
    
    // Apply local patches to server version
    const [mergedFromServer, resultsServer] = this.dmp.patch_apply(localPatches, server);
    
    // Check if all patches applied successfully
    const allLocalApplied = resultsLocal.every(r => r);
    const allServerApplied = resultsServer.every(r => r);
    
    // If both directions apply cleanly and produce same result, no conflict
    if (allLocalApplied && allServerApplied && mergedFromLocal === mergedFromServer) {
      return { merged: mergedFromLocal, hasConflict: false };
    }
    
    // If one direction works better, use that
    if (allLocalApplied && !allServerApplied) {
      return { merged: mergedFromLocal, hasConflict: false };
    }
    if (allServerApplied && !allLocalApplied) {
      return { merged: mergedFromServer, hasConflict: false };
    }
    
    // Both have issues or differ - true conflict
    // Return the version with more successful patches or local as fallback
    const localSuccessCount = resultsLocal.filter(r => r).length;
    const serverSuccessCount = resultsServer.filter(r => r).length;
    
    if (localSuccessCount >= serverSuccessCount) {
      return { merged: mergedFromLocal, hasConflict: true };
    }
    return { merged: mergedFromServer, hasConflict: true };
  }

  /**
   * Smart merge on reconnect - detects conflicts and auto-merges when possible
   */
  async smartMergeOnReconnect(): Promise<MergeResult> {
    this.setConnectionState(ConnectionState.MERGING);
    
    const serverFiles = this.doc.getMap('files');
    const conflicts: FileConflict[] = [];
    const autoMerged: string[] = [];
    const serverOnly: string[] = [];
    const localOnly: string[] = [];
    
    const processedFiles = new Set<string>();
    
    // Process files from server Y.Doc
    for (const [filepath, value] of serverFiles.entries()) {
      if (!(value instanceof Y.Text)) continue;
      processedFiles.add(filepath);
      
      const serverContent = value.toString();
      const localFile = this.vault.getAbstractFileByPath(filepath);
      
      if (!(localFile instanceof TFile)) {
        // File exists on server but not locally - create it
        serverOnly.push(filepath);
        continue;
      }
      
      let localContent: string;
      try {
        localContent = await this.vault.read(localFile);
      } catch (err) {
        console.error(`[Hive] Failed to read local file ${filepath}:`, err);
        continue;
      }
      
      // Get base content (content at time of last sync)
      const baseContent = this.getSavedYDocContent(filepath);
      
      // If content is the same, no action needed
      if (localContent === serverContent) {
        // Update base content for future syncs
        this.offlineManager.setBaseContent(filepath, serverContent);
        continue;
      }
      
      // Determine what changed
      const localChanged = baseContent !== undefined && baseContent !== localContent;
      const serverChanged = baseContent !== undefined && baseContent !== serverContent;
      
      if (!localChanged && serverChanged) {
        // Only server changed - safe to apply server version
        try {
          await this.vault.modify(localFile, serverContent);
          autoMerged.push(filepath);
          this.offlineManager.setBaseContent(filepath, serverContent);
          console.log(`[Hive] Auto-merged (server): ${filepath}`);
        } catch (err) {
          console.error(`[Hive] Failed to apply server changes to ${filepath}:`, err);
        }
      } else if (localChanged && !serverChanged) {
        // Only local changed - push local to Y.Doc
        this.applyLocalToYDoc(filepath, localContent);
        autoMerged.push(filepath);
        this.offlineManager.setBaseContent(filepath, localContent);
        console.log(`[Hive] Auto-merged (local): ${filepath}`);
      } else if (localChanged && serverChanged) {
        // Both changed - try three-way merge
        const { merged, hasConflict } = this.threeWayMerge(
          baseContent || '',
          localContent,
          serverContent
        );
        
        if (!hasConflict) {
          // Clean merge - apply it
          try {
            await this.vault.modify(localFile, merged);
            this.applyLocalToYDoc(filepath, merged);
            autoMerged.push(filepath);
            this.offlineManager.setBaseContent(filepath, merged);
            console.log(`[Hive] Auto-merged (three-way): ${filepath}`);
          } catch (err) {
            console.error(`[Hive] Failed to apply merged content to ${filepath}:`, err);
          }
        } else {
          // True conflict - needs user resolution
          conflicts.push({
            filepath,
            localContent,
            serverContent,
            baseContent,
            mergedContent: merged,
          });
          console.log(`[Hive] Conflict detected: ${filepath}`);
        }
      } else {
        // No base content - new file scenario, treat as conflict if different
        if (baseContent === undefined && localContent !== serverContent) {
          const { merged, hasConflict } = this.threeWayMerge('', localContent, serverContent);
          
          if (!hasConflict) {
            try {
              await this.vault.modify(localFile, merged);
              this.applyLocalToYDoc(filepath, merged);
              autoMerged.push(filepath);
              this.offlineManager.setBaseContent(filepath, merged);
            } catch (err) {
              console.error(`[Hive] Failed to apply merged content to ${filepath}:`, err);
            }
          } else {
            conflicts.push({
              filepath,
              localContent,
              serverContent,
              baseContent: undefined,
              mergedContent: merged,
            });
          }
        }
      }
    }
    
    // Check for local-only files (pending changes that don't exist on server)
    const pendingChanges = this.offlineManager.getPendingChanges();
    for (const [filepath, change] of pendingChanges) {
      if (!processedFiles.has(filepath)) {
        // File was created/modified locally but doesn't exist on server
        localOnly.push(filepath);
        // Push to Y.Doc
        this.applyLocalToYDoc(filepath, change.localContent);
        this.offlineManager.setBaseContent(filepath, change.localContent);
      }
    }
    
    // Clear pending changes after merge
    this.offlineManager.clearAllPending();
    
    // Update sync time
    this.offlineManager.updateLastSyncTime();
    
    // Save state after merge
    await this.saveLocalState();
    
    const result: MergeResult = { conflicts, autoMerged, serverOnly, localOnly };
    
    // Emit events
    if (conflicts.length > 0) {
      this.trigger('conflicts-detected', conflicts);
    }
    this.trigger('merge-complete', result);
    
    // If no conflicts, set to synced
    if (conflicts.length === 0) {
      this.setConnectionState(ConnectionState.SYNCED);
    }
    
    return result;
  }

  /**
   * Apply conflict resolutions
   */
  async applyConflictResolutions(resolutions: ConflictResolution[]): Promise<void> {
    for (const resolution of resolutions) {
      try {
        const file = this.vault.getAbstractFileByPath(resolution.filepath);
        
        if (file instanceof TFile) {
          await this.vault.modify(file, resolution.content);
        } else {
          // Create file if it doesn't exist
          const dir = resolution.filepath.substring(0, resolution.filepath.lastIndexOf('/'));
          if (dir && !this.vault.getAbstractFileByPath(dir)) {
            await this.vault.createFolder(dir);
          }
          await this.vault.create(resolution.filepath, resolution.content);
        }
        
        // Update Y.Doc
        this.applyLocalToYDoc(resolution.filepath, resolution.content);
        
        // Update base content
        this.offlineManager.setBaseContent(resolution.filepath, resolution.content);
        
        console.log(`[Hive] Applied resolution for ${resolution.filepath}: ${resolution.choice}`);
      } catch (err) {
        console.error(`[Hive] Failed to apply resolution for ${resolution.filepath}:`, err);
        throw err;
      }
    }
    
    // Save state after applying resolutions
    await this.saveLocalState();
    
    // Set to synced
    this.setConnectionState(ConnectionState.SYNCED);
  }

  /**
   * Track an offline change
   */
  trackOfflineChange(filepath: string, content: string): void {
    this.offlineManager.trackOfflineChange(filepath, content);
    this.trigger('offline-change', filepath);
  }

  /**
   * Check if there are pending offline changes
   */
  hasPendingOfflineChanges(): boolean {
    return this.offlineManager.hasPendingChanges();
  }

  /**
   * Get count of pending offline changes
   */
  getPendingOfflineCount(): number {
    return this.offlineManager.getPendingCount();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Stop auto-save
    this.stopAutoSave();
    
    // Save state before destroying
    this.saveLocalState().catch(err => {
      console.error('[Hive] Failed to save state on destroy:', err);
    });
    
    // Clear pending changes
    this.pendingChanges.forEach(timeout => clearTimeout(timeout));
    this.pendingChanges.clear();
    
    // Disconnect
    this.disconnect();
    
    // Clean up offline manager
    this.offlineManager.destroy();
    
    // Clean up Y.js
    this.awareness.destroy();
    this.doc.destroy();
  }
}
