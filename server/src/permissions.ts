/**
 * Hive - Permissions module for vault access control.
 * Implements hierarchical role system: viewer < editor < admin < owner
 * 
 * Role capabilities:
 * - viewer: read-only access to vault files
 * - editor: read + write files, sync changes
 * - admin: manage members (add/remove editors/viewers), edit vault settings
 * - owner: full control, can delete vault, transfer ownership, manage admins
 */

import { getDatabase } from './auth';

/**
 * Vault role type
 */
export type VaultRole = 'owner' | 'admin' | 'editor' | 'viewer';

/**
 * Role hierarchy values (higher = more permissions)
 */
const ROLE_HIERARCHY: Record<VaultRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

/**
 * Vault member information
 */
export interface VaultMember {
  id: number;
  vault_id: string;
  user_id: number;
  username: string;
  role: VaultRole;
  added_by: number | null;
  added_by_username: string | null;
  created_at: string;
}

/**
 * Get a user's role for a specific vault
 * @param userId - The user ID
 * @param vaultId - The vault ID
 * @returns The user's role or null if not a member
 */
export async function getUserVaultRole(userId: number, vaultId: string): Promise<VaultRole | null> {
  const db = getDatabase();
  
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT role FROM vault_members WHERE user_id = ? AND vault_id = ?',
      [userId, vaultId],
      (err: Error | null, row: { role: VaultRole } | undefined) => {
        if (err) {
          reject(err);
        } else {
          resolve(row?.role || null);
        }
      }
    );
  });
}

/**
 * Check if a user has at least the specified role level
 * @param userId - The user ID
 * @param vaultId - The vault ID
 * @param requiredRole - The minimum required role
 * @returns true if user has sufficient permissions
 */
export async function hasRoleOrHigher(
  userId: number,
  vaultId: string,
  requiredRole: VaultRole
): Promise<boolean> {
  const userRole = await getUserVaultRole(userId, vaultId);
  if (!userRole) return false;
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Check if user can read vault contents (viewer+)
 */
export async function canRead(userId: number, vaultId: string): Promise<boolean> {
  return hasRoleOrHigher(userId, vaultId, 'viewer');
}

/**
 * Check if user can write/edit vault contents (editor+)
 */
export async function canWrite(userId: number, vaultId: string): Promise<boolean> {
  return hasRoleOrHigher(userId, vaultId, 'editor');
}

/**
 * Check if user can manage vault members (admin+)
 */
export async function canManageMembers(userId: number, vaultId: string): Promise<boolean> {
  return hasRoleOrHigher(userId, vaultId, 'admin');
}

/**
 * Check if user is the vault owner
 */
export async function isOwner(userId: number, vaultId: string): Promise<boolean> {
  const role = await getUserVaultRole(userId, vaultId);
  return role === 'owner';
}

/**
 * Check if a user can modify another user's role
 * Rules:
 * - Owner can modify anyone except themselves (for ownership transfer, use transferOwnership)
 * - Admin can only modify users with lower roles (editor, viewer)
 * - Editor and viewer cannot modify anyone
 */
export async function canModifyMember(
  actorId: number,
  targetUserId: number,
  vaultId: string
): Promise<boolean> {
  if (actorId === targetUserId) return false; // Can't modify self
  
  const actorRole = await getUserVaultRole(actorId, vaultId);
  if (!actorRole) return false;
  
  // Must be at least admin to modify members
  if (ROLE_HIERARCHY[actorRole] < ROLE_HIERARCHY['admin']) return false;
  
  const targetRole = await getUserVaultRole(targetUserId, vaultId);
  if (!targetRole) return true; // Can add new members
  
  // Can only modify users with strictly lower role
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}

/**
 * Check if a role can be assigned by an actor
 * Rules:
 * - Owner can assign any role except owner
 * - Admin can only assign editor or viewer
 */
export async function canAssignRole(
  actorId: number,
  vaultId: string,
  roleToAssign: VaultRole
): Promise<boolean> {
  const actorRole = await getUserVaultRole(actorId, vaultId);
  if (!actorRole) return false;
  
  // Can't assign owner role (use transferOwnership instead)
  if (roleToAssign === 'owner') return false;
  
  // Owner can assign admin, editor, viewer
  if (actorRole === 'owner') return true;
  
  // Admin can only assign editor, viewer
  if (actorRole === 'admin') {
    return roleToAssign === 'editor' || roleToAssign === 'viewer';
  }
  
  return false;
}

/**
 * Add a user as a member of a vault
 * @param vaultId - The vault ID
 * @param userId - The user ID to add
 * @param role - The role to assign
 * @param addedBy - The user ID of who is adding (null for system/migration)
 * @returns Success status and error message if failed
 */
export async function addMember(
  vaultId: string,
  userId: number,
  role: VaultRole,
  addedBy: number | null
): Promise<{ success: boolean; error?: string }> {
  const db = getDatabase();
  
  // Validate role
  if (!['owner', 'admin', 'editor', 'viewer'].includes(role)) {
    return { success: false, error: 'Invalid role' };
  }
  
  // Check if addedBy user has permission to add this role
  if (addedBy !== null) {
    const canAssign = await canAssignRole(addedBy, vaultId, role);
    if (!canAssign) {
      return { success: false, error: 'Insufficient permissions to assign this role' };
    }
  }
  
  return new Promise((resolve) => {
    db.run(
      'INSERT INTO vault_members (vault_id, user_id, role, added_by) VALUES (?, ?, ?, ?)',
      [vaultId, userId, role, addedBy],
      function(err: Error | null) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            resolve({ success: false, error: 'User is already a member of this vault' });
          } else {
            console.error('Error adding vault member:', err);
            resolve({ success: false, error: 'Database error' });
          }
        } else {
          console.log(`Added user ${userId} to vault ${vaultId} as ${role}`);
          resolve({ success: true });
        }
      }
    );
  });
}

