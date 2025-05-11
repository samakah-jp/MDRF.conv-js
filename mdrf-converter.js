// mdrf-converter.js
// MDRF (Markdown Diff Review Format) v3.0 Parser and Generator Library
//
// 依存ライブラリ:
// - js-yaml (https://github.com/nodeca/js-yaml) YAMLのパースとダンプに使用

class MdrfConverter {
    /**
     * MdrfConverterのコンストラクタ
     * @param {object} [options] - オプション
     * @param {number} [options.yamlIndent=2] - YAMLをダンプする際のインデント数
     * @param {boolean} [options.autoNumbering=false] - MDRF生成時にスレッド番号とコメントIDを自動採番するかどうか
     */
    constructor(options = {}) {
        if (typeof jsyaml === 'undefined') {
            console.error('js-yaml library is required but not loaded.');
            throw new Error('js-yamlライブラリが必要です。先に読み込んでください。');
        }
        this.options = { 
            yamlIndent: 2, 
            autoNumbering: false,
            ...options 
        };
        // Parser state variables - these are reset for each parse operation
        this.lines = [];
        this.lineIndex = 0;
        this.result = {};
        this.currentGroup = null;
        this.currentFile = null;
        this.currentThread = null;
        this.currentLineNumber = 0;
    }

    // --- 正規表現定義 (静的プロパティとして共通化) ---
    static H1_REGEX = /^#\s+(.+)$/;
    static H2_REGEX = /^##\s+([^:]+):\s+(.+)$/i;
    static H3_REGEX = /^###\s+(.+?)(?:\s+\((Renamed|Moved|Removed)\))?$/i;
    static H4_REGEX = /^####\s+Thread\s+(\d+)(?:\s+on\s+Line\s+(\d+))?$/i;
    static H5_REGEX = /^#####\s+(?:\[([^\]]+)\]\s+)?([^\s(]+)\s+\((.+)\)$/;
    static DIFF_MARKER_REGEX = /^\*\*Diff:\*\*$/i;
    static CODE_FENCE_START_REGEX = /^```(\w*)\s*$/;
    static CODE_FENCE_END_REGEX = /^```\s*$/;
    static YAML_FRONT_MATTER_START_REGEX = /^---$/;
    static YAML_FRONT_MATTER_END_REGEX = /^---$/;
    static REPLY_TO_REGEX = /^:reply_to\[([^\]]+)\]$/;

    // --- Parser State Management ---
    _resetParserState() {
        this.lines = [];
        this.lineIndex = 0;
        this.result = {};
        this.currentGroup = null;
        this.currentFile = null;
        this.currentThread = null;
        this.currentLineNumber = 0;
    }

    // --- Common Helper Functions ---
    _isValidISODate(str) {
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|([+-]\d{2}:\d{2}))$/.test(str);
    }

    // --- Parser Helper Functions ---
    _parserGetCurrentLine() { return this.lineIndex < this.lines.length ? this.lines[this.lineIndex] : null; }
    _parserAdvanceLine(count = 1) { this.lineIndex += count; this.currentLineNumber += count; }
    _parserIsEOF() { return this.lineIndex >= this.lines.length; }
    _parserThrowError(message) { throw new Error(`MDRF Parse Error (Near Line ${this.currentLineNumber + 1}): ${message}`); }

    _parserParseYamlFrontMatter() {
        const yamlLines = []; let foundEnd = false;
        while (!this._parserIsEOF()) {
            const line = this._parserGetCurrentLine();
            if (line === null) { this._parserThrowError("Unexpected end of file while parsing YAML Front Matter."); break; }
            this._parserAdvanceLine();
            if (MdrfConverter.YAML_FRONT_MATTER_END_REGEX.test(line)) { foundEnd = true; break; }
            yamlLines.push(line);
        }
        if (!foundEnd) this._parserThrowError("YAML Front Matter block started with --- but was not closed.");
        try { return jsyaml.load(yamlLines.join('\n')); }
        catch (e) { this._parserThrowError(`Failed to parse YAML Front Matter: ${e.message}`); }
    }

    _parserParseFencedBlock(expectedLang = null) {
        const startLine = this._parserGetCurrentLine();
        if (startLine === null) this._parserThrowError("Unexpected end of file when expecting a fenced code block.");
        const langMatch = startLine.match(MdrfConverter.CODE_FENCE_START_REGEX);
        const actualLang = langMatch ? langMatch[1].toLowerCase() : null;
        if (expectedLang && actualLang !== expectedLang.toLowerCase()) {
            this._parserThrowError(`Expected a '${expectedLang}' code block, but found '${actualLang || 'unspecified'}'.`);
        }
        this._parserAdvanceLine(); const blockLines = []; let foundEnd = false;
        while (!this._parserIsEOF()) {
            const line = this._parserGetCurrentLine();
            if (line === null) { this._parserThrowError("Unexpected end of file while parsing fenced code block."); break; }
            if (MdrfConverter.CODE_FENCE_END_REGEX.test(line)) { this._parserAdvanceLine(); foundEnd = true; break; }
            blockLines.push(line); this._parserAdvanceLine();
        }
        if (!foundEnd) this._parserThrowError(`Fenced code block (started with ${startLine}) was not closed with \`\`\`.`);
        return { lang: actualLang, content: blockLines.join('\n') };
    }

    _parserExtractOptionalMetadataYaml(expectedKey) {
        const currentLineBeforeCheck = this._parserGetCurrentLine();
        if (currentLineBeforeCheck && MdrfConverter.CODE_FENCE_START_REGEX.test(currentLineBeforeCheck) && currentLineBeforeCheck.toLowerCase().includes('yaml')) {
            const yamlBlock = this._parserParseFencedBlock('yaml');
            try {
                const parsedYaml = jsyaml.load(yamlBlock.content);
                if (parsedYaml && typeof parsedYaml === 'object' && parsedYaml.hasOwnProperty(expectedKey)) {
                    return parsedYaml[expectedKey];
                } else { this._parserThrowError(`YAML block found, but missing the required top-level key '${expectedKey}'.`); }
            } catch (e) { this._parserThrowError(`Failed to parse YAML metadata block for key '${expectedKey}': ${e.message}`); }
        }
        return null;
    }

    _parserExtractCommentBody() {
        const bodyLines = [];
        while (!this._parserIsEOF()) {
            const line = this._parserGetCurrentLine();
            if (line === null) { this._parserThrowError("Unexpected end of file while parsing comment body."); break; }
            if (/^#{2,5}\s/.test(line)) break;
            if (/^#\s/.test(line)) this._parserThrowError("H1 (#) heading is not allowed within a comment body.");
            bodyLines.push(line); this._parserAdvanceLine();
        }
        const body = bodyLines.join('\n').trim();
        if (body === "") this._parserThrowError("Comment body cannot be empty.");
        return body;
    }

    // --- Public Parser Methods ---
    parseToObject(mdrfString) {
        this._resetParserState();
        this.lines = mdrfString.replace(/\r\n/g, '\n').split('\n');
        if (this.lines.length > 0 && this.lines[this.lines.length - 1] === '') this.lines.pop();
        if (this._parserIsEOF()) this._parserThrowError("File is empty.");
        let line = this._parserGetCurrentLine();
        if (line === null) this._parserThrowError("Internal error: File has content but first line is null.");
        let match = line.match(MdrfConverter.H1_REGEX);
        if (!match) this._parserThrowError("File must start with H1 ('# <title>').");
        this.result.title = match[1].trim(); this._parserAdvanceLine();
        if (this._parserIsEOF()) this._parserThrowError("Missing YAML Front Matter after H1.");
        line = this._parserGetCurrentLine();
        if (line === null || !MdrfConverter.YAML_FRONT_MATTER_START_REGEX.test(line)) this._parserThrowError("H1 must be immediately followed by YAML Front Matter (---).");
        this._parserAdvanceLine(); this.result.front_matter = this._parserParseYamlFrontMatter();
        if (!this.result.front_matter || (this.result.front_matter.mdrf_version !== '3.0' && this.result.front_matter.mdrf_version !== 3)) this._parserThrowError("YAML Front Matter must contain 'mdrf_version: 3.0'.");
        this.result.front_matter.mdrf_version = '3.0'; this.result.groups = [];
        while (!this._parserIsEOF()) {
            line = this._parserGetCurrentLine();
            if (line === null) { this._parserThrowError(`Internal error: Unexpected null line at index ${this.lineIndex}.`); break; }
            if (line.trim() === '') { this._parserAdvanceLine(); continue; }
            if (line.startsWith('## ')) {
                match = line.match(MdrfConverter.H2_REGEX);
                if (!match) this._parserThrowError(`Invalid H2 format: "${line}"`);
                this.currentGroup = { type: match[1].trim(), name_id: match[2].trim(), files: [] };
                if (!this.currentGroup.name_id) this._parserThrowError("H2 group_name_id cannot be empty.");
                this._parserAdvanceLine(); const groupMeta = this._parserExtractOptionalMetadataYaml('group_metadata');
                if (groupMeta) this.currentGroup.group_metadata = groupMeta;
                this.result.groups.push(this.currentGroup); this.currentFile = null; this.currentThread = null; continue;
            }
            if (line.startsWith('### ')) {
                if (!this.currentGroup) this._parserThrowError("Found H3 without a parent H2 group.");
                match = line.match(MdrfConverter.H3_REGEX);
                if (!match) this._parserThrowError(`Invalid H3 format: "${line}"`);
                const path = match[1].trim(); const statusRaw = match[2]; let status = 'modified';
                if (statusRaw) status = statusRaw.toLowerCase(); else if (/\(Removed\)$/i.test(line)) status = 'removed';
                this.currentFile = { path: path, status: status, threads: [] }; this._parserAdvanceLine();
                const fileMeta = this._parserExtractOptionalMetadataYaml('metadata');
                if (fileMeta) {
                    if (!fileMeta.file_path) this._parserThrowError("File metadata block must contain 'file_path' key.");
                    if (fileMeta.file_path !== path) this._parserThrowError(`File metadata 'file_path' ("${fileMeta.file_path}") does not match H3 path ("${path}").`);
                    this.currentFile.metadata = fileMeta;
                    if (fileMeta.change_type) this.currentFile.status = fileMeta.change_type;
                    if (fileMeta.old_path && (this.currentFile.status === 'renamed' || this.currentFile.status === 'moved')) this.currentFile.old_path = fileMeta.old_path;
                }
                if (this._parserIsEOF()) this._parserThrowError("Unexpected EOF after H3, expected '**Diff:**'.");
                line = this._parserGetCurrentLine();
                if (line === null || !MdrfConverter.DIFF_MARKER_REGEX.test(line)) this._parserThrowError("Expected '**Diff:**' marker after H3 heading/metadata.");
                this._parserAdvanceLine(); if (this._parserIsEOF()) this._parserThrowError("Unexpected EOF after '**Diff:**', expected diff block.");
                const diffBlock = this._parserParseFencedBlock('diff'); this.currentFile.diff = diffBlock.content;
                this.currentGroup.files.push(this.currentFile); this.currentThread = null; continue;
            }
            if (line.startsWith('#### ')) {
                if (!this.currentFile) this._parserThrowError("Found H4 without a parent H3 file.");
                match = line.match(MdrfConverter.H4_REGEX);
                if (!match) this._parserThrowError(`Invalid H4 format: "${line}"`);
                const threadNum = parseInt(match[1], 10); const lineNum = match[2] ? parseInt(match[2], 10) : null;
                if (isNaN(threadNum) || threadNum < 1) this._parserThrowError("H4 thread number must be an integer >= 1.");
                if (lineNum !== null && (isNaN(lineNum) || lineNum < 1)) this._parserThrowError("H4 line number must be an integer >= 1.");
                this.currentThread = { thread_number: threadNum, comments: [] };
                if (lineNum !== null) this.currentThread.line_number = lineNum; this._parserAdvanceLine();
                const threadMeta = this._parserExtractOptionalMetadataYaml('thread_meta');
                if (threadMeta) this.currentThread.thread_meta = threadMeta;
                this.currentFile.threads.push(this.currentThread); continue;
            }
            if (line.startsWith('##### ')) {
                if (!this.currentThread) this._parserThrowError("Found H5 without a parent H4 thread.");
                match = line.match(MdrfConverter.H5_REGEX);
                if (!match) this._parserThrowError(`Invalid H5 format: "${line}"`);
                const commentId = match[1] || null; const username = match[2]; const timestamp = match[3];
                if (!this._isValidISODate(timestamp)) this._parserThrowError(`Invalid ISO 8601 timestamp in H5: "${timestamp}"`);
                const comment = { username: username, timestamp: timestamp }; if (commentId) comment.id = commentId;
                this._parserAdvanceLine();
                if (!this._parserIsEOF()) {
                    const nextLine = this._parserGetCurrentLine();
                    if (nextLine && MdrfConverter.REPLY_TO_REGEX.test(nextLine)) {
                        const replyMatch = nextLine.match(MdrfConverter.REPLY_TO_REGEX);
                        comment.reply_to = replyMatch[1]; this._parserAdvanceLine();
                    }
                }
                comment.body = this._parserExtractCommentBody(); this.currentThread.comments.push(comment); continue;
            }
            this._parserThrowError(`Unexpected content. Expected H2-H5 heading or EOF, but got: "${line.substring(0, 50)}..."`);
        }
        return this.result;
    }

    parseToYaml(mdrfString) {
        try {
            const parsedObject = this.parseToObject(mdrfString);
            return jsyaml.dump(parsedObject, { indent: this.options.yamlIndent, noRefs: true });
        } catch (error) { console.error("MDRF Converter (parseToYaml) Error:", error); throw error; }
    }

    _generatorGenerateMetadataBlock(keyName, metadataObject) {
        if (!metadataObject || Object.keys(metadataObject).length === 0) return '';
        return ['```yaml', jsyaml.dump({ [keyName]: metadataObject }, { indent: this.options.yamlIndent }).trim(), '```'].join('\n');
    }

    _generatorGenerateGroup(group, generationOptions) {
        if (!group || !group.type || !group.name_id || !Array.isArray(group.files)) throw new Error(`Invalid group structure for generation: ${JSON.stringify(group)}`);
        const lines = [`## ${group.type}: ${group.name_id}`];
        if (group.group_metadata) lines.push(this._generatorGenerateMetadataBlock('group_metadata', group.group_metadata));
        
        if (group.files.length > 0) {
            group.files.forEach(file => { 
                lines.push(''); 
                lines.push(this._generatorGenerateFile(file, generationOptions));
            });
        }
        return lines.join('\n');
    }

    _generatorGenerateFile(file, generationOptions) {
        if (!file || !file.path || !file.status || typeof file.diff !== 'string' || !Array.isArray(file.threads)) throw new Error(`Invalid file structure for generation: ${JSON.stringify(file)}`);
        let h3Line = `### ${file.path}`;
        if (file.status === 'renamed') h3Line += ' (Renamed)'; else if (file.status === 'moved') h3Line += ' (Moved)'; else if (file.status === 'removed') h3Line += ' (Removed)';
        const lines = [h3Line];
        if (file.metadata) lines.push(this._generatorGenerateMetadataBlock('metadata', file.metadata));
        lines.push('**Diff:**', '```diff', file.diff, '```');
        
        if (file.threads.length > 0) {
            file.threads.forEach((thread, threadIndex) => { 
                lines.push(''); 
                const actualThreadNumber = generationOptions.autoNumbering ? (threadIndex + 1) : thread.thread_number;
                lines.push(this._generatorGenerateThread(thread, generationOptions, actualThreadNumber)); 
            });
        }
        return lines.join('\n');
    }

    _generatorGenerateThread(thread, generationOptions, assignedThreadNumber) {
         if (!thread || !Array.isArray(thread.comments)) throw new Error(`Invalid thread structure for generation: ${JSON.stringify(thread)}`);
        if (!generationOptions.autoNumbering && (typeof thread.thread_number !== 'number' || thread.thread_number < 1)) {
             throw new Error(`Invalid thread_number for thread: ${JSON.stringify(thread)} when autoNumbering is false.`);
        }

        let h4Line = `#### Thread ${assignedThreadNumber}`;
        if (thread.line_number && typeof thread.line_number === 'number' && thread.line_number >= 1) h4Line += ` on Line ${thread.line_number}`;
        const lines = [h4Line];
        if (thread.thread_meta) lines.push(this._generatorGenerateMetadataBlock('thread_meta', thread.thread_meta));
        
        if (thread.comments.length > 0) {
            thread.comments.forEach((comment, commentIndex) => { 
                const actualCommentNumber = commentIndex + 1;
                lines.push(this._generatorGenerateComment(comment, generationOptions, assignedThreadNumber, actualCommentNumber)); 
            });
        }
        return lines.join('\n');
    }

    _generatorGenerateComment(comment, generationOptions, currentThreadNumber, currentCommentNumberInThread) {
        if (!comment || !comment.username || !comment.timestamp || !comment.body) throw new Error(`Invalid comment structure for generation: ${JSON.stringify(comment)}`);
        let h5Line = '##### '; 
        if (generationOptions.autoNumbering) {
            h5Line += `[${currentThreadNumber}.${currentCommentNumberInThread}] `;
        } else if (comment.id) {
            h5Line += `[${comment.id}] `;
        }
        h5Line += `${comment.username} (${comment.timestamp})`;
        const lines = [h5Line]; 
        if (comment.reply_to) lines.push(`:reply_to[${comment.reply_to}]`);
        lines.push(comment.body); 
        return lines.join('\n');
    }
    
    generateFromObject(mdrfObject, methodOptions = {}) {
        const currentOptions = { ...this.options, ...methodOptions }; // Combine constructor and method options

        if (!mdrfObject || typeof mdrfObject !== 'object') throw new Error("Invalid input: mdrfObject must be an object.");
        if (!mdrfObject.title || typeof mdrfObject.title !== 'string') throw new Error("Invalid input: mdrfObject.title is required.");
        if (!mdrfObject.front_matter || typeof mdrfObject.front_matter !== 'object') throw new Error("Invalid input: mdrfObject.front_matter is required.");
        if (mdrfObject.front_matter.mdrf_version !== '3.0' && mdrfObject.front_matter.mdrf_version !== 3) throw new Error("Invalid input: mdrfObject.front_matter.mdrf_version must be '3.0'.");
        const frontMatterToDump = { ...mdrfObject.front_matter, mdrf_version: '3.0' };
        if (!Array.isArray(mdrfObject.groups)) throw new Error("Invalid input: mdrfObject.groups must be an array.");
        
        const output = [`# ${mdrfObject.title}`, '', '---', jsyaml.dump(frontMatterToDump, { indent: currentOptions.yamlIndent }).trim(), '---'];
        
        if (mdrfObject.groups.length > 0) {
            mdrfObject.groups.forEach(group => { 
                output.push(''); 
                output.push(this._generatorGenerateGroup(group, currentOptions)); // Pass currentOptions
            });
        }
        let resultString = output.join('\n');
        if (resultString.length > 0 && !resultString.endsWith('\n')) resultString += '\n';
        while (resultString.endsWith('\n\n')) resultString = resultString.substring(0, resultString.length - 1);
        return resultString;
    }

    generateFromYaml(yamlString, methodOptions = {}) {
         const currentOptions = { ...this.options, ...methodOptions }; // Combine constructor and method options
        if (typeof yamlString !== 'string') throw new Error("Invalid input: yamlString must be a string.");
        try {
            const mdrfObject = jsyaml.load(yamlString);
            if (typeof mdrfObject !== 'object' || mdrfObject === null) throw new Error("Invalid YAML content: Does not parse to a valid object.");
            return this.generateFromObject(mdrfObject, currentOptions); // Pass currentOptions
        } catch (error) {
            console.error("MDRF Converter (generateFromYaml) Error:", error);
            if (error instanceof Error && error.message.startsWith("Invalid input:")) throw error;
            throw new Error(`Failed to generate MDRF from YAML: ${error.message}`);
        }
    }
}
