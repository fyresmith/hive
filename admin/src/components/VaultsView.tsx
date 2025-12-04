import { useState, useEffect } from 'react';
import { 
  getVaults, 
  getVaultInfo, 
  getVaultMembers,
  addVaultMember,
  updateVaultMemberRole,
  removeVaultMember,
  transferVaultOwnership,
  deleteVault,
  getUsers,
  Vault,
  VaultMember,
  VaultRole,
  User
} from '../api';

interface VaultsViewProps {
  onOpenVault: (vaultId: string) => void;
}

export default function VaultsView({ onOpenVault }: VaultsViewProps) {
  const [vaultIds, setVaultIds] = useState<string[]>([]);
  const [vaultDetails, setVaultDetails] = useState<Map<string, Vault>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVault, setSelectedVault] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'files' | 'members'>('files');

  useEffect(() => {
    loadVaults();
  }, []);

  const loadVaults = async () => {
    try {
      setLoading(true);
      setError(null);
      const ids = await getVaults();
      setVaultIds(ids);
      
      // Load details for each vault
      const details = new Map<string, Vault>();
      for (const id of ids) {
        try {
          const info = await getVaultInfo(id);
          details.set(id, info);
        } catch {
          // Skip vault if we can't get info
        }
      }
      setVaultDetails(details);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vaults');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="view-container">
        <div className="view-header">
          <h1>Vaults</h1>
        </div>
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading vaults...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="view-container">
        <div className="view-header">
          <h1>Vaults</h1>
        </div>
        <div className="error-state">
          <p>{error}</p>
          <button onClick={loadVaults} className="retry-button">Retry</button>
        </div>
      </div>
    );
  }

  if (selectedVault) {
    return (
      <VaultDetailView 
        vaultId={selectedVault} 
        onBack={() => {
          setSelectedVault(null);
          loadVaults();
        }}
        onOpenFiles={() => onOpenVault(selectedVault)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    );
  }

  return (
    <div className="view-container">
      <div className="view-header">
        <h1>Vaults</h1>
        <span className="badge">{vaultIds.length}</span>
      </div>
      
      {vaultIds.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📁</span>
          <p>No vaults created yet</p>
        </div>
      ) : (
        <div className="vaults-grid">
          {vaultIds.map((vaultId) => {
            const details = vaultDetails.get(vaultId);
            return (
              <div 
                key={vaultId} 
                className="vault-card"
                onClick={() => setSelectedVault(vaultId)}
              >
                <div className="vault-name">{vaultId}</div>
                <div className="vault-stats">
                  <span className="vault-stat">{details?.files.length ?? '...'} files</span>
                  <span className="vault-stat">{details?.userCount ?? 0} online</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Vault Detail View with Members Management
interface VaultDetailViewProps {
  vaultId: string;
  onBack: () => void;
  onOpenFiles: () => void;
  activeTab: 'files' | 'members';
  onTabChange: (tab: 'files' | 'members') => void;
}

function VaultDetailView({ vaultId, onBack, onOpenFiles, activeTab, onTabChange }: VaultDetailViewProps) {
  const [vault, setVault] = useState<Vault | null>(null);
  const [members, setMembers] = useState<VaultMember[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadVaultData();
  }, [vaultId]);

  const loadVaultData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [vaultInfo, memberList, userList] = await Promise.all([
        getVaultInfo(vaultId),
        getVaultMembers(vaultId).catch(() => []),
        getUsers()
      ]);
      
      setVault(vaultInfo);
      setMembers(memberList);
      setAllUsers(userList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vault');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async (userId: number, role: VaultRole) => {
    try {
      setActionLoading(true);
      await addVaultMember(vaultId, userId, role);
      await loadVaultData();
      setShowAddMember(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateRole = async (userId: number, newRole: VaultRole) => {
    try {
      setActionLoading(true);
      await updateVaultMemberRole(vaultId, userId, newRole);
      await loadVaultData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveMember = async (userId: number, username: string) => {
    if (!confirm(`Remove ${username} from this vault?`)) return;
    
    try {
      setActionLoading(true);
      await removeVaultMember(vaultId, userId);
      await loadVaultData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransferOwnership = async (newOwnerId: number, newOwnerName: string) => {
    if (!confirm(`Transfer vault ownership to ${newOwnerName}? You will become an admin.`)) return;
    
    try {
      setActionLoading(true);
      await transferVaultOwnership(vaultId, newOwnerId);
      await loadVaultData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to transfer ownership');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteVault = async () => {
    if (!confirm(`Delete vault "${vaultId}"? This action cannot be undone!`)) return;
    if (!confirm(`Are you absolutely sure? All files and data will be permanently deleted.`)) return;
    
    try {
      setActionLoading(true);
      await deleteVault(vaultId);
      onBack();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete vault');
      setActionLoading(false);
    }
  };

  const nonMembers = allUsers.filter(u => !members.some(m => m.user_id === u.id));

  if (loading) {
    return (
      <div className="view-container">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading vault...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="view-container">
        <div className="error-state">
          <p>{error}</p>
          <button onClick={onBack} className="btn-secondary">Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      <div className="view-header">
        <button onClick={onBack} className="back-button">
          ← Back
        </button>
        <h1>{vaultId}</h1>
      </div>

      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => onTabChange('files')}
        >
          Files ({vault?.files.length ?? 0})
        </button>
        <button 
          className={`tab ${activeTab === 'members' ? 'active' : ''}`}
          onClick={() => onTabChange('members')}
        >
          Members ({members.length})
        </button>
      </div>

      {activeTab === 'files' ? (
        <div className="vault-files-section">
          <div className="section-header">
            <h2>Files</h2>
            <button onClick={onOpenFiles} className="btn-primary">
              Open File Viewer
            </button>
          </div>
          
          {vault?.files.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">📄</span>
              <p>No files in this vault</p>
            </div>
          ) : (
            <div className="file-list">
              {vault?.files.map(file => (
                <div key={file} className="file-item">
                  <span className="file-icon">📄</span>
                  <span className="file-path">{file}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="vault-members-section">
          <div className="section-header">
            <h2>Members</h2>
            <button 
              onClick={() => setShowAddMember(true)} 
              className="btn-primary"
              disabled={nonMembers.length === 0}
            >
              Add Member
            </button>
          </div>

          {showAddMember && (
            <AddMemberModal
              users={nonMembers}
              onAdd={handleAddMember}
              onClose={() => setShowAddMember(false)}
              loading={actionLoading}
            />
          )}

          {members.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">👥</span>
              <p>No members assigned yet</p>
              <p className="empty-hint">The first user to connect will become the owner</p>
            </div>
          ) : (
            <div className="members-list">
              {members.map(member => (
                <MemberRow
                  key={member.user_id}
                  member={member}
                  onUpdateRole={handleUpdateRole}
                  onRemove={handleRemoveMember}
                  onTransferOwnership={handleTransferOwnership}
                  loading={actionLoading}
                />
              ))}
            </div>
          )}

          <div className="danger-zone">
            <h3>Danger Zone</h3>
            <div className="danger-action">
              <div>
                <strong>Delete Vault</strong>
                <p>Permanently delete this vault and all its contents</p>
              </div>
              <button 
                onClick={handleDeleteVault} 
                className="btn-danger"
                disabled={actionLoading}
              >
                Delete Vault
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Member Row Component
interface MemberRowProps {
  member: VaultMember;
  onUpdateRole: (userId: number, role: VaultRole) => void;
  onRemove: (userId: number, username: string) => void;
  onTransferOwnership: (userId: number, username: string) => void;
  loading: boolean;
}

function MemberRow({ member, onUpdateRole, onRemove, onTransferOwnership, loading }: MemberRowProps) {
  const isOwner = member.role === 'owner';
  
  const roleColors: Record<VaultRole, string> = {
    owner: '#f5a623',
    admin: '#8b5cf6',
    editor: '#00d26a',
    viewer: '#888'
  };

  return (
    <div className="member-row">
      <div className="member-info">
        <div 
          className="member-avatar"
          style={{ backgroundColor: roleColors[member.role] }}
        >
          {member.username.charAt(0).toUpperCase()}
        </div>
        <div className="member-details">
          <div className="member-name">{member.username}</div>
          <div className="member-meta">
            Added {new Date(member.created_at).toLocaleDateString()}
            {member.added_by_username && ` by ${member.added_by_username}`}
          </div>
        </div>
      </div>
      
      <div className="member-actions">
        {isOwner ? (
          <span className="role-badge owner">Owner</span>
        ) : (
          <>
            <select
              value={member.role}
              onChange={(e) => onUpdateRole(member.user_id, e.target.value as VaultRole)}
              disabled={loading}
              className="role-select"
            >
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              onClick={() => onTransferOwnership(member.user_id, member.username)}
              className="btn-icon"
              title="Transfer Ownership"
              disabled={loading}
            >
              👑
            </button>
            <button
              onClick={() => onRemove(member.user_id, member.username)}
              className="btn-icon danger"
              title="Remove Member"
              disabled={loading}
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Add Member Modal
interface AddMemberModalProps {
  users: User[];
  onAdd: (userId: number, role: VaultRole) => void;
  onClose: () => void;
  loading: boolean;
}

function AddMemberModal({ users, onAdd, onClose, loading }: AddMemberModalProps) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedRole, setSelectedRole] = useState<VaultRole>('editor');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUserId) {
      onAdd(selectedUserId, selectedRole);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add Member</h3>
          <button onClick={onClose} className="modal-close">✕</button>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label>User</label>
            <select
              value={selectedUserId ?? ''}
              onChange={(e) => setSelectedUserId(Number(e.target.value) || null)}
              required
              className="form-input"
            >
              <option value="">Select a user...</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
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

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn-primary"
              disabled={!selectedUserId || loading}
            >
              {loading ? 'Adding...' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
