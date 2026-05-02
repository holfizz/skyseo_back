#!/bin/bash

echo "🌱 Running improved seed with rich statistics..."
echo ""

# Запускаем улучшенный сидер
npx ts-node --transpile-only prisma/seed-improved.ts

echo ""
echo "✅ Done! You can now login with:"
echo "   Email: asd11@gmail.com"
echo "   Password: password123"
echo ""
echo "📊 Check the statistics in the app!"
