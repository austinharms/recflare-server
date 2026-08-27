#!/usr/bin/env bash
set -e

pushd apps/mono > /dev/null

# Setup JWT_SECRET for workers, ignoring errors as that may mean the secret was already created
pnpm wrangler secrets-store secret create local --name JWT_SECRET --scopes workers --value "$(openssl rand -base64 32)" || true

popd > /dev/null

# Apply migrations to local instance, must be run sequentially as wrangler locks the database file
pnpm -r --filter=\!www run --sequential migrate --local

# Start the mono, econ and img workers in parallel
# due to using wrangler dev scheduled items don't run, curl the schedule endpoint periodically to run the scheduled items
exec concurrently --kill-others-on-fail \
    'pnpm --filter mono run dev' \
    'pnpm --filter econ run dev' \
    'pnpm --filter img run dev' \
    'sleep 30; while true; do curl --silent "http://localhost:8805/cdn-cgi/handler/scheduled"; sleep 300; done'
