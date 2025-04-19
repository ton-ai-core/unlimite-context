#!/usr/bin/env node
import { Command } from 'commander';
import { extractAndSaveCursorChatLogs } from '../lib/logExtractor';

const program = new Command();

program
  .name('unlimite-context')
  .description('Extracts Cursor chat history for the specified project')
  .argument('<project-identifier>', 'Project identifier (directory name, part of path, or unique string)')
  .option('-d, --db <path>', 'Path to state.vscdb (default: auto-detect for Linux/macOS/Win)')
  .option('--save-to-project <projectRoot>', 'Save each dialog to a separate file in .cursor-export-logs inside the specified project')
  .action(async (projectIdentifier: string, options: { db?: string, saveToProject?: string }) => {
    try {
      const saveDir = (options.saveToProject ? options.saveToProject : process.cwd()) + "/cursor-composers";
      const paths = await extractAndSaveCursorChatLogs(projectIdentifier, saveDir, options.db);
      if (paths.length === 0) {
        process.stdout.write('No chats found for project ' + projectIdentifier + '.\n');
      } else {
        const fs = await import('fs/promises');
        const filesWithStats = await Promise.all(paths.map(async p => ({
          path: p,
          mtime: (await fs.stat(p)).mtimeMs
        })));
        filesWithStats.sort((a, b) => b.mtime - a.mtime);
        const top5 = filesWithStats.slice(0, 5);
        const restCount = filesWithStats.length - top5.length;
        process.stdout.write('Newest chats saved:\n' + top5.map(f => f.path).join('\n') + '\n');
        if (restCount > 0) {
          process.stdout.write(`...and ${restCount} more chats.\n`);
        }
        process.stdout.write('All chats are in ./cursor-export-logs\n');
        process.stdout.write('To view older chat history, open files from this folder.\n');
      }
    } catch (e: any) {
      process.stderr.write((e?.message || String(e)) + '\n');
      process.exit(1);
    }
  });

program.parse(process.argv); 