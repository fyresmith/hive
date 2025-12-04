/**
 * Hive Server - Main entry point for the collaborative vault system.
 * Handles HTTP routes and Socket.io connections for real-time collaboration.
 * 
 * @see https://docs.obsidian.md/Plugins/ for Obsidian plugin integration
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import {
  initializeDatabase,
  registerUser,
  loginUser,
  verifyToken,
  authMiddleware,
  adminMiddleware,
  isLocalhost,
  AuthenticatedRequest,
  createAccessRequest,
  getPendingAccessRequests,
  getAllUsers,
  generateAdminToken,
  approveAccessRequest,
  rejectAccessRequest,
  createUser,
  updateUser,
  deleteUser,
  getUserById
} from './auth';
import {
  createVault,
  listVaults,
  listVaultFiles,
  readVaultFile,
  writeVaultFile,
  deleteVaultFile,
  deleteVault,
  vaultExists
} from './vault';
import {
  initializeCollaboration,
  handleJoinVault,
  handleLeaveVault,
  handleDisconnect,
  getVaultUsers,
  shutdown
} from './collaboration';
import {
  initializeBackupScheduler,
  stopBackupScheduler,
  listBackups,
  triggerManualBackup,
  restoreFromBackup,
  BackupInfo
} from './backup';
import {
  getUserVaultRole,
  canRead,
  canWrite,
  canManageMembers,
  isOwner,
  addMember,
  removeMember,
  updateMemberRole,
  transferOwnership,
  getVaultMembers,
  getUserVaults,
  VaultRole
} from './permissions';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

// Parse allowed origins from environment (comma-separated)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(origin => origin.length > 0);

// Optional admin password for admin token endpoint
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Initialize Express app
const app = express();
const httpServer = createServer(app);

// Initialize Socket.io with CORS and transport settings
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Transport configuration - start with polling (more reliable), then upgrade
  transports: ['polling', 'websocket'],
  // Increase ping timeout to avoid premature disconnects
  pingTimeout: 60000,
  pingInterval: 25000,
  // Allow upgrade from polling to websocket
  allowUpgrades: true,
  // Increase buffer size for sync messages
  maxHttpBufferSize: 5e6, // 5MB
  // Add connection state recovery
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
});

// =============================================================================
// Security Middleware
// =============================================================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API server
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}));

// Body parser
app.use(express.json());

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Store authenticated socket connections
const authenticatedSockets = new Map<string, { id: number; username: string }>();

// =============================================================================
// HTTP Routes - Authentication
// =============================================================================

/**
 * Health check endpoint
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Register a new user
 * POST /api/register
 * Body: { username: string, password: string }
 */
app.post('/api/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    
    const success = await registerUser(username, password);
    
    if (success) {
      res.status(201).json({ message: 'User registered successfully' });
    } else {
      res.status(409).json({ error: 'Username already exists' });
    }
  } catch (err: unknown) {
    console.error('Registration error:', err);
    const message = err instanceof Error ? err.message : 'Registration failed';
    res.status(400).json({ error: message });
  }
});

/**
 * Login and get JWT token
 * POST /api/login
 * Body: { username: string, password: string }
 */
app.post('/api/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    
    const token = await loginUser(username, password);
    
    if (token) {
      res.json({ token, username });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (err: unknown) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * Verify token is valid (protected route)
 * GET /api/verify
 * Headers: Authorization: Bearer <token>
 */
app.get('/api/verify', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    valid: true,
    user: req.user
  });
});

/**
 * Request login access (for users without an account)
 * POST /api/request-login
 * Body: { username: string, email: string, password: string, message?: string }
 */
app.post('/api/request-login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { username, email, password, message } = req.body;
    
    if (!username) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }
    
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }
    
    if (!password) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }
    
    const requestId = await createAccessRequest(username, email, password, message);
    
    console.log(`Access request submitted: ${username} (${email})`);
    
    res.status(201).json({ 
      message: 'Access request submitted successfully',
      requestId 
    });
  } catch (err: unknown) {
    console.error('Access request error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Failed to submit request';
    res.status(400).json({ error: errorMessage });
  }
});

/**
 * Get pending access requests (admin only)
 * GET /api/admin/access-requests
 */
app.get('/api/admin/access-requests', authMiddleware, adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const requests = await getPendingAccessRequests();
    res.json({ requests });
  } catch (err: unknown) {
    console.error('Error fetching access requests:', err);
    res.status(500).json({ error: 'Failed to fetch access requests' });
  }
});

