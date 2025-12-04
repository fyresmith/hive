# Contributing to Hive

Thank you for your interest in contributing to Hive! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We want Hive to be a welcoming project for everyone.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- Git

### Setting Up the Development Environment

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/hive.git
   cd hive
   ```

2. **Install dependencies for all packages**
   ```bash
   npm install
   ```

3. **Set up the server**
   ```bash
   cd server
   cp .env.example .env
   # Edit .env and set a JWT_SECRET
   npm run dev
   ```

4. **Build the plugin**
   ```bash
   cd plugin
   npm run dev
   ```

5. **Run the admin panel (optional)**
   ```bash
   cd admin
   npm run dev:electron
   ```

## Project Structure

```
hive/
├── server/     # Node.js backend server
├── plugin/     # Obsidian plugin
├── admin/      # Electron admin panel
└── scripts/    # Release and build scripts
```

## Development Workflow

### Branches

- `main` - Stable release branch
- `develop` - Integration branch for features
- `feature/*` - Feature branches
- `fix/*` - Bug fix branches

### Making Changes

1. Create a new branch from `develop`:
   ```bash
   git checkout develop
   git pull
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Test your changes:
   - Server: Ensure `npm run build` succeeds
   - Plugin: Test in Obsidian with a development vault
   - Admin: Run `npm run dev:electron`

4. Commit your changes with a descriptive message:
   ```bash
   git commit -m "feat(server): add feature description"
   ```

   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat(scope):` - New feature
   - `fix(scope):` - Bug fix
   - `docs(scope):` - Documentation changes
   - `refactor(scope):` - Code refactoring
   - `test(scope):` - Adding tests
   - `chore(scope):` - Maintenance tasks

5. Push your branch and create a Pull Request

### Pull Request Guidelines

- Fill out the PR template completely
- Link any related issues
- Ensure CI checks pass
- Request review from maintainers
- Be responsive to feedback

## Testing

### Server

```bash
cd server
npm run build  # Ensure TypeScript compiles
# Manual testing with test scripts
./test-auth.sh
node test-sync.js
```

### Plugin

1. Build: `npm run dev`
2. Copy to test vault: `cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/collaborative-vault/`
3. Enable in Obsidian and test

### Admin

```bash
cd admin
npm run dev:electron
```

## Releasing

Releases are handled by maintainers using the release script:

```bash
./scripts/release.sh server patch  # Server patch release
./scripts/release.sh plugin minor  # Plugin minor release
./scripts/release.sh admin major   # Admin major release
```

This creates a git tag that triggers the GitHub Actions release workflow.

## Reporting Issues

### Bug Reports

Please include:
- Description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Version information (server, plugin, Obsidian)
- Relevant logs or error messages

### Feature Requests

Please include:
- Clear description of the feature
- Use case / why it's needed
- Any implementation ideas you have

## Security Vulnerabilities

**Do not report security vulnerabilities through public issues.**

Please see [SECURITY.md](SECURITY.md) for instructions on responsible disclosure.

## Questions?

Feel free to open a Discussion on GitHub if you have questions about contributing.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

