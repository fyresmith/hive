#!/bin/bash
# =============================================================================
# Hive Release Script
# =============================================================================
# 
# Usage:
#   ./scripts/release.sh server patch   # Bump server patch version and release
#   ./scripts/release.sh plugin minor   # Bump plugin minor version and release
#   ./scripts/release.sh admin major    # Bump admin major version and release
#
# This script:
#   1. Bumps the version in the component's package.json
#   2. For plugin: also updates manifest.json and versions.json
#   3. Commits the changes
#   4. Creates a git tag
#   5. Pushes to trigger the release workflow

set -e

COMPONENT=$1
BUMP_TYPE=$2

if [ -z "$COMPONENT" ] || [ -z "$BUMP_TYPE" ]; then
    echo "Usage: $0 <component> <bump-type>"
    echo ""
    echo "Components: server, plugin, admin"
    echo "Bump types: patch, minor, major"
    echo ""
    echo "Examples:"
    echo "  $0 server patch"
    echo "  $0 plugin minor"
    echo "  $0 admin major"
    exit 1
fi

if [[ ! "$COMPONENT" =~ ^(server|plugin|admin)$ ]]; then
    echo "Error: Invalid component '$COMPONENT'"
    echo "Valid components: server, plugin, admin"
    exit 1
fi

if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
    echo "Error: Invalid bump type '$BUMP_TYPE'"
    echo "Valid bump types: patch, minor, major"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "Error: You have uncommitted changes. Please commit or stash them first."
    exit 1
fi

# Navigate to component directory
cd "$(dirname "$0")/../$COMPONENT"

echo "📦 Releasing $COMPONENT with $BUMP_TYPE version bump..."

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Bump version
if [ "$COMPONENT" = "plugin" ]; then
    # Plugin uses custom version script that also updates manifest.json
    npm version $BUMP_TYPE --no-git-tag-version
else
    npm version $BUMP_TYPE --no-git-tag-version
fi

# Get new version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"

# Go back to repo root
cd ..

# Stage changes
if [ "$COMPONENT" = "plugin" ]; then
    git add plugin/package.json plugin/manifest.json plugin/versions.json 2>/dev/null || git add plugin/package.json plugin/manifest.json
else
    git add $COMPONENT/package.json
fi

# Commit
git commit -m "chore($COMPONENT): bump version to $NEW_VERSION"

# Create tag
TAG_NAME="${COMPONENT}-v${NEW_VERSION}"
git tag -a "$TAG_NAME" -m "$COMPONENT version $NEW_VERSION"

echo ""
echo "✅ Version bumped and tagged as $TAG_NAME"
echo ""
echo "To release, push the commit and tag:"
echo "  git push && git push origin $TAG_NAME"
echo ""
echo "Or to abort:"
echo "  git reset --hard HEAD~1 && git tag -d $TAG_NAME"