/**
 * Get all users (admin only)
 * GET /api/admin/users
 */
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (err: unknown) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * Get a single user by ID (admin only)
 * GET /api/admin/users/:id
 */
app.get('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    
    const user = await getUserById(id);
    
    if (user) {
      res.json({ user });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err: unknown) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * Create a new user (admin only)
 * POST /api/admin/users
 * Body: { username: string, password: string }
 */
app.post('/api/admin/users', authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    
    const userId = await createUser(username, password);
    
    if (userId) {
      res.status(201).json({ message: 'User created successfully', userId, username });
    } else {
      res.status(409).json({ error: 'Username already exists' });
    }
  } catch (err: unknown) {
    console.error('Error creating user:', err);
    const message = err instanceof Error ? err.message : 'Failed to create user';
    res.status(400).json({ error: message });
  }
});

/**
 * Update a user (admin only)
 * PUT /api/admin/users/:id
 * Body: { username?: string, password?: string }
 */
app.put('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    
    const { username, password } = req.body;
    
    if (!username && !password) {
      res.status(400).json({ error: 'At least one field (username or password) is required' });
      return;
    }
    
    const result = await updateUser(id, { username, password });
    
    if (result.success) {
      res.json({ message: 'User updated successfully' });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err: unknown) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * Delete a user (admin only)
 * DELETE /api/admin/users/:id
 */
app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    
    const deleted = await deleteUser(id);
    
    if (deleted) {
      res.json({ message: 'User deleted successfully' });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err: unknown) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * Get admin token for local admin panel
 * Only accessible from localhost for security
 * GET /api/admin/token
 */
app.get('/api/admin/token', (req: Request, res: Response) => {
  // Get client IP
  const clientIp = req.ip || req.socket.remoteAddress;
  
  // Restrict to localhost only
  if (!isLocalhost(clientIp)) {
    console.warn(`[Security] Admin token request rejected from non-local IP: ${clientIp}`);
    res.status(403).json({ error: 'Admin token only available from localhost' });
    return;
  }
  
  // Optional: require admin password if configured
  if (ADMIN_PASSWORD) {
    const providedPassword = req.headers['x-admin-password'] || req.query.password;
    if (providedPassword !== ADMIN_PASSWORD) {
      console.warn(`[Security] Admin token request with invalid password from: ${clientIp}`);
      res.status(401).json({ error: 'Invalid admin password' });
      return;
    }
  }
  
  const token = generateAdminToken();
  console.log(`[Security] Admin token generated for localhost (${clientIp})`);
  res.json({ token, username: 'local-admin' });
});

/**
 * Approve an access request (creates user account)
 * POST /api/admin/access-requests/:id/approve
 */
app.post('/api/admin/access-requests/:id/approve', authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid request ID' });
      return;
    }
    
    const result = await approveAccessRequest(id);
    
    if (result.success) {
      res.json({ message: 'Access request approved', username: result.username });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err: unknown) {
    console.error('Error approving access request:', err);
    res.status(500).json({ error: 'Failed to approve access request' });
  }
});

/**
 * Reject an access request (admin only)
 * POST /api/admin/access-requests/:id/reject
 */
app.post('/api/admin/access-requests/:id/reject', authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid request ID' });
      return;
    }
    
    const success = await rejectAccessRequest(id);
    
    if (success) {
      res.json({ message: 'Access request rejected' });
    } else {
      res.status(404).json({ error: 'Access request not found' });
    }
  } catch (err: unknown) {
    console.error('Error rejecting access request:', err);
    res.status(500).json({ error: 'Failed to reject access request' });
  }
});

// =============================================================================
// HTTP Routes - Vault Management
// =============================================================================

/**
 * Create a new vault
 * POST /api/vault/create
 * Body: { vaultId: string }
 */
app.post('/api/vault/create', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { vaultId } = req.body;
    
    if (!vaultId) {
      res.status(400).json({ error: 'Vault ID is required' });
      return;
    }
    
    // Validate vault ID format
    if (!/^[a-zA-Z0-9_-]+$/.test(vaultId)) {
      res.status(400).json({ error: 'Vault ID can only contain letters, numbers, hyphens, and underscores' });
      return;
    }
    
    // Create vault with the requesting user as owner
    const success = await createVault(vaultId, req.user!.id);
    
    if (success) {
      res.status(201).json({ message: 'Vault created successfully', vaultId, role: 'owner' });
    } else {
      res.status(409).json({ error: 'Vault already exists' });
    }
  } catch (err: unknown) {
    console.error('Vault creation error:', err);
    res.status(500).json({ error: 'Failed to create vault' });
  }
});

