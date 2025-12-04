/**
 * Hive - Collaboration Engine
 * Manages real-time collaboration using Y.js CRDT for conflict-free editing.
 * Handles awareness protocol for cursor positions and user presence.
 * 
 * @see https://docs.obsidian.md/Plugins/ for Obsidian plugin integration
 */

import * as Y from 'yjs';
import { Server, Socket } from 'socket.io';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { createVault, loadVaultState, saveVaultState, vaultExists, writeVaultFile, deleteVaultFile, renameVaultFile } from './vault';
import { 
  getUserVaultRole, 
  canRead, 
  canWrite, 
  setVaultOwner, 
  vaultHasMembers,
  VaultRole 
} from './permissions';

// Message types for the sync protocol
const MessageType = {
  SYNC: 0,
  AWARENESS: 1,
  AUTH: 2,
} as const;

// Store for active Y.Docs per vault
const vaultDocs = new Map<string, Y.Doc>();

// Store for awareness instances per vault
const vaultAwareness = new Map<string, awarenessProtocol.Awareness>();

// Store for clients in each vault
const vaultClients = new Map<string, Set<Socket>>();

// Auto-save interval (in ms) - reduced from 30s to 10s for better data safety
const SAVE_INTERVAL = 10000; // 10 seconds

// Track dirty vaults that need saving
const dirtyVaults = new Set<string>();

/**
 * Get or create a Y.Doc for a vault
 */
async function getOrCreateDoc(vaultId: string): Promise<Y.Doc> {
  let doc = vaultDocs.get(vaultId);
  
  if (!doc) {
    // Check if vault exists, create if not
    if (!(await vaultExists(vaultId))) {
      await createVault(vaultId);
    }
    
    // Load existing state
    doc = await loadVaultState(vaultId);
    vaultDocs.set(vaultId, doc);
    
    // Set up update listener to mark vault as dirty
    doc.on('update', () => {
      dirtyVaults.add(vaultId);
    });
    
    // Set up file map observer to persist files to disk
    setupFileMapObserver(vaultId, doc);
    
    console.log(`Initialized Y.Doc for vault: ${vaultId}`);
  }
  
  return doc;
}

/**
 * Set up observer on the Y.Doc's files map to persist changes to disk
 */
function setupFileMapObserver(vaultId: string, doc: Y.Doc): void {
  const files = doc.getMap('files');
  
  // Debounce file writes to avoid excessive disk I/O (reduced from 500ms to 200ms for faster persistence)
  const pendingWrites = new Map<string, NodeJS.Timeout>();
  const pendingDeletes = new Map<string, NodeJS.Timeout>();
  const writeDebounceMs = 200;
  
  const scheduleFileWrite = (filepath: string, content: string) => {
    // Clear any pending write or delete for this file
    const existingWrite = pendingWrites.get(filepath);
    if (existingWrite) {
      clearTimeout(existingWrite);
    }
    const existingDelete = pendingDeletes.get(filepath);
    if (existingDelete) {
      clearTimeout(existingDelete);
      pendingDeletes.delete(filepath);
    }
    
    // Schedule new write
    pendingWrites.set(filepath, setTimeout(async () => {
      pendingWrites.delete(filepath);
      try {
        await writeVaultFile(vaultId, filepath, content);
        console.log(`[FileObserver] Persisted file to disk: ${filepath}`);
      } catch (err) {
        console.error(`[FileObserver] Failed to persist file ${filepath}:`, err);
      }
    }, writeDebounceMs));
  };
  
  const scheduleFileDelete = (filepath: string) => {
    // Clear any pending write for this file
    const existingWrite = pendingWrites.get(filepath);
    if (existingWrite) {
      clearTimeout(existingWrite);
      pendingWrites.delete(filepath);
    }
    
    // Clear any pending delete
    const existingDelete = pendingDeletes.get(filepath);
    if (existingDelete) {
      clearTimeout(existingDelete);
    }
    
    // Schedule delete
    pendingDeletes.set(filepath, setTimeout(async () => {
      pendingDeletes.delete(filepath);
      try {
        await deleteVaultFile(vaultId, filepath);
        console.log(`[FileObserver] Deleted file from disk: ${filepath}`);
      } catch (err) {
        console.error(`[FileObserver] Failed to delete file ${filepath}:`, err);
      }
    }, writeDebounceMs));
  };
  
  // Observe the files map for adds, updates, and deletes
  files.observe((event) => {
    event.keysChanged.forEach((filepath) => {
      const change = event.changes.keys.get(filepath);
      
      if (change) {
        if (change.action === 'delete') {
          // File was deleted
          console.log(`[FileObserver] File deleted from Y.Doc: ${filepath}`);
          scheduleFileDelete(filepath);
        } else if (change.action === 'add' || change.action === 'update') {
          // File was added or updated
          const text = files.get(filepath) as Y.Text | undefined;
          if (text) {
            const content = text.toString();
            scheduleFileWrite(filepath, content);
          }
        }
      }
    });
  });
  
  // Observe deep changes to catch text edits within files
  files.observeDeep((events: Y.YEvent<any>[]) => {
    events.forEach((event) => {
      // Handle Y.Text changes (content edits)
      if (event.target instanceof Y.Text) {
        // Find which file this Y.Text belongs to
        files.forEach((value, key) => {
          if (value === event.target) {
            const content = (event.target as Y.Text).toString();
            scheduleFileWrite(key, content);
          }
        });
      }
    });
  });
  
  console.log(`[FileObserver] Set up file persistence observer for vault: ${vaultId}`);
}

