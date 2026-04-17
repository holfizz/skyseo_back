#!/bin/sh

# Restore script
if [ -z "$1" ]; then
    echo "Usage: ./restore.sh <encrypted_backup_file.gpg>"
    exit 1
fi

ENCRYPTED_FILE=$1
DECRYPTED_FILE="${ENCRYPTED_FILE%.gpg}"

# Decrypt backup
echo "Decrypting backup..."
echo "$BACKUP_PASSWORD" | gpg --batch --yes --passphrase-fd 0 --decrypt -o $DECRYPTED_FILE $ENCRYPTED_FILE

# Restore database
echo "Restoring database..."
PGPASSWORD=$POSTGRES_PASSWORD psql -h postgres -U $POSTGRES_USER -d $POSTGRES_DB < $DECRYPTED_FILE

# Remove decrypted file
rm $DECRYPTED_FILE

echo "Restore completed!"
