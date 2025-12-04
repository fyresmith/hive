#!/bin/bash

# Test script for vault API endpoints
# Run with: chmod +x test-vault.sh && ./test-vault.sh

BASE_URL="http://localhost:3000"

echo "=========================================="
echo "Testing Vault API Endpoints"
echo "=========================================="
echo ""

# First, register and login to get a token
echo "1. Registering test user..."
curl -s -X POST "$BASE_URL/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"vaultuser","password":"testpass123"}' | jq .
echo ""

echo "2. Logging in..."
LOGIN_RESULT=$(curl -s -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"vaultuser","password":"testpass123"}')
echo "$LOGIN_RESULT" | jq .
TOKEN=$(echo "$LOGIN_RESULT" | jq -r '.token')
echo ""

# Create a vault
VAULT_ID="my-test-vault"
echo "3. Creating vault: $VAULT_ID..."
curl -s -X POST "$BASE_URL/api/vault/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"vaultId\":\"$VAULT_ID\"}" | jq .
echo ""

# List vaults
echo "4. Listing all vaults..."
curl -s "$BASE_URL/api/vault/list" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Write a file
echo "5. Writing a test file..."
curl -s -X POST "$BASE_URL/api/vault/$VAULT_ID/file/notes/welcome.md" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"content":"# Welcome\n\nThis is a collaborative vault!\n\n## Features\n- Real-time sync\n- Live cursors\n- Conflict-free editing"}' | jq .
echo ""

# Write another file
echo "6. Writing another file..."
curl -s -X POST "$BASE_URL/api/vault/$VAULT_ID/file/daily/2024-01-15.md" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"content":"# Daily Note\n\n## Tasks\n- [ ] Test the sync\n- [ ] Review cursors"}' | jq .
echo ""

# List files in vault
echo "7. Listing files in vault..."
curl -s "$BASE_URL/api/vault/$VAULT_ID/files" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Read a file
echo "8. Reading file content..."
curl -s "$BASE_URL/api/vault/$VAULT_ID/file/notes/welcome.md" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Get vault info
echo "9. Getting vault info..."
curl -s "$BASE_URL/api/vault/$VAULT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Try to create duplicate vault (should fail)
echo "10. Creating duplicate vault (should fail)..."
curl -s -X POST "$BASE_URL/api/vault/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"vaultId\":\"$VAULT_ID\"}" | jq .
echo ""

# Try to read non-existent file (should fail)
echo "11. Reading non-existent file (should fail)..."
curl -s "$BASE_URL/api/vault/$VAULT_ID/file/nonexistent.md" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Try to access vault without token (should fail)
echo "12. Accessing vault without token (should fail)..."
curl -s "$BASE_URL/api/vault/list" | jq .
echo ""

# Delete a file
echo "13. Deleting a file..."
curl -s -X DELETE "$BASE_URL/api/vault/$VAULT_ID/file/daily/2024-01-15.md" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Verify deletion
echo "14. Verifying file was deleted..."
curl -s "$BASE_URL/api/vault/$VAULT_ID/files" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=========================================="
echo "Vault API Test Complete!"
echo "=========================================="

