# Obsidian Collaborative Vault - Development Instructions

This document provides explicit instructions for building a self-hosted collaborative Obsidian vault system with real-time editing and live cursors.

## Project Overview

**Two Applications:**
1. **Server** (Node.js/TypeScript): Manages vault state, authentication, and real-time sync
2. **Client** (Obsidian Plugin/TypeScript): Connects to server, syncs vault, displays cursors

**Tech Stack:**
- Server: Node.js, Express, Socket.io, Y.js (CRDT), SQLite
- Client: Obsidian Plugin API, Socket.io-client, Y.js

---

## Repository Structure

```
obsidian-collab-vault/
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── auth.ts
│   │   ├── vault.ts
│   │   └── collaboration.ts
│   └── data/
│       ├── vaults/
│       └── users.db
├── plugin/
│   ├── manifest.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.ts
│   │   ├── settings.ts
│   │   ├── sync.ts
│   │   └── cursors.ts
│   └── styles.css
└── README.md
```

---

# PHASE 1: Basic Server with Authentication

## Objective
Create a Node.js server that handles user authentication and serves as the foundation for vault management.

## Instructions for Cursor Agent

### Step 1.1: Initialize Server Project

Create `server/` directory and initialize:

```bash
mkdir -p server/src server/data/vaults
cd server
npm init -y
npm install express socket.io sqlite3 bcryptjs jsonwebtoken cors dotenv
npm install -D @types/node @types/express @types/bcryptjs @types/jsonwebtoken @types/cors typescript ts-node nodemon
```

### Step 1.2: Configure TypeScript

Create `server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### Step 1.3: Create Environment Configuration

Create `server/.env`:

```
PORT=3000
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
DATABASE_PATH=./data/users.db
VAULTS_PATH=./data/vaults
```

### Step 1.4: Build Authentication System

Create `server/src/auth.ts`:

**Requirements:**
- Initialize SQLite database with users table (id, username, password_hash, created_at)
- Function to register new user (hash password with bcrypt, store in DB)
- Function to login user (verify password, return JWT token)
- Function to verify JWT token
- Middleware to protect routes

**Key functions to implement:**
```typescript
export async function initializeDatabase(): Promise<void>
export async function registerUser(username: string, password: string): Promise<boolean>
export async function loginUser(username: string, password: string): Promise<string | null>
export function verifyToken(token: string): any
export function authMiddleware(req, res, next): void
```

### Step 1.5: Create Basic Server

Create `server/src/index.ts`:

**Requirements:**
- Initialize Express app with CORS
- Initialize Socket.io with CORS
- Load environment variables
- Initialize authentication database
- Create routes:
  - POST `/api/register` - Register new user
  - POST `/api/login` - Login and get JWT token
  - GET `/api/verify` - Verify token is valid (protected route)
- Start HTTP server on configured port
- Log server startup information

**Socket.io Setup:**
- Listen for connections
- Verify JWT token on connection
- Store authenticated socket connections
- Log connections/disconnections

### Step 1.6: Add Development Scripts

Update `server/package.json` scripts:

```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### Step 1.7: Test Phase 1

Create `server/test-auth.sh` (bash script to test authentication):

```bash
#!/bin/bash
# Test user registration
curl -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass123"}'

# Test user login
TOKEN=$(curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass123"}' \
  | jq -r '.token')

# Test token verification
curl http://localhost:3000/api/verify \
  -H "Authorization: Bearer $TOKEN"
```

**Test Checklist:**
- [ ] Server starts without errors
- [ ] Can register new user
- [ ] Can login with correct credentials
- [ ] Login fails with wrong credentials
- [ ] Token verification works
- [ ] Protected routes reject invalid tokens

---

# PHASE 2: Y.js Integration and Vault Sync

## Objective
Implement CRDT-based synchronization using Y.js for conflict-free collaborative editing.

## Instructions for Cursor Agent

### Step 2.1: Install Y.js Dependencies

```bash
cd server
npm install yjs y-protocols lib0
```

### Step 2.2: Create Vault Management System

Create `server/src/vault.ts`:

**Requirements:**
- Function to create new vault (creates directory, initializes Y.Doc)
- Function to load vault (loads existing Y.Doc from disk)
- Function to save vault state to disk
- Function to list all files in vault
- Function to read file content
- Function to write file content
- Use filesystem to store vault files persistently

