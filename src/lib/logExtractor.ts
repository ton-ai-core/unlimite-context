import Database from 'better-sqlite3';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

// --- Interfaces ---

interface ToolCallInfo {
    toolCallId?: string;
    // Additional fields might exist depending on the capability
}

interface CapabilityRun {
    [capabilityName: string]: ToolCallInfo[];
}

interface BubbleUri {
    $mid?: number;
    fsPath?: string;
    external?: string; // Often used as a key in codeBlockData
    path?: string;
    scheme?: string;
}

interface CodeBlockMeta {
    uri?: BubbleUri;
    version?: number;
    languageId?: string;
    content?: string; // Rarely used here, content is usually in codeBlockData
    codeBlockIdx?: number; // Important for matching
}

interface LinterError {
    message?: string;
    range?: any; // Define more specifically if needed
    severity?: number;
    source?: string;
    // other potential fields
}

interface MultiFileLinterError {
    relativeWorkspacePath?: string;
    errors?: LinterError[];
    fileContents?: string; // Sometimes present
}

interface Bubble {
  _v: number;
  type: 1 | 2; // 1 = User, 2 = AI/System
  bubbleId: string;
  text?: string;
  richText?: string; // Can be parsed if needed for richer formatting
  capabilitiesRan?: CapabilityRun;
  cachedConversationSummary?: {
    summary?: string;
    includesToolResults?: boolean;
  };
  codeBlocks?: CodeBlockMeta[];
  multiFileLinterErrors?: MultiFileLinterError[];
  isThought?: boolean;
  isCapabilityIteration?: boolean;
  relevantFiles?: string[];
  attachedFileCodeChunksUris?: Array<{ path?: string }>;
  currentFileLocationData?: { relativeWorkspacePath?: string };
  // other potential fields
}

interface ToolCallData {
    tool?: number; // Tool ID (not always the name)
    toolCallId: string;
    status: string; // e.g., "completed", "error"
    rawArgs?: string; // Arguments as JSON string
    params?: string; // Alternative field for arguments
    name?: string; // Tool name (preferred)
    result?: string; // Result as JSON string or simple string
    output?: string; // Output, e.g., for terminal commands
    error?: string; // Error message
    additionalData?: { // Extra context
         version?: number;
         instructions?: string;
         explanation?: string;
         startingLints?: any[];
         sessionId?: string;
         // ... and others
     };
    // other tool-specific fields might exist
}

interface CodeBlockDetails {
    uri: BubbleUri; // URI here might be the key in codeBlockData
    version: number;
    content: string; // The actual code content
    languageId: string;
    status: string; // e.g., "accepted"
    codeBlockDisplayPreference?: string;
    codeBlockIdx?: number; // Important for matching, but might be missing in older logs
}

export interface FullConversationLog {
    composerId: string;
    richText: string; // Root rich text
    hasLoaded: boolean;
    text: string; // Root text
    conversation: Bubble[];
    status: string;
    context: any; // Usually complex, skip deep parsing for now
    gitGraphFileSuggestions?: any[]; // Optional fields
    generatingBubbleIds?: any[];
    isReadingLongFile?: boolean;
    codeBlockData?: Record<string, CodeBlockDetails[]>; // Code content map
    originalModelLines?: any;
    newlyCreatedFiles?: any[];
    newlyCreatedFolders?: any[];
    lastUpdatedAt: number;
    createdAt: number;
    hasChangedContext?: boolean;
    capabilities?: any[];
    name?: string;
    usageData?: any;
    latestConversationSummary?: any;
    lastBubbleId?: string;
    bubbleDataMap?: Record<string, ToolCallData>; // Tool call details map
    // other potential root fields
}


// --- Database and Utility Functions ---

