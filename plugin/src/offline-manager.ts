/**
 * Hive - Offline Manager
 * Tracks offline state, pending changes, and manages offline editing queue.
 * 
 * @see https://docs.obsidian.md/Plugins/
 */

import { Events } from 'obsidian';

/**
 * Pending change information for a file
 */
export interface PendingChange {
  filepath: string;
  localContent: string;
  timestamp: number;
  baseContent?: string; // Content at time of last sync
}

/**
 * Offline manager events
 */
export interface OfflineManagerEvents {
  'offline-change': (change: PendingChange) => void;
  'pending-count-change': (count: number) => void;
  'online-status-change': (isOnline: boolean) => void;
}

/**
 * Offline Manager
 * Manages offline state tracking and pending change queue
 */
export class OfflineManager extends Events {
  private isOnline = false;
  private pendingChanges: Map<string, PendingChange> = new Map();
  private lastSyncTime: number = 0;
  private baseContents: Map<string, string> = new Map();

  constructor() {
    super();
  }

  /**
   * Set online status
   */
  setOnline(online: boolean): void {
    const wasOnline = this.isOnline;
    this.isOnline = online;
    
    if (wasOnline !== online) {
      this.trigger('online-status-change', online);
      
      if (online) {
        this.lastSyncTime = Date.now();
      }
    }
  }

  /**
   * Check if online
   */
  getIsOnline(): boolean {
    return this.isOnline;
  }

  /**
   * Get last sync timestamp
   */
  getLastSyncTime(): number {
    return this.lastSyncTime;
  }

  /**
   * Update last sync time
   */
  updateLastSyncTime(): void {
    this.lastSyncTime = Date.now();
  }

  /**
   * Set base content for a file (content at time of last sync)
   * Used for three-way merge conflict detection
   */
  setBaseContent(filepath: string, content: string): void {
    this.baseContents.set(filepath, content);
  }

  /**
   * Get base content for a file
   */
  getBaseContent(filepath: string): string | undefined {
    return this.baseContents.get(filepath);
  }

  /**
   * Clear base content for a file
   */
  clearBaseContent(filepath: string): void {
    this.baseContents.delete(filepath);
  }

  /**
   * Clear all base contents
   */
  clearAllBaseContents(): void {
    this.baseContents.clear();
  }

  /**
   * Track an offline change
   */
  trackOfflineChange(filepath: string, localContent: string): void {
    const existing = this.pendingChanges.get(filepath);
    const baseContent = existing?.baseContent || this.baseContents.get(filepath);
    
    const change: PendingChange = {
      filepath,
      localContent,
      timestamp: Date.now(),
      baseContent,
    };
    
    this.pendingChanges.set(filepath, change);
    this.trigger('offline-change', change);
    this.trigger('pending-count-change', this.pendingChanges.size);
  }

  /**
   * Get all pending changes
   */
  getPendingChanges(): Map<string, PendingChange> {
    return new Map(this.pendingChanges);
  }

  /**
   * Get pending change for a specific file
   */
  getPendingChange(filepath: string): PendingChange | undefined {
    return this.pendingChanges.get(filepath);
  }

  /**
   * Get count of pending changes
   */
  getPendingCount(): number {
    return this.pendingChanges.size;
  }

  /**
   * Check if there are pending changes
   */
  hasPendingChanges(): boolean {
    return this.pendingChanges.size > 0;
  }

  /**
   * Get list of files with pending changes
   */
  getPendingFiles(): string[] {
    return Array.from(this.pendingChanges.keys());
  }

  /**
   * Clear a specific pending change
   */
  clearPendingChange(filepath: string): void {
    if (this.pendingChanges.has(filepath)) {
      this.pendingChanges.delete(filepath);
      this.trigger('pending-count-change', this.pendingChanges.size);
    }
  }

  /**
   * Clear all pending changes
   */
  clearAllPending(): void {
    this.pendingChanges.clear();
    this.trigger('pending-count-change', 0);
  }

  /**
   * Export pending changes to JSON for persistence
   */
  exportPendingChanges(): string {
    const data: Record<string, PendingChange> = {};
    this.pendingChanges.forEach((change, filepath) => {
      data[filepath] = change;
    });
    return JSON.stringify(data);
  }

  /**
   * Import pending changes from JSON
   */
  importPendingChanges(json: string): void {
    try {
      const data = JSON.parse(json) as Record<string, PendingChange>;
      this.pendingChanges.clear();
      
      for (const [filepath, change] of Object.entries(data)) {
        this.pendingChanges.set(filepath, change);
      }
      
      this.trigger('pending-count-change', this.pendingChanges.size);
    } catch (err) {
      console.error('[Hive] Failed to import pending changes:', err);
    }
  }

  /**
   * Export base contents to JSON for persistence
   */
  exportBaseContents(): string {
    const data: Record<string, string> = {};
    this.baseContents.forEach((content, filepath) => {
      data[filepath] = content;
    });
    return JSON.stringify(data);
  }

  /**
   * Import base contents from JSON
   */
  importBaseContents(json: string): void {
    try {
      const data = JSON.parse(json) as Record<string, string>;
      this.baseContents.clear();
      
      for (const [filepath, content] of Object.entries(data)) {
        this.baseContents.set(filepath, content);
      }
    } catch (err) {
      console.error('[Hive] Failed to import base contents:', err);
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.pendingChanges.clear();
    this.baseContents.clear();
  }
}

