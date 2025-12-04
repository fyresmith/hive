/**
 * Hive - Presence View
 * A sidebar view showing connected users in the Hive.
 * Displays user names, colors, and what file each user is editing.
 * 
 * @see https://docs.obsidian.md/Plugins/User+interface/Views
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { UserPresence } from './sync';
import type HivePlugin from './main';

export const PRESENCE_VIEW_TYPE = 'hive-presence-view';

/**
 * Presence View
 * Custom sidebar view for showing connected Hive users
 */
export class PresenceView extends ItemView {
  private plugin: HivePlugin;
  private users: UserPresence[] = [];
  private contentEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: HivePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return PRESENCE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Hive Users';
  }

  getIcon(): string {
    return 'users';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('hive-presence-view');

    // Create header
    const header = container.createDiv({ cls: 'hive-presence-header' });
    
    const titleContainer = header.createDiv({ cls: 'hive-presence-title-container' });
    const iconEl = titleContainer.createSpan({ cls: 'hive-presence-icon' });
    setIcon(iconEl, 'users');
    titleContainer.createSpan({ text: 'Hive Members', cls: 'hive-presence-title' });

    const countEl = header.createDiv({ cls: 'hive-presence-count' });
    countEl.setText('0');

    // Create user list container
    this.contentEl = container.createDiv({ cls: 'hive-user-list' });

    // Initial render
    this.renderUserList();
  }

  async onClose(): Promise<void> {
    // Nothing to clean up
  }

  /**
   * Update the user list with new presence data
   */
  updatePresence(users: UserPresence[]): void {
    this.users = users;
    this.renderUserList();
  }

  /**
   * Render the user list
   */
  private renderUserList(): void {
    if (!this.contentEl) return;

    // Update count in header
    const countEl = this.containerEl.querySelector('.hive-presence-count');
    if (countEl) {
      countEl.setText(String(this.users.length));
    }

    // Clear existing content
    this.contentEl.empty();

    // Check connection status
    if (!this.plugin.isConnected()) {
      const emptyState = this.contentEl.createDiv({ cls: 'hive-presence-empty' });
      const emptyIcon = emptyState.createDiv({ cls: 'hive-presence-empty-icon' });
      setIcon(emptyIcon, 'hexagon');
      emptyState.createDiv({ cls: 'hive-presence-empty-text', text: 'Not connected to the Hive' });
      emptyState.createEl('button', { 
        cls: 'hive-connect-btn',
        text: 'Connect'
      }).addEventListener('click', () => {
        this.plugin.connectToServer();
      });
      return;
    }

    // Show empty state if no users
    if (this.users.length === 0) {
      const emptyState = this.contentEl.createDiv({ cls: 'hive-presence-empty' });
      const emptyIcon = emptyState.createDiv({ cls: 'hive-presence-empty-icon' });
      setIcon(emptyIcon, 'users');
      emptyState.createDiv({ cls: 'hive-presence-empty-text', text: 'No other users in the Hive' });
      return;
    }

    // Render each user
    this.users.forEach(user => {
      this.renderUserItem(user);
    });
  }

  /**
   * Render a single user item
   */
  private renderUserItem(user: UserPresence): void {
    if (!this.contentEl) return;

    const userEl = this.contentEl.createDiv({ cls: 'hive-user-item' });
    userEl.dataset.userId = String(user.id);

    // Avatar with user initial and color
    const avatar = userEl.createDiv({ cls: 'hive-user-avatar' });
    avatar.style.backgroundColor = user.color || '#f5a623';
    avatar.setText(user.username.charAt(0).toUpperCase());

    // User info container
    const infoEl = userEl.createDiv({ cls: 'hive-user-info' });
    
    // Username
    infoEl.createDiv({ cls: 'hive-user-name', text: user.username });
    
    // Current file (if any)
    if (user.file) {
      const fileName = user.file.split('/').pop() || user.file;
      const fileEl = infoEl.createDiv({ cls: 'hive-user-file' });
      setIcon(fileEl.createSpan({ cls: 'hive-file-icon' }), 'file-text');
      fileEl.createSpan({ text: fileName });
    } else {
      infoEl.createDiv({ cls: 'hive-user-file hive-user-idle', text: 'Idle' });
    }

    // Status indicator
    const statusEl = userEl.createDiv({ cls: 'hive-user-status' });
    statusEl.addClass(user.cursor ? 'active' : 'idle');

    // Click to jump to user's file
    if (user.file) {
      userEl.addClass('clickable');
      userEl.addEventListener('click', () => {
        this.jumpToUserFile(user);
      });
    }
  }

  /**
   * Jump to the file that a user is editing
   */
  private async jumpToUserFile(user: UserPresence): Promise<void> {
    if (!user.file) return;

    try {
      const file = this.app.vault.getAbstractFileByPath(user.file);
      if (file) {
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file as any);

        // If user has cursor position, scroll to it
        if (user.cursor) {
          const view = this.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
          if (view) {
            view.editor.setCursor(user.cursor.line, user.cursor.ch);
            view.editor.scrollIntoView({
              from: { line: user.cursor.line, ch: 0 },
              to: { line: user.cursor.line, ch: 0 }
            }, true);
          }
        }
      }
    } catch (err) {
      console.error('[Hive] Error jumping to user file:', err);
    }
  }
}

/**
 * Register the presence view with the plugin
 */
export function registerPresenceView(plugin: HivePlugin): void {
  plugin.registerView(
    PRESENCE_VIEW_TYPE,
    (leaf) => new PresenceView(leaf, plugin)
  );
}

/**
 * Activate (open) the presence view in the right sidebar
 */
export async function activatePresenceView(plugin: HivePlugin): Promise<void> {
  const { workspace } = plugin.app;

  let leaf: WorkspaceLeaf | null = null;
  const leaves = workspace.getLeavesOfType(PRESENCE_VIEW_TYPE);

  if (leaves.length > 0) {
    // View already exists, reveal it
    leaf = leaves[0];
  } else {
    // Create new leaf in right sidebar
    leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: PRESENCE_VIEW_TYPE, active: true });
    }
  }

  // Reveal the leaf
  if (leaf) {
    workspace.revealLeaf(leaf);
  }
}

/**
 * Get the presence view instance if it exists
 */
export function getPresenceView(plugin: HivePlugin): PresenceView | null {
  const leaves = plugin.app.workspace.getLeavesOfType(PRESENCE_VIEW_TYPE);
  if (leaves.length > 0) {
    return leaves[0].view as PresenceView;
  }
  return null;
}