/**
 * Remove a user from a vault
 * @param vaultId - The vault ID
 * @param userId - The user ID to remove
 * @param removedBy - The user ID of who is removing
 * @returns Success status and error message if failed
 */
export async function removeMember(
  vaultId: string,
  userId: number,
  removedBy: number
): Promise<{ success: boolean; error?: string }> {
  const db = getDatabase();
  
  // Check if the target is the owner
  const targetRole = await getUserVaultRole(userId, vaultId);
  if (targetRole === 'owner') {
    return { success: false, error: 'Cannot remove vault owner. Transfer ownership first.' };
  }
  
  // Check if remover has permission
  const canModify = await canModifyMember(removedBy, userId, vaultId);
  if (!canModify) {
    return { success: false, error: 'Insufficient permissions to remove this member' };
  }
  
  return new Promise((resolve) => {
    db.run(
      'DELETE FROM vault_members WHERE vault_id = ? AND user_id = ?',
      [vaultId, userId],
      function(this: { changes: number }, err: Error | null) {
        if (err) {
          console.error('Error removing vault member:', err);
          resolve({ success: false, error: 'Database error' });
        } else if (this.changes === 0) {
          resolve({ success: false, error: 'Member not found' });
        } else {
          console.log(`Removed user ${userId} from vault ${vaultId}`);
          resolve({ success: true });
        }
      }
    );
  });
}

/**
 * Update a user's role in a vault
 * @param vaultId - The vault ID
 * @param userId - The user ID to update
 * @param newRole - The new role to assign
 * @param updatedBy - The user ID of who is updating
 * @returns Success status and error message if failed
 */
