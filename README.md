# Hive - Collaborative Obsidian Vaults

Hive is a self-hosted solution for real-time collaborative editing in Obsidian. It enables multiple users to work on the same vault simultaneously with live cursors, presence awareness, and conflict-free synchronization.

## Features

- **Real-time Collaboration**: Edit notes simultaneously with other users
- **Live Cursors**: See where others are typing in real-time
- **Presence Awareness**: Know who's online and what files they're viewing
- **Conflict-free Sync**: Built on Y.js CRDTs for automatic conflict resolution
- **Offline Support**: Continue editing when disconnected, changes merge on reconnect
- **Self-hosted**: Full control over your data
- **Automatic Backups**: Hourly and daily backups with configurable retention

## Architecture

Hive consists of three components:

1. **Server** (`/server`) - Node.js backend handling authentication, vault storage, and real-time sync
2. **Plugin** (`/plugin`) - Obsidian plugin that connects to the server
3. **Admin** (`/admin`) - Electron app for server management (optional)

## Quick Start

### 1. Set Up the Server

```bash
cd server
npm install

# Create environment file
cp .env.example .env

# Generate a secure JWT secret
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env

# Start the server
npm run dev
```

### 2. Install the Plugin

1. Build the plugin:
   ```bash
   cd plugin
   npm install
   npm run build
   ```

2. Copy to your Obsidian vault:
   ```bash
   mkdir -p /path/to/your/vault/.obsidian/plugins/collaborative-vault
   cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/collaborative-vault/
   ```

3. Enable the plugin in Obsidian: Settings → Community Plugins → Enable "Collaborative Vault"

4. Configure the plugin with your server URL and create an account

## Configuration

### Server Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | **Yes** | - | Secret key for signing tokens (min 32 chars) |
| `PORT` | No | 3000 | Server port |
| `DATABASE_PATH` | No | ./data/users.db | SQLite database path |
| `VAULTS_PATH` | No | ./data/vaults | Vault storage directory |
| `BACKUPS_PATH` | No | ./data/backups | Backup storage directory |
| `ALLOWED_ORIGINS` | No | localhost | CORS allowed origins (comma-separated) |
| `ADMIN_PASSWORD` | No | - | Optional password for admin token endpoint |

See `server/.env.example` for a complete configuration template.

## Security Considerations

### Authentication

- Passwords are hashed with bcrypt (10 rounds)
- JWT tokens expire after 7 days
- The first registered user automatically becomes an admin

### Rate Limiting

- Authentication endpoints: 5 requests per 15 minutes per IP
- General API: 100 requests per minute per IP

### Access Control

- Admin endpoints require admin role
- The `/api/admin/token` endpoint is restricted to localhost only
- All vault operations require authentication

### Production Deployment

For production use, we strongly recommend:

1. **Use HTTPS**: Deploy behind a reverse proxy (nginx, Caddy) with TLS
2. **Set strong secrets**: Generate a secure `JWT_SECRET` with `openssl rand -base64 32`
3. **Configure CORS**: Set `ALLOWED_ORIGINS` to your specific domain(s)
4. **Firewall**: Only expose necessary ports
5. **Backups**: Set up external backups of the `data/` directory
6. **Monitoring**: Monitor server logs for suspicious activity

### Example nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name hive.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## API Reference

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/register` | POST | Register new user |
| `/api/login` | POST | Login and get JWT token |
| `/api/verify` | GET | Verify token validity |
| `/api/request-login` | POST | Request account (pending admin approval) |

### Vault Operations (requires auth)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vault/create` | POST | Create a new vault |
| `/api/vault/list` | GET | List all vaults |
| `/api/vault/:id` | GET | Get vault info |
| `/api/vault/:id/files` | GET | List files in vault |
| `/api/vault/:id/file/*` | GET | Read file content |
| `/api/vault/:id/file/*` | POST | Write file content |
| `/api/vault/:id/file/*` | DELETE | Delete file |

### Backup Operations (requires auth)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vault/:id/backups` | GET | List available backups |
| `/api/vault/:id/backup` | POST | Trigger manual backup |
| `/api/vault/:id/restore` | POST | Restore from backup |

### Admin Operations (requires admin role)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/users` | GET | List all users |
| `/api/admin/users/:id` | GET/PUT/DELETE | Manage user |
| `/api/admin/access-requests` | GET | List pending requests |
| `/api/admin/access-requests/:id/approve` | POST | Approve request |
| `/api/admin/access-requests/:id/reject` | POST | Reject request |

## Development

### Server

```bash
cd server
npm install
npm run dev    # Development with hot reload
npm run build  # Production build
npm start      # Run production build
```

### Plugin

```bash
cd plugin
npm install
npm run dev    # Development build
npm run build  # Production build
```

### Admin App

```bash
cd admin
npm install
npm run dev    # Development
npm run build  # Production build
```

## Technology Stack

- **Server**: Node.js, Express, Socket.io, SQLite
- **Sync**: Y.js (CRDT), y-protocols
- **Plugin**: Obsidian API, TypeScript
- **Admin**: Electron, React, Vite

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please ensure you:

1. Follow the existing code style
2. Add tests for new functionality
3. Update documentation as needed
4. Keep security in mind

## Acknowledgments

- [Y.js](https://yjs.dev/) - The CRDT framework powering real-time sync
- [Obsidian](https://obsidian.md/) - The markdown editor this plugin extends
- [Socket.io](https://socket.io/) - Real-time communication

