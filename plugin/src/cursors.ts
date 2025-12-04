/**
 * Hive - Cursor Manager
 * Handles rendering of remote user cursors in the CodeMirror editor.
 * Listens to Y.js awareness updates and renders cursor widgets.
 * 
 * @see https://docs.obsidian.md/Plugins/Editor/
 */

import { App, MarkdownView, Editor } from 'obsidian';
import * as awarenessProtocol from 'y-protocols/awareness';
import { UserPresence } from './sync';

/**
 * Remote cursor representation in the DOM
 */
interface RemoteCursor {
  clientId: number;
  username: string;
  color: string;
  file?: string;
  cursor?: { line: number; ch: number };
  selection?: { from: { line: number; ch: number }; to: { line: number; ch: number } };
  cursorEl?: HTMLElement;
  selectionEls?: HTMLElement[];
  labelEl?: HTMLElement;
  lastUpdate: number;
}

/**
 * Cursor Manager
 * Manages rendering and updating of remote cursors in the editor
 */
export class CursorManager {
  private app: App;
  private awareness: awarenessProtocol.Awareness;
  private cursors: Map<number, RemoteCursor> = new Map();
  private localClientId: number;
  private currentFile: string | null = null;
  private updateThrottleMs = 50; // 20 updates per second max
  private lastRenderTime = 0;
  private pendingRender = false;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private cursorContainer: HTMLElement | null = null;

  constructor(app: App, awareness: awarenessProtocol.Awareness, localClientId: number) {
    this.app = app;
    this.awareness = awareness;
    this.localClientId = localClientId;

    // Listen for awareness changes
    this.awareness.on('change', this.handleAwarenessChange.bind(this));

    // Start cleanup interval to remove stale cursors
    this.cleanupInterval = setInterval(() => this.cleanupStaleCursors(), 5000);
  }

  /**
   * Set the current file being edited
   */
  setCurrentFile(filepath: string | null): void {
    this.currentFile = filepath;
    this.renderAllCursors();
  }

  /**
   * Handle awareness changes from Y.js
   */
  private handleAwarenessChange({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }): void {
    // Handle removed clients
    removed.forEach(clientId => {
      this.removeCursor(clientId);
    });

    // Handle added/updated clients
    [...added, ...updated].forEach(clientId => {
      // Skip our own cursor
      if (clientId === this.localClientId) return;

      const state = this.awareness.getStates().get(clientId);
      if (state?.user) {
        this.updateCursor(clientId, state.user as UserPresence);
      }
    });

    // Throttled render
    this.scheduleRender();
  }

  /**
   * Update a remote cursor's state
   */
  private updateCursor(clientId: number, user: UserPresence): void {
    let cursor = this.cursors.get(clientId);
    
    if (!cursor) {
      cursor = {
        clientId,
        username: user.username,
        color: user.color || this.generateColor(clientId),
        lastUpdate: Date.now(),
      };
      this.cursors.set(clientId, cursor);
    }

    // Update cursor state
    cursor.username = user.username;
    cursor.color = user.color || cursor.color;
    cursor.file = user.file;
    cursor.cursor = user.cursor;
    cursor.selection = user.selection;
    cursor.lastUpdate = Date.now();
  }

  /**
   * Remove a cursor for a disconnected client
   */
  private removeCursor(clientId: number): void {
    const cursor = this.cursors.get(clientId);
    if (cursor) {
      this.destroyCursorElements(cursor);
      this.cursors.delete(clientId);
    }
  }

  /**
   * Destroy DOM elements for a cursor
   */
  private destroyCursorElements(cursor: RemoteCursor): void {
    cursor.cursorEl?.remove();
    cursor.labelEl?.remove();
    cursor.selectionEls?.forEach(el => el.remove());
    cursor.cursorEl = undefined;
    cursor.labelEl = undefined;
    cursor.selectionEls = undefined;
  }

  /**
   * Schedule a throttled render
   */
  private scheduleRender(): void {
    if (this.pendingRender) return;

    const now = Date.now();
    const timeSinceLastRender = now - this.lastRenderTime;

    if (timeSinceLastRender >= this.updateThrottleMs) {
      this.renderAllCursors();
    } else {
      this.pendingRender = true;
      setTimeout(() => {
        this.pendingRender = false;
        this.renderAllCursors();
      }, this.updateThrottleMs - timeSinceLastRender);
    }
  }