/**
 * Get or create an Awareness instance for a vault
 */
function getOrCreateAwareness(vaultId: string, doc: Y.Doc): awarenessProtocol.Awareness {
  let awareness = vaultAwareness.get(vaultId);
  
  if (!awareness) {
    awareness = new awarenessProtocol.Awareness(doc);
    vaultAwareness.set(vaultId, awareness);
    
    // Clean up awareness when all clients disconnect
    awareness.on('change', ({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }) => {
      const clients = vaultClients.get(vaultId);
      if (clients && clients.size > 0) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MessageType.AWARENESS);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(
          awareness!,
          [...added, ...updated, ...removed]
        ));
        const message = encoding.toUint8Array(encoder);
        
        clients.forEach(client => {
          client.emit('sync-message', Buffer.from(message).toString('base64'));
        });
      }
    });
    
    console.log(`Initialized Awareness for vault: ${vaultId}`);
  }
  
  return awareness;
}

/**
 * Add a client to a vault's client set
 */
function addClientToVault(vaultId: string, socket: Socket): void {
  let clients = vaultClients.get(vaultId);
  if (!clients) {
    clients = new Set();
    vaultClients.set(vaultId, clients);
  }
  clients.add(socket);
}

/**
 * Remove a client from a vault's client set
 * Saves immediately when the last client disconnects to prevent data loss
 */
async function removeClientFromVault(vaultId: string, socket: Socket): Promise<void> {
  const clients = vaultClients.get(vaultId);
  if (clients) {
    clients.delete(socket);
    
    // Clean up if no clients left - save immediately to prevent data loss
    if (clients.size === 0) {
      vaultClients.delete(vaultId);
      
      // Save state immediately when last client leaves
      await saveAndCleanupVault(vaultId);
    }
  }
}

/**
 * Save vault state and clean up memory
 */
async function saveAndCleanupVault(vaultId: string): Promise<void> {
  const doc = vaultDocs.get(vaultId);
  if (doc) {
    await saveVaultState(vaultId, doc);
    
    // Only clean up if no clients are connected
    const clients = vaultClients.get(vaultId);
    if (!clients || clients.size === 0) {
      doc.destroy();
      vaultDocs.delete(vaultId);
      vaultAwareness.delete(vaultId);
      dirtyVaults.delete(vaultId);
      console.log(`Cleaned up vault: ${vaultId}`);
    }
  }
}

