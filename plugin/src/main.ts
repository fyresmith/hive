/**
 * Hive - Real-time collaborative editing for Obsidian
 * Main plugin entry point. Handles plugin lifecycle, UI elements, and coordination.
 * 
 * @see https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
 */

import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  MarkdownView,
  Notice,
  addIcon,
  debounce,
  Editor,
  setIcon,
} from 'obsidian';
import { HiveSettings, HiveVaultSettings, DEFAULT_SETTINGS, DEFAULT_VAULT_SETTINGS, HiveSettingsTab } from './settings';
import { SyncEngine, ConnectionState, UserPresence, FileConflict, ConflictResolution, MergeResult, VaultRole } from './sync';
import { CursorManager } from './cursors';
import { 
  registerPresenceView, 
  activatePresenceView, 
  getPresenceView,
  PRESENCE_VIEW_TYPE 
} from './presence';
import { openHiveSettings, registerHiveSettingsView, HIVE_SETTINGS_VIEW_TYPE } from './hive-modal';
import { showConflictModal } from './conflict-modal';

// Hive hexagon icon
const HIVE_ICON = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6">
  <polygon points="50,5 93,27.5 93,72.5 50,95 7,72.5 7,27.5" fill="currentColor" opacity="0.15"/>
  <polygon points="50,5 93,27.5 93,72.5 50,95 7,72.5 7,27.5"/>
