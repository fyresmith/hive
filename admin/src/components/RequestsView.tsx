import { useState, useEffect } from 'react';
import { getAccessRequests, approveAccessRequest, rejectAccessRequest, AccessRequest } from '../api';

export default function RequestsView() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getAccessRequests();
      setRequests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (request: AccessRequest) => {
    if (actionLoading) return;
    
    setActionLoading(request.id);
    try {
      await approveAccessRequest(request.id);
      // Remove from list after approval
      setRequests(prev => prev.filter(r => r.id !== request.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (request: AccessRequest) => {
    if (actionLoading) return;
    
    if (!confirm(`Are you sure you want to reject ${request.username}'s request?`)) {
      return;
    }
    
    setActionLoading(request.id);
    try {
      await rejectAccessRequest(request.id);
      // Remove from list after rejection
      setRequests(prev => prev.filter(r => r.id !== request.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject request');
    } finally {
      setActionLoading(null);
    }
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
          <h1>Access Requests</h1>
        </div>
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading requests...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="view-container">
        <div className="view-header">
          <h1>Access Requests</h1>
        </div>
        <div className="error-state">
          <p>{error}</p>
          <button onClick={loadRequests} className="retry-button">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      <div className="view-header">
        <h1>Access Requests</h1>
        <span className="badge">{requests.length}</span>
      </div>
      
      {requests.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📝</span>
          <p>No pending access requests</p>
        </div>
      ) : (
        <div className="requests-list">
          {requests.map((request) => (
            <div key={request.id} className="request-card">
              <div className="request-header">
                <div className="request-user">
                  <span className="user-avatar">
                    {request.username.charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <div className="request-username">{request.username}</div>
                    <div className="request-email">{request.email}</div>
                  </div>
                </div>
                <span className={`status-badge status-${request.status}`}>
                  {request.status}
                </span>
              </div>
              {request.message && (
                <div className="request-message">
                  "{request.message}"
                </div>
              )}
              <div className="request-footer">
                <span className="request-date">{formatDate(request.created_at)}</span>
                <div className="request-actions">
                  <button 
                    className="action-button approve"
                    onClick={() => handleApprove(request)}
                    disabled={actionLoading === request.id}
                  >
                    {actionLoading === request.id ? '...' : 'Approve'}
                  </button>
                  <button 
                    className="action-button reject"
                    onClick={() => handleReject(request)}
                    disabled={actionLoading === request.id}
                  >
                    {actionLoading === request.id ? '...' : 'Reject'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
