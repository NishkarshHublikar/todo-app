#!/bin/sh
# Injects runtime environment variables into the frontend HTML before Nginx starts.
# This avoids baking secrets into the image at build time.

cat > /usr/share/nginx/html/env.js <<EOF
window.ENV_API_URL = "${API_URL:-}";
window.ENV_RAZORPAY_KEY = "${RAZORPAY_KEY_ID:-rzp_test_REPLACE_ME}";
EOF

echo "✅ env.js written"
exec nginx -g 'daemon off;'
