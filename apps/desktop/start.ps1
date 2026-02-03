# Quick Start Guide

Write-Host "🚀 Electron + TypeScript + Tailwind v4 Setup" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if node_modules exists
if (!(Test-Path "node_modules")) {
    Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
    npm install
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Dependencies installed successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✅ Dependencies already installed" -ForegroundColor Green
}

Write-Host ""
Write-Host "🎯 Starting development server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "The app will open with:" -ForegroundColor Cyan
Write-Host "  • Vite dev server with HMR" -ForegroundColor White
Write-Host "  • TypeScript compilation" -ForegroundColor White
Write-Host "  • Tailwind CSS v4 (CSS-first)" -ForegroundColor White
Write-Host "  • DevTools opened automatically" -ForegroundColor White
Write-Host ""

npm run dev