/**
 * List all vaults (admin sees all, users see only their vaults)
 * GET /api/vault/list
 */
app.get('/api/vault/list', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Server admins can see all vaults
    if (req.user!.isAdmin) {
      const vaults = await listVaults();
      res.json({ vaults });
      return;
    }
    
    // Regular users only see vaults they have access to
    const userVaults = await getUserVaults(req.user!.id);
    const vaults = userVaults.map(v => v.vault_id);
    res.json({ vaults });
  } catch (err: unknown) {
    console.error('List vaults error:', err);
    res.status(500).json({ error: 'Failed to list vaults' });
  }
});

/**
 * List vaults the current user has access to with their roles
 * GET /api/user/vaults
 */
app.get('/api/user/vaults', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userVaults = await getUserVaults(req.user!.id);
    res.json({ vaults: userVaults });
  } catch (err: unknown) {
    console.error('List user vaults error:', err);
    res.status(500).json({ error: 'Failed to list user vaults' });
  }
});

/**
 * Get vault info including connected users
 * GET /api/vault/:id
 * Requires: viewer+ permission (or server admin)
 */
app.get('/api/vault/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    // Check permission (server admins bypass)
    if (!req.user!.isAdmin) {
      const hasAccess = await canRead(req.user!.id, vaultId);
      if (!hasAccess) {
        res.status(403).json({ error: 'You do not have access to this vault' });
        return;
      }
    }
    
    const userRole = await getUserVaultRole(req.user!.id, vaultId);
    const users = getVaultUsers(vaultId);
    const files = await listVaultFiles(vaultId);
    
    res.json({
      vaultId,
      role: userRole,
      users,
      files,
      userCount: users.length
    });
  } catch (err: unknown) {
    console.error('Get vault error:', err);
    res.status(500).json({ error: 'Failed to get vault info' });
  }
});

/**
 * List files in a vault
 * GET /api/vault/:id/files
 * Requires: viewer+ permission (or server admin)
 */
