#!/bin/sh

# Backup script with encryption
BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/skyseo_backup_$TIMESTAMP.sql"
ENCRYPTED_FILE="$BACKUP_FILE.gpg"

# Create backup directory if not exists
mkdir -p $BACKUP_DIR

# Create backup
echo "Creating backup: $BACKUP_FILE"
PGPASSWORD=$POSTGRES_PASSWORD pg_dump -h postgres -U $POSTGRES_USER -d $POSTGRES_DB > $BACKUP_FILE

# Encrypt backup
echo "Encrypting backup..."
echo "$BACKUP_PASSWORD" | gpg --batch --yes --passphrase-fd 0 --symmetric --cipher-algo AES256 -o $ENCRYPTED_FILE $BACKUP_FILE

# Remove unencrypted backup
rm $BACKUP_FILE

# Keep only last 30 backups
echo "Cleaning old backups..."
ls -t $BACKUP_DIR/*.gpg | tail -n +31 | xargs -r rm

echo "Backup completed: $ENCRYPTED_FILE"

# Add to crontab (run daily at 2 AM)
# 0 2 * * * /backup.sh >> /var/log/backup.log 2>&1