  /**
   * Render all cursors for the current file
   */
  private renderAllCursors(): void {
    this.lastRenderTime = Date.now();

    // Get the active editor
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      this.hideAllCursors();
      return;
    }

    const editor = activeView.editor;
    if (!editor) {
      this.hideAllCursors();
      return;
    }

    // Ensure cursor container exists
    this.ensureCursorContainer(activeView);

    // Render each cursor
    this.cursors.forEach((cursor, clientId) => {
      // Only render cursors for the current file
      if (cursor.file !== this.currentFile) {
        this.hideCursor(cursor);
        return;
      }

      // Render cursor position
      if (cursor.cursor) {
        this.renderCursorPosition(cursor, editor);
      }

      // Render selection
      if (cursor.selection) {
        this.renderSelection(cursor, editor);
      }
    });
  }

  /**
   * Ensure the cursor container element exists in the editor
   */
  private ensureCursorContainer(view: MarkdownView): void {
    const editorEl = view.contentEl.querySelector('.cm-editor');
    if (!editorEl) return;

    // Check if container already exists
    let container = editorEl.querySelector('.hive-cursor-container') as HTMLElement;
    if (!container) {
      container = document.createElement('div');
      container.className = 'hive-cursor-container';
      editorEl.appendChild(container);
    }
    this.cursorContainer = container;
  }

  /**
   * Render a cursor position marker
   */
  private renderCursorPosition(cursor: RemoteCursor, editor: Editor): void {
    if (!cursor.cursor || !this.cursorContainer) return;

    // Create cursor element if it doesn't exist
    if (!cursor.cursorEl) {
      cursor.cursorEl = document.createElement('div');
      cursor.cursorEl.className = 'hive-remote-cursor';
      cursor.cursorEl.dataset.clientId = String(cursor.clientId);
      this.cursorContainer.appendChild(cursor.cursorEl);

      // Create label element
      cursor.labelEl = document.createElement('div');
      cursor.labelEl.className = 'hive-cursor-label';
      cursor.labelEl.textContent = cursor.username;
      cursor.cursorEl.appendChild(cursor.labelEl);
    }

    // Apply color
    cursor.cursorEl.style.setProperty('--cursor-color', cursor.color);
    cursor.labelEl!.style.backgroundColor = cursor.color;

    // Calculate position using CodeMirror
    try {
      // Get the coordinates from the editor
      // Using the editor's internal CM6 methods
      const cm = (editor as any).cm;
      if (cm && cm.coordsAtPos) {
        const pos = editor.posToOffset({ line: cursor.cursor.line, ch: cursor.cursor.ch });
        const coords = cm.coordsAtPos(pos);
        
        if (coords) {
          const editorRect = this.cursorContainer.getBoundingClientRect();
          cursor.cursorEl.style.left = `${coords.left - editorRect.left}px`;
          cursor.cursorEl.style.top = `${coords.top - editorRect.top}px`;
          cursor.cursorEl.style.height = `${coords.bottom - coords.top}px`;
          cursor.cursorEl.style.display = 'block';
        }
      } else {
        // Fallback: estimate position based on line height
        const lineHeight = 22; // Approximate line height in Obsidian
        const charWidth = 8; // Approximate character width
        cursor.cursorEl.style.left = `${cursor.cursor.ch * charWidth + 50}px`;
        cursor.cursorEl.style.top = `${cursor.cursor.line * lineHeight}px`;
        cursor.cursorEl.style.height = `${lineHeight}px`;
        cursor.cursorEl.style.display = 'block';
      }
    } catch (err) {
      console.error('[Hive] Error positioning cursor:', err);
    }
  }

  /**
   * Render a selection highlight
   */
  private renderSelection(cursor: RemoteCursor, editor: Editor): void {
    if (!cursor.selection || !this.cursorContainer) return;

    // Clear old selection elements
    cursor.selectionEls?.forEach(el => el.remove());
    cursor.selectionEls = [];

    const { from, to } = cursor.selection;
    
    // For simplicity, we'll create a single highlight element per line
    const startLine = from.line;
    const endLine = to.line;

    for (let line = startLine; line <= endLine; line++) {
      const selEl = document.createElement('div');
      selEl.className = 'hive-remote-selection';
      selEl.style.backgroundColor = cursor.color;
      selEl.style.opacity = '0.3';

      // Calculate selection bounds for this line
      const lineStart = line === startLine ? from.ch : 0;
      const lineEnd = line === endLine ? to.ch : editor.getLine(line)?.length || 0;

      try {
        const cm = (editor as any).cm;
        if (cm && cm.coordsAtPos) {
          const startPos = editor.posToOffset({ line, ch: lineStart });
          const endPos = editor.posToOffset({ line, ch: lineEnd });
          const startCoords = cm.coordsAtPos(startPos);
          const endCoords = cm.coordsAtPos(endPos);

          if (startCoords && endCoords) {
            const editorRect = this.cursorContainer.getBoundingClientRect();
            selEl.style.left = `${startCoords.left - editorRect.left}px`;
            selEl.style.top = `${startCoords.top - editorRect.top}px`;
            selEl.style.width = `${endCoords.left - startCoords.left}px`;
            selEl.style.height = `${startCoords.bottom - startCoords.top}px`;
          }
        } else {
          // Fallback positioning
          const lineHeight = 22;
          const charWidth = 8;
          selEl.style.left = `${lineStart * charWidth + 50}px`;
          selEl.style.top = `${line * lineHeight}px`;
          selEl.style.width = `${(lineEnd - lineStart) * charWidth}px`;
          selEl.style.height = `${lineHeight}px`;
        }

        this.cursorContainer.appendChild(selEl);
        cursor.selectionEls!.push(selEl);
      } catch (err) {
        console.error('[Hive] Error positioning selection:', err);
      }
    }
  }

  /**
   * Hide a cursor (e.g., when user switches to different file)
   */
  private hideCursor(cursor: RemoteCursor): void {
    if (cursor.cursorEl) {
      cursor.cursorEl.style.display = 'none';
    }
    cursor.selectionEls?.forEach(el => el.style.display = 'none');
  }

  /**
   * Hide all cursors
   */
  private hideAllCursors(): void {
    this.cursors.forEach(cursor => this.hideCursor(cursor));
  }

  /**
   * Clean up stale cursors (no update in 10 seconds)
   */
  private cleanupStaleCursors(): void {
    const now = Date.now();
    const staleThreshold = 10000; // 10 seconds

    this.cursors.forEach((cursor, clientId) => {
      if (now - cursor.lastUpdate > staleThreshold) {
        // Check if still in awareness
        const state = this.awareness.getStates().get(clientId);
        if (!state) {
          this.removeCursor(clientId);
        }
      }
    });
  }

  /**
   * Generate a unique color for a client
   */
  private generateColor(clientId: number): string {
    // Predefined set of visually distinct colors
    const colors = [
      '#FF6B6B', // Coral Red
      '#4ECDC4', // Turquoise
      '#45B7D1', // Sky Blue
      '#96CEB4', // Sage Green
      '#FFEAA7', // Cream Yellow
      '#DDA0DD', // Plum
      '#98D8C8', // Mint
      '#F7DC6F', // Sunflower
      '#BB8FCE', // Amethyst
      '#85C1E9', // Light Blue
      '#F8B500', // Honey
      '#FF8C00', // Dark Orange
    ];
    
    return colors[clientId % colors.length];
  }

  /**
   * Get all remote cursor states for display
   */
  getCursors(): RemoteCursor[] {
    return Array.from(this.cursors.values());
  }

  /**
   * Get users currently viewing a specific file
   */
  getUsersInFile(filepath: string): RemoteCursor[] {
    return Array.from(this.cursors.values()).filter(c => c.file === filepath);
  }

  /**
   * Clean up and destroy the cursor manager
   */
  destroy(): void {
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Remove awareness listener
    this.awareness.off('change', this.handleAwarenessChange.bind(this));

    // Remove all cursor elements
    this.cursors.forEach(cursor => this.destroyCursorElements(cursor));
    this.cursors.clear();

    // Remove container
    this.cursorContainer?.remove();
    this.cursorContainer = null;
  }
}

