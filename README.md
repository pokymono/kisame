# Kisame

**Kisame is an AI-assisted network forensics tool that helps analysts reconstruct, explore, and explain network activity from PCAP files using session reconstruction, timelines, and evidence-anchored conversational analysis.**

## System Context & Philosophy

For a complete understanding of Kisame's philosophy, architecture, and behavior, please read [SYSTEM_CONTEXT.md](./SYSTEM_CONTEXT.md).

> "Kisame feels like using Cursor, but instead of explaining code, it helps you reason about network traffic — calmly, transparently, and with evidence."

## Project Structure

```
kisame/
├── apps/
│   ├── desktop/          # Electron desktop application
│   └── website/          # Web application
├── services/             # Backend services
└── README.md            # This file
```

## Applications

### Desktop App (`apps/desktop`)

A cross-platform desktop application built with:

- **Electron** - Native desktop app framework
- **TypeScript** - Type-safe development
- **Vite** - Lightning-fast build tool
- **Tailwind CSS v4** - Modern CSS framework

#### Quick Start

```bash
cd apps/desktop
npm install
npm run dev
```

#### Features

- Fast development with Vite HMR
- Full TypeScript support
- Tailwind CSS v4 with CSS-first approach
- Secure architecture with context isolation
- Cross-platform (Windows, macOS, Linux)

#### Available Commands

| Command           | Description              |
| ----------------- | ------------------------ |
| `npm run dev`     | Start development server |
| `npm run build`   | Build for production     |
| `npm run preview` | Preview production build |

### Website (`apps/website`)

_Coming soon_

## Technology Stack

### Desktop

- **Runtime**: Electron 33
- **Language**: TypeScript 5.6
- **Build Tool**: Vite 6
- **Styling**: Tailwind CSS 4.0
- **Package Manager**: npm

### Development Tools

- **Version Control**: Git
- **IDE**: VS Code (recommended)
- **Node.js**: 20.17.0+

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v20.17.0 or higher)
- **npm** (v10.0.0 or higher)
- **Git**

## Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd kisame
```

### 2. Choose Your Application

#### Desktop App

```bash
cd apps/desktop
npm install
npm run dev
```

#### Website

```bash
cd apps/website
# Instructions coming soon
```

## Project Setup

### Desktop Application

The desktop app uses a modern Electron setup with:

1. **Main Process** (`electron/main.ts`)
   - Application lifecycle management
   - Window creation and management
   - Native OS integration

2. **Renderer Process** (`src/main.ts`)
   - UI rendering with TypeScript
   - Tailwind CSS for styling
   - Hot module replacement

3. **Preload Script** (`electron/preload.ts`)
   - Secure IPC communication
   - Context bridge for safe API exposure

### Configuration Files

- `vite.config.ts` - Vite and plugin configuration
- `tsconfig.json` - TypeScript compiler options
- `package.json` - Dependencies and scripts

## Development

### Code Structure

```
apps/desktop/
├── electron/              # Main process
│   ├── main.ts           # Entry point
│   └── preload.ts        # IPC bridge
├── src/                  # Renderer process
│   ├── main.ts           # UI entry
│   └── index.css         # Styles
├── .vscode/              # VS Code config
├── index.html            # HTML template
└── vite.config.ts        # Build config
```

### Development Workflow

1. **Start Development**

   ```bash
   npm run dev
   ```

2. **Make Changes**
   - Edit files in `src/` for UI changes
   - Edit `electron/` for main process changes
   - Changes auto-reload with HMR

3. **Build for Production**
   ```bash
   npm run build
   ```

## Troubleshooting

### Desktop App Won't Start

**Issue**: "Vite requires Node.js version X.X+"

**Solution**: Ensure you're using Node.js 20.17.0 or higher

```bash
node --version
```

**Issue**: Module not found errors

**Solution**: Clean install dependencies

```bash
cd apps/desktop
rm -rf node_modules package-lock.json
npm install
```

### TypeScript Errors

**Issue**: Type errors in VS Code

**Solution**: Restart TypeScript server

- Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
- Type "TypeScript: Restart TS Server"

### Build Errors

**Issue**: Build fails with PostCSS errors

**Solution**: Ensure `@tailwindcss/postcss` is installed

```bash
npm install @tailwindcss/postcss --save-dev
```

## Documentation

- **Desktop App**: See `apps/desktop/README.md` for detailed documentation
- **Setup Guide**: See `apps/desktop/SETUP.md` for setup instructions
- **Quick Start**: See `apps/desktop/HOW_TO_RUN.md` for running the app

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT

## Resources

### Electron Desktop App

- [Electron Documentation](https://www.electronjs.org/docs)
- [Vite Documentation](https://vitejs.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/)
- [Tailwind CSS v4](https://tailwindcss.com/docs)

### Tools

- [VS Code](https://code.visualstudio.com/)
- [Node.js](https://nodejs.org/)
- [Git](https://git-scm.com/)

## Support

For issues and questions:

- Check the troubleshooting section above
- Review application-specific README files
- Check existing issues in the repository

---

Built with modern web technologies