export async function updateMemberRole(
  vaultId: string,
  userId: number,
  newRole: VaultRole,
  updatedBy: number
): Promise<{ success: boolean; error?: string }> {
  const db = getDatabase();
  
  // Validate role
  if (!['owner', 'admin', 'editor', 'viewer'].includes(newRole)) {
    return { success: false, error: 'Invalid role' };
  }
  
  // Can't change to owner via this function
  if (newRole === 'owner') {
    return { success: false, error: 'Use transferOwnership to change vault owner' };
  }
  
  // Check if updater has permission to modify this member
  const canModify = await canModifyMember(updatedBy, userId, vaultId);
  if (!canModify) {
    return { success: false, error: 'Insufficient permissions to modify this member' };
  }
  
  // Check if updater can assign the new role
  const canAssign = await canAssignRole(updatedBy, vaultId, newRole);
  if (!canAssign) {
    return { success: false, error: 'Insufficient permissions to assign this role' };
  }
  
  return new Promise((resolve) => {
    db.run(
      'UPDATE vault_members SET role = ? WHERE vault_id = ? AND user_id = ?',
      [newRole, vaultId, userId],
      function(this: { changes: number }, err: Error | null) {
        if (err) {
          console.error('Error updating vault member role:', err);
          resolve({ success: false, error: 'Database error' });
        } else if (this.changes === 0) {
          resolve({ success: false, error: 'Member not found' });
        } else {
          console.log(`Updated user ${userId} role to ${newRole} in vault ${vaultId}`);
          resolve({ success: true });
        }
      }
    );
  });
}

/**
 * Transfer vault ownership to another user
 * @param vaultId - The vault ID
 * @param newOwnerId - The user ID of the new owner
 * @param currentOwnerId - The user ID of the current owner
 * @returns Success status and error message if failed
 */
export async function transferOwnership(
  vaultId: string,
  newOwnerId: number,
  currentOwnerId: number
): Promise<{ success: boolean; error?: string }> {
  const db = getDatabase();
  
  // Verify current owner
  const isCurrentOwner = await isOwner(currentOwnerId, vaultId);
  if (!isCurrentOwner) {
    return { success: false, error: 'Only the current owner can transfer ownership' };
  }
  
  // Check if new owner is a member
  const newOwnerRole = await getUserVaultRole(newOwnerId, vaultId);
  if (!newOwnerRole) {
    return { success: false, error: 'New owner must be an existing member of the vault' };
  }
  
  // Can't transfer to self
  if (newOwnerId === currentOwnerId) {
    return { success: false, error: 'Cannot transfer ownership to yourself' };
  }
  
  return new Promise((resolve) => {
    // Use a transaction to ensure atomicity
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Demote current owner to admin
      db.run(
        'UPDATE vault_members SET role = ? WHERE vault_id = ? AND user_id = ?',
        ['admin', vaultId, currentOwnerId],
        function(err: Error | null) {
          if (err) {
            db.run('ROLLBACK');
            console.error('Error demoting current owner:', err);
            resolve({ success: false, error: 'Database error' });
            return;
          }
          
          // Promote new owner
          db.run(
            'UPDATE vault_members SET role = ? WHERE vault_id = ? AND user_id = ?',
            ['owner', vaultId, newOwnerId],
            function(err: Error | null) {
              if (err) {
                db.run('ROLLBACK');
                console.error('Error promoting new owner:', err);
                resolve({ success: false, error: 'Database error' });
                return;
              }
              
              db.run('COMMIT', (err: Error | null) => {
                if (err) {
                  db.run('ROLLBACK');
                  console.error('Error committing ownership transfer:', err);
                  resolve({ success: false, error: 'Database error' });
                } else {
                  console.log(`Transferred vault ${vaultId} ownership from user ${currentOwnerId} to ${newOwnerId}`);
                  resolve({ success: true });
                }
              });
            }
          );
        }
      );
    });
  });
}

/**
 * Get all members of a vault
 * @param vaultId - The vault ID
 * @returns Array of vault members with user details
 */
