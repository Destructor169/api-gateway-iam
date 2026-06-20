#!/bin/bash

GATEWAY_URL="http://localhost:3000"

echo "1. Attempting to access protected route without token..."
curl -s -i "$GATEWAY_URL/api/finance/crypto"
echo -e "\n"

echo "2. Registering a new user..."
curl -s -X POST "$GATEWAY_URL/auth/register" -H "Content-Type: application/json" -d '{"username":"testuser","password":"password123"}'
echo -e "\n"

echo "3. Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$GATEWAY_URL/auth/login" -H "Content-Type: application/json" -d '{"username":"testuser","password":"password123"}')
echo "Login Response: $LOGIN_RESPONSE"
TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | grep -o '[^"]*$')
echo -e "\n"

echo "4. Accessing Finance route WITH token..."
curl -s -i -H "Authorization: Bearer $TOKEN" "$GATEWAY_URL/api/finance/crypto"
echo -e "\n"

echo "5. Accessing News route WITH token..."
curl -s -i -H "Authorization: Bearer $TOKEN" "$GATEWAY_URL/api/news/sentiment"
echo -e "\n"

echo "6. Testing Rate Limiting (Sending 10 requests quickly to Finance)..."
for i in {1..10}
do
   echo -n "Request $i: "
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" "$GATEWAY_URL/api/finance/crypto"
done
