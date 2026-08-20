#!/usr/bin/env bash
# Allow the SPA origin to PUT media straight into the bucket.
#
# Uploads bypass the backend: CreateMediaUpload hands the browser a presigned
# URL and the browser PUTs to S3_ENDPOINT. That is cross-origin, so without a
# bucket CORS rule the preflight comes back with no Access-Control-Allow-Origin
# and the upload fails before a single byte moves. Idempotent — re-run freely.
#
#   ./scripts/setup-s3-cors.sh                       # origins from CORS_ORIGINS
#   ORIGINS=http://localhost:3001 ./scripts/setup-s3-cors.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
BUCKET="${S3_BUCKET:-tasks-media}"
ACCESS="${S3_ACCESS_KEY:-minioadmin}"
SECRET="${S3_SECRET_KEY:-minioadmin}"
REGION="${S3_REGION:-us-east-1}"
ORIGINS="${ORIGINS:-${CORS_ORIGINS:-http://localhost:3001}}"

rules=""
IFS=',' read -ra list <<< "$ORIGINS"
for o in "${list[@]}"; do
  o="$(echo "$o" | xargs)"
  [ -z "$o" ] && continue
  rules+="<AllowedOrigin>$o</AllowedOrigin>"
done

body="<CORSConfiguration><CORSRule>${rules}\
<AllowedMethod>PUT</AllowedMethod><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>\
<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3000</MaxAgeSeconds>\
</CORSRule></CORSConfiguration>"

echo "Applying CORS to ${ENDPOINT}/${BUCKET} for: ${ORIGINS}"
curl -sf --aws-sigv4 "aws:amz:${REGION}:s3" -u "${ACCESS}:${SECRET}" \
  -X PUT --data-binary "$body" "${ENDPOINT}/${BUCKET}/?cors" >/dev/null
echo "Done. Current config:"
curl -s --aws-sigv4 "aws:amz:${REGION}:s3" -u "${ACCESS}:${SECRET}" "${ENDPOINT}/${BUCKET}/?cors"
echo