/**
 * Handle incoming sync message from client
 * Enforces permission checks for write operations
 */
async function handleSyncMessage(
  socket: Socket,
  vaultId: string,
  message: Uint8Array,
  user: { id: number; username: string },
  userRole: VaultRole
): Promise<void> {
  const doc = await getOrCreateDoc(vaultId);
  const awareness = getOrCreateAwareness(vaultId, doc);
  
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);
  
  switch (messageType) {
    case MessageType.SYNC: {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MessageType.SYNC);
      
      const syncMessageType = syncProtocol.readSyncMessage(
        decoder,
        encoder,
        doc,
        null
      );
      
      // If we have a response, send it
      if (encoding.length(encoder) > 1) {
        socket.emit('sync-message', Buffer.from(encoding.toUint8Array(encoder)).toString('base64'));
      }
      
      // Broadcast update to other clients if it was a sync step 2 (update)
      if (syncMessageType === 2) {
        // Check if user has write permission
        const isViewer = userRole === 'viewer';
        
        if (isViewer) {
          // Viewer tried to write - emit permission denied and don't apply
          console.log(`[Permissions] User ${user.username} (viewer) attempted to write to vault ${vaultId} - denied`);
          socket.emit('permission-denied', { 
            action: 'write', 
            vaultId,
            message: 'You have read-only access to this vault'
          });
          return;
        }
        
        // Mark vault as dirty for periodic save (the actual save happens on the interval)
        dirtyVaults.add(vaultId);
        
        const clients = vaultClients.get(vaultId);
        if (clients) {
          const updateEncoder = encoding.createEncoder();
          encoding.writeVarUint(updateEncoder, MessageType.SYNC);
          syncProtocol.writeUpdate(updateEncoder, Y.encodeStateAsUpdate(doc));
          const updateMessage = Buffer.from(encoding.toUint8Array(updateEncoder)).toString('base64');
          
          clients.forEach(client => {
            if (client.id !== socket.id) {
              client.emit('sync-message', updateMessage);
            }
          });
        }
      }
      break;
    }
    
    case MessageType.AWARENESS: {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(awareness, update, socket);
      
      // Broadcast to other clients
      const clients = vaultClients.get(vaultId);
      if (clients) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MessageType.AWARENESS);
        encoding.writeVarUint8Array(encoder, update);
        const broadcastMessage = Buffer.from(encoding.toUint8Array(encoder)).toString('base64');
        
        clients.forEach(client => {
          if (client.id !== socket.id) {
            client.emit('sync-message', broadcastMessage);
          }
        });
      }
      break;
    }
  }
}

/**
 * Small delay helper to avoid flooding client with messages
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send initial sync state to a client
 * Uses small delays between messages to avoid overwhelming the client connection
 */
async function sendInitialSync(socket: Socket, vaultId: string): Promise<void> {
  const doc = await getOrCreateDoc(vaultId);
  const awareness = getOrCreateAwareness(vaultId, doc);
  
  // Send sync step 1 (state vector)
  const encoder1 = encoding.createEncoder();
  encoding.writeVarUint(encoder1, MessageType.SYNC);
  syncProtocol.writeSyncStep1(encoder1, doc);
  socket.emit('sync-message', Buffer.from(encoding.toUint8Array(encoder1)).toString('base64'));
  
  // Small delay to let client process step 1
  await delay(50);
  
  // Send sync step 2 (full document state) so client gets all data immediately
  // This is the key fix - without this, new clients never receive the server's data
  const encoder2 = encoding.createEncoder();
  encoding.writeVarUint(encoder2, MessageType.SYNC);
  syncProtocol.writeSyncStep2(encoder2, doc);
  socket.emit('sync-message', Buffer.from(encoding.toUint8Array(encoder2)).toString('base64'));
  console.log(`[Sync] Sent full document state to client for vault: ${vaultId}`);
  
  // Small delay before awareness
  await delay(50);
  
  // Send current awareness state
  const awarenessStates = awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MessageType.AWARENESS);
    encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(
      awareness,
      Array.from(awarenessStates.keys())
    ));
    socket.emit('sync-message', Buffer.from(encoding.toUint8Array(awarenessEncoder)).toString('base64'));
  }
}