</svg>`;

/**
 * Hive Plugin
 * Enables real-time collaborative editing with live cursors
 */
export default class HivePlugin extends Plugin {
  settings: HiveSettings = DEFAULT_SETTINGS;
  private vaultName: string = '';
  syncEngine: SyncEngine | null = null;
  cursorManager: CursorManager | null = null;
  statusBarItem: HTMLElement | null = null;
  private activeFile: TFile | null = null;
  private cursorUpdateThrottle = 100; // ms between cursor updates
  private lastCursorUpdate = 0;
  private pendingCount = 0;
  private currentConnectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private currentRole: VaultRole | null = null;

  async onload(): Promise<void> {
    console.log('[Hive] Loading plugin');

    // Load settings
    await this.loadSettings();

    // Register custom icon
    addIcon('hive', HIVE_ICON);

    // Register views
    registerPresenceView(this);
    registerHiveSettingsView(this);

    // Add settings tab
    this.addSettingTab(new HiveSettingsTab(this.app, this));

    // Add status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass('hive-status-bar');
    this.updateStatusBar(ConnectionState.DISCONNECTED);

    // Add ribbon icon - opens the Hive settings tab
    this.addRibbonIcon('hive', 'Hive Settings', () => {
      openHiveSettings(this);
    });

    // Add commands
    this.addCommand({
      id: 'open-hive-settings',
      name: 'Open Hive settings',
      callback: () => {
        openHiveSettings(this);
      },
    });

    this.addCommand({
      id: 'connect-to-hive',
      name: 'Connect to the Hive',
      callback: async () => {
        await this.connectToServer();
      },
    });

    this.addCommand({
      id: 'disconnect-from-hive',
      name: 'Disconnect from the Hive',
      callback: () => {
        this.disconnectFromServer();
        new Notice('Disconnected from the Hive');
      },
    });

    this.addCommand({
      id: 'show-hive-users',
      name: 'Show connected users',
      callback: () => {
        this.showConnectedUsers();
      },
    });

    this.addCommand({
      id: 'open-hive-presence',
      name: 'Open Hive presence panel',
      callback: async () => {
        await activatePresenceView(this);
      },
    });

    // Register file change handlers
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && this.syncEngine) {
          this.syncEngine.onFileChange(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && this.syncEngine) {
          this.syncEngine.onFileChange(file);
        }
      })
    );

    // Register file rename handler
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile && this.syncEngine) {
          this.syncEngine.onFileRename(oldPath, file.path);
        }
      })
    );

    // Register file delete handler
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && this.syncEngine) {
          this.syncEngine.onFileDelete(file.path);
        }
      })
    );

    // Register active file change handler
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        this.handleActiveLeafChange(leaf);
      })
    );

    // Register editor change handler for cursor tracking
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor: Editor, info) => {
        this.handleEditorChange(editor, info);
      })
    );

    // Auto-connect if enabled
    const vaultSettings = this.getVaultSettings();
    if (vaultSettings.autoConnect && vaultSettings.token) {
      // Delay auto-connect to let Obsidian fully load
      setTimeout(() => {
        this.connectToServer();
      }, 2000);
    }
  }

  async onunload(): Promise<void> {
    console.log('[Hive] Unloading plugin');
    
    // Clean up cursor manager
    if (this.cursorManager) {
      this.cursorManager.destroy();
      this.cursorManager = null;
    }

    // Clean up sync engine
    if (this.syncEngine) {
      this.syncEngine.destroy();
      this.syncEngine = null;
    }

    // Detach view leaves
    this.app.workspace.detachLeavesOfType(PRESENCE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(HIVE_SETTINGS_VIEW_TYPE);
  }

  /**
   * Load plugin settings
   * Settings are stored per-vault to allow different logins for different vaults
   */
  async loadSettings(): Promise<void> {
    this.vaultName = this.app.vault.getName();
    const data = await this.loadData();
    
    // Check if this is old-style settings (no 'vaults' key) and migrate
    if (data && !data.vaults && data.serverUrl !== undefined) {
      console.log('[Hive] Migrating old settings format to per-vault storage');
      // Old format - migrate to new format under current vault name
      const oldSettings: HiveVaultSettings = {
        serverUrl: data.serverUrl || '',
        username: data.username || '',
        token: data.token || '',
        vaultId: data.vaultId || '',
        autoConnect: data.autoConnect || false,
        userColor: data.userColor || DEFAULT_VAULT_SETTINGS.userColor,
      };
      this.settings = {
        vaults: {
          [this.vaultName]: oldSettings,
        },
      };
      // Save the migrated settings
      await this.saveData(this.settings);
    } else {
      // New format or empty
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    }
  }

  /**
   * Save plugin settings
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Get settings for the current vault
   */
  getVaultSettings(): HiveVaultSettings {
    if (!this.settings.vaults[this.vaultName]) {
      // Initialize with defaults if not present
      this.settings.vaults[this.vaultName] = { ...DEFAULT_VAULT_SETTINGS };
    }
    return this.settings.vaults[this.vaultName];
  }

  /**
   * Update settings for the current vault
   */
  updateVaultSettings(updates: Partial<HiveVaultSettings>): void {
    if (!this.settings.vaults[this.vaultName]) {
      this.settings.vaults[this.vaultName] = { ...DEFAULT_VAULT_SETTINGS };
    }
    Object.assign(this.settings.vaults[this.vaultName], updates);
  }

  /**
   * Check if connected to server
   */
  isConnected(): boolean {
    return this.syncEngine?.isConnected() ?? false;
  }

  /**
   * Connect to the Hive server
   */
  async connectToServer(): Promise<void> {
    const vaultSettings = this.getVaultSettings();
    
    // Validate settings
    if (!vaultSettings.serverUrl) {
      new Notice('Please configure the Hive server URL in settings');
      return;
    }

    if (!vaultSettings.token) {
      new Notice('Please login first in Hive settings');
      return;
    }

    if (!vaultSettings.vaultId) {
      new Notice('Please configure a vault ID in Hive settings');
      return;
    }

    // Disconnect existing connection
    if (this.syncEngine) {
      this.syncEngine.destroy();
      this.syncEngine = null;
    }

    // Clean up existing cursor manager
    if (this.cursorManager) {
      this.cursorManager.destroy();
      this.cursorManager = null;
    }

    try {
      // Create sync engine with config directory for persistence
      this.syncEngine = new SyncEngine(
        vaultSettings.serverUrl,
        vaultSettings.token,
        vaultSettings.vaultId,
        this.app.vault,
        vaultSettings.userColor,
        this.app.vault.configDir
      );

      // Set up event handlers
      this.syncEngine.on('connection-change', (state: ConnectionState) => {
        this.currentConnectionState = state;
        this.updateStatusBar(state, this.pendingCount);
      });

      this.syncEngine.on('user-joined', (user: { id: number; username: string }) => {
        console.log('[Hive] User joined:', user.username);
      });

      this.syncEngine.on('user-left', (user: { id: number; username: string }) => {
        console.log('[Hive] User left:', user.username);
      });

      this.syncEngine.on('presence-update', (users: UserPresence[]) => {
        // Update cursor manager
        console.log('[Hive] Presence update:', users.length, 'users');
        
        // Update presence view
        const presenceView = getPresenceView(this);
        if (presenceView) {
          presenceView.updatePresence(users);
        }
        
        // Update status bar with user count
        this.updateStatusBarUserCount(users.length);
      });

      this.syncEngine.on('error', (error: Error) => {
        console.error('[Hive] Error:', error);
        new Notice(`Hive error: ${error.message}`);
      });

      // Handle file list event - shows what files will be synced
      this.syncEngine.on('syncing-files', (files: string[]) => {
        if (files.length > 0) {
          console.log(`[Hive] Preparing to sync ${files.length} files`);
          new Notice(`Syncing ${files.length} files from Hive...`, 3000);
        }
      });

      // Handle sync progress updates
      this.syncEngine.on('sync-progress', (synced: number, total: number) => {
        if (total > 5 && synced % 5 === 0) {
          // Update status bar with progress for larger syncs
          this.updateStatusBarText(`Syncing ${synced}/${total}...`);
        }
      });
      
      // Handle conflicts detected
      this.syncEngine.on('conflicts-detected', (conflicts: FileConflict[]) => {
        console.log(`[Hive] ${conflicts.length} conflicts detected`);
        this.showConflictResolutionModal(conflicts);
      });
      
      // Handle merge complete
      this.syncEngine.on('merge-complete', (result: MergeResult) => {
        console.log('[Hive] Merge complete:', result);
        if (result.autoMerged.length > 0) {
          new Notice(`Auto-merged ${result.autoMerged.length} file(s)`);
        }
      });
      
      // Handle offline change tracking
      this.syncEngine.on('offline-change', (filepath: string) => {
        this.pendingCount = this.syncEngine?.getPendingOfflineCount() || 0;
        this.updateStatusBar(this.currentConnectionState, this.pendingCount);
        console.log(`[Hive] Offline change tracked: ${filepath} (${this.pendingCount} pending)`);
      });
      
      // Handle role changes
      this.syncEngine.on('role-change', (role: VaultRole) => {
        this.currentRole = role;
        console.log(`[Hive] Role changed to: ${role}`);
        this.updateStatusBar(this.currentConnectionState, this.pendingCount);
        
        // Notify user if they're in read-only mode
        if (role === 'viewer') {
          new Notice('You have read-only access to this vault', 5000);
        }
      });
      
      // Handle permission denied events
      this.syncEngine.on('permission-denied', (action: string, message: string) => {
        console.log(`[Hive] Permission denied: ${action} - ${message}`);
        new Notice(`Permission denied: ${message}`, 5000);
      });
      
      // Subscribe to offline manager events
      const offlineManager = this.syncEngine.getOfflineManager();
      offlineManager.on('pending-count-change', (count: number) => {
        this.pendingCount = count;
        this.updateStatusBar(this.currentConnectionState, this.pendingCount);
      });

      // Connect
      this.updateStatusBar(ConnectionState.CONNECTING);
      await this.syncEngine.connect();
      
      // Initialize cursor manager
      this.cursorManager = new CursorManager(
        this.app,
        this.syncEngine.getAwareness(),
        this.syncEngine.getDoc().clientID
      );
      
      new Notice('Connected to the Hive!');
      
      // Update awareness with current file
      this.updateActiveFileAwareness();

      // Update presence view
      const presenceView = getPresenceView(this);
      if (presenceView) {
        presenceView.updatePresence(this.syncEngine.getUsers());
      }

    } catch (err) {
      console.error('[Hive] Failed to connect:', err);
      new Notice(`Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`);
      
      if (this.syncEngine) {
        this.syncEngine.destroy();
        this.syncEngine = null;
      }
      
      this.updateStatusBar(ConnectionState.DISCONNECTED);
    }
  }

  /**
   * Disconnect from the server
   */
  disconnectFromServer(): void {
    // Clean up cursor manager
    if (this.cursorManager) {
      this.cursorManager.destroy();
      this.cursorManager = null;
    }

    // Clean up sync engine
    if (this.syncEngine) {
      this.syncEngine.destroy();
      this.syncEngine = null;
    }
    
    this.updateStatusBar(ConnectionState.DISCONNECTED);

    // Update presence view
    const presenceView = getPresenceView(this);
    if (presenceView) {
      presenceView.updatePresence([]);
    }
  }

  /**
   * Update status bar with connection state and pending count
   */
  private updateStatusBar(state: ConnectionState, pendingCount: number = 0): void {
    if (!this.statusBarItem) return;

    const stateConfig: Record<ConnectionState, { text: string; icon: string; statusClass: string }> = {
      [ConnectionState.DISCONNECTED]: { text: 'Offline', icon: 'circle', statusClass: 'hive-status-offline' },
      [ConnectionState.CONNECTING]: { text: 'Connecting...', icon: 'loader', statusClass: 'hive-status-connecting' },
      [ConnectionState.CONNECTED]: { text: 'Connected', icon: 'loader', statusClass: 'hive-status-connecting' },
      [ConnectionState.AUTHENTICATED]: { text: 'Authenticated', icon: 'loader', statusClass: 'hive-status-connecting' },
      [ConnectionState.SYNCING]: { text: 'Syncing...', icon: 'refresh-cw', statusClass: 'hive-status-syncing' },
      [ConnectionState.SYNCED]: { text: 'Synced', icon: 'check-circle', statusClass: 'hive-status-synced' },
      [ConnectionState.MERGING]: { text: 'Merging...', icon: 'git-merge', statusClass: 'hive-status-merging' },
    };

    const config = stateConfig[state] || { text: 'Unknown', icon: 'hexagon', statusClass: '' };
    let text = config.text;
    
    // Add pending count for offline state
    if (state === ConnectionState.DISCONNECTED && pendingCount > 0) {
      text += ` (${pendingCount} pending)`;
      this.statusBarItem.addClass('hive-has-pending');
    } else {
      this.statusBarItem.removeClass('hive-has-pending');
    }
    
    // Clear status bar content
    this.statusBarItem.empty();
    
    // Add icon
    const iconEl = this.statusBarItem.createSpan({ cls: 'hive-status-icon' });
    setIcon(iconEl, config.icon);
    
    // Add text
    this.statusBarItem.createSpan({ text: text, cls: 'hive-status-text' });
    
    // Add role badge for connected states
    if (this.currentRole && (state === ConnectionState.SYNCED || state === ConnectionState.SYNCING)) {
      const roleBadge = this.statusBarItem.createSpan({ cls: 'hive-role-badge' });
      const roleDisplay = this.currentRole === 'viewer' ? 'Read-only' : 
                          this.currentRole.charAt(0).toUpperCase() + this.currentRole.slice(1);
      roleBadge.setText(roleDisplay);
      roleBadge.addClass(`hive-role-${this.currentRole}`);
      
      // Add read-only class to status bar for styling
      if (this.currentRole === 'viewer') {
        this.statusBarItem.addClass('hive-read-only');
      } else {
        this.statusBarItem.removeClass('hive-read-only');
      }
    }
    
    // Add CSS class based on state
    this.statusBarItem.removeClass('hive-offline', 'hive-connecting', 'hive-syncing', 'hive-synced', 'hive-merging', 'hive-status-offline', 'hive-status-connecting', 'hive-status-syncing', 'hive-status-synced', 'hive-status-merging');
    this.statusBarItem.addClass(config.statusClass);
    
    if (state === ConnectionState.DISCONNECTED) {
      this.statusBarItem.addClass('hive-offline');
      this.currentRole = null; // Clear role when disconnected
      this.statusBarItem.removeClass('hive-read-only');
    } else if (state === ConnectionState.SYNCED) {
      this.statusBarItem.addClass('hive-synced');
    } else if (state === ConnectionState.SYNCING) {
      this.statusBarItem.addClass('hive-syncing');
    } else if (state === ConnectionState.MERGING) {
      this.statusBarItem.addClass('hive-merging');
    } else {
      this.statusBarItem.addClass('hive-connecting');
    }

    const roleInfo = this.currentRole ? ` as ${this.currentRole}` : '';
    this.statusBarItem.setAttribute('aria-label', `Hive: ${state}${roleInfo}${pendingCount > 0 ? ` (${pendingCount} pending changes)` : ''}`);
  }

  /**
   * Update status bar text only (for progress updates)
   */
  private updateStatusBarText(text: string): void {
    if (!this.statusBarItem) return;
    const textEl = this.statusBarItem.querySelector('.hive-status-text');
    if (textEl) {
      textEl.textContent = text;
    }
  }

  /**
   * Update status bar with user count
   */
  private updateStatusBarUserCount(count: number): void {
    if (!this.statusBarItem || !this.isConnected()) return;
    
    const text = count > 0 ? `${count + 1} users` : 'Synced';
    this.updateStatusBarText(text);
  }

  /**
   * Handle active leaf change
   */
  private handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    if (!leaf) {
      this.activeFile = null;
      if (this.cursorManager) {
        this.cursorManager.setCurrentFile(null);
      }
      return;
    }

    const view = leaf.view;
    if (view instanceof MarkdownView) {
      this.activeFile = view.file;
      this.updateActiveFileAwareness();
      
      // Update cursor manager with current file
      if (this.cursorManager && this.activeFile) {
        this.cursorManager.setCurrentFile(this.activeFile.path);
      }
    } else {
      this.activeFile = null;
      if (this.cursorManager) {
        this.cursorManager.setCurrentFile(null);
      }
    }
  }

  /**
   * Handle editor changes for cursor tracking
   */
  private handleEditorChange(editor: Editor, info: any): void {
    if (!this.syncEngine || !this.isConnected() || !this.activeFile) return;

    // Throttle cursor updates
    const now = Date.now();
    if (now - this.lastCursorUpdate < this.cursorUpdateThrottle) {
      return;
    }
    this.lastCursorUpdate = now;

    // Get cursor position
    const cursor = editor.getCursor();
    
    // Get selection if any
    const selection = editor.somethingSelected() ? {
      from: editor.getCursor('from'),
      to: editor.getCursor('to')
    } : undefined;

    // Update awareness
    this.syncEngine.updateAwareness({
      file: this.activeFile.path,
      cursor: { line: cursor.line, ch: cursor.ch },
      selection: selection ? {
        from: { line: selection.from.line, ch: selection.from.ch },
        to: { line: selection.to.line, ch: selection.to.ch }
      } : undefined,
    });
  }

  /**
   * Update awareness with active file info
   */
  private updateActiveFileAwareness(): void {
    if (!this.syncEngine || !this.isConnected()) return;

    // Get current cursor position if we have an active editor
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.editor) {
      const cursor = view.editor.getCursor();
      const selection = view.editor.somethingSelected() ? {
        from: view.editor.getCursor('from'),
        to: view.editor.getCursor('to')
      } : undefined;

      this.syncEngine.updateAwareness({
        file: this.activeFile?.path,
        cursor: { line: cursor.line, ch: cursor.ch },
        selection: selection ? {
          from: { line: selection.from.line, ch: selection.from.ch },
          to: { line: selection.to.line, ch: selection.to.ch }
        } : undefined,
      });
    } else {
      this.syncEngine.updateAwareness({
        file: this.activeFile?.path,
      });
    }
  }

  /**
   * Show connected users in a notice
   */
  private showConnectedUsers(): void {
    if (!this.syncEngine || !this.isConnected()) {
      new Notice('Not connected to the Hive');
      return;
    }

    const users = this.syncEngine.getUsers();
    
    if (users.length === 0) {
      new Notice('No other users in the Hive');
      return;
    }

    const userList = users.map(u => `• ${u.username}`).join('\n');
    new Notice(`Hive members:\n${userList}`, 5000);
  }

  /**
   * Show conflict resolution modal
   */
  private showConflictResolutionModal(conflicts: FileConflict[]): void {
    showConflictModal(
      this.app,
      conflicts,
      async (resolutions: ConflictResolution[]) => {
        // Apply resolutions
        if (this.syncEngine) {
          try {
            await this.syncEngine.applyConflictResolutions(resolutions);
            new Notice(`Resolved ${resolutions.length} conflict(s)`);
          } catch (err) {
            console.error('[Hive] Failed to apply resolutions:', err);
            new Notice(`Failed to apply resolutions: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      },
      () => {
        // Cancelled - keep local versions by default
        new Notice('Conflict resolution cancelled. Local changes preserved.');
      }
    );
  }
}
