/**
 * Hive - Authentication module for the collaborative vault server.
 * Handles user registration, login, and JWT token management.
 */

import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const SECRETS_FILE = path.join(DATA_DIR, '.secrets.json');

/**
 * Get or generate JWT secret
 * Priority: 1) Environment variable, 2) Persisted secret file, 3) Generate new
 */
function getJwtSecret(): string {
  // 1. Check environment variable first
  if (process.env.JWT_SECRET) {
    const secret = process.env.JWT_SECRET;
    if (secret.length < 32) {
      throw new Error('SECURITY ERROR: JWT_SECRET must be at least 32 characters long');
    }
    return secret;
  }
  
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  // 2. Check for persisted secrets file
  if (fs.existsSync(SECRETS_FILE)) {
    try {
      const secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf-8'));
      if (secrets.jwtSecret && secrets.jwtSecret.length >= 32) {
        console.log('Using persisted JWT secret from', SECRETS_FILE);
        return secrets.jwtSecret;
      }
    } catch (err) {
      console.warn('Failed to read secrets file, generating new secret');
    }
  }
  
  // 3. Generate and persist a new secret
  const newSecret = crypto.randomBytes(48).toString('base64');
  
  try {
    const secrets = { jwtSecret: newSecret, generatedAt: new Date().toISOString() };
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    console.log('Generated and saved new JWT secret to', SECRETS_FILE);
  } catch (err) {
    console.warn('Could not persist JWT secret (will regenerate on restart):', err);
  }
  
  return newSecret;
}

const JWT_SECRET: string = getJwtSecret();

const DATABASE_PATH = process.env.DATABASE_PATH || './data/users.db';

let db: sqlite3.Database;

/**
 * Extended Request interface to include user information from JWT
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    isAdmin: boolean;
  };
}

/**
 * Access request interface
 */
export interface AccessRequest {
  id: number;
  username: string;
  email: string;
  message: string | null;
  password_hash: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

/**
 * Initialize the SQLite database and create users table if it doesn't exist
 */
export async function initializeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const dbPath = path.resolve(DATABASE_PATH);
    
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Failed to connect to database:', err);
        reject(err);
        return;
      }
      
      console.log('Connected to SQLite database at:', dbPath);
      
      // Enable WAL mode for better crash safety and concurrent read performance
      db.run('PRAGMA journal_mode=WAL', (err) => {
        if (err) {
          console.warn('Failed to enable WAL mode:', err);
        } else {
          console.log('SQLite WAL mode enabled');
        }
      });
      
      // Set synchronous to NORMAL for better performance while maintaining safety with WAL
      db.run('PRAGMA synchronous=NORMAL', (err) => {
        if (err) {
          console.warn('Failed to set synchronous mode:', err);
        }
      });
      
      // Create users table with is_admin column
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          is_admin INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Failed to create users table:', err);
          reject(err);
          return;
        }
        
        console.log('Users table initialized');
        
        // Migration: Add is_admin column if it doesn't exist (for existing DBs)
        db.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`, () => {
          // Ignore error if column already exists
        });
        
        // Create access_requests table
        db.run(`
          CREATE TABLE IF NOT EXISTS access_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            email TEXT NOT NULL,
            message TEXT,
            password_hash TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            console.error('Failed to create access_requests table:', err);
            reject(err);
            return;
          }
          
          console.log('Access requests table initialized');
          
          // Add password_hash column if it doesn't exist (migration for existing DBs)
          db.run(`ALTER TABLE access_requests ADD COLUMN password_hash TEXT`, () => {
            // Ignore error if column already exists
          });
          
          // Create vault_members table for permission management
          db.run(`
            CREATE TABLE IF NOT EXISTS vault_members (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              vault_id TEXT NOT NULL,
              user_id INTEGER NOT NULL,
              role TEXT CHECK(role IN ('owner', 'admin', 'editor', 'viewer')) NOT NULL,
              added_by INTEGER,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(vault_id, user_id),
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
            )
          `, (err) => {
            if (err) {
              console.error('Failed to create vault_members table:', err);
              reject(err);
            } else {
              console.log('Vault members table initialized');
              resolve();
            }
          });
        });
      });
    });
  });
}

