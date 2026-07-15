#!/bin/bash
set -e

sleep 2

# Use password from mounted secret in the container
MONGOT_PASSWORD="$(cat /run/secrets/mongot_password)"

mongosh --eval "
const adminDb = db.getSiblingDB('admin');
try {
  adminDb.createUser({
    user: 'mongotUser',
    // Note: This is harmless because the containers are ephemeral (limited to test runs)
    // and we don't store any data in these underlying containers
    pwd: '${MONGOT_PASSWORD}',
    roles: [{ role: 'searchCoordinator', db: 'admin' }]
  });
} catch (error) {
  if (error.code !== 11000) {
    throw error;
  }
}
"
