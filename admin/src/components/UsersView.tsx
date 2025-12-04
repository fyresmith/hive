import { useState, useEffect } from 'react';
import { getUsers, createUser, updateUser, deleteUser, User } from '../api';

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
              {saving ? 'Saving...' : isCreating ? 'Create User' : 'Save Changes'}
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
            {deleting ? 'Deleting...' : 'Delete User'}
          </button>
        </div>
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
    await loadUsers();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

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
          <button className="btn-create" onClick={() => setShowCreateModal(true)}>
            <span className="btn-icon">+</span>
            Create User
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
                <th>ID</th>
                <th>Username</th>
                <th>Created</th>
                <th className="actions-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="mono">{user.id}</td>
                  <td>
                    <div className="user-cell">
                      <span className="user-avatar">
                        {user.username.charAt(0).toUpperCase()}
                      </span>
                      {user.username}
                    </div>
                  </td>
                  <td className="muted">{formatDate(user.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button 
                        className="action-btn edit" 
                        onClick={() => setEditingUser(user)}
                        title="Edit user"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button 
                        className="action-btn delete" 
                        onClick={() => setDeletingUser(user)}
                        title="Delete user"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
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