/**
 * Register a new user with hashed password
 * First user is automatically made an admin
 * @param username - The username for the new user
 * @param password - The plain text password (will be hashed)
 * @returns true if registration successful, false if username exists
 */
export async function registerUser(username: string, password: string): Promise<boolean> {
  return new Promise(async (resolve, reject) => {
    try {
      // Validate inputs
      if (!username || username.length < 3) {
        reject(new Error('Username must be at least 3 characters'));
        return;
      }
      if (!password || password.length < 6) {
        reject(new Error('Password must be at least 6 characters'));
        return;
      }

      // Hash password with bcrypt (10 salt rounds)
      const passwordHash = await bcrypt.hash(password, 10);
      
      // Check if this is the first user (make them admin)
      db.get('SELECT COUNT(*) as count FROM users', [], (err, row: { count: number } | undefined) => {
        if (err) {
          reject(err);
          return;
        }
        
        const isFirstUser = (row?.count || 0) === 0;
        const isAdmin = isFirstUser ? 1 : 0;
        
        db.run(
          'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
          [username, passwordHash, isAdmin],
          function(err) {
            if (err) {
              if (err.message.includes('UNIQUE constraint failed')) {
                resolve(false); // Username already exists
              } else {
                reject(err);
              }
            } else {
              const adminNote = isFirstUser ? ' (admin)' : '';
              console.log(`User registered: ${username} (ID: ${this.lastID})${adminNote}`);
              resolve(true);
            }
          }
        );
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Login user and return JWT token
 * @param username - The username
 * @param password - The plain text password
 * @returns JWT token if credentials valid, null otherwise
 */
export async function loginUser(username: string, password: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, username, password_hash, is_admin FROM users WHERE username = ?',
      [username],
      async (err, row: { id: number; username: string; password_hash: string; is_admin: number } | undefined) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!row) {
          resolve(null); // User not found
          return;
        }
        
        try {
          const passwordMatch = await bcrypt.compare(password, row.password_hash);
          
          if (!passwordMatch) {
            resolve(null); // Wrong password
            return;
          }
          
          // Generate JWT token with admin status
          const token = jwt.sign(
            { id: row.id, username: row.username, isAdmin: row.is_admin === 1 },
            JWT_SECRET,
            { expiresIn: '7d' }
          );
          
          console.log(`User logged in: ${username}${row.is_admin ? ' (admin)' : ''}`);
          resolve(token);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

/**
 * Verify a JWT token and return the decoded payload
 * @param token - The JWT token to verify
 * @returns Decoded token payload or null if invalid
 */
export function verifyToken(token: string): { id: number; username: string; isAdmin: boolean } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; username: string; isAdmin?: boolean };
    return {
      id: decoded.id,
      username: decoded.username,
      isAdmin: decoded.isAdmin === true,
    };
  } catch {
    return null;
  }
}

/**
 * Express middleware to protect routes with JWT authentication
 */
export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    res.status(401).json({ error: 'No authorization header provided' });
    return;
  }
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({ error: 'Invalid authorization header format' });
    return;
  }
  
  const token = parts[1];
  const decoded = verifyToken(token);
  
  if (!decoded) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  
  req.user = decoded;
  next();
}

/**
 * Express middleware to protect admin-only routes
 * Must be used AFTER authMiddleware
 */
export function adminMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  
  if (!req.user.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  
  next();
}

/**
 * Create an access request
 * @param username - Desired username
 * @param email - Contact email
 * @param password - Suggested password from the user
 * @param message - Optional message from requester
 * @returns The created request ID
 */
export async function createAccessRequest(
  username: string,
  email: string,
  password: string,
  message?: string
): Promise<number> {
  return new Promise(async (resolve, reject) => {
    // Validate inputs
    if (!username || username.length < 3) {
      reject(new Error('Username must be at least 3 characters'));
      return;
    }
    if (!email || !email.includes('@')) {
      reject(new Error('Valid email is required'));
      return;
    }
    if (!password || password.length < 6) {
      reject(new Error('Password must be at least 6 characters'));
      return;
    }

    try {
      // Hash the password before storing
      const passwordHash = await bcrypt.hash(password, 10);

      db.run(
        'INSERT INTO access_requests (username, email, message, password_hash, status) VALUES (?, ?, ?, ?, ?)',
        [username, email, message || null, passwordHash, 'pending'],
        function(err) {
          if (err) {
            reject(err);
          } else {
            console.log(`Access request created: ${username} (ID: ${this.lastID})`);
            resolve(this.lastID);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get all pending access requests (for admin)
 */
export async function getPendingAccessRequests(): Promise<AccessRequest[]> {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM access_requests WHERE status = ? ORDER BY created_at DESC',
      ['pending'],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as AccessRequest[]);
        }
      }
    );
  });
}

/**
 * Update access request status (for rejections)
 */
export async function rejectAccessRequest(id: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE access_requests SET status = ? WHERE id = ?',
      ['rejected', id],
      function(err) {
        if (err) {
          reject(err);
        } else {
          console.log(`Access request ${id} rejected`);
          resolve(this.changes > 0);
        }
      }
    );
  });
}