**Key functions to implement:**
```typescript
export async function createVault(vaultId: string): Promise<boolean>
export async function loadVault(vaultId: string): Promise<any>
export async function saveVault(vaultId: string, doc: any): Promise<void>
export async function listVaultFiles(vaultId: string): Promise<string[]>
export async function readVaultFile(vaultId: string, filepath: string): Promise<string>
export async function writeVaultFile(vaultId: string, filepath: string, content: string): Promise<void>
```

### Step 2.3: Create Collaboration Engine

Create `server/src/collaboration.ts`:

**Requirements:**
- Manage Y.Doc instances per vault (Map<vaultId, Y.Doc>)
- Handle awareness protocol for cursor positions
- Broadcast updates to all connected clients in same vault
- Persist Y.Doc state to disk periodically
- Handle client sync requests

**Key functions to implement:**
```typescript
export function initializeCollaboration(io: SocketIO.Server): void
export function handleClientSync(socket: Socket, vaultId: string, update: Uint8Array): void
export function broadcastUpdate(vaultId: string, update: Uint8Array, excludeSocket?: Socket): void
export function handleAwareness(socket: Socket, vaultId: string, awareness: any): void
```

### Step 2.4: Integrate Collaboration into Server

Update `server/src/index.ts`:

**Add Socket.io event handlers:**
- `join-vault` - Client joins a vault, send current Y.Doc state
- `sync-update` - Client sends Y.js update, broadcast to others
- `awareness-update` - Client sends cursor/selection, broadcast to others
- `disconnect` - Clean up client state

**Requirements:**
- Verify user is authenticated before joining vault
- Create vault if it doesn't exist
- Track which clients are in which vaults
- Handle graceful disconnection

### Step 2.5: Add Vault Endpoints

Add to `server/src/index.ts`:

**New routes:**
- POST `/api/vault/create` - Create new vault (protected)
- GET `/api/vault/list` - List user's vaults (protected)
- GET `/api/vault/:id/files` - List files in vault (protected)
- GET `/api/vault/:id/file/*` - Get file content (protected)
- POST `/api/vault/:id/file/*` - Write file content (protected)

### Step 2.6: Test Phase 2

Create `server/test-sync.js` (Node.js test script):

```javascript
const io = require('socket.io-client');
const Y = require('yjs');

// Connect two clients
// Create Y.Docs on both
// Make changes on client 1
// Verify client 2 receives updates
// Verify both Y.Docs are in sync
```

**Test Checklist:**
- [ ] Can create vault via API
- [ ] Can list vaults via API
- [ ] Can connect to vault via Socket.io
- [ ] Y.js updates sync between clients
- [ ] Vault state persists after server restart
- [ ] File operations work correctly

---

# PHASE 3: Obsidian Plugin with Connection

## Objective
Create Obsidian plugin that connects to server and syncs vault contents.

## Instructions for Cursor Agent

### Step 3.1: Initialize Plugin Project

```bash
mkdir -p plugin/src
cd plugin
npm init -y
npm install obsidian socket.io-client yjs y-protocols
npm install -D @types/node typescript esbuild
```

### Step 3.2: Create Plugin Manifest

Create `plugin/manifest.json`:

```json
{
  "id": "collaborative-vault",
  "name": "Collaborative Vault",
  "version": "0.1.0",
  "minAppVersion": "0.15.0",
  "description": "Real-time collaborative editing for Obsidian vaults",
  "author": "Your Name",
  "authorUrl": "https://github.com/yourusername",
  "isDesktopOnly": false
}
```

### Step 3.3: Configure TypeScript

Create `plugin/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2018",
    "module": "ESNext",
    "lib": ["ES2018", "DOM"],
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": ".",
    "baseUrl": ".",
    "paths": {
      "obsidian": ["node_modules/obsidian/obsidian.d.ts"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

### Step 3.4: Create Settings Interface

Create `plugin/src/settings.ts`:

**Requirements:**
- Define settings interface (serverUrl, username, token)
- Default settings
- Settings tab UI for Obsidian
- Save/load settings from plugin data

**Interface:**
```typescript
export interface CollabSettings {
  serverUrl: string;
  username: string;
  token: string;
  autoConnect: boolean;
}

export class CollabSettingsTab extends PluginSettingTab {
  // Implement settings UI
}
```

### Step 3.5: Create Sync Engine

Create `plugin/src/sync.ts`:

**Requirements:**
- Manage Socket.io connection to server
- Initialize Y.js Y.Doc
- Handle sync protocol with server
- Watch for local file changes in Obsidian vault
- Apply remote changes to local vault
- Handle connection/reconnection logic
- Emit events for connection status

**Key class structure:**
```typescript
export class SyncEngine {
  private socket: Socket;
  private doc: Y.Doc;
  private connected: boolean;
  