function getDefaultDbPath(): string {
    const platform = os.platform();
    const homeDir = os.homedir();
    let dbPath = '';

    switch (platform) {
        case 'win32':
            if (!process.env.APPDATA) throw new Error('APPDATA environment variable not found.');
            dbPath = path.join(process.env.APPDATA, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
            if (!fs.existsSync(dbPath)) {
                const devPath = path.join(process.env.APPDATA, 'cursor-dev', 'User', 'globalStorage', 'state.vscdb');
                if (fs.existsSync(devPath)) { dbPath = devPath; }
            }
            break;
        case 'darwin':
             dbPath = path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
             if (!fs.existsSync(dbPath)) {
                 const devPath = path.join(homeDir, 'Library', 'Application Support', 'cursor-dev', 'User', 'globalStorage', 'state.vscdb');
                 if (fs.existsSync(devPath)) { dbPath = devPath; }
             }
            break;
        default: // linux
            const standardPath = path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
             if (fs.existsSync(standardPath)) { dbPath = standardPath; }
             else {
                 const devPath = path.join(homeDir, '.config', 'cursor-dev', 'User', 'globalStorage', 'state.vscdb');
                 if (fs.existsSync(devPath)) { dbPath = devPath; }
                 else { dbPath = standardPath; } // Default back if none found
             }
            break;
    }
    if (!dbPath) { throw new Error('Could not determine default Cursor DB path.'); }
    return dbPath;
}

function resolveDbPath(dbPath?: string): string {
    const targetPath = dbPath || getDefaultDbPath();
    try {
        if (!fs.existsSync(targetPath)) {
             if (!dbPath) throw new Error(`Default DB path not found: ${targetPath}`);
             else throw new Error(`Specified DB path not found: ${targetPath}`);
        }
        // Ensure path is absolute before returning
        return path.resolve(fs.realpathSync(targetPath));
    } catch (err: any) {
        throw new Error(`Error resolving DB path (${targetPath}): ${err.message}`);
    }
}

function safeJsonParse<T>(str: string | Buffer, keyHint?: string): T | undefined {
  try {
    const data = typeof str === 'string' ? str : str.toString('utf8');
    if (!data) return undefined; // Handle empty string/buffer
    return JSON.parse(data);
  } catch (e: any) {
    console.error(`Error parsing JSON for key ${keyHint || 'unknown'} (first 200 chars): ${typeof str === 'string' ? str.slice(0, 200) : '<Buffer>'}... Error: ${e.message}`);
    return undefined;
  }
}

function sanitizeFilename(name: string): string {
    // Remove potential directory traversal and invalid chars
    const baseName = path.basename(name);
    return baseName.replace(/[^\p{L}0-9_\-\. ]+/gu, '_').slice(0, 100); // Allow all Unicode letters, limit length
}

function remapScriptExtension(ext: string): string {
    const allowed = ['.log', '.txt', '.md', '.csv'];
    if (!ext) return ext;
    if (allowed.includes(ext.toLowerCase())) return ext;
    return ext + 'txt';
}

// --- Formatting Functions ---

interface FormattedLine {
    type: 'text' | 'tool_ref' | 'code_ref' | 'linter_error' | 'capability_info' | 'tool_inline' | 'code_inline' | 'code_not_found' | 'summary';
    content: string;
    details?: { filePath: string; data: string; };
}

function formatUserMessageV2(msg: Bubble, index: number): FormattedLine[] {
    const text = msg.text || (msg.richText ? "(Formatted Text - see details if needed)" : "<empty message>");
    return [{ type: 'text', content: `[${index}] User: ${text.trim()}` }];
}

async function formatAiMessageV2(
    msg: Bubble,
    index: number,
    bubbleDataMap: Record<string, ToolCallData> | undefined,
    codeBlockData: Record<string, CodeBlockDetails[]> | undefined,
    chatSubDir: string,
    chatSubDirBaseName: string
): Promise<FormattedLine[]> {
    let lines: FormattedLine[] = [];
    const basePrefix = `[${index}] AI:`;
    const toolPrefix = `    [TOOL CALL]`;
    const codePrefix = `    [CODE BLOCK]`;
    const errorPrefix = `    [Linter Errors Found]:`;
    const summaryPrefix = `    [Summary]:`;
    const detailThreshold = 300; // Characters threshold for inline vs file

    // 1. Basic AI Text
    if (msg.text && msg.text.trim()) {
        lines.push({ type: 'text', content: `${basePrefix} ${msg.text.trim()}` });
    }
    let contentAdded = !!(msg.text && msg.text.trim());

    // 2. Cached Summary
    if (msg.cachedConversationSummary?.summary) {
        if (!contentAdded && lines.length === 0) lines.push({ type: 'text', content: basePrefix });
        contentAdded = true;
        lines.push({ type: 'summary', content: `${summaryPrefix}` });
        const summaryLines = msg.cachedConversationSummary.summary.split('\n').map(l => l.trim()).filter(Boolean);
        summaryLines.forEach(line => {
            lines.push({ type: 'summary', content: `      ${line}` });
        });
    }

    // 3. Tool Calls (using bubbleDataMap)
    if (msg.capabilitiesRan && bubbleDataMap) {
        for (const capabilityType in msg.capabilitiesRan) {
            const calls: ToolCallInfo[] | undefined = msg.capabilitiesRan[capabilityType];
            if (Array.isArray(calls)) {
                for (const callInfo of calls) {
                    const toolCallId = callInfo?.toolCallId;
                    if (toolCallId && bubbleDataMap[toolCallId]) {
                        const toolData = bubbleDataMap[toolCallId];
                        const toolName = toolData.name || `ToolID_${toolData.tool}` || 'unknown tool';
                        const detailDataString = JSON.stringify(toolData, null, 2);
                        const detailDataLength = detailDataString.length;

                        if (!contentAdded && lines.length === 0) lines.push({ type: 'text', content: basePrefix });
                        contentAdded = true;

                        if (detailDataLength < detailThreshold) {
                            lines.push({ type: 'tool_inline', content: `${toolPrefix} Name: ${toolName} (ID: ${toolCallId}) [INLINE DETAILS]` });
                             try {
                                const argsSource = toolData.params || toolData.rawArgs;
                                const args = argsSource ? safeJsonParse<any>(argsSource, `tool args ${toolCallId}`) || { raw: argsSource } : {}; // Parse safely
                                const result = toolData.result || toolData.output;
                                const instructions = toolData.additionalData?.instructions || args?.instructions;
                                const explanation = toolData.additionalData?.explanation || args?.explanation;

                                // Conditionally add lines only if data exists
                                if (args && Object.keys(args).length > 0 && argsSource !== '{}') {
                                     let argsSummary = '';
                                     if (args.command) argsSummary += `Cmd: ${args.command.substring(0,50)}${args.command.length > 50 ? '...' : ''}; `;
                                     if (args.target_file) argsSummary += `File: ${args.target_file}; `;
                                     if (args.relativeWorkspacePath) argsSummary += `File: ${args.relativeWorkspacePath}; `;
                                     if (args.directoryPath) argsSummary += `Dir: ${args.directoryPath}; `;
                                     if (args.query) argsSummary += `Query: ${args.query.substring(0,30)}${args.query.length > 30 ? '...' : ''}; `;
                                     if (args.search_term) argsSummary += `Search: ${args.search_term}; `;
                                     if (argsSummary) lines.push({ type: 'tool_inline', content: `      Args: ${argsSummary.trim()}`});
                                     else if (argsSource) lines.push({ type: 'tool_inline', content: `      Args: ${argsSource.substring(0,100)}${argsSource.length > 100 ? '...' : ''}`});
                                 }
                                if (instructions) lines.push({ type: 'tool_inline', content: `      Instructions: ${instructions.substring(0, 100)}${instructions.length > 100 ? '...' : ''}` });
                                if (explanation) lines.push({ type: 'tool_inline', content: `      Explanation: ${explanation.substring(0, 100)}${explanation.length > 100 ? '...' : ''}` });
                                if (result) lines.push({ type: 'tool_inline', content: `      Result: ${result.substring(0,150)}${result.length>150 ? '...' : ''}`});
                                if (toolData.error) lines.push({ type: 'tool_inline', content: `      ERROR: ${toolData.error}`});
                                if (toolData.status) lines.push({ type: 'tool_inline', content: `      Status: ${toolData.status}`});
                             } catch (e) { // Catch potential errors during processing
                                 console.error(`Error processing inline tool details for ${toolCallId}:`, e);
                                 lines.push({ type: 'tool_inline', content: `      Details (raw): ${detailDataString.substring(0, 150)}${detailDataString.length > 150 ? '...' : ''}`});
                             }
                        } else {
                            const detailFileName = `tool_call_${toolCallId}.json`;
                            const detailFilePath = path.join(chatSubDir, detailFileName);
                            let logLineContent = `${toolPrefix} Name: ${toolName} (ID: ${toolCallId}).`;
                            if (toolData.status) logLineContent += ` Status: ${toolData.status}.`;
                            logLineContent += ` (Details: ./${chatSubDirBaseName}/${detailFileName})`;
                             lines.push({
                                type: 'tool_ref',
                                content: logLineContent,
                                details: { filePath: detailFilePath, data: detailDataString }
                             });
                        }
                    } else if (callInfo && Object.keys(callInfo).length > 0) {
                        if (!contentAdded && lines.length === 0) lines.push({type: 'text', content: basePrefix});
                        lines.push({type: 'capability_info', content: `    [Capability Info (details not found for ${toolCallId || 'N/A'})]: ${JSON.stringify(callInfo)}`});
                        contentAdded = true;
                    }
                }
            }
        }
    }

    // 4. Code blocks
    if (msg.codeBlocks && msg.codeBlocks.length > 0 && codeBlockData) {
        for (const [idx, blockMeta] of msg.codeBlocks.entries()) {
            const lang = blockMeta.languageId || 'unknown';
            const fsPath = blockMeta.uri?.fsPath;
            const externalUri = blockMeta.uri?.external;
            const codeBlockIdx = blockMeta.codeBlockIdx ?? idx;
            const version = blockMeta.version ?? 0;
            let content = ''; // Default to empty
            let status = 'unknown';
            let detailFileName = `code_block_unknown_${codeBlockIdx}_v${version}.log`;
            let detailFilePath = path.join(chatSubDir, detailFileName);
            let needsSeparateFile = false;
            let codeBlockDetails: CodeBlockDetails | undefined = undefined;
            let codeFound = false;

            // --- FIXED CODE SEARCH LOGIC ---
            const searchKey = externalUri || fsPath;
            if (searchKey && codeBlockData[searchKey]) {
                const blocksForKey = codeBlockData[searchKey];
                // Looking for a block with the EXACT version
                // If not found, try to find by index, if present
                // If still not found, but only one block with this version - take it (as fallback)
                codeBlockDetails = blocksForKey.find(cb => cb.version === version);
                // If not found, try to find by index, if present
                // If still not found, but only one block with this version - take it (as fallback)
                if (!codeBlockDetails && blockMeta.codeBlockIdx !== undefined) {
                    codeBlockDetails = blocksForKey.find(cb => cb.codeBlockIdx === blockMeta.codeBlockIdx && cb.version === version);
                    // If still not found, but only one block with this version - take it (as fallback)
                    if (!codeBlockDetails) {
                       const blocksWithVersion = blocksForKey.filter(cb => cb.version === version);
                       if (blocksWithVersion.length === 1) {
                            // console.warn(`[DEBUG ${index}]   Could not match codeBlockIdx ${blockMeta.codeBlockIdx} for v=${version}. Taking the only block with this version.`);
                            codeBlockDetails = blocksWithVersion[0];
                       }
                    }
                }
            }
            // --- END OF FIX ---

            if (codeBlockDetails) {
                    content = codeBlockDetails.content;
                    status = codeBlockDetails.status || 'found_in_data';
                    needsSeparateFile = true;
                    codeFound = true;
                    const targetPath = codeBlockDetails.uri.fsPath || fsPath;
                    const ext = path.extname(targetPath || 'file') || `.${lang === 'unknown' ? 'log' : lang}`;
                    const baseName = sanitizeFilename(targetPath || `unknown_${codeBlockIdx}`);
                    detailFileName = `code_block_${baseName}_idx${codeBlockIdx}_v${version}${ext}`;
                    if (detailFileName) {
                        const ext = path.extname(detailFileName);
                        if (ext) detailFileName = detailFileName.slice(0, -ext.length) + remapScriptExtension(ext);
                        detailFilePath = path.join(chatSubDir, detailFileName);
                    }
            } else if (blockMeta.content) { // Fallback to content from the bubble itself
                 content = blockMeta.content;
                 status = 'inline_fallback';
                 codeFound = true;
                 if(content.length >= detailThreshold || content.split('\n').length > 10) {
                     const ext = `.${lang === 'unknown' ? 'log' : lang}`;
                     detailFileName = `code_block_inline_${codeBlockIdx}_v${version}${ext}`;
                     detailFilePath = path.join(chatSubDir, detailFileName);
                     needsSeparateFile = true;
                 }
            }

            if (!contentAdded && lines.length === 0) lines.push({type: 'text', content: basePrefix});
            contentAdded = true;

            const displayPath = blockMeta.uri?.fsPath || blockMeta.uri?.path || (codeBlockDetails?.uri.fsPath) || 'inline/unknown';

            if (codeFound) {
                 if (needsSeparateFile) {
                     const logLineContent = `${codePrefix} #${codeBlockIdx + 1} [${status}] Lang: ${lang}, Path: ${displayPath}. (Full code: ./${chatSubDirBaseName}/${detailFileName})`;
                     lines.push({
                         type: 'code_ref',
                         content: logLineContent,
                         details: { filePath: detailFilePath, data: content }
                     });
                 } else {
                      lines.push({ type: 'code_inline', content: `${codePrefix} #${codeBlockIdx + 1} [${status}] Lang: ${lang}, Path: ${displayPath} [INLINE CODE]`});
                      lines.push({ type: 'code_inline', content: `      \`\`\`${lang}\n${content}\n      \`\`\``});
                 }
             } else {
                  lines.push({ type: 'code_not_found', content: `${codePrefix} #${codeBlockIdx + 1} [not found] Lang: ${lang}, Path: ${displayPath}. (Content not found)`});
             }
        }
    } else if (msg.codeBlocks && msg.codeBlocks.length > 0) {
         if (!contentAdded && lines.length === 0) lines.push({type: 'text', content: basePrefix});
         lines.push({type: 'text', content: `    [CODE BLOCKS DETECTED] (Content details not extracted - codeBlockData missing in JSON log)`});
         msg.codeBlocks.forEach(block => {
              const lang = block.languageId || 'unknown';
              const pathUri = block.uri?.fsPath || block.uri?.path || 'no path';
              lines.push({ type: 'text', content: `     - Lang: ${lang}, Path: ${pathUri}`});
         });
         contentAdded = true;
   }

    // 5. Linter errors
    if (msg.multiFileLinterErrors && msg.multiFileLinterErrors.length > 0) {
        if (!contentAdded && lines.length === 0) lines.push({type: 'text', content: basePrefix});
        lines.push({ type: 'linter_error', content: errorPrefix});
        contentAdded = true;
        msg.multiFileLinterErrors.forEach(fileError => {
            const filePath = fileError.relativeWorkspacePath || 'unknown file';
            if (fileError.errors && fileError.errors.length > 0) {
                fileError.errors.forEach(err => {
                    lines.push({ type: 'linter_error', content: `     - File: ${filePath}: ${err.message || 'no message'}`});
                });
            }
        });
    }

     if (lines.length === 0 || (lines.length === 1 && lines[0].type === 'text' && lines[0].content === basePrefix && !contentAdded)) {
        return [];
     }

    return lines;
}


// --- Main extraction function ---
export async function extractAndSaveCursorChatLogs(
  projectIdentifier: string,
  outputDir: string,
  dbPath?: string
): Promise<string[]> {
    const resolvedDbPath = resolveDbPath(dbPath);

    await fs.ensureDir(outputDir);
    const savedFilePaths: string[] = [];
    let db: Database.Database | undefined;
    let rows: Array<{ key: string, value: Buffer | string }> = [];
    let queriedTable = '';

    try {
        db = new Database(resolvedDbPath, { readonly: true, fileMustExist: true });

        try {
            rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE 'composerData:%'").all() as Array<{key: string, value: Buffer | string}>;
            queriedTable = 'ItemTable';
        } catch (tableErr: any) {
            if (tableErr.message.includes('no such table: ItemTable')) {
                console.warn("Table 'ItemTable' not found, trying 'cursorDiskKV'...");
                rows = [];
            } else { throw tableErr; }
        }
        if (rows.length === 0) {
            try {
                rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as Array<{key: string, value: Buffer | string}>;
                queriedTable = 'cursorDiskKV';
            } catch (kvErr: any) {
                 if (kvErr.message.includes('no such table: cursorDiskKV')) {
                     console.error("Tables 'ItemTable' and 'cursorDiskKV' not found. Cannot extract logs.");
                     rows = [];
                 } else { throw kvErr; }
            }
        }

        let projectChatsFound = 0;

        for (const { key, value } of rows) {
            if (!value) {
                console.warn(`Skipping row with key ${key} due to null/undefined value`);
                continue; // Пропускаем строку, если value === null или undefined
            }
            const rawValue = typeof value === 'string' ? value : value.toString('utf8');
            if (!rawValue.includes(projectIdentifier)) continue;

            const fullData = safeJsonParse<FullConversationLog>(rawValue, key); // Pass key for error logging
            if (!fullData || !fullData.conversation) {
                continue;
            }

            let belongs = rawValue.includes(projectIdentifier);
            if (!belongs) continue;

            projectChatsFound++;
            const bubbleDataMap = fullData.bubbleDataMap;
            const codeBlockData = fullData.codeBlockData;

            const safeName = (fullData.name || 'chat').replace(/[^\p{L}0-9_\- ]+/gu, '_').replace(/\s+/g, '_').slice(0, 50);
            let dateStr = 'nodate';
            if (fullData.lastUpdatedAt) {
                const d = new Date(typeof fullData.lastUpdatedAt === 'number' ? fullData.lastUpdatedAt : parseInt(fullData.lastUpdatedAt, 10));
                if (!isNaN(d.getTime())) {
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    dateStr = `${pad(d.getUTCDate())}-${pad(d.getUTCMonth()+1)}-${d.getUTCFullYear()}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`;
                }
            }
            const composerIdShort = (fullData.composerId || key.replace('composerData:', '')).substring(0, 8);
            const logFileName = `${dateStr}_${safeName}_${composerIdShort}.log`;
            const chatSubDirName = `${dateStr}_${safeName}_${composerIdShort}_details`;
            const chatDirPath = path.join(outputDir, chatSubDirName);
            let remappedLogFileName = logFileName;
            if (remappedLogFileName) {
                const ext = path.extname(remappedLogFileName);
                if (ext) remappedLogFileName = remappedLogFileName.slice(0, -ext.length) + remapScriptExtension(ext);
            }
            const mainLogFilePath = path.join(outputDir, remappedLogFileName);

            let mainLogContentLines: string[] = [];
            const detailWritePromises: Promise<void>[] = [];
            let hasDetailFiles = false;
            let detailDirEnsured = false;

            mainLogContentLines.push(`--- Chat Log ---`);
            mainLogContentLines.push(`File: ${remappedLogFileName}`);
            mainLogContentLines.push(`Table: ${queriedTable}`);
            mainLogContentLines.push(`Key: ${key}`);
            mainLogContentLines.push(`Name: ${fullData.name || 'N/A'}`);
            mainLogContentLines.push(`Last Updated: ${fullData.lastUpdatedAt ? new Date(typeof fullData.lastUpdatedAt === 'number' ? fullData.lastUpdatedAt : parseInt(fullData.lastUpdatedAt, 10)).toISOString() : 'N/A'}`);
            mainLogContentLines.push(`Composer ID: ${fullData.composerId || 'N/A'}`);
            mainLogContentLines.push(`Project Identifier Found: ${projectIdentifier}`);
            mainLogContentLines.push(`--- Start of Conversation ---`);
            mainLogContentLines.push('');

            let messageIndex = 1;
            let hasNonEmptyMessages = false;
            for (const msg of fullData.conversation) {
                if (msg.isThought || msg.isCapabilityIteration) continue;
                let formattedLines: FormattedLine[] = [];
                if (msg.type === 1) {
                    formattedLines = formatUserMessageV2(msg, messageIndex);
                } else if (msg.type === 2) {
                    formattedLines = await formatAiMessageV2(msg, messageIndex, bubbleDataMap, codeBlockData, chatDirPath, chatSubDirName);
                }
                if (formattedLines.length > 0) {
                    hasNonEmptyMessages = true;
                    for (const line of formattedLines) {
                        mainLogContentLines.push(line.content);
                        if (line.details) {
                            if (!hasDetailFiles) { hasDetailFiles = true; }
                            if (!detailDirEnsured) {
                                try {
                                    await fs.ensureDir(chatDirPath);
                                    detailDirEnsured = true;
                                } catch(dirErr: any) {
                                    continue;
                                }
                            }
                            if (detailDirEnsured) {
                                detailWritePromises.push(fs.writeFile(line.details.filePath, line.details.data, 'utf8')
                                    .catch(writeErr => console.error(`Error writing file ${line.details?.filePath}:`, writeErr)));
                            }
                        }
                    }
                    mainLogContentLines.push('');
                    messageIndex++;
                }
            }
            if (!hasNonEmptyMessages) {
                continue;
            }

            if (hasDetailFiles) {
                 const headerIndex = mainLogContentLines.findIndex(line => line.startsWith('Table:'));
                 if (headerIndex !== -1) {
                     mainLogContentLines.splice(headerIndex, 0, `Details Directory: ./${chatSubDirName}/`);
                 }
            }

            mainLogContentLines.push('--- End of Conversation ---');

            await fs.writeFile(mainLogFilePath, mainLogContentLines.join('\n'), 'utf8');
            savedFilePaths.push(mainLogFilePath);

            if (detailWritePromises.length > 0) {
                await Promise.all(detailWritePromises);
            }
        } // end for loop

        return savedFilePaths;
    } catch (e: any) {
        console.error(`\nCritical error extracting logs: ${e.message}`);
        if (e.stack) console.error(e.stack);
        throw e;
    } finally {
        if (db) {
            try { db.close(); }
            catch (closeErr: any) { console.error(`Error closing database: ${closeErr.message}`); }
        }
    }
}
