#!/bin/bash

# Test script for authentication endpoints
# Run with: chmod +x test-auth.sh && ./test-auth.sh

BASE_URL="http://localhost:3000"

echo "=========================================="
echo "Testing Collaborative Vault Server Auth"
echo "=========================================="
echo ""

# Test health endpoint
echo "1. Testing health endpoint..."
curl -s "$BASE_URL/api/health" | jq .
echo ""

# Test user registration
echo "2. Testing user registration..."
REGISTER_RESULT=$(curl -s -X POST "$BASE_URL/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass123"}')
echo "$REGISTER_RESULT" | jq .
echo ""

# Test duplicate registration (should fail)
echo "3. Testing duplicate registration (should fail)..."
curl -s -X POST "$BASE_URL/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass123"}' | jq .
echo ""

# Test login with correct credentials
echo "4. Testing login with correct credentials..."
LOGIN_RESULT=$(curl -s -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass123"}')
echo "$LOGIN_RESULT" | jq .
TOKEN=$(echo "$LOGIN_RESULT" | jq -r '.token')
echo ""

# Test login with wrong password
echo "5. Testing login with wrong password (should fail)..."
curl -s -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"wrongpassword"}' | jq .
echo ""

# Test token verification
echo "6. Testing token verification..."
curl -s "$BASE_URL/api/verify" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Test verification without token (should fail)
echo "7. Testing verification without token (should fail)..."
curl -s "$BASE_URL/api/verify" | jq .
echo ""

# Test verification with invalid token (should fail)
echo "8. Testing verification with invalid token (should fail)..."
curl -s "$BASE_URL/api/verify" \
  -H "Authorization: Bearer invalidtoken123" | jq .
echo ""

echo "=========================================="
echo "Test complete!"
echo "=========================================="

