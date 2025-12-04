/**
 * Test script for Y.js synchronization between multiple clients.
 * Run with: node test-sync.js
 * 
 * This script tests:
 * 1. Vault creation via API
 * 2. Socket.io connection and authentication
 * 3. Y.js sync between two clients
 * 4. File operations via API
 */

const { io } = require('socket.io-client');
const Y = require('yjs');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const syncProtocol = require('y-protocols/sync');

const BASE_URL = 'http://localhost:3000';

// Message types matching the server
const MessageType = {
  SYNC: 0,
  AWARENESS: 1,
};

// Helper to make HTTP requests
async function request(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(`${BASE_URL}${path}`, options);
  return response.json();
}

// Create a test client with Y.js
class TestClient {
  constructor(name) {
    this.name = name;
    this.socket = null;
    this.doc = new Y.Doc();
    this.token = null;
    this.connected = false;
    this.synced = false;
  }
  
  async register(username, password) {
    const result = await request('POST', '/api/register', { username, password });
    console.log(`[${this.name}] Register:`, result);
    return result;
  }
  
  async login(username, password) {
    const result = await request('POST', '/api/login', { username, password });
    if (result.token) {
      this.token = result.token;
      console.log(`[${this.name}] Logged in as ${username}`);
    }
    return result;
  }
  
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(BASE_URL);
      
      this.socket.on('connect', () => {
        console.log(`[${this.name}] Socket connected`);
        this.connected = true;
        
        // Authenticate
        this.socket.emit('authenticate', this.token);
      });
      
      this.socket.on('authenticated', (data) => {
        if (data.success) {
          console.log(`[${this.name}] Authenticated as ${data.user.username}`);
          resolve();
        } else {
          reject(new Error('Authentication failed'));
        }
      });
      
      this.socket.on('sync-message', (data) => {
        this.handleSyncMessage(data);
      });
      
      this.socket.on('error', (err) => {
        console.error(`[${this.name}] Socket error:`, err);
      });
      
