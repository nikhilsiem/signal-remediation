#!/usr/bin/env bash
# Idempotent. Needs: gcloud auth login, project with billing attached. Optional: FIXPROOF_API_URL, DATABASE_URL, BILLING_ACCOUNT.
set -euo pipefail
cd "$(dirname "$0")"; . ./lib.sh
CREATED=()
note() { CREATED+=("$1"); }

echo "1. APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com logging.googleapis.com monitoring.googleapis.com \
  pubsub.googleapis.com iam.googleapis.com secretmanager.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com $G
note "APIs enabled"

echo "2. Artifact Registry"
gcloud artifacts repositories describe $REPO --location=$REGION $G >/dev/null 2>&1 || \
  gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION $G
note "artifact repo $REPO"

echo "3. Service accounts"
for a in zoo-runtime zoo-pubsub-push fixproof-reader fixproof-actor; do
  gcloud iam service-accounts describe "$(sa $a)" $G >/dev/null 2>&1 || gcloud iam service-accounts create $a --display-name=$a $G
done
bind() { gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$(sa $1)" --role="$2" --condition=None --quiet >/dev/null; }
for r in roles/logging.viewer roles/monitoring.viewer roles/run.viewer; do bind fixproof-reader $r; done
bind fixproof-actor roles/run.developer
gcloud iam service-accounts add-iam-policy-binding "$(sa zoo-runtime)" --member="serviceAccount:$(sa fixproof-actor)" \
  --role=roles/iam.serviceAccountUser $G --quiet >/dev/null
note "service accounts zoo-runtime zoo-pubsub-push fixproof-reader fixproof-actor"

echo "4. Secrets"
mk_secret() { # name, value
  if ! gcloud secrets describe "$1" $G >/dev/null 2>&1; then
    printf %s "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic $G; note "secret $1"
  fi
  gcloud secrets add-iam-policy-binding "$1" --member="serviceAccount:$(sa zoo-runtime)" --role=roles/secretmanager.secretAccessor $G --quiet >/dev/null
}
mk_secret ZOO_ADMIN_TOKEN "$(openssl rand -hex 32)"
mk_secret CACHE_INVALIDATE_TOKEN "$(openssl rand -hex 32)"
if [ -n "${DATABASE_URL:-}" ]; then mk_secret DATABASE_URL "$DATABASE_URL"
elif ! gcloud secrets describe DATABASE_URL $G >/dev/null 2>&1; then echo "  DATABASE_URL not set and no secret exists: re-run with DATABASE_URL=... (Neon connection string)"; fi

echo "5. Alerts"
NUM="$(PROJECT_NUMBER)"
gcloud pubsub topics describe $TOPIC $G >/dev/null 2>&1 || gcloud pubsub topics create $TOPIC $G
note "topic $TOPIC"
FILTER='resource.type="cloud_run_revision" AND resource.labels.service_name="zoo-shop" AND severity>=ERROR'
if gcloud logging sinks describe zoo-errors $G >/dev/null 2>&1; then
  gcloud logging sinks update zoo-errors "pubsub.googleapis.com/projects/$PROJECT/topics/$TOPIC" --log-filter="$FILTER" $G >/dev/null
else
  gcloud logging sinks create zoo-errors "pubsub.googleapis.com/projects/$PROJECT/topics/$TOPIC" --log-filter="$FILTER" $G
fi
WRITER="$(gcloud logging sinks describe zoo-errors --format='value(writerIdentity)' $G)"
gcloud pubsub topics add-iam-policy-binding $TOPIC --member="$WRITER" --role=roles/pubsub.publisher $G --quiet >/dev/null
gcloud pubsub topics add-iam-policy-binding $TOPIC --member="serviceAccount:service-$NUM@gcp-sa-monitoring-notification.iam.gserviceaccount.com" \
  --role=roles/pubsub.publisher $G --quiet >/dev/null
note "log sink zoo-errors"

if [ -n "${FIXPROOF_API_URL:-}" ]; then
  ENDPOINT="${FIXPROOF_API_URL%/}/webhooks/gcp"
  gcloud iam service-accounts add-iam-policy-binding "$(sa zoo-pubsub-push)" \
    --member="serviceAccount:service-$NUM@gcp-sa-pubsub.iam.gserviceaccount.com" --role=roles/iam.serviceAccountTokenCreator $G --quiet >/dev/null
  ARGS=(--topic=$TOPIC --push-endpoint="$ENDPOINT" --push-auth-service-account="$(sa zoo-pubsub-push)" --push-auth-token-audience="$ENDPOINT" $G)
  if gcloud pubsub subscriptions describe zoo-alerts-push $G >/dev/null 2>&1; then gcloud pubsub subscriptions update zoo-alerts-push "${ARGS[@]:1}"
  else gcloud pubsub subscriptions create zoo-alerts-push "${ARGS[@]}"; fi
  note "push subscription -> $ENDPOINT"
else
  echo "  FIXPROOF_API_URL not set: skipping the push subscription. Set it and re-run."
fi

CH="$(gcloud beta monitoring channels list --filter='displayName="zoo-alerts"' --format='value(name)' $G | head -1)"
if [ -z "$CH" ]; then
  CH="$(gcloud beta monitoring channels create --display-name=zoo-alerts --type=pubsub --channel-labels=topic="projects/$PROJECT/topics/$TOPIC" --format='value(name)' $G)"
fi
if [ -z "$(gcloud alpha monitoring policies list --filter='displayName="zoo-shop 5xx ratio"' --format='value(name)' $G)" ]; then
  sed "s|__CHANNEL__|$CH|" alert-policy.json > /tmp/zoo-policy.json
  gcloud alpha monitoring policies create --policy-from-file=/tmp/zoo-policy.json $G
  note "alert policy zoo-shop 5xx ratio"
fi

echo "6. Budget"
BILLING="${BILLING_ACCOUNT:-$(gcloud billing projects describe $PROJECT --format='value(billingAccountName)' | sed 's|billingAccounts/||')}"
if [ -n "$BILLING" ] && [ -z "$(gcloud billing budgets list --billing-account="$BILLING" --filter='displayName="zoo-budget"' --format='value(name)')" ]; then
  gcloud billing budgets create --billing-account="$BILLING" --display-name=zoo-budget --budget-amount=1USD \
    --filter-projects="projects/$PROJECT" --threshold-rule=percent=0.5 --threshold-rule=percent=1.0
  note "budget \$1 with alerts at 50% and 100%"
else echo "  budget exists or no billing account found"; fi

echo "7. Key files for Fixproof"
mkdir -p ../.keys
[ -f ../.keys/fixproof-reader.json ] || gcloud iam service-accounts keys create ../.keys/fixproof-reader.json --iam-account="$(sa fixproof-reader)" $G
[ -f ../.keys/fixproof-actor.json ] || gcloud iam service-accounts keys create ../.keys/fixproof-actor.json --iam-account="$(sa fixproof-actor)" $G
echo "  .keys/fixproof-reader.json -> GCP_READ_CREDENTIALS_FILE"
echo "  .keys/fixproof-actor.json  -> GCP_ACTION_CREDENTIALS_FILE"
echo "  token values: gcloud secrets versions access latest --secret=CACHE_INVALIDATE_TOKEN $G  (-> Fixproof CACHE_INVALIDATE_TOKEN)"
echo; echo "Summary:"; printf '  - %s\n' "${CREATED[@]:-nothing new (already set up)}"