  constructor(serverUrl: string, token: string);
  async connect(): Promise<void>;
  disconnect(): void;
  onFileChange(filepath: string, content: string): void;
  onRemoteUpdate(update: Uint8Array): void;
}
```

### Step 3.6: Create Main Plugin

Create `plugin/src/main.ts`:

**Requirements:**
- Extend Obsidian Plugin class
- Load settings on startup
- Initialize sync engine when connected
- Add status bar item showing connection status
- Add ribbon icon for manual connect/disconnect
- Add command palette commands:
  - Connect to server
  - Disconnect from server
  - Show connection status
- Handle plugin load/unload properly

**Main class structure:**
```typescript
export default class CollaborativeVaultPlugin extends Plugin {
  settings: CollabSettings;
  syncEngine: SyncEngine | null;
  statusBarItem: HTMLElement;
  
  async onload(): Promise<void>;
  async onunload(): Promise<void>;
  async loadSettings(): Promise<void>;
  async saveSettings(): Promise<void>;
  async connectToServer(): Promise<void>;
  disconnectFromServer(): void;
}
```

### Step 3.7: Build System

Create `plugin/esbuild.config.mjs`:

```javascript
import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
}).catch(() => process.exit(1));
```

Update `plugin/package.json` scripts:

```json
{
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "node esbuild.config.mjs production"
  }
}
```

### Step 3.8: Test Phase 3

**Manual Testing Steps:**

1. Build plugin: `npm run dev`
2. Copy plugin files to Obsidian vault: `.obsidian/plugins/collaborative-vault/`
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. Enable plugin in Obsidian settings
4. Configure server URL and credentials
5. Click connect in ribbon or command palette

**Test Checklist:**
- [ ] Plugin loads without errors
- [ ] Settings tab appears and works
- [ ] Can input server URL and credentials
- [ ] Connection status shows in status bar
- [ ] Can connect to server
- [ ] Connection survives brief disconnections
- [ ] Manual disconnect works

---

# PHASE 4: Cursor Tracking and Presence

## Objective
Implement real-time cursor positions and user presence indicators.

## Instructions for Cursor Agent

### Step 4.1: Add Awareness to Server

Update `server/src/collaboration.ts`:

**Requirements:**
- Use Y.js Awareness API
- Track user cursors (position, selection, user info)
- Broadcast awareness updates to all clients
- Clean up awareness when user disconnects
- Store user colors and display names

**Add awareness handling:**
```typescript
export function initializeAwareness(vaultId: string): Awareness
export function updateAwareness(socket: Socket, vaultId: string, state: any): void
export function broadcastAwareness(vaultId: string, excludeSocket?: Socket): void
```

### Step 4.2: Create Cursor Rendering

Create `plugin/src/cursors.ts`:

**Requirements:**
- Listen to awareness updates from Y.js
- Render cursor widgets in CodeMirror editor
- Show user names next to cursors
- Assign unique colors to users
- Update cursor positions smoothly
- Remove cursors when users disconnect

**Key class:**
```typescript
export class CursorManager {
  private awareness: Awareness;
  private cursors: Map<number, CursorWidget>;
  
  constructor(awareness: Awareness, editor: Editor);
  updateCursors(): void;
  renderCursor(clientId: number, state: any): void;
  removeCursor(clientId: number): void;
}
```

### Step 4.3: Integrate Cursors into Plugin

Update `plugin/src/main.ts`:

**Requirements:**
- Initialize cursor manager when connected
- Update local cursor position on editor changes
- Send awareness updates to server
- Handle active file switching
- Clean up cursors on disconnect

### Step 4.4: Add User Presence Sidebar

Update `plugin/src/main.ts`:

**Requirements:**
- Add custom view showing connected users
- Display user names and colors
- Show what file each user is editing
- Add "jump to user" functionality
- Update in real-time

**New class:**
```typescript
export class PresenceView extends ItemView {
  getViewType(): string;
  getDisplayText(): string;
  async onOpen(): Promise<void>;
  updatePresence(users: UserPresence[]): void;
}
```

### Step 4.5: Style Cursors

Create `plugin/styles.css`:

**Requirements:**
- Style cursor indicators (colored vertical lines)
- Style user name labels
- Animate cursor movements
- Make cursors semi-transparent
- Add hover effects

### Step 4.6: Optimize Performance

**Requirements:**
- Throttle cursor position updates (max 10/second)
- Debounce awareness broadcasts
- Clean up old cursor DOM elements
- Use requestAnimationFrame for smooth rendering
- Batch multiple updates

### Step 4.7: Test Phase 4

**Manual Testing Steps:**

1. Open two Obsidian instances with plugin installed
2. Connect both to same server
3. Open same file in both instances
4. Move cursor in instance 1
5. Verify cursor appears in instance 2
6. Edit text in both instances simultaneously
7. Check presence sidebar updates

**Test Checklist:**
- [ ] Cursors appear for remote users
- [ ] Cursors move smoothly
- [ ] User names display correctly
- [ ] Each user has unique color
- [ ] Presence sidebar shows all users
- [ ] Cursors disappear when user disconnects
- [ ] Performance is smooth with multiple users
- [ ] No cursor rendering glitches

---

# LOCAL TESTING SETUP

## Server Setup

1. Navigate to server directory:
```bash
cd server
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file with local settings

