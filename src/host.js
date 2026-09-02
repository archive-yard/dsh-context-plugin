/**
 * DeepSeek Harness Context Plugin - Host Implementation
 * 
 * Provides RPC endpoints for:
 * - Detecting workspace root directory
 * - Scanning files respecting .gitignore, .dshignore, and .git rules
 * - Reading text/binary file contents with dynamic backtick code fences
 */

function hostPlugin() {
  return {
    apply(ctx) {
      const fs = ctx.get('fs');
      const sandboxPolicy = ctx.get('sandboxPolicy');

      // Helper: get current workspace root
      harness.handle('get-workspace-root', async () => {
        try {
          const root = sandboxPolicy?.workspaceRoot || '';
          return { workspaceRoot: root };
        } catch (e) {
          return { workspaceRoot: '' };
        }
      });

      // Helper: parse gitignore / dshignore rules
      function parseIgnoreRules(text) {
        if (!text || typeof text !== 'string') return [];
        const lines = text.split(/\r?\n/);
        const rules = [];
        for (let rawLine of lines) {
          let line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;
          let negated = false;
          if (line.startsWith('!')) {
            negated = true;
            line = line.slice(1).trim();
          }
          if (!line) continue;
          const dirOnly = line.endsWith('/');
          if (dirOnly) line = line.slice(0, -1);
          if (!line) continue;
          const hasSlash = line.includes('/');
          let pattern = line;
          if (pattern.startsWith('/')) pattern = pattern.slice(1);

          // Convert glob pattern to regular expression
          let re = '';
          for (let i = 0; i < pattern.length; i++) {
            const c = pattern[i];
            if (c === '*' && pattern[i + 1] === '*') {
              if (pattern[i + 2] === '/') {
                re += '(?:.*/)?';
                i += 2;
              } else {
                re += '.*';
                i += 1;
              }
            } else if (c === '*') {
              re += '[^/]*';
            } else if (c === '?') {
              re += '[^/]';
            } else if ('[\\]{}()+^$|.,'.includes(c)) {
              re += '\\' + c;
            } else {
              re += c;
            }
          }

          let regex;
          if (hasSlash) {
            regex = new RegExp('^' + re + '(?:/.*)?$');
          } else {
            regex = new RegExp('(?:^|/)' + re + '(?:/.*)?$');
          }

          rules.push({ raw: rawLine, pattern, negated, dirOnly, regex });
        }
        return rules;
      }

      function isPathIgnored(relPath, isDir, rules) {
        // 1. Always ignore .git/ at any depth
        const parts = relPath.split('/');
        if (parts.includes('.git')) return true;

        // 2. Evaluate ignore rules in order
        let ignored = false;
        for (const rule of rules) {
          if (rule.dirOnly && !isDir) continue;
          if (rule.regex.test(relPath)) {
            ignored = !rule.negated;
          }
        }
        return ignored;
      }

      const BINARY_EXTENSIONS = new Set([
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'tif', 'avif',
        'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma',
        'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm',
        'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'iso',
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
        'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'obj', 'class', 'pyc', 'pyo', 'wasm',
        'woff', 'woff2', 'ttf', 'eot', 'otf',
        'db', 'sqlite', 'sqlite3'
      ]);

      function getExt(filename) {
        const idx = filename.lastIndexOf('.');
        if (idx <= 0) return '';
        return filename.slice(idx + 1).toLowerCase();
      }

      // Endpoint: scan-workspace
      harness.handle('scan-workspace', async (args) => {
        if (!fs) throw new Error('fs service is not available on Host');
        const rootPath = args?.workspacePath || sandboxPolicy?.workspaceRoot || '.';
        const rootTarget = await fs.resolve(rootPath);
        const canonicalRoot = fs.processPath(rootTarget);

        // Read .gitignore in workspace root
        let gitignoreContent = '';
        let hasGitignore = false;
        try {
          const giTarget = await fs.resolve('.gitignore', { cwd: canonicalRoot });
          const giStat = await fs.stat(giTarget);
          if (giStat && giStat.type === 'file') {
            gitignoreContent = await fs.readText(giTarget);
            hasGitignore = true;
          }
        } catch (e) {}

        // Read .dshignore in workspace root
        let dshignoreContent = '';
        let hasDshignore = false;
        try {
          const diTarget = await fs.resolve('.dshignore', { cwd: canonicalRoot });
          const diStat = await fs.stat(diTarget);
          if (diStat && diStat.type === 'file') {
            dshignoreContent = await fs.readText(diTarget);
            hasDshignore = true;
          }
        } catch (e) {}

        const rules = [
          ...parseIgnoreRules(gitignoreContent),
          ...parseIgnoreRules(dshignoreContent)
        ];

        const files = [];
        let ignoredCount = 0;
        const queue = [{ target: rootTarget, relDir: '' }];

        while (queue.length > 0) {
          const item = queue.shift();
          let entries = [];
          try {
            entries = await fs.listDir(item.target);
          } catch (e) {
            continue;
          }

          for (const entry of entries) {
            const name = entry.name;
            const relPath = item.relDir ? (item.relDir + '/' + name) : name;
            const isDir = entry.type === 'directory';

            if (isPathIgnored(relPath, isDir, rules)) {
              ignoredCount++;
              continue;
            }

            if (isDir) {
              queue.push({ target: entry.target, relDir: relPath });
            } else if (entry.type === 'file') {
              const absPath = fs.processPath(entry.target);
              const ext = getExt(name);
              const isBin = BINARY_EXTENSIONS.has(ext);
              files.push({
                relativePath: relPath,
                absolutePath: absPath,
                extension: ext,
                size: entry.size || 0,
                isBinaryByExt: isBin
              });
            }
          }
        }

        files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

        return {
          rootPath: canonicalRoot,
          hasGitignore,
          hasDshignore,
          ignoredCount,
          files
        };
      });

      // Helper: calculate dynamic backtick fence (>= 3 backticks, exceeding any inner sequence)
      function getBacktickFence(str) {
        if (!str) return '```';
        const matches = str.match(/`+/g);
        if (!matches) return '```';
        let maxLen = 0;
        for (const m of matches) {
          if (m.length > maxLen) maxLen = m.length;
        }
        return '`'.repeat(Math.max(3, maxLen + 1));
      }

      // Endpoint: read-file
      harness.handle('read-file', async (args) => {
        if (!fs) throw new Error('fs service is not available on Host');
        const { absolutePath, relativePath, isBinaryByExt, extension } = args;

        if (isBinaryByExt) {
          return {
            relativePath,
            absolutePath,
            extension: extension || '',
            content: '*Binary file - content not displayed.*',
            isBinary: true,
            fence: '```'
          };
        }

        try {
          const target = await fs.resolve(absolutePath);
          // Null-byte check on first 8KB of bytes
          const bytes = await fs.readBytes(target, undefined, 8192);
          let hasNull = false;
          for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] === 0) {
              hasNull = true;
              break;
            }
          }

          if (hasNull) {
            return {
              relativePath,
              absolutePath,
              extension: extension || '',
              content: '*Binary file - content not displayed.*',
              isBinary: true,
              fence: '```'
            };
          }

          const text = await fs.readText(target);
          const fence = getBacktickFence(text);
          return {
            relativePath,
            absolutePath,
            extension: extension || '',
            content: text,
            isBinary: false,
            fence
          };
        } catch (err) {
          return {
            relativePath,
            absolutePath,
            extension: extension || '',
            content: '*Binary file - content not displayed.*',
            isBinary: true,
            fence: '```'
          };
        }
      });
    }
  };
}

module.exports = hostPlugin;