      this.socket.on('disconnect', () => {
        console.log(`[${this.name}] Disconnected`);
        this.connected = false;
      });
    });
  }
  
  handleSyncMessage(data) {
    try {
      const message = new Uint8Array(Buffer.from(data, 'base64'));
      const decoder = decoding.createDecoder(message);
      const messageType = decoding.readVarUint(decoder);
      
      if (messageType === MessageType.SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MessageType.SYNC);
        
        const syncMessageType = syncProtocol.readSyncMessage(
          decoder,
          encoder,
          this.doc,
          null
        );
        
        // Send response if we have one
        if (encoding.length(encoder) > 1) {
          const response = Buffer.from(encoding.toUint8Array(encoder)).toString('base64');
          this.socket.emit('sync-message', response);
        }
        
        if (syncMessageType === 0) {
          // Received sync step 1, we're synced now
          this.synced = true;
          console.log(`[${this.name}] Sync step 1 received, sending step 2`);
        } else if (syncMessageType === 2) {
          console.log(`[${this.name}] Received update from server`);
        }
      } else if (messageType === MessageType.AWARENESS) {
        console.log(`[${this.name}] Received awareness update`);
      }
    } catch (err) {
      console.error(`[${this.name}] Error handling sync message:`, err);
    }
  }
  
  joinVault(vaultId) {
    return new Promise((resolve) => {
      this.socket.once('vault-joined', (data) => {
        console.log(`[${this.name}] Joined vault: ${data.vaultId}`);
        resolve(data);
      });
      
      this.socket.emit('join-vault', vaultId);
    });
  }
  
  sendUpdate() {
    // Send current doc state as sync message
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.SYNC);
    syncProtocol.writeSyncStep2(encoder, this.doc);
    const message = Buffer.from(encoding.toUint8Array(encoder)).toString('base64');
    this.socket.emit('sync-message', message);
  }
  
  getText(name) {
    return this.doc.getText(name);
  }
  
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Main test function
async function runTests() {
  console.log('='.repeat(60));
  console.log('Y.js Sync Test');
  console.log('='.repeat(60));
  console.log('');
  
  const client1 = new TestClient('Client1');
  const client2 = new TestClient('Client2');
  
  try {
    // Step 1: Register and login users
    console.log('--- Step 1: Authentication ---');
    await client1.register('syncuser1', 'password123');
    await client2.register('syncuser2', 'password123');
    
    await client1.login('syncuser1', 'password123');
    await client2.login('syncuser2', 'password123');
    console.log('');
    
    // Step 2: Test vault API
    console.log('--- Step 2: Vault API ---');
    const vaultId = `test-vault-${Date.now()}`;
    const createResult = await request('POST', '/api/vault/create', { vaultId }, client1.token);
    console.log('Create vault:', createResult);
    
    const listResult = await request('GET', '/api/vault/list', null, client1.token);
    console.log('List vaults:', listResult);
    console.log('');
    
    // Step 3: Test file API
    console.log('--- Step 3: File API ---');
    const writeResult = await request('POST', `/api/vault/${vaultId}/file/test.md`, 
      { content: '# Test File\n\nThis is a test.' }, client1.token);
    console.log('Write file:', writeResult);
    
    const readResult = await request('GET', `/api/vault/${vaultId}/file/test.md`, null, client1.token);
    console.log('Read file:', readResult);
    
    const filesResult = await request('GET', `/api/vault/${vaultId}/files`, null, client1.token);
    console.log('List files:', filesResult);
    console.log('');
    
    // Step 4: Connect clients via WebSocket
    console.log('--- Step 4: WebSocket Connection ---');
    await client1.connect();
    await client2.connect();
    console.log('');
    
    // Step 5: Join vault
    console.log('--- Step 5: Join Vault ---');
    await client1.joinVault(vaultId);
    await new Promise(r => setTimeout(r, 500)); // Wait for sync
    await client2.joinVault(vaultId);
    await new Promise(r => setTimeout(r, 500)); // Wait for sync
    console.log('');
    
    // Step 6: Test Y.js sync
    console.log('--- Step 6: Y.js Sync ---');
    
    // Client 1 makes a change
    const text1 = client1.getText('shared-doc');
    text1.insert(0, 'Hello from Client 1! ');
    console.log(`[Client1] Inserted text, doc: "${text1.toString()}"`);
    client1.sendUpdate();
    
    await new Promise(r => setTimeout(r, 1000)); // Wait for sync
    
    // Client 2 makes a change
    const text2 = client2.getText('shared-doc');
    text2.insert(text2.length, 'Hello from Client 2!');
    console.log(`[Client2] Inserted text, doc: "${text2.toString()}"`);
    client2.sendUpdate();
    
    await new Promise(r => setTimeout(r, 1000)); // Wait for sync
    
    // Check if both clients have the same content
    console.log('');
    console.log('--- Final State ---');
    console.log(`[Client1] Doc content: "${client1.getText('shared-doc').toString()}"`);
    console.log(`[Client2] Doc content: "${client2.getText('shared-doc').toString()}"`);
    
    const client1Content = client1.getText('shared-doc').toString();
    const client2Content = client2.getText('shared-doc').toString();
    
    if (client1Content === client2Content) {
      console.log('');
      console.log('✅ SUCCESS: Both clients have the same content!');
    } else {
      console.log('');
      console.log('❌ MISMATCH: Clients have different content');
    }
    
    // Step 7: Get vault info
    console.log('');
    console.log('--- Step 7: Vault Info ---');
    const vaultInfo = await request('GET', `/api/vault/${vaultId}`, null, client1.token);
    console.log('Vault info:', JSON.stringify(vaultInfo, null, 2));
    
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    // Cleanup
    console.log('');
    console.log('--- Cleanup ---');
    client1.disconnect();
    client2.disconnect();
    console.log('Clients disconnected');
  }
  
  console.log('');
  console.log('='.repeat(60));
  console.log('Test Complete');
  console.log('='.repeat(60));
}

runTests().catch(console.error);