4. Start development server:
```bash
npm run dev
```

Server will run on `http://localhost:3000`

## Plugin Setup

1. Navigate to plugin directory:
```bash
cd plugin
```

2. Install dependencies:
```bash
npm install
```

3. Build plugin:
```bash
npm run dev
```

4. Create symlink to test vault:
```bash
# Linux/Mac
ln -s $(pwd) /path/to/test-vault/.obsidian/plugins/collaborative-vault

# Windows (run as admin)
mklink /D "C:\path\to\test-vault\.obsidian\plugins\collaborative-vault" "%cd%"
```

5. In Obsidian:
   - Open test vault
   - Go to Settings → Community Plugins
   - Enable "Collaborative Vault"
   - Configure server URL: `http://localhost:3000`
   - Register a user or login

## Testing with Multiple Clients

### Option 1: Multiple Obsidian Windows
- Open Obsidian twice with different vaults
- Install plugin in both
- Connect both to same server with different users

### Option 2: Obsidian + Browser
- Server can serve a simple web interface for testing
- Open vault in Obsidian
- Open same vault in browser
- Verify sync works

---

# ADDITIONAL REQUIREMENTS

## Error Handling

All phases should include:
- Try-catch blocks for async operations
- User-friendly error messages in Obsidian notices
- Server error logging
- Graceful degradation when offline
- Retry logic for failed connections

## Security Considerations

- Validate all user inputs
- Sanitize file paths to prevent directory traversal
- Rate limit authentication attempts
- Use HTTPS in production
- Don't log sensitive data (passwords, tokens)

## Code Quality

- Add TypeScript types for all functions
- Use async/await instead of callbacks
- Comment complex logic
- Follow consistent naming conventions
- Keep functions small and focused

## Documentation

Each file should have:
- Header comment explaining purpose
- JSDoc comments for exported functions
- Inline comments for complex logic
- README.md explaining setup

---

# DEVELOPMENT WORKFLOW

1. Start server: `cd server && npm run dev`
2. Watch plugin: `cd plugin && npm run dev`
3. Reload Obsidian plugin: Cmd/Ctrl + R in Obsidian
4. Check server logs in terminal
5. Check browser console in Obsidian (Cmd/Ctrl + Shift + I)

---

# SUCCESS CRITERIA

**Phase 1:**
- Server starts successfully
- Can register and login users
- JWT authentication works

**Phase 2:**
- Y.js documents sync between connections
- File changes persist to disk
- Multiple clients can edit simultaneously

**Phase 3:**
- Plugin installs in Obsidian
- Can connect to local server
- Settings save correctly

**Phase 4:**
- Cursors visible for all users
- Smooth cursor movement
- Presence sidebar works
- No performance issues

---

# TROUBLESHOOTING COMMON ISSUES

## Server won't start
- Check PORT is not in use: `lsof -i :3000`
- Verify .env file exists and is valid
- Check all dependencies installed

## Plugin won't load
- Verify manifest.json is valid JSON
- Check main.js was built successfully
- Enable developer console in Obsidian
- Check for TypeScript compilation errors

## Sync not working
- Verify WebSocket connection in browser console
- Check server logs for errors
- Ensure JWT token is valid
- Verify Y.js updates are being sent

## Cursors not showing
- Check awareness updates in network tab
- Verify CodeMirror editor is accessible
- Check CSS is loaded
- Look for JavaScript errors in console

---

# NEXT STEPS AFTER COMPLETION

1. Add conflict resolution UI for edge cases
2. Implement file tree synchronization
3. Add end-to-end encryption
4. Create admin dashboard
5. Add user permissions system
6. Implement vault templates
7. Add mobile app support
8. Create hosted service option
9. Add plugins marketplace integration
10. Write comprehensive user documentation