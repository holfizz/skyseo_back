#!/bin/bash

# Setup cron for automatic backups

CRON_JOB="0 2 * * * cd $(pwd) && docker-compose exec -T backup /backup.sh >> $(pwd)/logs/backup.log 2>&1"

# Add to crontab if not exists
(crontab -l 2>/dev/null | grep -v "/backup.sh"; echo "$CRON_JOB") | crontab -

echo "✅ Cron job added: Daily backup at 2:00 AM"
echo "📋 Current crontab:"
crontab -l
