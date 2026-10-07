#!/bin/bash
set -e

BASE=http://localhost:4000/api

# 1. Public products list
CODE=$(curl -s -o /dev/null -w "%{http_code}\n" $BASE/products)
if [ "$CODE" -ne 200 ]; then echo "Failed check 1 with status $CODE"; exit 1; fi

# 2. Public single product
CODE=$(curl -s -o /dev/null -w "%{http_code}\n" $BASE/products/classic-pipe-tobacco-blend)
if [ "$CODE" -ne 200 ]; then echo "Failed check 2 with status $CODE"; exit 1; fi

# 3. Public content
CODE=$(curl -s -o /dev/null -w "%{http_code}\n" $BASE/content)
if [ "$CODE" -ne 200 ]; then echo "Failed check 3 with status $CODE"; exit 1; fi

# 4. Login with valid seeded credentials
LOGIN_RES=$(curl -s -c cookies.txt -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@smoketimestore.co.za","password":"password123"}')

TOKEN=$(printf '%s' "$LOGIN_RES" | node -e 'try { const data = JSON.parse(require("node:fs").readFileSync(0, "utf8")); process.stdout.write(data.data?.accessToken || ""); } catch { console.error("Unable to read login response."); process.exit(1); }')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "undefined" ]; then
  echo "Login failed: no access token returned."
  exit 1
fi

# Also login retail user
RETAIL_RES=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"thabo@example.co.za","password":"password123"}')
RETAIL_TOKEN=$(printf '%s' "$RETAIL_RES" | node -e 'try { const data = JSON.parse(require("node:fs").readFileSync(0, "utf8")); process.stdout.write(data.data?.accessToken || ""); } catch { console.error("Unable to read login response."); process.exit(1); }')

# 5. Login with wrong password
CODE=$(curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@smoketimestore.co.za","password":"wrong"}')
if [ "$CODE" -ne 401 ]; then echo "Failed check 5 with status $CODE"; exit 1; fi

# 6. Orders without auth
CODE=$(curl -s -o /dev/null -w "%{http_code}\n" $BASE/orders)
if [ "$CODE" -ne 401 ]; then echo "Failed check 6 with status $CODE"; exit 1; fi

# 7. Refresh using saved cookie
CODE=$(curl -s -o /dev/null -w "%{http_code}\n" -b cookies.txt -X POST $BASE/auth/refresh)
if [ "$CODE" -ne 200 ]; then echo "Failed check 7 with status $CODE"; exit 1; fi

# 8. Cart validate
CODE=$(curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/cart/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"items":[{"productId":"1","qty":10}]}')
if [ "$CODE" -ne 200 ]; then echo "Failed check 8 with status $CODE"; exit 1; fi

# 9. Non-admin hitting admin route
CODE=$(curl -s -o /dev/null -w "%{http_code}\n" $BASE/wholesale/applications \
  -H "Authorization: Bearer $RETAIL_TOKEN")
if [ "$CODE" -ne 403 ]; then echo "Failed check 9 with status $CODE"; exit 1; fi

# 10. Order with tampered total
CODE=$(curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"items":[{"productId":"1","qty":1}],"total":0.01}')
if [ "$CODE" -ne 409 ]; then echo "Failed check 10 with status $CODE"; exit 1; fi

rm -f cookies.txt
echo "Smoke tests passed: 10 checks."
