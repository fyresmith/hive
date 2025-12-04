/**
 * Hive - Settings module
 * Handles plugin configuration and the settings UI tab.
 * The main configuration is now done through the HiveModal,
 * but this settings tab provides quick access and preferences.
 * 
 * @see https://docs.obsidian.md/Plugins/User+interface/Settings
 */

import { App, PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import type HivePlugin from './main';
import { openHiveSettings } from './hive-modal';

/**
 * Per-vault settings interface
 */
export interface HiveVaultSettings {
  /** URL of the Hive server */
  serverUrl: string;
  /** Username for authentication */
  username: string;
  /** JWT token (stored after login) */
  token: string;
  /** Vault ID to sync with */
  vaultId: string;
  /** Auto-connect on plugin load */
  autoConnect: boolean;
  /** User display color for cursors */
  userColor: string;
}

/**
 * Plugin settings interface (stores settings per Obsidian vault)
 */
export interface HiveSettings {
  /** Settings for each Obsidian vault, keyed by vault name */
  vaults: Record<string, HiveVaultSettings>;
}

/**
 * Default per-vault settings values
 */
export const DEFAULT_VAULT_SETTINGS: HiveVaultSettings = {
  serverUrl: '',
  username: '',
  token: '',
  vaultId: '',
  autoConnect: false,
  userColor: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
};

/**
 * Default settings values
 */
export const DEFAULT_SETTINGS: HiveSettings = {
  vaults: {},
};

/**
 * Settings tab for the Hive plugin
 */
export class HiveSettingsTab extends PluginSettingTab {
  plugin: HivePlugin;

  constructor(app: App, plugin: HivePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Get current vault settings
    const vaultSettings = this.plugin.getVaultSettings();

    // Header
    const headerEl = containerEl.createEl('h2', { cls: 'hive-header-title' });
    const headerIcon = headerEl.createSpan({ cls: 'hive-header-icon' });
    setIcon(headerIcon, 'hexagon');
    headerEl.createSpan({ text: ' Hive' });
    containerEl.createEl('p', { 
      cls: 'hive-settings-subtitle',
      text: 'Real-time collaborative editing for Obsidian' 
    });

    // Show current vault name
    const vaultName = this.plugin.app.vault.getName();
    containerEl.createEl('p', { 
      cls: 'hive-settings-vault-info',
      text: `Settings for vault: ${vaultName}` 
    });

    // Connection Status Card
    this.renderConnectionStatus(containerEl);

    // Main action button - Open Hive Settings
    const actionContainer = containerEl.createDiv({ cls: 'hive-settings-action' });
    
    new Setting(actionContainer)
      .setName('Configure Hive')
      .setDesc('Connect to a server, login, and manage your Hive connection')
      .addButton(button => button
        .setButtonText('Open Hive Settings')
        .setCta()
        .onClick(() => {
          openHiveSettings(this.plugin);
        }));

    // Quick Actions
    containerEl.createEl('h3', { text: 'Quick Actions' });

    // Connect/Disconnect button
    new Setting(containerEl)
      .setName('Connection')
      .setDesc(this.plugin.isConnected() 
        ? 'You are currently connected to the Hive' 
        : 'Connect to the configured Hive server')
      .addButton(button => {
        const isConnected = this.plugin.isConnected();
        button
          .setButtonText(isConnected ? 'Disconnect' : 'Connect')
          .setClass(isConnected ? 'mod-warning' : 'mod-cta')
          .onClick(async () => {
            if (isConnected) {
              this.plugin.disconnectFromServer();
              new Notice('Disconnected from the Hive');
            } else {
              if (!vaultSettings.serverUrl || !vaultSettings.token) {
                new Notice('Please configure Hive first');
                openHiveSettings(this.plugin);
                return;
              }
              await this.plugin.connectToServer();
            }
            this.display(); // Refresh
          });
      });

    // Preferences Section
    containerEl.createEl('h3', { text: 'Preferences' });

    // Cursor color
    new Setting(containerEl)
      .setName('Cursor Color')
      .setDesc('Your cursor color visible to other Hive members')
      .addText(text => text
        .setPlaceholder('#ff0000')
        .setValue(vaultSettings.userColor)
        .onChange(async (value) => {
          if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
            this.plugin.updateVaultSettings({ userColor: value });
            await this.plugin.saveSettings();
          }
        }))
      .addColorPicker(picker => picker
        .setValue(vaultSettings.userColor)
        .onChange(async (value) => {
          this.plugin.updateVaultSettings({ userColor: value });
          await this.plugin.saveSettings();
        }));

    // Auto-connect
    new Setting(containerEl)
      .setName('Auto-connect')
      .setDesc('Automatically connect to the Hive when Obsidian starts')
      .addToggle(toggle => toggle
        .setValue(vaultSettings.autoConnect)
        .onChange(async (value) => {
          this.plugin.updateVaultSettings({ autoConnect: value });
          await this.plugin.saveSettings();
        }));

    // Current Configuration (read-only info)
    if (vaultSettings.serverUrl) {
      containerEl.createEl('h3', { text: 'Current Configuration' });

      const configInfo = containerEl.createDiv({ cls: 'hive-config-info' });
      
      this.createInfoRow(configInfo, 'Server', vaultSettings.serverUrl);
      this.createInfoRow(configInfo, 'Vault', vaultSettings.vaultId || 'Not set');
      this.createInfoRow(configInfo, 'User', vaultSettings.username || 'Not logged in');
      
      // Logout button
      if (vaultSettings.token) {
        new Setting(containerEl)
          .addButton(button => button
            .setButtonText('Logout')
            .setWarning()
            .onClick(async () => {
              this.plugin.updateVaultSettings({ token: '' });
              await this.plugin.saveSettings();
              this.plugin.disconnectFromServer();
              new Notice('Logged out from Hive');
              this.display();
            }));
      }
    }
  }

  /**
   * Render connection status indicator
   */
  private renderConnectionStatus(container: HTMLElement): void {
    const isConnected = this.plugin.isConnected();
    const vaultSettings = this.plugin.getVaultSettings();
    
    const statusContainer = container.createDiv({ cls: 'hive-status-container' });
    const statusEl = statusContainer.createDiv({ cls: 'hive-status' });
    
    const indicator = statusEl.createSpan({ 
      cls: `hive-status-indicator ${isConnected ? 'connected' : 'disconnected'}` 
    });
    
    const statusText = statusEl.createSpan();
    
    if (isConnected) {
      statusText.setText(`Connected to ${vaultSettings.vaultId}`);
    } else if (vaultSettings.serverUrl) {
      statusText.setText('Offline - Click Connect to join the Hive');
    } else {
      statusText.setText('Not configured - Open Hive Settings to get started');
    }
  }

  /**
   * Create an info row
   */
  private createInfoRow(container: HTMLElement, label: string, value: string): void {
    const row = container.createDiv({ cls: 'hive-info-row' });
    row.createSpan({ cls: 'hive-info-label', text: label + ':' });
    row.createSpan({ cls: 'hive-info-value', text: value });
  }
}
