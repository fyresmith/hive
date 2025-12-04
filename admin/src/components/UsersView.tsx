import { useState, useEffect } from 'react';
import { 
  getUsers, 
  createUser, 
  updateUser, 
  deleteUser, 
  getVaults,
  getVaultMembers,
  addVaultMember,
  updateVaultMemberRole,
  removeVaultMember,
  User, 
  VaultRole
} from '../api';

interface UserModalProps {
  user: User | null;
  onClose: () => void;
  onSave: (username: string, password: string) => Promise<void>;
  isCreating: boolean;
}

function UserModal({ user, onClose, onSave, isCreating }: UserModalProps) {
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isCreating && !username.trim()) {
      setError('Username is required');
      return;
    }
    if (isCreating && !password) {
      setError('Password is required');
      return;
    }
    if (!isCreating && !username.trim() && !password) {
      setError('At least one field must be filled');
      return;
    }

    try {
      setSaving(true);
      await onSave(username.trim(), password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isCreating ? 'Create User' : 'Edit User'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="modal-error">{error}</div>}
            
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={isCreating ? 'Enter username' : 'Leave empty to keep current'}
                autoFocus
                autoComplete="off"
              />
              <span className="form-hint">Minimum 3 characters</span>
            </div>

            <div className="form-group">
              <label htmlFor="password">
                {isCreating ? 'Password' : 'New Password'}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={isCreating ? 'Enter password' : 'Leave empty to keep current'}
                autoComplete="new-password"
              />
              <span className="form-hint">Minimum 6 characters</span>
            </div>
          </div>
          
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : isCreating ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeleteModalProps {
  user: User;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function DeleteModal({ user, onClose, onConfirm }: DeleteModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    try {
      setDeleting(true);
      setError(null);
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-small" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Delete User</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="modal-error">{error}</div>}
          <p className="delete-warning">
            Are you sure you want to delete <strong>{user.username}</strong>?
          </p>
          <p className="delete-hint">This action cannot be undone.</p>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// User Detail View with Vault Permissions
interface UserDetailViewProps {
  user: User;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

interface VaultMembership {
  vaultId: string;
  role: VaultRole;
}

function UserDetailView({ user, onBack, onEdit, onDelete }: UserDetailViewProps) {
  const [memberships, setMemberships] = useState<VaultMembership[]>([]);
  const [allVaults, setAllVaults] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddVault, setShowAddVault] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [user.id]);

  const loadData = async () => {
    try {
      setLoading(true);
      const vaults = await getVaults();
      setAllVaults(vaults);
      
      const userMemberships: VaultMembership[] = [];
      for (const vaultId of vaults) {
        try {
          const members = await getVaultMembers(vaultId);
          const userMember = members.find(m => m.user_id === user.id);
          if (userMember) {
            userMemberships.push({ vaultId, role: userMember.role });
          }
        } catch {
          // Skip vaults we can't access
        }
      }
      setMemberships(userMemberships);
    } catch (err) {
      console.error('Failed to load user data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToVault = async (vaultId: string, role: VaultRole) => {
    try {
      setActionLoading(true);
      await addVaultMember(vaultId, user.id, role);
      await loadData();
      setShowAddVault(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add user to vault');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateRole = async (vaultId: string, newRole: VaultRole) => {
    try {
      setActionLoading(true);
      await updateVaultMemberRole(vaultId, user.id, newRole);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveFromVault = async (vaultId: string) => {
    if (!confirm(`Remove ${user.username} from vault "${vaultId}"?`)) return;
    
    try {
      setActionLoading(true);
      await removeVaultMember(vaultId, user.id);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove from vault');
    } finally {
      setActionLoading(false);
    }
  };

  const availableVaults = allVaults.filter(v => !memberships.some(m => m.vaultId === v));

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <button onClick={onBack} className="back-button">← Back</button>
        <h1>{user.username}</h1>
        {user.is_admin && <span className="badge admin-badge">Admin</span>}
      </div>

      <div className="user-detail-card">
        <div className="user-detail-header">
          <div className="user-detail-avatar" style={{ backgroundColor: '#3b82f6' }}>
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="user-detail-info">
            <h2>{user.username}</h2>
            <p className="user-detail-meta">User ID: {user.id} · Created {formatDate(user.created_at)}</p>
          </div>
          <div className="user-detail-actions">
            <button className="btn-secondary" onClick={onEdit}>Edit</button>
            <button className="btn-danger" onClick={onDelete}>Delete</button>
          </div>
        </div>
      </div>

      <div className="section-header">
        <h2>Vault Permissions</h2>
        <button 
          className="btn-primary"
          onClick={() => setShowAddVault(true)}
          disabled={availableVaults.length === 0}
        >
          + Add to Vault
        </button>
      </div>

      {loading ? (
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading permissions...</p>
        </div>
      ) : memberships.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🔒</span>
          <p>No vault access</p>
          <p className="empty-hint">This user doesn't have access to any vaults</p>
        </div>
      ) : (
        <div className="permissions-list">
          {memberships.map(membership => (
            <div key={membership.vaultId} className="permission-row">
              <div className="permission-vault">
                <span className="vault-icon">📁</span>
                <span className="vault-name">{membership.vaultId}</span>
              </div>
              <div className="permission-actions">
                {membership.role === 'owner' ? (
                  <span className="role-badge owner">Owner</span>
                ) : (
                  <>
                    <select
                      value={membership.role}
                      onChange={(e) => handleUpdateRole(membership.vaultId, e.target.value as VaultRole)}
                      disabled={actionLoading}
                      className="role-select"
                    >
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      onClick={() => handleRemoveFromVault(membership.vaultId)}
                      className="btn-icon danger"
                      title="Remove access"
                      disabled={actionLoading}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddVault && (
        <AddToVaultModal
          vaults={availableVaults}
          onAdd={handleAddToVault}
          onClose={() => setShowAddVault(false)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

// Add to Vault Modal
interface AddToVaultModalProps {
  vaults: string[];
  onAdd: (vaultId: string, role: VaultRole) => void;
  onClose: () => void;
  loading: boolean;
}

function AddToVaultModal({ vaults, onAdd, onClose, loading }: AddToVaultModalProps) {
  const [selectedVault, setSelectedVault] = useState('');
  const [selectedRole, setSelectedRole] = useState<VaultRole>('editor');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedVault) {
      onAdd(selectedVault, selectedRole);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add to Vault</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Vault</label>
              <select
                value={selectedVault}
                onChange={(e) => setSelectedVault(e.target.value)}
                className="form-input"
                required
              >
                <option value="">Select a vault...</option>
                {vaults.map(vault => (
                  <option key={vault} value={vault}>{vault}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Role</label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as VaultRole)}
                className="form-input"
              >
                <option value="admin">Admin - Can manage members</option>
                <option value="editor">Editor - Can read and write</option>
                <option value="viewer">Viewer - Read only</option>
              </select>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!selectedVault || loading}>
              {loading ? 'Adding...' : 'Add Access'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UsersView() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (username: string, password: string) => {
    await createUser(username, password);
    await loadUsers();
  };

  const handleUpdateUser = async (username: string, password: string) => {
    if (!editingUser) return;
    const updates: { username?: string; password?: string } = {};
    if (username && username !== editingUser.username) {
      updates.username = username;
    }
    if (password) {
      updates.password = password;
    }
    if (Object.keys(updates).length > 0) {
      await updateUser(editingUser.id, updates);
      await loadUsers();
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    await deleteUser(deletingUser.id);
    setSelectedUser(null);
    await loadUsers();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Show user detail view if a user is selected
  if (selectedUser) {
    return (
      <UserDetailView
        user={selectedUser}
        onBack={() => {
          setSelectedUser(null);
          loadUsers();
        }}
        onEdit={() => setEditingUser(selectedUser)}
        onDelete={() => setDeletingUser(selectedUser)}
      />
    );
  }

  if (loading) {
    return (
      <div className="view-container">
        <div className="view-header">
          <h1>Users</h1>
        </div>
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading users...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="view-container">
        <div className="view-header">
          <h1>Users</h1>
        </div>
        <div className="error-state">
          <p>{error}</p>
          <button onClick={loadUsers} className="retry-button">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      <div className="view-header">
        <h1>Users</h1>
        <span className="badge">{users.length}</span>
        <div className="header-actions">
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
            + Create User
          </button>
        </div>
      </div>
      
      {users.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">👤</span>
          <p>No users registered yet</p>
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
            Create First User
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Created</th>
                <th>Role</th>
                <th className="actions-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr 
                  key={user.id} 
                  className="clickable-row"
                  onClick={() => setSelectedUser(user)}
                >
                  <td>
                    <div className="user-cell">
                      <span className="user-avatar">
                        {user.username.charAt(0).toUpperCase()}
                      </span>
                      <div className="user-cell-info">
                        <span className="user-cell-name">{user.username}</span>
                        <span className="user-cell-id">ID: {user.id}</span>
                      </div>
                    </div>
                  </td>
                  <td className="muted">{formatDate(user.created_at)}</td>
                  <td>
                    {user.is_admin ? (
                      <span className="role-tag admin">Server Admin</span>
                    ) : (
                      <span className="role-tag user">User</span>
                    )}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="row-actions">
                      <button 
                        className="action-btn edit" 
                        onClick={() => setEditingUser(user)}
                        title="Edit user"
                      >
                        ✎
                      </button>
                      <button 
                        className="action-btn delete" 
                        onClick={() => setDeletingUser(user)}
                        title="Delete user"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <UserModal
          user={null}
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreateUser}
          isCreating={true}
        />
      )}

      {editingUser && (
        <UserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={handleUpdateUser}
          isCreating={false}
        />
      )}

      {deletingUser && (
        <DeleteModal
          user={deletingUser}
          onClose={() => setDeletingUser(null)}
          onConfirm={handleDeleteUser}
        />
      )}
    </div>
  );
}