/**
 * Initialize collaboration system with Socket.io server
 */
export function initializeCollaboration(io: Server): void {
  // Start periodic save interval
  setInterval(async () => {
    for (const vaultId of dirtyVaults) {
      const doc = vaultDocs.get(vaultId);
      if (doc) {
        try {
          await saveVaultState(vaultId, doc);
          dirtyVaults.delete(vaultId);
        } catch (err) {
          console.error(`Failed to auto-save vault ${vaultId}:`, err);
        }
      }
    }
  }, SAVE_INTERVAL);
  
  console.log('Collaboration engine initialized');
}

/**
 * Handle a client joining a vault
 * Verifies permissions and handles migration for existing vaults
 */
export async function handleJoinVault(
  socket: Socket,
  vaultId: string,
  user: { id: number; username: string }
): Promise<{ success: boolean; role?: VaultRole; error?: string }> {
  // Check if vault has any members (for migration)
  const hasMembers = await vaultHasMembers(vaultId);
  
  let userRole: VaultRole;
  
  if (!hasMembers) {
    // First user to join a vault without members becomes the owner (migration)
    const ownerResult = await setVaultOwner(vaultId, user.id);
    if (!ownerResult.success) {
      console.error(`Failed to set vault owner: ${ownerResult.error}`);
      socket.emit('error', { message: 'Failed to set vault ownership' });
      return { success: false, error: ownerResult.error };
    }
    userRole = 'owner';
    console.log(`[Migration] User ${user.username} became owner of vault ${vaultId}`);
  } else {
    // Check user's permission
    const role = await getUserVaultRole(user.id, vaultId);
    
    if (!role) {
      // User is not a member of this vault
      console.log(`[Permissions] User ${user.username} denied access to vault ${vaultId} - not a member`);
      socket.emit('permission-denied', { 
        action: 'join', 
        vaultId,
        message: 'You do not have access to this vault'
      });
      return { success: false, error: 'You do not have access to this vault' };
    }
    
    userRole = role;
  }
  
  // Store vault ID, user, and role on socket for cleanup and permission checks
  (socket as any).vaultId = vaultId;
  (socket as any).user = user;
  (socket as any).userRole = userRole;
  
  // Add to vault clients
  addClientToVault(vaultId, socket);
  
  // Join socket.io room for this vault
  socket.join(`vault:${vaultId}`);
  
  // Set up message handler for this socket with role-based permission checking
  socket.on('sync-message', async (data: string) => {
    try {
      const message = new Uint8Array(Buffer.from(data, 'base64'));
      const currentRole = (socket as any).userRole as VaultRole;
      await handleSyncMessage(socket, vaultId, message, user, currentRole);
    } catch (err) {
      console.error(`Error handling sync message:`, err);
    }
  });
  
  // Send file list first so client knows what files are coming
  const fileList = await getVaultFileList(vaultId);
  socket.emit('file-list', { files: fileList });
  console.log(`[Sync] Sent file list (${fileList.length} files) to client for vault: ${vaultId}`);
  
  // Small delay to let client process file list
  await delay(50);
  
  // Send initial sync (includes SyncStep1 and SyncStep2 with full data)
  await sendInitialSync(socket, vaultId);
  
  // Send user their role
  socket.emit('vault-role', { vaultId, role: userRole });
  
  // Save vault state after user joins to persist any initial sync
  const doc = vaultDocs.get(vaultId);
  if (doc) {
    try {
      await saveVaultState(vaultId, doc);
      dirtyVaults.delete(vaultId);
    } catch (err) {
      console.error(`Failed to save vault ${vaultId} after user join:`, err);
    }
  }
  
  console.log(`User ${user.username} (${userRole}) joined vault: ${vaultId}`);
  
  // Notify other clients
  socket.to(`vault:${vaultId}`).emit('user-joined', {
    userId: user.id,
    username: user.username,
    role: userRole
  });
  
  return { success: true, role: userRole };
}