app.get('/api/vault/:id/files', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    // Check permission (server admins bypass)
    if (!req.user!.isAdmin) {
      const hasAccess = await canRead(req.user!.id, vaultId);
      if (!hasAccess) {
        res.status(403).json({ error: 'You do not have access to this vault' });
        return;
      }
    }
    
    const files = await listVaultFiles(vaultId);
    res.json({ files });
  } catch (err: unknown) {
    console.error('List files error:', err);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

/**
 * Get file content
 * GET /api/vault/:id/file/*filepath
 * Requires: viewer+ permission (or server admin)
 */
app.get('/api/vault/:id/file/*filepath', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    // In Express 5, wildcard params come as arrays - join them
    const filepathParam = req.params.filepath;
    const filepath = Array.isArray(filepathParam) ? filepathParam.join('/') : filepathParam;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    // Check permission (server admins bypass)
    if (!req.user!.isAdmin) {
      const hasAccess = await canRead(req.user!.id, vaultId);
      if (!hasAccess) {
        res.status(403).json({ error: 'You do not have access to this vault' });
        return;
      }
    }
    
    if (!filepath) {
      res.status(400).json({ error: 'File path is required' });
      return;
    }
    
    const content = await readVaultFile(vaultId, filepath);
    res.json({ filepath, content });
  } catch (err: unknown) {
    console.error('Read file error:', err);
    const message = err instanceof Error ? err.message : 'Failed to read file';
    if (message === 'File not found') {
      res.status(404).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

/**
 * Write file content
 * POST /api/vault/:id/file/*filepath
 * Body: { content: string }
 * Requires: editor+ permission (or server admin)
 */
app.post('/api/vault/:id/file/*filepath', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    // In Express 5, wildcard params come as arrays - join them
    const filepathParam = req.params.filepath;
    const filepath = Array.isArray(filepathParam) ? filepathParam.join('/') : filepathParam;
    const { content } = req.body;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    // Check permission (server admins bypass)
    if (!req.user!.isAdmin) {
      const hasAccess = await canWrite(req.user!.id, vaultId);
      if (!hasAccess) {
        res.status(403).json({ error: 'You do not have write access to this vault' });
        return;
      }
    }
    
    if (!filepath) {
      res.status(400).json({ error: 'File path is required' });
      return;
    }
    
    if (content === undefined) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }
    
    await writeVaultFile(vaultId, filepath, content);
    res.json({ message: 'File saved successfully', filepath });
  } catch (err: unknown) {
    console.error('Write file error:', err);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

/**
 * Delete a file
 * DELETE /api/vault/:id/file/*filepath
 * Requires: editor+ permission (or server admin)
 */
app.delete('/api/vault/:id/file/*filepath', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    // In Express 5, wildcard params come as arrays - join them
    const filepathParam = req.params.filepath;
    const filepath = Array.isArray(filepathParam) ? filepathParam.join('/') : filepathParam;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    // Check permission (server admins bypass)
    if (!req.user!.isAdmin) {
      const hasAccess = await canWrite(req.user!.id, vaultId);
      if (!hasAccess) {
        res.status(403).json({ error: 'You do not have write access to this vault' });
        return;
      }
    }
    
    if (!filepath) {
      res.status(400).json({ error: 'File path is required' });
      return;
    }
    
    await deleteVaultFile(vaultId, filepath);
    res.json({ message: 'File deleted successfully', filepath });
  } catch (err: unknown) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

/**
 * Delete a vault (owner only)
 * DELETE /api/vault/:id
 * Requires: owner permission (or server admin)
 */
app.delete('/api/vault/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    // Check permission (server admins bypass)
    if (!req.user!.isAdmin) {
      const isVaultOwner = await isOwner(req.user!.id, vaultId);
      if (!isVaultOwner) {
        res.status(403).json({ error: 'Only the vault owner can delete the vault' });
        return;
      }
    }
    
    await deleteVault(vaultId);
    res.json({ message: 'Vault deleted successfully', vaultId });
  } catch (err: unknown) {
    console.error('Delete vault error:', err);
    res.status(500).json({ error: 'Failed to delete vault' });
  }
});

// =============================================================================
// HTTP Routes - Vault Member Management
// =============================================================================

/**
 * List members of a vault
 * GET /api/vault/:id/members
 * Requires: admin+ permission (or server admin)
 */
app.get('/api/vault/:id/members', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    // Check permission (server admins bypass)
    if (!req.user!.isAdmin) {
      const canManage = await canManageMembers(req.user!.id, vaultId);
      if (!canManage) {
        res.status(403).json({ error: 'You do not have permission to view members' });
        return;
      }
    }
    
    const members = await getVaultMembers(vaultId);
    res.json({ vaultId, members });
  } catch (err: unknown) {
    console.error('List members error:', err);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

/**
 * Add a member to a vault
 * POST /api/vault/:id/members
 * Body: { userId: number, role: 'admin' | 'editor' | 'viewer' }
 * Requires: admin+ permission (can only add roles lower than own)
 */
app.post('/api/vault/:id/members', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    const { userId, role } = req.body;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    if (!userId || typeof userId !== 'number') {
      res.status(400).json({ error: 'Valid user ID is required' });
      return;
    }
    
    if (!role || !['admin', 'editor', 'viewer'].includes(role)) {
      res.status(400).json({ error: 'Valid role is required (admin, editor, or viewer)' });
      return;
    }
    
    // Check if user exists
    const targetUser = await getUserById(userId);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    
    // Server admins can add anyone
    const addedBy = req.user!.isAdmin ? null : req.user!.id;
    
    const result = await addMember(vaultId, userId, role as VaultRole, addedBy);
    
    if (result.success) {
      res.status(201).json({ 
        message: 'Member added successfully', 
        vaultId, 
        userId, 
        username: targetUser.username,
        role 
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err: unknown) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

/**
 * Update a member's role
 * PUT /api/vault/:id/members/:userId
 * Body: { role: 'admin' | 'editor' | 'viewer' }
 * Requires: admin+ permission (can only modify users with lower roles)
 */
app.put('/api/vault/:id/members/:userId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    const userId = parseInt(req.params.userId, 10);
    const { role } = req.body;
    
    if (isNaN(userId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    if (!role || !['admin', 'editor', 'viewer'].includes(role)) {
      res.status(400).json({ error: 'Valid role is required (admin, editor, or viewer)' });
      return;
    }
    
    // Server admins bypass permission checks
    if (req.user!.isAdmin) {
      // Direct update without permission checks
      const result = await updateMemberRole(vaultId, userId, role as VaultRole, req.user!.id);
      if (result.success) {
        res.json({ message: 'Member role updated successfully', vaultId, userId, role });
      } else {
        res.status(400).json({ error: result.error });
      }
      return;
    }
    
    const result = await updateMemberRole(vaultId, userId, role as VaultRole, req.user!.id);
    
    if (result.success) {
      res.json({ message: 'Member role updated successfully', vaultId, userId, role });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err: unknown) {
    console.error('Update member role error:', err);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

/**
 * Remove a member from a vault
 * DELETE /api/vault/:id/members/:userId
 * Requires: admin+ permission (can only remove users with lower roles)
 */
app.delete('/api/vault/:id/members/:userId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    const userId = parseInt(req.params.userId, 10);
    
    if (isNaN(userId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    const result = await removeMember(vaultId, userId, req.user!.id);
    
    if (result.success) {
      res.json({ message: 'Member removed successfully', vaultId, userId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err: unknown) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

/**
 * Transfer vault ownership
 * POST /api/vault/:id/transfer
 * Body: { newOwnerId: number }
 * Requires: owner permission
 */
app.post('/api/vault/:id/transfer', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    const { newOwnerId } = req.body;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    if (!newOwnerId || typeof newOwnerId !== 'number') {
      res.status(400).json({ error: 'Valid new owner ID is required' });
      return;
    }
    
    // Check if user is the current owner (server admins cannot transfer ownership)
    const isVaultOwner = await isOwner(req.user!.id, vaultId);
    if (!isVaultOwner) {
      res.status(403).json({ error: 'Only the vault owner can transfer ownership' });
      return;
    }
    
    const result = await transferOwnership(vaultId, newOwnerId, req.user!.id);
    
    if (result.success) {
      res.json({ message: 'Ownership transferred successfully', vaultId, newOwnerId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err: unknown) {
    console.error('Transfer ownership error:', err);
    res.status(500).json({ error: 'Failed to transfer ownership' });
  }
});

// =============================================================================
// HTTP Routes - Backup Management
// =============================================================================

/**
 * List all backups for a vault
 * GET /api/vault/:id/backups
 */
app.get('/api/vault/:id/backups', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    const backups = await listBackups(vaultId);
    res.json({ 
      vaultId,
      backups,
      count: backups.length
    });
  } catch (err: unknown) {
    console.error('List backups error:', err);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

/**
 * Trigger a manual backup for a vault
 * POST /api/vault/:id/backup
 */
app.post('/api/vault/:id/backup', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    
    if (!(await vaultExists(vaultId))) {
      res.status(404).json({ error: 'Vault not found' });
      return;
    }
    
    const backup = await triggerManualBackup(vaultId);
    res.status(201).json({ 
      message: 'Backup created successfully',
      backup
    });
  } catch (err: unknown) {
    console.error('Manual backup error:', err);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

/**
 * Restore a vault from a backup
 * POST /api/vault/:id/restore
 * Body: { timestamp: string, type?: 'hourly' | 'daily' }
 */
app.post('/api/vault/:id/restore', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultId = req.params.id;
    const { timestamp, type = 'hourly' } = req.body;
    
    if (!timestamp) {
      res.status(400).json({ error: 'Backup timestamp is required' });
      return;
    }
    
    if (type !== 'hourly' && type !== 'daily') {
      res.status(400).json({ error: 'Invalid backup type. Must be "hourly" or "daily"' });
      return;
    }
    
    await restoreFromBackup(vaultId, timestamp, type);
    res.json({ 
      message: 'Vault restored successfully',
      vaultId,
      restoredFrom: { timestamp, type }
    });
  } catch (err: unknown) {
    console.error('Restore backup error:', err);
    const message = err instanceof Error ? err.message : 'Failed to restore backup';
    res.status(500).json({ error: message });
  }
});

// =============================================================================
// Socket.io Connection Handling
// =============================================================================

io.on('connection', (socket: Socket) => {
  console.log(`Socket connected: ${socket.id}`);
  
  // Authenticate socket connection
  socket.on('authenticate', (token: string) => {
    const user = verifyToken(token);
    
    if (user) {
      authenticatedSockets.set(socket.id, user);
      socket.emit('authenticated', { success: true, user: { id: user.id, username: user.username } });
      console.log(`Socket authenticated: ${socket.id} (User: ${user.username})`);
    } else {
      socket.emit('authenticated', { success: false, error: 'Invalid token' });
      console.log(`Socket authentication failed: ${socket.id}`);
    }
  });
  
  // Join a vault for real-time collaboration
  socket.on('join-vault', async (vaultId: string) => {
    const user = authenticatedSockets.get(socket.id);
    
    if (!user) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }
    
    try {
      // Check if vault exists
      if (!(await vaultExists(vaultId))) {
        // Auto-create vault with the user as owner
        await createVault(vaultId, user.id);
      }
      
      // handleJoinVault now handles permission checks and migration
      const result = await handleJoinVault(socket, vaultId, user);
      
      if (!result.success) {
        // Permission denied or other error - already emitted by handleJoinVault
        return;
      }
      
      // Send vault-joined with role information
      socket.emit('vault-joined', { vaultId, user, role: result.role });
    } catch (err) {
      console.error(`Error joining vault ${vaultId}:`, err);
      socket.emit('error', { message: 'Failed to join vault' });
    }
  });
  
  // Leave a vault
  socket.on('leave-vault', async (vaultId: string) => {
    const user = authenticatedSockets.get(socket.id);
    
    if (!user) {
      return;
    }
    
    try {
      await handleLeaveVault(socket, vaultId, user);
      socket.emit('vault-left', { vaultId });
    } catch (err) {
      console.error(`Error leaving vault ${vaultId}:`, err);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', async (reason) => {
    const user = authenticatedSockets.get(socket.id);
    
    if (user) {
      console.log(`Socket disconnected: ${socket.id} (User: ${user.username}) - Reason: ${reason}`);
      await handleDisconnect(socket);
      authenticatedSockets.delete(socket.id);
    } else {
      console.log(`Socket disconnected: ${socket.id} - Reason: ${reason}`);
    }
  });
  
  // Ping-pong for connection health
  socket.on('ping', () => {
    socket.emit('pong');
  });
});

// =============================================================================
// Server Startup
// =============================================================================

async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();
    
    // Initialize collaboration engine
    initializeCollaboration(io);
    
    // Initialize backup scheduler
    initializeBackupScheduler();
    
    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log('🐝 Hive Server - Real-time Collaborative Vault');
      console.log('='.repeat(60));
      console.log(`HTTP Server running on http://localhost:${PORT}`);
      console.log(`WebSocket Server ready for real-time collaboration`);
      console.log('='.repeat(60));
      console.log('Authentication endpoints:');
      console.log(`  POST /api/register          - Register new user`);
      console.log(`  POST /api/login             - Login and get token`);
      console.log(`  GET  /api/verify            - Verify token (protected)`);
      console.log('');
      console.log('Vault endpoints (all protected):');
      console.log(`  POST /api/vault/create      - Create new vault`);
      console.log(`  GET  /api/vault/list        - List all vaults`);
      console.log(`  GET  /api/vault/:id         - Get vault info`);
      console.log(`  GET  /api/vault/:id/files   - List files in vault`);
      console.log(`  GET  /api/vault/:id/file/*  - Get file content`);
      console.log(`  POST /api/vault/:id/file/*  - Write file content`);
      console.log(`  DELETE /api/vault/:id/file/*- Delete file`);
      console.log('');
      console.log('Backup endpoints (all protected):');
      console.log(`  GET  /api/vault/:id/backups - List available backups`);
      console.log(`  POST /api/vault/:id/backup  - Trigger manual backup`);
      console.log(`  POST /api/vault/:id/restore - Restore from backup`);
      console.log('');
      console.log('Socket.io events:');
      console.log(`  authenticate                - Authenticate with JWT token`);
      console.log(`  join-vault                  - Join vault for collaboration`);
      console.log(`  leave-vault                 - Leave vault`);
      console.log(`  sync-message                - Y.js sync protocol messages`);
      console.log('='.repeat(60));
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nReceived SIGINT, shutting down gracefully...');
      stopBackupScheduler();
      await shutdown();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\nReceived SIGTERM, shutting down gracefully...');
      stopBackupScheduler();
      await shutdown();
      process.exit(0);
    });
    
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
