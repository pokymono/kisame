# Electron + TypeScript + Tailwind CSS v4

A modern Electron desktop application built with **TypeScript**, **Vite**, and **Tailwind CSS v4** using the new CSS-first approach.

## ✨ Features

- ⚡ **Electron** - Build cross-platform desktop apps
- 📘 **TypeScript** - Type-safe development
- 🎨 **Tailwind CSS v4** - Beautiful, modern styling with CSS-first approach
- ⚡ **Vite** - Lightning-fast build tool and dev server
- 🔒 **Secure** - Context isolation and preload scripts
- 🎯 **Modern Stack** - Latest tools and best practices

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

### Installation

1. **Install Dependencies**

```bash
npm install
```

### Development

Run the development server with hot reload:

```bash
npm run dev
```

This will:

- Start Vite dev server for the renderer process
- Compile TypeScript for main and preload processes
- Launch Electron with DevTools open
- Enable hot module replacement (HMR)

### Build

Build the application for production:

```bash
npm run build
```

### Preview

Preview the production build:

```bash
npm run preview
```

## 📁 Project Structure

```
desktop/
├── electron/              # Electron main process files
│   ├── main.ts           # Main process entry (TypeScript)
│   └── preload.ts        # Preload script for secure IPC
├── src/                  # Renderer process files
│   ├── main.ts           # Renderer entry point (TypeScript)
│   └── index.css         # Tailwind v4 CSS (CSS-first)
├── dist-electron/        # Compiled Electron files
├── dist/                 # Built renderer files
├── index.html            # Main HTML file
├── vite.config.ts        # Vite configuration
├── tsconfig.json         # TypeScript configuration
└── package.json          # Project dependencies

```

## 🎨 Tailwind CSS v4

This project uses **Tailwind CSS v4** with the new **CSS-first approach**:

- No separate `tailwind.config.js` needed for basic setups
- Import Tailwind directly in CSS: `@import "tailwindcss";`
- Integrated as a Vite PostCSS plugin
- JIT compilation by default
- Faster builds and better performance

## 🔧 Key Technologies

### Vite

- Ultra-fast dev server with HMR
- Optimized production builds
- Native ESM support
- TypeScript support out of the box

### Electron

- Cross-platform desktop apps (Windows, macOS, Linux)
- Native OS integration
- Secure architecture with process isolation

### TypeScript

- Type safety across main and renderer processes
- Better IDE support and autocomplete
- Catch errors at compile time

## 🛠️ Development Tips

### Opening DevTools

- **Windows/Linux**: `Ctrl + Shift + I`
- **macOS**: `Cmd + Option + I`

### Hot Module Replacement

Vite provides instant HMR for the renderer process. Changes to your UI will reflect immediately without restarting the app.

### Debugging

The app automatically opens DevTools in development mode. You can:

- Inspect the DOM and styles
- Debug JavaScript/TypeScript
- Monitor network requests
- View console logs

## 📦 Building for Production

To create distributable packages:

```bash
npm run electron:build
```

This will create platform-specific installers in the `dist` folder.

## 🎯 Next Steps

- [ ] Add more features and components
- [ ] Implement IPC communication between main and renderer
- [ ] Add state management (if needed)
- [ ] Configure electron-builder for distribution
- [ ] Add auto-updates functionality
- [ ] Implement native menus and tray icons

## 📚 Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [Vite Documentation](https://vitejs.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs)
- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)
- [vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron)

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 📄 License

MIT
