/**
 * Hive - Conflict Resolution Modal
 * Shows file conflicts and allows users to resolve them.
 * Displays side-by-side diff and merge options.
 * 
 * @see https://docs.obsidian.md/Plugins/User+interface/Modals
 */

import { Modal, App, Setting, ButtonComponent, setIcon } from 'obsidian';
import { FileConflict, ConflictResolution } from './sync';
import DiffMatchPatch from 'diff-match-patch';

/**
 * Conflict Modal
 * Displays file conflicts for user resolution
 */
export class ConflictModal extends Modal {
  private conflicts: FileConflict[];
  private currentIndex: number = 0;
  private resolutions: Map<string, ConflictResolution> = new Map();
  private onResolve: (resolutions: ConflictResolution[]) => void;
  private onCancel: () => void;
  private dmp: DiffMatchPatch;

  constructor(
    app: App,
    conflicts: FileConflict[],
    onResolve: (resolutions: ConflictResolution[]) => void,
    onCancel: () => void
  ) {
    super(app);
    this.conflicts = conflicts;
    this.onResolve = onResolve;
    this.onCancel = onCancel;
    this.dmp = new DiffMatchPatch();
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    
    // Add custom class for styling
    modalEl.addClass('hive-conflict-modal');
    
    // Render current conflict
    this.renderConflict();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * Render the current conflict
   */
  private renderConflict(): void {
    const { contentEl } = this;
    contentEl.empty();
    
    if (this.conflicts.length === 0) {
      contentEl.createDiv({ cls: 'hive-conflict-empty', text: 'No conflicts to resolve' });
      return;
    }
    
    const conflict = this.conflicts[this.currentIndex];
    
    // Header
    const header = contentEl.createDiv({ cls: 'hive-conflict-header' });
    header.createEl('h2', { text: 'Resolve Conflicts' });
    
    const counter = header.createDiv({ cls: 'hive-conflict-counter' });
    counter.setText(`${this.currentIndex + 1} of ${this.conflicts.length}`);
    
    // File path
    const fileInfo = contentEl.createDiv({ cls: 'hive-conflict-file-info' });
    fileInfo.createDiv({ cls: 'hive-conflict-file-path', text: conflict.filepath });
    
    // Status indicator for this file
    const resolution = this.resolutions.get(conflict.filepath);
    if (resolution) {
      const statusBadge = fileInfo.createDiv({ cls: 'hive-conflict-status-badge resolved' });
      const checkIcon = statusBadge.createSpan({ cls: 'hive-badge-icon' });
      setIcon(checkIcon, 'check');
      statusBadge.createSpan({ text: ` ${resolution.choice}` });
    }
    
    // Diff view container
    const diffContainer = contentEl.createDiv({ cls: 'hive-conflict-diff-container' });
    
    // Side-by-side panels
    const panelsContainer = diffContainer.createDiv({ cls: 'hive-conflict-panels' });
    
    // Local panel
    const localPanel = panelsContainer.createDiv({ cls: 'hive-conflict-panel local' });
    const localHeader = localPanel.createDiv({ cls: 'hive-conflict-panel-header' });
    localHeader.createSpan({ cls: 'hive-conflict-panel-title', text: 'Your Changes (Local)' });
    localHeader.createSpan({ cls: 'hive-conflict-panel-badge local', text: 'LOCAL' });
    
    const localContent = localPanel.createDiv({ cls: 'hive-conflict-panel-content' });
    this.renderDiffContent(localContent, conflict.baseContent || '', conflict.localContent, 'local');
    
    // Server panel
    const serverPanel = panelsContainer.createDiv({ cls: 'hive-conflict-panel server' });
    const serverHeader = serverPanel.createDiv({ cls: 'hive-conflict-panel-header' });
    serverHeader.createSpan({ cls: 'hive-conflict-panel-title', text: 'Server Changes' });
    serverHeader.createSpan({ cls: 'hive-conflict-panel-badge server', text: 'SERVER' });
    
    const serverContent = serverPanel.createDiv({ cls: 'hive-conflict-panel-content' });
    this.renderDiffContent(serverContent, conflict.baseContent || '', conflict.serverContent, 'server');
    
    // Merged preview (if available)
    if (conflict.mergedContent) {
      const mergedSection = contentEl.createDiv({ cls: 'hive-conflict-merged-section' });
      const mergedHeader = mergedSection.createDiv({ cls: 'hive-conflict-merged-header' });
      mergedHeader.createSpan({ text: 'Auto-Merged Preview' });
      mergedHeader.createSpan({ cls: 'hive-conflict-panel-badge merged', text: 'MERGED' });
      
      const mergedContent = mergedSection.createDiv({ cls: 'hive-conflict-merged-content' });
      const pre = mergedContent.createEl('pre');
      pre.setText(conflict.mergedContent);
    }
    
    // Action buttons
    const actions = contentEl.createDiv({ cls: 'hive-conflict-actions' });
    
    // Resolution buttons
    const resolutionButtons = actions.createDiv({ cls: 'hive-conflict-resolution-buttons' });
    
    new Setting(resolutionButtons)
      .setName('')
      .addButton(btn => {
        btn
          .setButtonText('Keep Local')
          .setClass('hive-btn-local')
          .onClick(() => this.resolveConflict(conflict, 'local', conflict.localContent));
      })
      .addButton(btn => {
        btn
          .setButtonText('Keep Server')
          .setClass('hive-btn-server')
          .onClick(() => this.resolveConflict(conflict, 'server', conflict.serverContent));
      })
      .addButton(btn => {
        btn
          .setButtonText('Use Merged')
          .setClass('hive-btn-merged')
          .setDisabled(!conflict.mergedContent)
          .onClick(() => {
            if (conflict.mergedContent) {
              this.resolveConflict(conflict, 'merged', conflict.mergedContent);
            }
          });
      });
    
    // Navigation and final actions
    const navigationActions = actions.createDiv({ cls: 'hive-conflict-navigation' });
    
    new Setting(navigationActions)
      .setName('')
      .addButton(btn => {
        btn
          .setButtonText('← Previous')
          .setDisabled(this.currentIndex === 0)
          .onClick(() => {
            if (this.currentIndex > 0) {
              this.currentIndex--;
              this.renderConflict();
            }
          });
      })
      .addButton(btn => {
        btn
          .setButtonText('Next →')
          .setDisabled(this.currentIndex >= this.conflicts.length - 1)
          .onClick(() => {
            if (this.currentIndex < this.conflicts.length - 1) {
              this.currentIndex++;
              this.renderConflict();
            }
          });
      });
    
    // Final action buttons
    const finalActions = contentEl.createDiv({ cls: 'hive-conflict-final-actions' });
    
    const resolvedCount = this.resolutions.size;
    const totalCount = this.conflicts.length;
    const allResolved = resolvedCount === totalCount;
    
    const statusText = finalActions.createDiv({ cls: 'hive-conflict-status-text' });
    statusText.setText(`${resolvedCount} of ${totalCount} conflicts resolved`);
    
    new Setting(finalActions)
      .setName('')
      .addButton(btn => {
        btn
          .setButtonText('Cancel')
          .onClick(() => {
            this.onCancel();
            this.close();
          });
      })
      .addButton(btn => {
        btn
          .setButtonText('Keep All Local')
          .setWarning()
          .onClick(() => {
            this.resolveAllWith('local');
          });
      })
      .addButton(btn => {
        btn
          .setButtonText('Keep All Server')
          .setWarning()
          .onClick(() => {
            this.resolveAllWith('server');
          });
      })
      .addButton(btn => {
        btn
          .setButtonText('Apply Resolutions')
          .setCta()
          .setDisabled(!allResolved)
          .onClick(() => {
            if (allResolved) {
              this.applyResolutions();
            }
          });
      });
  }

  /**
   * Render diff content with highlighting
   */
  private renderDiffContent(
    container: HTMLElement,
    base: string,
    content: string,
    side: 'local' | 'server'
  ): void {
    const pre = container.createEl('pre', { cls: 'hive-conflict-code' });
    
    if (!base) {
      // No base content - show full content
      pre.setText(content);
      return;
    }
    
    // Compute diff
    const diffs = this.dmp.diff_main(base, content);
    this.dmp.diff_cleanupSemantic(diffs);
    
    // Render with highlighting
    for (const [op, text] of diffs) {
      const span = pre.createSpan();
      span.setText(text);
      
      if (op === 1) {
        // Addition
        span.addClass('hive-diff-add');
      } else if (op === -1) {
        // Deletion
        span.addClass('hive-diff-del');
      }
    }
  }

  /**
   * Resolve a single conflict
   */
  private resolveConflict(
    conflict: FileConflict,
    choice: 'local' | 'server' | 'merged',
    content: string
  ): void {
    this.resolutions.set(conflict.filepath, {
      filepath: conflict.filepath,
      choice,
      content,
    });
    
    // Move to next unresolved conflict or re-render current
    const nextUnresolved = this.conflicts.findIndex(
      (c, i) => i > this.currentIndex && !this.resolutions.has(c.filepath)
    );
    
    if (nextUnresolved !== -1) {
      this.currentIndex = nextUnresolved;
    } else {
      // Check if there are any unresolved before current
      const prevUnresolved = this.conflicts.findIndex(
        c => !this.resolutions.has(c.filepath)
      );
      if (prevUnresolved !== -1) {
        this.currentIndex = prevUnresolved;
      }
    }
    
    this.renderConflict();
  }

  /**
   * Resolve all conflicts with the same choice
   */
  private resolveAllWith(choice: 'local' | 'server'): void {
    for (const conflict of this.conflicts) {
      const content = choice === 'local' ? conflict.localContent : conflict.serverContent;
      this.resolutions.set(conflict.filepath, {
        filepath: conflict.filepath,
        choice,
        content,
      });
    }
    
    this.applyResolutions();
  }

  /**
   * Apply all resolutions and close modal
   */
  private applyResolutions(): void {
    const resolutionsList = Array.from(this.resolutions.values());
    this.onResolve(resolutionsList);
    this.close();
  }
}

/**
 * Show conflict resolution modal
 */
export function showConflictModal(
  app: App,
  conflicts: FileConflict[],
  onResolve: (resolutions: ConflictResolution[]) => void,
  onCancel: () => void
): ConflictModal {
  const modal = new ConflictModal(app, conflicts, onResolve, onCancel);
  modal.open();
  return modal;
}

