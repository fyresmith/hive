const API_BASE = 'http://localhost:3000';

let authToken: string | null = localStorage.getItem('hive_admin_token');

export function setToken(token: string) {
  authToken = token;
  localStorage.setItem('hive_admin_token', token);
}

export function getToken(): string | null {
  return authToken;
}

export function clearToken() {
  authToken = null;
  localStorage.removeItem('hive_admin_token');
}

async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (authToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401) {
    clearToken();
    throw new Error('Unauthorized');
  }

  return response;
}

// Auto-login for admin panel
export async function autoLogin(): Promise<{ token: string; username: string }> {
  const res = await fetch(`${API_BASE}/api/admin/token`);

  if (!res.ok) {
    throw new Error('Failed to connect to server');
  }

  const data = await res.json();
  setToken(data.token);
  return data;
}

// Users
export interface User {
  id: number;
  username: string;
  created_at: string;
}

export async function getUsers(): Promise<User[]> {
  const res = await fetchWithAuth('/api/admin/users');
  if (!res.ok) throw new Error('Failed to fetch users');
  const data = await res.json();
  return data.users;
}

export async function getUser(id: number): Promise<User> {
  const res = await fetchWithAuth(`/api/admin/users/${id}`);
  if (!res.ok) throw new Error('Failed to fetch user');
  const data = await res.json();
  return data.user;
}

export async function createUser(username: string, password: string): Promise<{ userId: number; username: string }> {
  const res = await fetchWithAuth('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to create user');
  }
  return res.json();
}

export async function updateUser(id: number, updates: { username?: string; password?: string }): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to update user');
  }
}

export async function deleteUser(id: number): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/users/${id}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to delete user');
  }
}

// Access Requests
export interface AccessRequest {
  id: number;
  username: string;
  email: string;
  message: string | null;
  status: string;
  created_at: string;
}

export async function getAccessRequests(): Promise<AccessRequest[]> {
  const res = await fetchWithAuth('/api/admin/access-requests');
  if (!res.ok) throw new Error('Failed to fetch access requests');
  const data = await res.json();
  return data.requests;
}

export async function approveAccessRequest(id: number): Promise<{ username: string }> {
  const res = await fetchWithAuth(`/api/admin/access-requests/${id}/approve`, {
    method: 'POST'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to approve request');
  }
  return res.json();
}

export async function rejectAccessRequest(id: number): Promise<void> {
  const res = await fetchWithAuth(`/api/admin/access-requests/${id}/reject`, {
    method: 'POST'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to reject request');
  }
}

// Vaults
export interface Vault {
  id: string;
  files: string[];
  userCount: number;
}

export async function getVaults(): Promise<string[]> {
  const res = await fetchWithAuth('/api/vault/list');
  if (!res.ok) throw new Error('Failed to fetch vaults');
  const data = await res.json();
  return data.vaults;
}

export async function getVaultInfo(vaultId: string): Promise<Vault> {
  const res = await fetchWithAuth(`/api/vault/${vaultId}`);
  if (!res.ok) throw new Error('Failed to fetch vault info');
  const data = await res.json();
  return { id: vaultId, files: data.files, userCount: data.userCount };
}

export async function getVaultFiles(vaultId: string): Promise<string[]> {
  const res = await fetchWithAuth(`/api/vault/${vaultId}/files`);
  if (!res.ok) throw new Error('Failed to fetch vault files');
  const data = await res.json();
  return data.files;
}

export async function getFileContent(vaultId: string, filepath: string): Promise<string> {
  const res = await fetchWithAuth(`/api/vault/${vaultId}/file/${filepath}`);
  if (!res.ok) throw new Error('Failed to fetch file content');
  const data = await res.json();
  return data.content;
}

export async function deleteVault(vaultId: string): Promise<void> {
  const res = await fetchWithAuth(`/api/vault/${vaultId}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to delete vault');
  }
}

// Vault Members
export type VaultRole = 'owner' | 'admin' | 'editor' | 'viewer';

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

export async function getVaultMembers(vaultId: string): Promise<VaultMember[]> {
  const res = await fetchWithAuth(`/api/vault/${vaultId}/members`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch vault members');
  }
  const data = await res.json();
  return data.members;
}

export async function addVaultMember(
  vaultId: string, 
  userId: number, 
  role: VaultRole
): Promise<{ userId: number; username: string; role: VaultRole }> {
  const res = await fetchWithAuth(`/api/vault/${vaultId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId, role })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to add member');
  }
  return res.json();
}

export async function updateVaultMemberRole(
  vaultId: string, 
  userId: number, 
  role: VaultRole
): Promise<void> {
  const res = await fetchWithAuth(`/api/vault/${vaultId}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ role })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to update member role');
  }
}

export async function removeVaultMember(vaultId: string, userId: number): Promise<void> {
  const res = await fetchWithAuth(`/api/vault/${vaultId}/members/${userId}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to remove member');
  }
}

export async function transferVaultOwnership(vaultId: string, newOwnerId: number): Promise<void> {
  const res = await fetchWithAuth(`/api/vault/${vaultId}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ newOwnerId })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to transfer ownership');
  }
}

