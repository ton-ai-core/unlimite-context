![image](https://github.com/user-attachments/assets/6f45ff6a-bff4-4608-a708-1fb1b0966fc1)

# @ton-ai-core/unlimite-context

Unlimited context: export and manage unlimited chat history from Cursor for any project.

## Features
- Export all chat history from Cursor for any project
- Unlimited context size: no artificial limits
- Saves each dialog as a separate file in `./cursor-composers`
- Supports auto-detection of Cursor database on Linux, macOS, Windows
- CLI and programmatic usage

## Installation

### Using npx (no install required)
```sh
npx @ton-ai-core/unlimite-context <project-identifier>
```

### Local install
```sh
npm install @ton-ai-core/unlimite-context
yarn add @ton-ai-core/unlimite-context
```

### Global install
```sh
npm install -g @ton-ai-core/unlimite-context
```

## Usage

```sh
unlimite-context <project-identifier> [options]
```

- `<project-identifier>` — Project identifier (directory name, part of path, or unique string)

### Options
- `-d, --db <path>` — Path to state.vscdb (default: auto-detect for Linux/macOS/Win)
- `--save-to-project <projectRoot>` — Save each dialog to a separate file in `.cursor-export-logs` inside the specified project (default: current directory)

### Example
```sh
unlimite-context my-project-id
unlimite-context my-project-id --db /path/to/state.vscdb
unlimite-context my-project-id --save-to-project /path/to/project
```

## Output
- All exported chats are saved in `./cursor-export-logs` (or the specified directory)
- Each chat is a separate file, with script/code files safely renamed (e.g. `.js` → `.jstxt`)
- The CLI prints the 5 newest chats and a summary of the rest

## Development
- `npm run build` — Compile TypeScript
- `npm test` — Run tests

## License
ISC

## Issues & Support
- [GitHub Issues](https://github.com/ton-ai-core/cursor-export/issues)
- PRs and feedback welcome! 
