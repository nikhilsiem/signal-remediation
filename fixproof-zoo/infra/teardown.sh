#!/usr/bin/env bash
# Deletes everything the zoo created, except the project, secrets and service accounts (re-run setup-gcp.sh to rebuild).
set -uo pipefail
cd "$(dirname "$0")"; . ./lib.sh
for s in zoo-shop zoo-upstream; do gcloud run services delete $s --region=$REGION --quiet $G; done
gcloud artifacts repositories delete $REPO --location=$REGION --quiet $G
gcloud pubsub subscriptions delete zoo-alerts-push --quiet $G
gcloud pubsub topics delete $TOPIC --quiet $G
gcloud logging sinks delete zoo-errors --quiet $G
for p in $(gcloud alpha monitoring policies list --filter='displayName="zoo-shop 5xx ratio"' --format='value(name)' $G); do
  gcloud alpha monitoring policies delete "$p" --quiet $G; done
echo "teardown finished"
