#!/bin/bash

DEFAULT_MSG="Update project files"

if [ $# -eq 0 ]; then
    COMMIT_MSG="$DEFAULT_MSG"
else
    COMMIT_MSG="$*"
fi

echo "🌟 Staging all changes..."
git add .

echo "📝 Committing with message: '$COMMIT_MSG'"
git commit -m "$COMMIT_MSG"

if git remote | grep -q origin; then
    echo "🚀 Pushing to origin main..."
    git push origin main
else
    echo "⚠️ Remote 'origin' not set! Add your GitHub repo:"
    echo "git remote add origin https://github.com/vault9-repo/primepicks-link-tracker.git"
fi

echo "✅ Done!"
