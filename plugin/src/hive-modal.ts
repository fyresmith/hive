/**
 * Hive - Settings View (Tab)
 * Multi-step wizard for connecting to a Hive server.
 * Opens as a workspace tab/leaf instead of a modal.
 * Steps: Server URL → Ping → Login/Request Access → Vault Check → Sync
 */

import { App, ItemView, WorkspaceLeaf, Setting, Notice, ButtonComponent, TextComponent, setIcon, requestUrl } from 'obsidian';
import type HivePlugin from './main';

export const HIVE_SETTINGS_VIEW_TYPE = 'hive-settings-view';

type ViewStep = 'locator' | 'auth-choice' | 'login' | 'request-access' | 'syncing' | 'connected' | 'error';

interface AuthState {
  serverUrl: string;
  serverVerified: boolean;
  username: string;
  token: string;
  vaultId: string;
}

/**
 * Hive Settings View
 * A tab-based multi-step wizard for connecting to a Hive server
 */
export class HiveSettingsView extends ItemView {
  private plugin: HivePlugin;
  private currentStep: ViewStep = 'locator';
  private state: AuthState;
  private mainContentEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: HivePlugin) {
    super(leaf);
    this.plugin = plugin;
    
    // Initialize state from saved settings (vault-specific)
    const vaultSettings = plugin.getVaultSettings();
    this.state = {
      serverUrl: vaultSettings.serverUrl || '',
      serverVerified: false,
      username: vaultSettings.username || '',
      token: vaultSettings.token || '',
      vaultId: vaultSettings.vaultId || '',
    };

    // Determine initial step based on current state
    if (plugin.isConnected()) {
      this.currentStep = 'connected';
    } else if (this.state.token && this.state.serverUrl) {
      this.currentStep = 'connected';
    } else if (this.state.serverUrl) {
      this.currentStep = 'auth-choice';
    }
  }

  getViewType(): string {
    return HIVE_SETTINGS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Hive Settings';
  }

  getIcon(): string {
    return 'hive';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('hive-settings-view');

    // Create the main layout
    const wrapper = container.createDiv({ cls: 'hive-settings-wrapper' });
    
    // Header
    const header = wrapper.createDiv({ cls: 'hive-settings-header' });
    const titleContainer = header.createDiv({ cls: 'hive-settings-title' });
    const titleIcon = titleContainer.createSpan({ cls: 'hive-settings-title-icon' });
    setIcon(titleIcon, 'hexagon');
    titleContainer.createSpan({ text: ' Hive Settings' });
    header.createEl('p', { 
      cls: 'hive-settings-subtitle',
      text: 'Configure your connection to the Hive collaborative server' 
    });

    // Main content area
    this.mainContentEl = wrapper.createDiv({ cls: 'hive-settings-content' });

    // Render current step
    this.renderStep();
  }

  async onClose(): Promise<void> {
    // Nothing to clean up
  }

  /**
   * Render the current step
   */
  private renderStep(): void {
    if (!this.mainContentEl) return;
    this.mainContentEl.empty();

    switch (this.currentStep) {
      case 'locator':
        this.renderLocatorStep();
        break;
      case 'auth-choice':
        this.renderAuthChoiceStep();
        break;
      case 'login':
        this.renderLoginStep();
        break;
      case 'request-access':
        this.renderRequestAccessStep();
        break;
      case 'syncing':
        this.renderSyncingStep();
        break;
      case 'connected':
        this.renderConnectedStep();
        break;
      case 'error':
        this.renderErrorStep();
        break;
    }
  }

  /**
   * Step 1: Server URL Locator
   */
  private renderLocatorStep(): void {
    if (!this.mainContentEl) return;
    
    const container = this.mainContentEl.createDiv({ cls: 'hive-step hive-step-card' });
    
    // Step indicator
    container.createDiv({ cls: 'hive-step-indicator', text: 'Step 1 of 2' });
    
    container.createEl('h2', { text: 'Connect to a Hive' });
    container.createEl('p', { 
      cls: 'hive-step-description',
      text: 'Enter the URL of your Hive server to get started.' 
    });

    // URL input
    const urlContainer = container.createDiv({ cls: 'hive-input-group' });
    urlContainer.createEl('label', { text: 'Server URL' });
    
    let urlInput: TextComponent;
    
    new Setting(urlContainer)
      .setClass('hive-url-setting')
      .addText(text => {
        urlInput = text;
        text
          .setPlaceholder('https://your-hive-server.com')
          .setValue(this.state.serverUrl)
          .onChange(value => {
            this.state.serverUrl = value;
            this.state.serverVerified = false;
          });
        text.inputEl.addClass('hive-url-input');
      });

    // Status indicator
    const statusEl = container.createDiv({ cls: 'hive-server-status' });

    // Check connection button
    const buttonContainer = container.createDiv({ cls: 'hive-button-container' });
    
    let checkButton: ButtonComponent;
    new Setting(buttonContainer)
      .setClass('hive-check-button-setting')
      .addButton(btn => {
        checkButton = btn;
        btn
          .setButtonText('Check Connection')
          .setCta()
          .onClick(async () => {
            await this.checkServerConnection(statusEl, checkButton);
          });
      });
  }

  /**
   * Check if server is reachable and is a Hive server
   */
  private async checkServerConnection(statusEl: HTMLElement, button: ButtonComponent): Promise<void> {
    const url = this.state.serverUrl.trim();
    
    if (!url) {
      statusEl.empty();
      statusEl.addClass('hive-status-error');
      statusEl.removeClass('hive-status-success');
      statusEl.setText('Please enter a server URL');
      return;
    }

    // Show loading state
    button.setButtonText('Checking...');
    button.setDisabled(true);
    statusEl.empty();
    statusEl.removeClass('hive-status-error', 'hive-status-success');
    statusEl.addClass('hive-status-checking');
    statusEl.empty();
    const checkIcon = statusEl.createSpan({ cls: 'hive-status-icon-inline' });
    setIcon(checkIcon, 'search');
    statusEl.createSpan({ text: ' Checking connection...' });

    try {
      // Normalize URL
      let normalizedUrl = url;
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = 'http://' + normalizedUrl;
      }
      normalizedUrl = normalizedUrl.replace(/\/$/, ''); // Remove trailing slash

      const response = await requestUrl({
        url: `${normalizedUrl}/api/health`,
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      const data = response.json;

      if (response.status === 200 && data.status === 'ok') {
        // Success!
        this.state.serverUrl = normalizedUrl;
        this.state.serverVerified = true;
        
        statusEl.empty();
        statusEl.removeClass('hive-status-error', 'hive-status-checking');
        statusEl.addClass('hive-status-success');
        const successIcon = statusEl.createSpan({ cls: 'hive-status-icon-inline' });
        setIcon(successIcon, 'check');
        statusEl.createSpan({ text: ' Hive server found!' });

        // Save the URL (vault-specific)
        this.plugin.updateVaultSettings({ serverUrl: normalizedUrl });
        await this.plugin.saveSettings();

        // Auto-advance after a short delay
        setTimeout(() => {
          this.currentStep = 'auth-choice';
          this.renderStep();
        }, 800);
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err) {
      statusEl.empty();
      statusEl.removeClass('hive-status-success', 'hive-status-checking');
      statusEl.addClass('hive-status-error');
      const errorIcon = statusEl.createSpan({ cls: 'hive-status-icon-inline' });
      setIcon(errorIcon, 'x');
      statusEl.createSpan({ text: ' Could not connect. Check the URL and try again.' });
      this.state.serverVerified = false;
    } finally {
      button.setButtonText('Check Connection');
      button.setDisabled(false);
    }
  }

  /**
   * Step 2a: Auth Choice (Login or Request Access)
   */
  private renderAuthChoiceStep(): void {
    if (!this.mainContentEl) return;
    
    const container = this.mainContentEl.createDiv({ cls: 'hive-step hive-step-card' });
    
    // Step indicator
    container.createDiv({ cls: 'hive-step-indicator', text: 'Step 2 of 2' });
    
    container.createEl('h2', { text: 'Join the Hive' });
    container.createEl('p', { 
      cls: 'hive-step-description',
      text: 'Choose how you want to authenticate with the server.' 
    });

    // Server info
    const serverInfo = container.createDiv({ cls: 'hive-server-info' });
    serverInfo.createSpan({ cls: 'hive-server-label', text: 'Server: ' });
    serverInfo.createSpan({ cls: 'hive-server-url', text: this.state.serverUrl });

    // Auth options
    const optionsContainer = container.createDiv({ cls: 'hive-auth-options' });

    // Login option
    const loginOption = optionsContainer.createDiv({ cls: 'hive-auth-option' });
    const loginTitle = loginOption.createEl('h3', { cls: 'hive-auth-option-title' });
    const loginIcon = loginTitle.createSpan({ cls: 'hive-auth-icon' });
    setIcon(loginIcon, 'lock');
    loginTitle.createSpan({ text: ' Login' });
    loginOption.createEl('p', { text: 'I have an account on this server' });
    new Setting(loginOption)
      .addButton(btn => btn
        .setButtonText('Login with credentials')
        .setCta()
        .onClick(() => {
          this.currentStep = 'login';
          this.renderStep();
        }));

    // Request access option
    const requestOption = optionsContainer.createDiv({ cls: 'hive-auth-option' });
    const requestTitle = requestOption.createEl('h3', { cls: 'hive-auth-option-title' });
    const requestIcon = requestTitle.createSpan({ cls: 'hive-auth-icon' });
    setIcon(requestIcon, 'mail');
    requestTitle.createSpan({ text: ' Request Access' });
    requestOption.createEl('p', { text: 'I need an account on this server' });
    new Setting(requestOption)
      .addButton(btn => btn
        .setButtonText('Request access')
        .onClick(() => {
          this.currentStep = 'request-access';
          this.renderStep();
        }));

    // Back button
    const backContainer = container.createDiv({ cls: 'hive-back-container' });
    new Setting(backContainer)
      .addButton(btn => btn
        .setButtonText('← Back')
        .onClick(() => {
          this.currentStep = 'locator';
          this.renderStep();
        }));
  }

  /**
   * Step 2b: Login Form
   */
  private renderLoginStep(): void {
    if (!this.mainContentEl) return;
    
    const container = this.mainContentEl.createDiv({ cls: 'hive-step hive-step-card' });
    
    const loginHeader = container.createEl('h2', { cls: 'hive-step-header' });
    const loginHeaderIcon = loginHeader.createSpan({ cls: 'hive-step-icon' });
    setIcon(loginHeaderIcon, 'lock');
    loginHeader.createSpan({ text: ' Login' });
    container.createEl('p', { 
      cls: 'hive-step-description',
      text: 'Enter your credentials to join the Hive.' 
    });

    let usernameInput: TextComponent;
    let passwordInput: HTMLInputElement;
    let vaultIdInput: TextComponent;

    // Username
    new Setting(container)
      .setName('Username')
      .addText(text => {
        usernameInput = text;
        text
          .setPlaceholder('your-username')
          .setValue(this.state.username)
          .onChange(value => {
            this.state.username = value;
          });
      });

    // Password
    const passwordSetting = new Setting(container)
      .setName('Password');
    
    passwordSetting.controlEl.createEl('input', {
      type: 'password',
      placeholder: 'your-password',
      cls: 'hive-password-input'
    }, el => {
      passwordInput = el;
    });

    // Vault ID
    new Setting(container)
      .setName('Vault ID')
      .setDesc('The shared vault to connect to')
      .addText(text => {
        vaultIdInput = text;
        text
          .setPlaceholder('my-shared-vault')
          .setValue(this.state.vaultId)
          .onChange(value => {
            this.state.vaultId = value;
          });
      });

    // Status message
    const statusEl = container.createDiv({ cls: 'hive-login-status' });

    // Buttons
    const buttonContainer = container.createDiv({ cls: 'hive-button-row' });
    
    new Setting(buttonContainer)
      .addButton(btn => btn
        .setButtonText('← Back')
        .onClick(() => {
          this.currentStep = 'auth-choice';
          this.renderStep();
        }))
      .addButton(btn => btn
        .setButtonText('Login & Connect')
        .setCta()
        .onClick(async () => {
          await this.handleLogin(
            usernameInput.getValue(),
            passwordInput.value,
            vaultIdInput.getValue(),
            statusEl,
            btn
          );
        }));
  }

  /**
   * Handle login attempt
   */
  private async handleLogin(
    username: string,
    password: string,
    vaultId: string,
    statusEl: HTMLElement,
    button: ButtonComponent
  ): Promise<void> {
    if (!username || !password) {
      statusEl.setText('Please enter username and password');
      statusEl.addClass('hive-status-error');
      return;
    }

    if (!vaultId) {
      statusEl.setText('Please enter a vault ID');
      statusEl.addClass('hive-status-error');
      return;
    }

    button.setButtonText('Logging in...');
    button.setDisabled(true);
    statusEl.empty();
    statusEl.removeClass('hive-status-error');

    try {
      const response = await requestUrl({
        url: `${this.state.serverUrl}/api/login`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = response.json;

      if (response.status === 200 && data.token) {
        // Save credentials (vault-specific)
        this.state.username = username;
        this.state.token = data.token;
        this.state.vaultId = vaultId;
        
        this.plugin.updateVaultSettings({
          username,
          token: data.token,
          vaultId,
        });
        await this.plugin.saveSettings();

        // Check vault and sync
        await this.checkVaultAndSync(statusEl);
      } else {
        statusEl.setText(`Login failed: ${data.error || 'Invalid credentials'}`);
        statusEl.addClass('hive-status-error');
        button.setButtonText('Login & Connect');
        button.setDisabled(false);
      }
    } catch (err) {
      statusEl.setText(`Connection error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      statusEl.addClass('hive-status-error');
      button.setButtonText('Login & Connect');
      button.setDisabled(false);
    }
  }

  /**
   * Check if local vault is empty and sync
   */
  private async checkVaultAndSync(statusEl: HTMLElement): Promise<void> {
    statusEl.setText('Checking vault...');

    // Get all markdown files in the vault
    const files = this.app.vault.getMarkdownFiles();
    
    if (files.length > 0) {
      // Vault is not empty - warn user
      statusEl.empty();
      this.renderVaultNotEmptyWarning(files.length);
      return;
    }

    // Vault is empty, proceed with sync
    this.currentStep = 'syncing';
    this.renderStep();
    
    try {
      await this.plugin.connectToServer();
      this.currentStep = 'connected';
      this.renderStep();
    } catch (err) {
      statusEl.setText(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      statusEl.addClass('hive-status-error');
    }
  }

  /**
   * Render warning when vault is not empty
   */
  private renderVaultNotEmptyWarning(fileCount: number): void {
    if (!this.mainContentEl) return;
    
    const container = this.mainContentEl;
    container.empty();
    
    const card = container.createDiv({ cls: 'hive-step hive-step-card' });
    
    const warning = card.createDiv({ cls: 'hive-warning' });
    const warningHeader = warning.createEl('h2', { cls: 'hive-warning-header' });
    const warningIcon = warningHeader.createSpan({ cls: 'hive-warning-icon' });
    setIcon(warningIcon, 'alert-triangle');
    warningHeader.createSpan({ text: ' Vault Not Empty' });
    warning.createEl('p', { 
      text: `This vault contains ${fileCount} file${fileCount > 1 ? 's' : ''}. To prevent conflicts, Hive requires an empty vault for initial sync.` 
    });
    warning.createEl('p', {
      cls: 'hive-warning-detail',
      text: 'Please create a new vault or clear all files from this vault before connecting.'
    });

    const buttonContainer = card.createDiv({ cls: 'hive-button-row' });
    new Setting(buttonContainer)
      .addButton(btn => btn
        .setButtonText('← Go Back')
        .onClick(() => {
          this.currentStep = 'login';
          this.renderStep();
        }))
      .addButton(btn => btn
        .setButtonText('Connect Anyway (Advanced)')
        .setWarning()
        .onClick(async () => {
          this.currentStep = 'syncing';
          this.renderStep();
          try {
            await this.plugin.connectToServer();
            this.currentStep = 'connected';
            this.renderStep();
          } catch (err) {
            new Notice(`Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`);
            this.currentStep = 'login';
            this.renderStep();
          }
        }));
  }

  /**
   * Step 2c: Request Access Form
   */
  private renderRequestAccessStep(): void {
    if (!this.mainContentEl) return;
    
    const container = this.mainContentEl.createDiv({ cls: 'hive-step hive-step-card' });
    
    const requestHeader = container.createEl('h2', { cls: 'hive-step-header' });
    const requestHeaderIcon = requestHeader.createSpan({ cls: 'hive-step-icon' });
    setIcon(requestHeaderIcon, 'mail');
    requestHeader.createSpan({ text: ' Request Access' });
    container.createEl('p', { 
      cls: 'hive-step-description',
      text: 'Submit a request to the server administrator for an account.' 
    });

    let usernameInput: TextComponent;
    let emailInput: TextComponent;
    let passwordInput: HTMLInputElement;
    let confirmPasswordInput: HTMLInputElement;
    let messageInput: HTMLTextAreaElement;

    // Desired username
    new Setting(container)
      .setName('Desired Username')
      .addText(text => {
        usernameInput = text;
        text.setPlaceholder('your-username');
      });

    // Email
    new Setting(container)
      .setName('Email')
      .setDesc('So the admin can contact you')
      .addText(text => {
        emailInput = text;
        text.setPlaceholder('you@example.com');
      });

    // Password
    const passwordSetting = new Setting(container)
      .setName('Password')
      .setDesc('Choose a password (min 6 characters)');
    
    passwordSetting.controlEl.createEl('input', {
      type: 'password',
      placeholder: 'your-password',
      cls: 'hive-password-input'
    }, el => {
      passwordInput = el;
    });

    // Confirm Password
    const confirmPasswordSetting = new Setting(container)
      .setName('Confirm Password');
    
    confirmPasswordSetting.controlEl.createEl('input', {
      type: 'password',
      placeholder: 'confirm-password',
      cls: 'hive-password-input'
    }, el => {
      confirmPasswordInput = el;
    });

    // Message
    const messageSetting = new Setting(container)
      .setName('Message (optional)')
      .setDesc('Why do you want access?');
    
    messageSetting.controlEl.createEl('textarea', {
      placeholder: 'I would like to collaborate on...',
      cls: 'hive-message-input'
    }, el => {
      messageInput = el;
    });

    // Status
    const statusEl = container.createDiv({ cls: 'hive-login-status' });

    // Buttons
    const buttonContainer = container.createDiv({ cls: 'hive-button-row' });
    
    new Setting(buttonContainer)
      .addButton(btn => btn
        .setButtonText('← Back')
        .onClick(() => {
          this.currentStep = 'auth-choice';
          this.renderStep();
        }))
      .addButton(btn => btn
        .setButtonText('Submit Request')
        .setCta()
        .onClick(async () => {
          await this.handleRequestAccess(
            usernameInput.getValue(),
            emailInput.getValue(),
            passwordInput.value,
            confirmPasswordInput.value,
            messageInput.value,
            statusEl,
            btn
          );
        }));
  }

  /**
   * Handle access request submission
   */
  private async handleRequestAccess(
    username: string,
    email: string,
    password: string,
    confirmPassword: string,
    message: string,
    statusEl: HTMLElement,
    button: ButtonComponent
  ): Promise<void> {
    if (!username) {
      statusEl.setText('Please enter a desired username');
      statusEl.addClass('hive-status-error');
      return;
    }

    if (username.length < 3) {
      statusEl.setText('Username must be at least 3 characters');
      statusEl.addClass('hive-status-error');
      return;
    }

    if (!email) {
      statusEl.setText('Please enter your email');
      statusEl.addClass('hive-status-error');
      return;
    }

    if (!password) {
      statusEl.setText('Please enter a password');
      statusEl.addClass('hive-status-error');
      return;
    }

    if (password.length < 6) {
      statusEl.setText('Password must be at least 6 characters');
      statusEl.addClass('hive-status-error');
      return;
    }

    if (password !== confirmPassword) {
      statusEl.setText('Passwords do not match');
      statusEl.addClass('hive-status-error');
      return;
    }

    button.setButtonText('Submitting...');
    button.setDisabled(true);
    statusEl.empty();
    statusEl.removeClass('hive-status-error');

    try {
      const response = await requestUrl({
        url: `${this.state.serverUrl}/api/request-login`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, message }),
      });

      const data = response.json;

      if (response.status === 200 || response.status === 201) {
        // Show success message
        if (!this.mainContentEl) return;
        this.mainContentEl.empty();
        
        const card = this.mainContentEl.createDiv({ cls: 'hive-step hive-step-card' });
        const successContainer = card.createDiv({ cls: 'hive-success' });
        const successHeader = successContainer.createEl('h2', { cls: 'hive-success-header' });
        const successIcon = successHeader.createSpan({ cls: 'hive-success-icon' });
        setIcon(successIcon, 'check-circle');
        successHeader.createSpan({ text: ' Request Submitted!' });
        successContainer.createEl('p', { 
          text: 'Your access request has been sent to the server administrator. Once approved, you can log in with your chosen username and password.' 
        });

        const buttonContainer = card.createDiv({ cls: 'hive-button-container' });
        new Setting(buttonContainer)
          .addButton(btn => btn
            .setButtonText('Done')
            .setCta()
            .onClick(() => {
              this.currentStep = 'locator';
              this.renderStep();
            }));
      } else {
        statusEl.setText(`Request failed: ${data.error || 'Unknown error'}`);
        statusEl.addClass('hive-status-error');
        button.setButtonText('Submit Request');
        button.setDisabled(false);
      }
    } catch (err) {
      statusEl.setText(`Connection error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      statusEl.addClass('hive-status-error');
      button.setButtonText('Submit Request');
      button.setDisabled(false);
    }
  }

  /**
   * Syncing step - shows progress
   */
  private renderSyncingStep(): void {
    if (!this.mainContentEl) return;
    
    const container = this.mainContentEl.createDiv({ cls: 'hive-step hive-step-card hive-syncing' });
    
    container.createDiv({ cls: 'hive-sync-spinner' });
    container.createEl('h2', { text: 'Connecting to the Hive...' });
    container.createEl('p', { 
      cls: 'hive-step-description',
      text: 'Syncing files from the remote vault.' 
    });
  }

  /**
   * Connected step - shows success and options
   */
  private renderConnectedStep(): void {
    if (!this.mainContentEl) return;
    
    const container = this.mainContentEl.createDiv({ cls: 'hive-step hive-step-card' });
    
    const isConnected = this.plugin.isConnected();
    const vaultSettings = this.plugin.getVaultSettings();
    
    if (isConnected) {
      const connectedIconContainer = container.createDiv({ cls: 'hive-connected-icon' });
      setIcon(connectedIconContainer, 'hexagon');
      container.createEl('h2', { text: 'Connected to the Hive!' });
    } else {
      const configHeader = container.createEl('h2', { cls: 'hive-config-header' });
      const configIcon = configHeader.createSpan({ cls: 'hive-config-icon' });
      setIcon(configIcon, 'hexagon');
      configHeader.createSpan({ text: ' Hive Configuration' });
    }

    // Show current Obsidian vault name
    const obsidianVaultName = this.plugin.app.vault.getName();
    const obsidianVaultInfo = container.createDiv({ cls: 'hive-obsidian-vault-info' });
    obsidianVaultInfo.createSpan({ cls: 'hive-vault-label', text: 'Obsidian Vault: ' });
    obsidianVaultInfo.createSpan({ cls: 'hive-vault-name', text: obsidianVaultName });

    // Connection info
    const infoContainer = container.createDiv({ cls: 'hive-connection-info' });
    
    const serverRow = infoContainer.createDiv({ cls: 'hive-info-row' });
    serverRow.createSpan({ cls: 'hive-info-label', text: 'Server:' });
    serverRow.createSpan({ cls: 'hive-info-value', text: vaultSettings.serverUrl || 'Not configured' });

    const vaultRow = infoContainer.createDiv({ cls: 'hive-info-row' });
    vaultRow.createSpan({ cls: 'hive-info-label', text: 'Hive Vault:' });
    vaultRow.createSpan({ cls: 'hive-info-value', text: vaultSettings.vaultId || 'Not configured' });

    const userRow = infoContainer.createDiv({ cls: 'hive-info-row' });
    userRow.createSpan({ cls: 'hive-info-label', text: 'User:' });
    userRow.createSpan({ cls: 'hive-info-value', text: vaultSettings.username || 'Not logged in' });

    const statusRow = infoContainer.createDiv({ cls: 'hive-info-row' });
    statusRow.createSpan({ cls: 'hive-info-label', text: 'Status:' });
    const statusValue = statusRow.createSpan({ cls: 'hive-info-value' });
    statusValue.createSpan({ 
      cls: `hive-status-dot ${isConnected ? 'connected' : 'disconnected'}` 
    });
    statusValue.createSpan({ text: isConnected ? 'Connected' : 'Disconnected' });

    // Show role if connected
    if (isConnected && this.plugin.syncEngine) {
      const role = this.plugin.syncEngine.getRole();
      if (role) {
        const roleRow = infoContainer.createDiv({ cls: 'hive-info-row' });
        roleRow.createSpan({ cls: 'hive-info-label', text: 'Role:' });
        const roleValue = roleRow.createSpan({ cls: 'hive-info-value' });
        const roleDisplay = role === 'viewer' ? 'Viewer (Read-only)' : 
                            role.charAt(0).toUpperCase() + role.slice(1);
        roleValue.createSpan({ 
          text: roleDisplay,
          cls: `hive-role-text hive-role-${role}`
        });
        
        // Show warning for viewers
        if (role === 'viewer') {
          const roleWarning = infoContainer.createDiv({ cls: 'hive-role-warning' });
          setIcon(roleWarning.createSpan({ cls: 'hive-warning-icon' }), 'info');
          roleWarning.createSpan({ 
            text: 'You have read-only access. Contact the vault owner to request write access.' 
          });
        }
      }
    }

    // Preferences section
    container.createEl('h3', { text: 'Preferences', cls: 'hive-section-title' });

    // Cursor color
    new Setting(container)
      .setName('Cursor Color')
      .setDesc('Your cursor color visible to other users')
      .addText(text => text
        .setValue(vaultSettings.userColor)
        .onChange(async value => {
          if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
            this.plugin.updateVaultSettings({ userColor: value });
            await this.plugin.saveSettings();
          }
        }))
      .addColorPicker(picker => picker
        .setValue(vaultSettings.userColor)
        .onChange(async value => {
          this.plugin.updateVaultSettings({ userColor: value });
          await this.plugin.saveSettings();
        }));

    // Auto-connect
    new Setting(container)
      .setName('Auto-connect')
      .setDesc('Automatically connect when Obsidian starts')
      .addToggle(toggle => toggle
        .setValue(vaultSettings.autoConnect)
        .onChange(async value => {
          this.plugin.updateVaultSettings({ autoConnect: value });
          await this.plugin.saveSettings();
        }));

    // Action buttons
    const buttonContainer = container.createDiv({ cls: 'hive-button-row' });
    
    if (isConnected) {
      new Setting(buttonContainer)
        .addButton(btn => btn
          .setButtonText('Disconnect')
          .setWarning()
          .onClick(() => {
            this.plugin.disconnectFromServer();
            new Notice('Disconnected from the Hive');
            this.renderStep();
          }));
    } else {
      new Setting(buttonContainer)
        .addButton(btn => btn
          .setButtonText('Change Server')
          .onClick(() => {
            this.currentStep = 'locator';
            this.renderStep();
          }))
        .addButton(btn => btn
          .setButtonText('Connect')
          .setCta()
          .onClick(async () => {
            try {
              await this.plugin.connectToServer();
              this.renderStep();
            } catch (err) {
              new Notice(`Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
          }));
    }

    // Logout option
    if (vaultSettings.token) {
      const logoutContainer = container.createDiv({ cls: 'hive-logout-container' });
      new Setting(logoutContainer)
        .addButton(btn => btn
          .setButtonText('Logout')
          .onClick(async () => {
            this.plugin.updateVaultSettings({ token: '', username: '' });
            await this.plugin.saveSettings();
            this.plugin.disconnectFromServer();
            this.currentStep = 'locator';
            this.renderStep();
            new Notice('Logged out from Hive');
          }));
    }
  }

  /**
   * Error step
   */
  private renderErrorStep(): void {
    if (!this.mainContentEl) return;
    
    const container = this.mainContentEl.createDiv({ cls: 'hive-step hive-step-card hive-error-step' });
    
    const errorHeader = container.createEl('h2', { cls: 'hive-error-header' });
    const errorIcon = errorHeader.createSpan({ cls: 'hive-error-icon' });
    setIcon(errorIcon, 'x-circle');
    errorHeader.createSpan({ text: ' Connection Error' });
    container.createEl('p', { 
      cls: 'hive-step-description',
      text: 'Something went wrong while connecting to the Hive.' 
    });

    const buttonContainer = container.createDiv({ cls: 'hive-button-container' });
    new Setting(buttonContainer)
      .addButton(btn => btn
        .setButtonText('Try Again')
        .setCta()
        .onClick(() => {
          this.currentStep = 'locator';
          this.renderStep();
        }));
  }
}

/**
 * Register the Hive settings view with the plugin
 */
export function registerHiveSettingsView(plugin: HivePlugin): void {
  plugin.registerView(
    HIVE_SETTINGS_VIEW_TYPE,
    (leaf) => new HiveSettingsView(leaf, plugin)
  );
}

/**
 * Open the Hive settings view as a tab
 */
export async function openHiveSettings(plugin: HivePlugin): Promise<void> {
  const { workspace } = plugin.app;

  let leaf: WorkspaceLeaf | null = null;
  const leaves = workspace.getLeavesOfType(HIVE_SETTINGS_VIEW_TYPE);

  if (leaves.length > 0) {
    // View already exists, reveal it
    leaf = leaves[0];
  } else {
    // Create new leaf in main area
    leaf = workspace.getLeaf('tab');
    if (leaf) {
      await leaf.setViewState({ type: HIVE_SETTINGS_VIEW_TYPE, active: true });
    }
  }

  // Reveal the leaf
  if (leaf) {
    workspace.revealLeaf(leaf);
  }
}

// Backwards compatibility alias
export const openHiveModal = openHiveSettings;
