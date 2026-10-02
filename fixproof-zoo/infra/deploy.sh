#!/usr/bin/env bash
# Idempotent. Needs: docker, gcloud auth, setup-gcp.sh already run. Optional: FAIL_RATE, LATENCY_MS, BUILD_STAMP, SENTRY_DSN, OTLP_*.
set -euo pipefail
cd "$(dirname "$0")"; . ./lib.sh
TAG="$(date +%Y%m%d%H%M%S)"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet >/dev/null
docker build -t "$IMAGE_BASE:$TAG" ../app
docker push "$IMAGE_BASE:$TAG"

COMMON=(--image="$IMAGE_BASE:$TAG" --region=$REGION --service-account="$(sa zoo-runtime)" --min-instances=0 --max-instances=1
  --cpu=1 --memory=256Mi --timeout=35 --allow-unauthenticated --port=8080 $G)
SECRETS="ZOO_ADMIN_TOKEN=ZOO_ADMIN_TOKEN:latest,DATABASE_URL=DATABASE_URL:latest"
OPT=""; for v in SENTRY_DSN OTLP_1_ENDPOINT OTLP_1_HEADERS OTLP_2_ENDPOINT OTLP_2_HEADERS; do
  [ -n "${!v:-}" ] && OPT="${OPT:+$OPT|}$v=${!v}"; done
if [ -n "$OPT" ]; then
  gcloud run services update zoo-shop --region=$REGION $G --update-env-vars="^|^$OPT"
fi

# keep only the 2 newest images
gcloud artifacts docker images list "$IMAGE_BASE" --include-tags --sort-by=~CREATE_TIME --format='value(version)' $G \
  | tail -n +3 | while read -r d; do gcloud artifacts docker images delete "$IMAGE_BASE@$d" --delete-tags --quiet $G || true; done

echo; echo "zoo-upstream: $UP_URL"
echo "zoo-shop:     $(gcloud run services describe zoo-shop --region=$REGION --format='value(status.url)' $G)"
echo "export ZOO_SHOP_URL=<zoo-shop url>  ZOO_ADMIN_TOKEN=\$(gcloud secrets versions access latest --secret=ZOO_ADMIN_TOKEN $G)"