/**
 * Approve access request and create user account
 */
export async function approveAccessRequest(id: number): Promise<{ success: boolean; username?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    // First, get the access request
    db.get(
      'SELECT * FROM access_requests WHERE id = ? AND status = ?',
      [id, 'pending'],
      async (err, row: AccessRequest | undefined) => {
        if (err) {
          reject(err);
          return;
        }

        if (!row) {
          resolve({ success: false, error: 'Access request not found or already processed' });
          return;
        }

        if (!row.password_hash) {
          resolve({ success: false, error: 'No password provided in request' });
          return;
        }

        // Check if username already exists
        db.get(
          'SELECT id FROM users WHERE username = ?',
          [row.username],
          async (err, existingUser) => {
            if (err) {
              reject(err);
              return;
            }

            if (existingUser) {
              resolve({ success: false, error: 'Username already exists' });
              return;
            }

            // Create the user with the pre-hashed password
            db.run(
              'INSERT INTO users (username, password_hash) VALUES (?, ?)',
              [row.username, row.password_hash],
              function(err) {
                if (err) {
                  reject(err);
                  return;
                }

                const userId = this.lastID;
                console.log(`User created from access request: ${row.username} (ID: ${userId})`);

                // Update access request status
                db.run(
                  'UPDATE access_requests SET status = ? WHERE id = ?',
                  ['approved', id],
                  function(err) {
                    if (err) {
                      reject(err);
                      return;
                    }

                    console.log(`Access request ${id} approved`);
                    resolve({ success: true, username: row.username });
                  }
                );
              }
            );
          }
        );
      }
    );
  });
}

/**
 * Get all registered users (for admin)
 */
export async function getAllUsers(): Promise<Array<{ id: number; username: string; is_admin: boolean; created_at: string }>> {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC',
      [],
      (err, rows: Array<{ id: number; username: string; is_admin: number; created_at: string }>) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(row => ({
            id: row.id,
            username: row.username,
            is_admin: row.is_admin === 1,
            created_at: row.created_at,
          })));
        }
      }
    );
  });
}

/**
 * Generate an admin token for local admin panel access
 * Only accessible from localhost for the Electron admin app
 */
