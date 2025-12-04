# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: [security@yourdomain.com]

Or, if you prefer, you can use GitHub's private vulnerability reporting feature on this repository.

### What to Include

Please include as much of the following information as possible:

- Type of vulnerability (e.g., authentication bypass, SQL injection, XSS)
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact assessment

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Target**: Within 30 days (depending on complexity)

### What to Expect

1. **Acknowledgment**: We'll acknowledge receipt of your report within 48 hours.

2. **Assessment**: We'll assess the vulnerability and determine its impact.

3. **Updates**: We'll keep you informed of our progress.

4. **Resolution**: Once fixed, we'll:
   - Release a patch
   - Credit you in the release notes (unless you prefer anonymity)
   - Coordinate disclosure timing with you

### Safe Harbor

We support responsible security research. If you:
- Make a good faith effort to avoid privacy violations and data destruction
- Give us reasonable time to respond before public disclosure
- Don't exploit the vulnerability beyond demonstrating it

We will not pursue legal action against you.

## Security Best Practices for Deployment

### Server Deployment

1. **Always use HTTPS** in production via a reverse proxy (nginx, Caddy)

2. **Generate a strong JWT_SECRET**:
   ```bash
   openssl rand -base64 32
   ```

3. **Set restrictive CORS origins** - only allow your specific domains

4. **Use a firewall** to restrict access to the server port

5. **Set up monitoring** for suspicious authentication patterns

6. **Regular backups** - Hive has automatic backups, but also set up external backups

7. **Keep dependencies updated** - Run `npm audit` regularly

### Plugin Usage

1. **Verify server identity** - Only connect to servers you trust

2. **Use HTTPS servers** - Don't connect to unencrypted servers for sensitive data

3. **Review vault contents** before syncing to a shared server

## Known Security Considerations

### By Design

- **No end-to-end encryption**: Data is readable by the server. For sensitive data, self-host and control access.

- **Server admin access**: Server administrators can access all vault data.

- **Local token storage**: Authentication tokens are stored in Obsidian's plugin data folder.

### Mitigations in Place

- JWT tokens expire after 7 days
- Passwords are hashed with bcrypt (10 rounds)
- Rate limiting on authentication endpoints
- Path sanitization prevents directory traversal
- Admin token endpoint restricted to localhost

## Dependency Security

We regularly monitor dependencies for vulnerabilities using:
- `npm audit`
- GitHub Dependabot alerts

Critical vulnerabilities in dependencies are patched as quickly as possible.

