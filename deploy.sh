#!/bin/bash

set -e

echo "🚀 Starting deployment..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Load environment variables
if [ -f .env.production ]; then
    export $(cat .env.production | grep -v '^#' | xargs)
fi

# Pull latest code
echo -e "${YELLOW}📥 Pulling latest code...${NC}"
git pull origin main

# Stop existing containers
echo -e "${YELLOW}🛑 Stopping existing containers...${NC}"
docker-compose down

# Build and start containers
echo -e "${YELLOW}🔨 Building and starting containers...${NC}"
docker-compose up -d --build

# Wait for database to be ready
echo -e "${YELLOW}⏳ Waiting for database...${NC}"
sleep 10

# Run migrations
echo -e "${YELLOW}🔄 Running database migrations...${NC}"
docker-compose exec -T backend npx prisma migrate deploy

# Show logs
echo -e "${GREEN}✅ Deployment completed!${NC}"
echo -e "${YELLOW}📋 Showing logs (Ctrl+C to exit):${NC}"
docker-compose logs -f backend