/**
 * Handle a client leaving a vault
 */
export async function handleLeaveVault(
  socket: Socket,
  vaultId: string,
  user: { id: number; username: string }
): Promise<void> {
  // Remove awareness state for this client
  const awareness = vaultAwareness.get(vaultId);
  if (awareness) {
    awarenessProtocol.removeAwarenessStates(awareness, [socket.id as any], null);
  }
  
  // Save vault state before removing client to persist any pending changes
  if (dirtyVaults.has(vaultId)) {
    const doc = vaultDocs.get(vaultId);
    if (doc) {
      try {
        await saveVaultState(vaultId, doc);
        dirtyVaults.delete(vaultId);
      } catch (err) {
        console.error(`Failed to save vault ${vaultId} before user leave:`, err);
      }
    }
  }
  
  // Remove from vault clients (saves immediately if last client)
  await removeClientFromVault(vaultId, socket);
  
  // Leave socket.io room
  socket.leave(`vault:${vaultId}`);
  
  // Remove message handler
  socket.removeAllListeners('sync-message');
  
  console.log(`User ${user.username} left vault: ${vaultId}`);
  
  // Notify other clients
  socket.to(`vault:${vaultId}`).emit('user-left', {
    userId: user.id,
    username: user.username
  });
}

/**
 * Handle client disconnection - clean up all vault memberships
 */
export async function handleDisconnect(socket: Socket): Promise<void> {
  const vaultId = (socket as any).vaultId;
  const user = (socket as any).user;
  
  if (vaultId && user) {
    await handleLeaveVault(socket, vaultId, user);
  }
}

/**
 * Update awareness state for a user
 */
export function updateAwareness(
  socket: Socket,
  vaultId: string,
  state: {
    cursor?: { line: number; ch: number };
    selection?: { from: { line: number; ch: number }; to: { line: number; ch: number } };
    file?: string;
    user: { id: number; username: string; color: string };
  }
): void {
  const awareness = vaultAwareness.get(vaultId);
  if (awareness) {
    awareness.setLocalStateField(socket.id as any, state);
  }
}

/**
 * Get current users in a vault
 */
export function getVaultUsers(vaultId: string): Array<{ id: number; username: string }> {
  const clients = vaultClients.get(vaultId);
  if (!clients) return [];
  
  const users: Array<{ id: number; username: string }> = [];
  clients.forEach(socket => {
    const user = (socket as any).user;
    if (user) {
      users.push(user);
    }
  });
  
  return users;
}

/**
 * Get a Y.Doc's text content for a specific file
 * Files are stored as Y.Text objects in the Y.Doc's Map
 */
export async function getFileText(vaultId: string, filepath: string): Promise<Y.Text> {
  const doc = await getOrCreateDoc(vaultId);
  const files = doc.getMap('files');
  
  let text = files.get(filepath) as Y.Text | undefined;
  if (!text) {
    text = new Y.Text();
    files.set(filepath, text);
  }
  
  return text;
}

/**
 * Get list of all file paths in a vault's Y.Doc
 */
async function getVaultFileList(vaultId: string): Promise<string[]> {
  const doc = await getOrCreateDoc(vaultId);
  const files = doc.getMap('files');
  const filePaths: string[] = [];
  
  files.forEach((_, key) => {
    filePaths.push(key);
  });
  
  return filePaths.sort();
}

/**
 * Gracefully shutdown - save all dirty vaults
 */
export async function shutdown(): Promise<void> {
  console.log('Shutting down collaboration engine...');
  
  for (const vaultId of vaultDocs.keys()) {
    try {
      await saveAndCleanupVault(vaultId);
    } catch (err) {
      console.error(`Failed to save vault ${vaultId} during shutdown:`, err);
    }
  }
  
  console.log('Collaboration engine shutdown complete');
}