export function generateAdminToken(): string {
  const token = jwt.sign(
    { id: 0, username: 'local-admin', isAdmin: true },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  return token;
}

/**
 * Check if an IP address is localhost
 */
export function isLocalhost(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === '127.0.0.1' || 
         ip === '::1' || 
         ip === '::ffff:127.0.0.1' ||
         ip === 'localhost';
}

/**
 * Get a user by ID
 */
export async function getUserById(id: number): Promise<{ id: number; username: string; is_admin: boolean; created_at: string } | null> {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, username, is_admin, created_at FROM users WHERE id = ?',
      [id],
      (err, row: { id: number; username: string; is_admin: number; created_at: string } | undefined) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            resolve({
              id: row.id,
              username: row.username,
              is_admin: row.is_admin === 1,
              created_at: row.created_at,
            });
          } else {
            resolve(null);
          }
        }
      }
    );
  });
}

/**
 * Create a new user (admin function)
 * @param username - The username for the new user
 * @param password - The plain text password (will be hashed)
 * @returns The created user's ID or null if username exists
 */
export async function createUser(username: string, password: string): Promise<number | null> {
  return new Promise(async (resolve, reject) => {
    try {
      if (!username || username.length < 3) {
        reject(new Error('Username must be at least 3 characters'));
        return;
      }
      if (!password || password.length < 6) {
        reject(new Error('Password must be at least 6 characters'));
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      
      db.run(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        [username, passwordHash],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              resolve(null);
            } else {
              reject(err);
            }
          } else {
            console.log(`User created by admin: ${username} (ID: ${this.lastID})`);
            resolve(this.lastID);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update a user's username and/or password
 * @param id - The user ID to update
 * @param updates - Object containing optional username and password updates
 * @returns true if update successful, false if user not found or username taken
 */
export async function updateUser(
  id: number,
  updates: { username?: string; password?: string }
): Promise<{ success: boolean; error?: string }> {
  return new Promise(async (resolve, reject) => {
    try {
      // Validate inputs
      if (updates.username !== undefined && updates.username.length < 3) {
        resolve({ success: false, error: 'Username must be at least 3 characters' });
        return;
      }
      if (updates.password !== undefined && updates.password.length < 6) {
        resolve({ success: false, error: 'Password must be at least 6 characters' });
        return;
      }

      // Check if user exists
      const existingUser = await getUserById(id);
      if (!existingUser) {
        resolve({ success: false, error: 'User not found' });
        return;
      }

      // Check if new username is taken by another user
      if (updates.username && updates.username !== existingUser.username) {
        const usernameCheck = await new Promise<boolean>((res, rej) => {
          db.get(
            'SELECT id FROM users WHERE username = ? AND id != ?',
            [updates.username, id],
            (err, row) => {
              if (err) rej(err);
              else res(!!row);
            }
          );
        });
        if (usernameCheck) {
          resolve({ success: false, error: 'Username already taken' });
          return;
        }
      }

      // Build update query
      const setClauses: string[] = [];
      const params: (string | number)[] = [];

      if (updates.username) {
        setClauses.push('username = ?');
        params.push(updates.username);
      }
      if (updates.password) {
        const passwordHash = await bcrypt.hash(updates.password, 10);
        setClauses.push('password_hash = ?');
        params.push(passwordHash);
      }

      if (setClauses.length === 0) {
        resolve({ success: true }); // Nothing to update
        return;
      }

      params.push(id);
      const query = `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`;

      db.run(query, params, function(err) {
        if (err) {
          reject(err);
        } else {
          console.log(`User updated: ID ${id}`);
          resolve({ success: true });
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Delete a user by ID
 * @param id - The user ID to delete
 * @returns true if deleted, false if user not found
 */
export async function deleteUser(id: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM users WHERE id = ?',
      [id],
      function(err) {
        if (err) {
          reject(err);
        } else {
          if (this.changes > 0) {
            console.log(`User deleted: ID ${id}`);
          }
          resolve(this.changes > 0);
        }
      }
    );
  });
}

/**
 * Get database instance (for testing purposes)
 */
export function getDatabase(): sqlite3.Database {
  return db;
}

