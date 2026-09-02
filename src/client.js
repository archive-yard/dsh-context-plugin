/**
 * DeepSeek Harness Context Plugin - Client Implementation
 * 
 * Registers:
 * 1. An interactive floating UI window in `shell.overlay`
 * 2. An action button in `conversation.session.header.actions`
 * 3. An action button in `conversation.input.left`
 * 
 * Features:
 * - Scans workspace files respecting .gitignore, .dshignore, and .git
 * - Detects binary files and replaces content with notice
 * - Dynamically calculates code fence backticks (>= 3 backticks)
 * - Inserts all formatted files into the composer draft as a single prompt
 * - Leaves cursor/space at the bottom so user can immediately type their request
 */

function clientPlugin() {
  return {
    inject: ['timer'],
    apply(ctx) {
      const h = React.createElement;
      const slots = ctx.get('slots');
      if (!slots) return;

      // Shared cross-slot coordinator
      const listeners = new Set();
      const windowState = {
        isOpen: true,
        isMinimized: false
      };

      const sharedStore = {
        inputActions: null,
        currentDraft: ''
      };

      function updateWindowState(patch) {
        Object.assign(windowState, patch);
        for (const cb of listeners) cb();
      }

      function useSharedWindowState() {
        const [state, setState] = React.useState({ ...windowState });
        React.useEffect(() => {
          const cb = () => setState({ ...windowState });
          listeners.add(cb);
          return () => listeners.delete(cb);
        }, []);
        return state;
      }

      // Inject custom CSS styling
      if (typeof styles !== 'undefined' && styles.insert) {
        styles.insert(`
          .dsh-ctx-overlay-container {
            position: fixed;
            top: 60px;
            right: 24px;
            z-index: 10000;
            pointer-events: auto;
            font-family: inherit;
          }
          .dsh-ctx-window {
            width: 470px;
            max-width: calc(100vw - 48px);
            background: var(--dsw-alias-bg-overlay, #1c1d22);
            border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.18));
            border-radius: 12px;
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
            color: var(--dsw-alias-label-primary, #f0f0f0);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            animation: dshCtxFadeIn 0.2s ease-out;
          }
          @keyframes dshCtxFadeIn {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .dsh-ctx-header {
            padding: 10px 14px;
            background: var(--dsw-alias-bg-layer-1, #23242a);
            border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.1));
            display: flex;
            align-items: center;
            justify-content: space-between;
            user-select: none;
          }
          .dsh-ctx-title {
            font-weight: 600;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .dsh-ctx-header-btn {
            background: transparent;
            border: none;
            color: var(--dsw-alias-label-secondary, #999);
            font-size: 14px;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
            line-height: 1;
            transition: all 0.15s;
          }
          .dsh-ctx-header-btn:hover {
            background: rgba(255,255,255,0.1);
            color: var(--dsw-alias-label-primary, #fff);
          }
          .dsh-ctx-body {
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            font-size: 12px;
          }
          .dsh-ctx-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
          }
          .dsh-ctx-label {
            font-size: 11px;
            font-weight: 500;
            color: var(--dsw-alias-label-secondary, #aaa);
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .dsh-ctx-input-row {
            display: flex;
            gap: 6px;
          }
          .dsh-ctx-input {
            flex: 1;
            background: var(--dsw-alias-bg-layer-2, #141417);
            border: 1px solid var(--dsw-alias-border-l2, #333);
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 12px;
            font-family: monospace;
            color: var(--dsw-alias-label-primary, #f0f0f0);
            outline: none;
          }
          .dsh-ctx-input:focus {
            border-color: var(--dsw-alias-brand-primary, #3b82f6);
          }
          .dsh-ctx-btn {
            background: var(--dsw-alias-bg-layer-2, #2a2b33);
            border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.15));
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 500;
            color: var(--dsw-alias-label-primary, #fff);
            cursor: pointer;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
          }
          .dsh-ctx-btn:hover:not(:disabled) {
            background: var(--dsw-alias-bg-layer-1, #363842);
            border-color: var(--dsw-alias-border-l1, rgba(255,255,255,0.3));
          }
          .dsh-ctx-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .dsh-ctx-btn-primary {
            background: var(--dsw-alias-brand-primary, #2563eb);
            border-color: transparent;
            color: #fff;
            font-weight: 600;
            padding: 9px 14px;
            font-size: 13px;
          }
          .dsh-ctx-btn-primary:hover:not(:disabled) {
            background: #1d4ed8;
          }
          .dsh-ctx-switch-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--dsw-alias-bg-layer-2, #141417);
            border: 1px solid var(--dsw-alias-border-l2, #333);
            border-radius: 6px;
            padding: 4px 8px;
          }
          .dsh-ctx-switch-pills {
            display: flex;
            background: var(--dsw-alias-bg-layer-1, #23242a);
            border-radius: 5px;
            padding: 2px;
          }
          .dsh-ctx-pill {
            padding: 3px 10px;
            font-size: 11px;
            border-radius: 4px;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--dsw-alias-label-secondary, #999);
            font-weight: 500;
            transition: all 0.15s;
          }
          .dsh-ctx-pill.active {
            background: var(--dsw-alias-brand-primary, #2563eb);
            color: #fff;
            box-shadow: 0 1px 4px rgba(0,0,0,0.2);
          }
          .dsh-ctx-badges {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
          }
          .dsh-ctx-badge {
            font-size: 10px;
            padding: 2px 7px;
            border-radius: 4px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.1);
            color: var(--dsw-alias-label-secondary, #aaa);
          }
          .dsh-ctx-badge.found {
            background: rgba(34, 197, 94, 0.12);
            border-color: rgba(34, 197, 94, 0.3);
            color: #4ade80;
          }
          .dsh-ctx-file-list {
            max-height: 150px;
            overflow-y: auto;
            border: 1px solid var(--dsw-alias-border-l2, #333);
            border-radius: 6px;
            background: var(--dsw-alias-bg-layer-2, #141417);
            padding: 4px;
          }
          .dsh-ctx-file-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 3px 6px;
            font-size: 11px;
            font-family: monospace;
            border-radius: 4px;
            transition: background 0.1s;
          }
          .dsh-ctx-file-item:hover {
            background: rgba(255,255,255,0.05);
          }
          .dsh-ctx-file-info {
            display: flex;
            align-items: center;
            gap: 6px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .dsh-ctx-file-tag {
            font-size: 9px;
            padding: 1px 4px;
            border-radius: 3px;
            background: rgba(255,255,255,0.1);
          }
          .dsh-ctx-file-tag.bin {
            background: rgba(239, 68, 68, 0.2);
            color: #f87171;
          }
          .dsh-ctx-progress {
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: var(--dsw-alias-bg-layer-2, #141417);
            border: 1px solid var(--dsw-alias-border-l2, #333);
            border-radius: 6px;
            padding: 8px 10px;
          }
          .dsh-ctx-progress-bar-bg {
            height: 6px;
            background: rgba(255,255,255,0.1);
            border-radius: 3px;
            overflow: hidden;
          }
          .dsh-ctx-progress-bar-fill {
            height: 100%;
            background: var(--dsw-alias-brand-primary, #3b82f6);
            transition: width 0.15s ease;
          }
          .dsh-ctx-spinner {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: dshCtxSpin 0.7s linear infinite;
          }
          @keyframes dshCtxSpin {
            to { transform: rotate(360deg); }
          }
          .dsh-ctx-min-badge {
            background: var(--dsw-alias-bg-overlay, #1c1d22);
            border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.25));
            border-radius: 20px;
            padding: 6px 14px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.35);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            font-weight: 500;
            color: var(--dsw-alias-label-primary, #fff);
            transition: transform 0.15s;
          }
          .dsh-ctx-min-badge:hover {
            transform: scale(1.03);
          }
          .dsh-ctx-notice-success {
            padding: 8px 12px;
            background: rgba(34, 197, 94, 0.15);
            border: 1px solid rgba(34, 197, 94, 0.35);
            border-radius: 6px;
            color: #4ade80;
            font-size: 12px;
          }
          .dsh-ctx-notice-error {
            padding: 8px 12px;
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.35);
            color: #f87171;
            font-size: 12px;
          }
        `);
      }

      // UI Window Component mounted in shell.overlay
      function ContextOverlayWindow(props) {
        const win = useSharedWindowState();
        const sessionsState = props.useSessions ? props.useSessions(s => s) : null;
        const workspacesState = props.useWorkspaces ? props.useWorkspaces(s => s) : null;

        const [workspacePath, setWorkspacePath] = React.useState('');
        const [scheme, setScheme] = React.useState('file'); // 'file' | 'vscode'
        const [scanResult, setScanResult] = React.useState(null);
        const [selectedFiles, setSelectedFiles] = React.useState(new Set());
        const [phase, setPhase] = React.useState('idle'); // 'idle' | 'scanning' | 'reading' | 'completed' | 'error'
        const [progress, setProgress] = React.useState({ current: 0, total: 0, file: '', phaseText: '' });
        const [errorMessage, setErrorMessage] = React.useState('');
        const [successMessage, setSuccessMessage] = React.useState('');

        // Attempt automatic workspace path detection from Host and Client
        React.useEffect(() => {
          host.call('get-workspace-root', {}).then(res => {
            if (res && res.workspaceRoot) {
              setWorkspacePath(prev => prev || res.workspaceRoot);
            }
          }).catch(() => {});
        }, []);

        React.useEffect(() => {
          if (!workspacePath && workspacesState?.items?.length) {
            const currentSessionId = sessionsState?.current;
            let found = null;
            if (currentSessionId) {
              found = workspacesState.items.find(w => w.sessionIds && w.sessionIds.includes(currentSessionId));
            }
            if (!found) found = workspacesState.items[0];
            if (found && found.path) {
              setWorkspacePath(found.path);
            }
          }
        }, [workspacesState, sessionsState, workspacePath]);

        // Scan files in workspace
        const handleScan = React.useCallback(async () => {
          setPhase('scanning');
          setErrorMessage('');
          setSuccessMessage('');
          try {
            const res = await host.call('scan-workspace', { workspacePath: workspacePath.trim() });
            if (res.rootPath) {
              setWorkspacePath(res.rootPath);
            }
            setScanResult(res);
            setSelectedFiles(new Set(res.files.map(f => f.relativePath)));
            setPhase('idle');
          } catch (err) {
            setErrorMessage('Scan failed: ' + (err.message || String(err)));
            setPhase('error');
          }
        }, [workspacePath]);

        // Toggle file selection
        const toggleFile = (relPath) => {
          setSelectedFiles(prev => {
            const next = new Set(prev);
            if (next.has(relPath)) next.delete(relPath);
            else next.add(relPath);
            return next;
          });
        };

        const toggleAll = () => {
          if (!scanResult) return;
          if (selectedFiles.size === scanResult.files.length) {
            setSelectedFiles(new Set());
          } else {
            setSelectedFiles(new Set(scanResult.files.map(f => f.relativePath)));
          }
        };

        // Ingest files into Composer draft
        const handleInsertIntoComposer = async () => {
          setErrorMessage('');
          setSuccessMessage('');

          // 1. Scan if not already scanned
          let targetFiles = [];
          if (!scanResult || scanResult.files.length === 0) {
            setPhase('scanning');
            setProgress({ current: 0, total: 0, file: '', phaseText: 'Scanning workspace files...' });
            try {
              const res = await host.call('scan-workspace', { workspacePath: workspacePath.trim() });
              if (res.rootPath) setWorkspacePath(res.rootPath);
              setScanResult(res);
              targetFiles = res.files;
              setSelectedFiles(new Set(res.files.map(f => f.relativePath)));
            } catch (err) {
              setErrorMessage('Scan failed: ' + (err.message || String(err)));
              setPhase('error');
              return;
            }
          } else {
            targetFiles = scanResult.files.filter(f => selectedFiles.has(f.relativePath));
          }

          if (targetFiles.length === 0) {
            setErrorMessage('No files selected for ingestion.');
            setPhase('idle');
            return;
          }

          const total = targetFiles.length;
          const formattedBlocks = [];

          // 2. Read each file with progress feedback
          try {
            setPhase('reading');
            for (let i = 0; i < total; i++) {
              const file = targetFiles[i];
              const idx = i + 1;

              setProgress({
                current: idx,
                total,
                file: file.relativePath,
                phaseText: `Reading ${idx}/${total}: ${file.relativePath}`
              });

              const readRes = await host.call('read-file', {
                absolutePath: file.absolutePath,
                relativePath: file.relativePath,
                isBinaryByExt: file.isBinaryByExt,
                extension: file.extension
              });

              // Format header link
              const abs = file.absolutePath.startsWith('/') ? file.absolutePath : ('/' + file.absolutePath);
              const headerLink = scheme === 'vscode'
                ? `[\`${file.relativePath}\`](vscode://file${abs})`
                : `[\`${file.relativePath}\`](file://${abs})`;

              // Dynamic code fence and content
              const fence = readRes.fence || '```';
              const ext = readRes.extension || '';
              const content = readRes.content || '';
              const normalizedContent = content.endsWith('\n') ? content : (content + '\n');
              const block = `${headerLink}\n\n${fence}${ext}\n${normalizedContent}${fence}`;
              formattedBlocks.push(block);

              await ctx.timeout(15);
            }

            // 3. Assemble full prompt with extra space at the bottom for the user request
            const filesBlock = formattedBlocks.join('\n\n');
            const existingDraft = (sharedStore.currentDraft || '').trim();
            const fullDraft = existingDraft ? `${filesBlock}\n\n${existingDraft}` : `${filesBlock}\n\n`;

            // 4. Set draft via inputActions (with DOM fallback)
            let draftApplied = false;
            if (sharedStore.inputActions && typeof sharedStore.inputActions.setDraft === 'function') {
              try {
                sharedStore.inputActions.setDraft(fullDraft);
                draftApplied = true;
              } catch (e) {
                console.error('setDraft error', e);
              }
            }

            if (!draftApplied && typeof document !== 'undefined') {
              const textarea = document.querySelector('textarea');
              if (textarea) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                if (setter) {
                  setter.call(textarea, fullDraft);
                } else {
                  textarea.value = fullDraft;
                }
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.focus();
                textarea.selectionStart = textarea.selectionEnd = fullDraft.length;
                draftApplied = true;
              }
            }

            setPhase('completed');
            setSuccessMessage(`Inserted ${total} file${total > 1 ? 's' : ''} into composer! Write your request below and press Enter.`);

            // Automatically minimize after 1.5 seconds so user can write their prompt
            ctx.timeout(() => {
              updateWindowState({ isMinimized: true });
            }, 1500);

          } catch (err) {
            setErrorMessage('Ingestion error: ' + (err.message || String(err)));
            setPhase('error');
          }
        };

        if (!win.isOpen) {
          return h('div', { className: 'dsh-ctx-overlay-container' },
            h('button', {
              className: 'dsh-ctx-min-badge',
              onClick: () => updateWindowState({ isOpen: true, isMinimized: false })
            },
              h('span', null, '📁'),
              h('span', null, 'Context Ingester')
            )
          );
        }

        if (win.isMinimized) {
          return h('div', { className: 'dsh-ctx-overlay-container' },
            h('div', {
              className: 'dsh-ctx-min-badge',
              onClick: () => updateWindowState({ isMinimized: false })
            },
              h('span', null, '📁'),
              h('span', null, workspacePath ? workspacePath.split('/').pop() || workspacePath : 'Context Ingester'),
              scanResult ? h('span', { style: { opacity: 0.7 } }, `(${scanResult.files.length} files)`) : null,
              h('span', { style: { marginLeft: '6px', fontSize: '10px' } }, '▲')
            )
          );
        }

        const isBusy = phase === 'scanning' || phase === 'reading';
        const currentPathDisplay = workspacePath || '(auto-detecting...)';

        return h('div', { className: 'dsh-ctx-overlay-container' },
          h('div', { className: 'dsh-ctx-window' },
            // Window Header
            h('div', { className: 'dsh-ctx-header' },
              h('div', { className: 'dsh-ctx-title' },
                h('span', null, '📁'),
                h('span', null, 'dsh-context-plugin')
              ),
              h('div', { style: { display: 'flex', gap: '4px' } },
                h('button', {
                  className: 'dsh-ctx-header-btn',
                  title: 'Minimize',
                  onClick: () => updateWindowState({ isMinimized: true })
                }, '—'),
                h('button', {
                  className: 'dsh-ctx-header-btn',
                  title: 'Close',
                  onClick: () => updateWindowState({ isOpen: false })
                }, '✕')
              )
            ),

            // Window Body
            h('div', { className: 'dsh-ctx-body' },
              // Workspace Path Row
              h('div', { className: 'dsh-ctx-field' },
                h('div', { className: 'dsh-ctx-label' }, 'Workspace Directory:'),
                h('div', { className: 'dsh-ctx-input-row' },
                  h('input', {
                    className: 'dsh-ctx-input',
                    type: 'text',
                    value: workspacePath,
                    placeholder: '/path/to/workspace',
                    disabled: isBusy,
                    onChange: (e) => setWorkspacePath(e.target.value)
                  }),
                  h('button', {
                    className: 'dsh-ctx-btn',
                    disabled: isBusy || !workspacePath.trim(),
                    onClick: handleScan
                  }, phase === 'scanning' ? h('span', { className: 'dsh-ctx-spinner' }) : 'Scan')
                )
              ),

              // Header Link Protocol Switch
              h('div', { className: 'dsh-ctx-switch-row' },
                h('span', { style: { fontWeight: 500 } }, 'Header Link Protocol:'),
                h('div', { className: 'dsh-ctx-switch-pills' },
                  h('button', {
                    className: `dsh-ctx-pill ${scheme === 'file' ? 'active' : ''}`,
                    disabled: isBusy,
                    onClick: () => setScheme('file')
                  }, 'file:///'),
                  h('button', {
                    className: `dsh-ctx-pill ${scheme === 'vscode' ? 'active' : ''}`,
                    disabled: isBusy,
                    onClick: () => setScheme('vscode')
                  }, 'vscode://file/')
                )
              ),

              // Ignore Rules Badges
              h('div', { className: 'dsh-ctx-badges' },
                h('span', { className: 'dsh-ctx-badge' }, '🚫 .git/ (Always ignored)'),
                h('span', { className: `dsh-ctx-badge ${scanResult?.hasGitignore ? 'found' : ''}` },
                  scanResult?.hasGitignore ? '✓ .gitignore (Active)' : '○ .gitignore'
                ),
                h('span', { className: `dsh-ctx-badge ${scanResult?.hasDshignore ? 'found' : ''}` },
                  scanResult?.hasDshignore ? '✓ .dshignore (Active)' : '○ .dshignore'
                ),
                scanResult?.ignoredCount ? h('span', { className: 'dsh-ctx-badge' }, `${scanResult.ignoredCount} files ignored`) : null
              ),

              // Scanned File List (if scanned)
              scanResult && h('div', { className: 'dsh-ctx-field' },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                  h('div', { className: 'dsh-ctx-label' }, `Files to Ingest (${selectedFiles.size}/${scanResult.files.length}):`),
                  h('button', {
                    className: 'dsh-ctx-header-btn',
                    style: { fontSize: '11px', textDecoration: 'underline' },
                    disabled: isBusy,
                    onClick: toggleAll
                  }, selectedFiles.size === scanResult.files.length ? 'Deselect All' : 'Select All')
                ),
                h('div', { className: 'dsh-ctx-file-list' },
                  scanResult.files.map(f => {
                    const isSelected = selectedFiles.has(f.relativePath);
                    return h('div', {
                      key: f.relativePath,
                      className: 'dsh-ctx-file-item',
                      onClick: () => !isBusy && toggleFile(f.relativePath)
                    },
                      h('div', { className: 'dsh-ctx-file-info' },
                        h('input', {
                          type: 'checkbox',
                          checked: isSelected,
                          disabled: isBusy,
                          onChange: () => {}
                        }),
                        h('span', null, f.relativePath)
                      ),
                      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
                        h('span', { className: `dsh-ctx-file-tag ${f.isBinaryByExt ? 'bin' : ''}` },
                          f.isBinaryByExt ? 'binary' : (f.extension || 'txt')
                        ),
                        h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '10px' } },
                          f.size > 1024 ? `${(f.size / 1024).toFixed(1)}k` : `${f.size}b`
                        )
                      )
                    );
                  })
                )
              ),

              // Progress Bar & Status (when reading)
              isBusy && h('div', { className: 'dsh-ctx-progress' },
                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                    h('span', { className: 'dsh-ctx-spinner' }),
                    h('span', { style: { fontWeight: 500 } }, progress.phaseText || 'Reading files...')
                  ),
                  progress.total > 0 && h('span', { style: { opacity: 0.8 } },
                    `${Math.round((progress.current / progress.total) * 100)}%`
                  )
                ),
                progress.total > 0 && h('div', { className: 'dsh-ctx-progress-bar-bg' },
                  h('div', {
                    className: 'dsh-ctx-progress-bar-fill',
                    style: { width: `${(progress.current / progress.total) * 100}%` }
                  })
                )
              ),

              // Error Notice
              errorMessage && h('div', { className: 'dsh-ctx-notice-error' }, errorMessage),

              // Success Notice
              successMessage && h('div', { className: 'dsh-ctx-notice-success' }, successMessage),

              // Primary Action Button: Insert into Composer
              h('button', {
                className: 'dsh-ctx-btn dsh-ctx-btn-primary',
                disabled: isBusy || !workspacePath.trim(),
                onClick: handleInsertIntoComposer
              },
                isBusy ? [
                  h('span', { key: 'sp', className: 'dsh-ctx-spinner' }),
                  h('span', { key: 'tx' }, progress.phaseText || 'Reading files...')
                ] : [
                  h('span', { key: 'ic' }, '📥'),
                  h('span', { key: 'lb', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    `Insert into Composer: ${currentPathDisplay}`
                  )
                ]
              )
            )
          )
        );
      }

      // Header Action Button mounted in conversation.session.header.actions
      function HeaderActionButton(props) {
        // Capture inputActions and inputState into sharedStore
        if (props.inputActions) {
          sharedStore.inputActions = props.inputActions;
        }
        if (props.useInput) {
          try {
            const inputState = props.useInput(s => s);
            sharedStore.currentDraft = inputState?.draft || '';
          } catch (e) {}
        }

        return h('button', {
          className: 'dsh-ctx-btn',
          style: {
            padding: '4px 10px',
            fontSize: '12px',
            gap: '6px'
          },
          title: 'Open dsh-context-plugin Window',
          onClick: () => {
            updateWindowState({ isOpen: true, isMinimized: false });
          }
        },
          h('span', null, '📁'),
          h('span', null, 'Context Ingester')
        );
      }

      // Composer Toolbar Button mounted in conversation.input.left
      function ComposerToolbarButton(props) {
        if (props.inputActions) {
          sharedStore.inputActions = props.inputActions;
        }
        if (props.useInput) {
          try {
            const inputState = props.useInput(s => s);
            sharedStore.currentDraft = inputState?.draft || '';
          } catch (e) {}
        }

        return h('button', {
          className: 'dsh-ctx-btn',
          style: {
            padding: '3px 8px',
            fontSize: '11px',
            gap: '5px',
            background: 'transparent',
            borderColor: 'transparent'
          },
          title: 'Ingest workspace files into composer',
          onClick: () => {
            updateWindowState({ isOpen: true, isMinimized: false });
          }
        },
          h('span', null, '📁'),
          h('span', null, 'Context')
        );
      }

      // Register components in Cordis slots
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'workspace-context-overlay' },
        ContextOverlayWindow
      ));

      slots.inject('conversation.session.header.actions', () => slots.register(
        { name: 'conversation.session.header.actions', id: 'workspace-context-action', order: 15 },
        HeaderActionButton
      ));

      slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'workspace-context-input-btn', order: 50 },
        ComposerToolbarButton
      ));
    }
  };
}

module.exports = clientPlugin;