export async function getVaultMembers(vaultId: string): Promise<VaultMember[]> {
  const db = getDatabase();
  
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
        vm.id,
        vm.vault_id,
        vm.user_id,
        u.username,
        vm.role,
        vm.added_by,
        ab.username as added_by_username,
        vm.created_at
      FROM vault_members vm
      JOIN users u ON vm.user_id = u.id
      LEFT JOIN users ab ON vm.added_by = ab.id
      WHERE vm.vault_id = ?
      ORDER BY 
        CASE vm.role 
          WHEN 'owner' THEN 1 
          WHEN 'admin' THEN 2 
          WHEN 'editor' THEN 3 
          WHEN 'viewer' THEN 4 
        END,
        vm.created_at ASC`,
      [vaultId],
      (err: Error | null, rows: VaultMember[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as VaultMember[]);
        }
      }
    );
  });
}

/**
 * Get all vaults a user has access to
 * @param userId - The user ID
 * @returns Array of vault IDs with user's role
 */
export async function getUserVaults(userId: number): Promise<Array<{ vault_id: string; role: VaultRole }>> {
  const db = getDatabase();
  
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT vault_id, role FROM vault_members WHERE user_id = ? ORDER BY created_at DESC',
      [userId],
      (err: Error | null, rows: Array<{ vault_id: string; role: VaultRole }>) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as Array<{ vault_id: string; role: VaultRole }>);
        }
      }
    );
  });
}

/**
 * Get the owner of a vault
 * @param vaultId - The vault ID
 * @returns The owner's user ID or null if no owner
 */
export async function getVaultOwner(vaultId: string): Promise<number | null> {
  const db = getDatabase();
  
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT user_id FROM vault_members WHERE vault_id = ? AND role = ?',
      [vaultId, 'owner'],
      (err: Error | null, row: { user_id: number } | undefined) => {
        if (err) {
          reject(err);
        } else {
          resolve(row?.user_id || null);
        }
      }
    );
  });
}

/**
 * Check if a vault has any members (for migration purposes)
 * @param vaultId - The vault ID
 * @returns true if vault has members
 */
export async function vaultHasMembers(vaultId: string): Promise<boolean> {
  const db = getDatabase();
  
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT COUNT(*) as count FROM vault_members WHERE vault_id = ?',
      [vaultId],
      (err: Error | null, row: { count: number } | undefined) => {
        if (err) {
          reject(err);
        } else {
          resolve((row?.count || 0) > 0);
        }
      }
    );
  });
}

/**
 * Set vault owner (for vault creation or migration)
 * This bypasses normal permission checks and should only be used during vault creation
 * or when migrating existing vaults
 * @param vaultId - The vault ID
 * @param userId - The user ID to set as owner
 */
export async function setVaultOwner(
  vaultId: string,
  userId: number
): Promise<{ success: boolean; error?: string }> {
  const db = getDatabase();
  
  // Check if vault already has an owner
  const existingOwner = await getVaultOwner(vaultId);
  if (existingOwner !== null) {
    return { success: false, error: 'Vault already has an owner' };
  }
  
  return new Promise((resolve) => {
    db.run(
      'INSERT INTO vault_members (vault_id, user_id, role, added_by) VALUES (?, ?, ?, ?)',
      [vaultId, userId, 'owner', null],
      function(err: Error | null) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            // User is already a member, update their role to owner
            db.run(
              'UPDATE vault_members SET role = ? WHERE vault_id = ? AND user_id = ?',
              ['owner', vaultId, userId],
              function(err: Error | null) {
                if (err) {
                  console.error('Error setting vault owner:', err);
                  resolve({ success: false, error: 'Database error' });
                } else {
                  console.log(`Set user ${userId} as owner of vault ${vaultId}`);
                  resolve({ success: true });
                }
              }
            );
          } else {
            console.error('Error setting vault owner:', err);
            resolve({ success: false, error: 'Database error' });
          }
        } else {
          console.log(`Set user ${userId} as owner of vault ${vaultId}`);
          resolve({ success: true });
        }
      }
    );
  });
}

/**
 * Delete all members of a vault (for vault deletion)
 * @param vaultId - The vault ID
 */
export async function deleteAllVaultMembers(vaultId: string): Promise<void> {
  const db = getDatabase();
  
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM vault_members WHERE vault_id = ?',
      [vaultId],
      function(err: Error | null) {
        if (err) {
          reject(err);
        } else {
          console.log(`Deleted all members from vault ${vaultId}`);
          resolve();
        }
      }
    );
  });
}

