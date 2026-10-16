import { tSettingsDialog } from './settingsDialog.i18n';

export interface SettingsDialogOptions {
  title: string;
  fields: Array<{ label: string; control: HTMLElement; alignTop?: boolean }>;
  /** Muted text spanning the form below the fields. */
  note?: string;
  /** Return `false` to keep the dialog open; a rejected promise shows its message. */
  onSave(): boolean | void | Promise<void>;
  onClose(): void;
}

export interface SettingsDialogHandle {
  readonly element: HTMLElement;
  close(): void;
  setError(message: string | null): void;
}

let dialogSequence = 0;

/** Modal settings dialog: label/control rows with Close and Save centered at the bottom. */
export function openSettingsDialog(options: SettingsDialogOptions): SettingsDialogHandle {
  ensureSettingsDialogStyles();
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;

  const overlay = document.createElement('div');
  overlay.className = 'easyview-settings-overlay';
  // Disabled buttons drop focus to <body>, so Escape is handled at the document level.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    previousFocus?.focus({ preventScroll: true });
    options.onClose();
  };
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown, true);

  const titleId = `easyview-settings-title-${++dialogSequence}`;
  const dialog = document.createElement('div');
  dialog.className = 'easyview-settings-dialog';
  dialog.tabIndex = -1;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);

  const header = document.createElement('div');
  header.className = 'easyview-settings-header';
  const title = document.createElement('h2');
  title.id = titleId;
  title.className = 'easyview-settings-title';
  title.textContent = options.title;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'easyview-settings-close';
  closeButton.textContent = '×';
  closeButton.title = tSettingsDialog('closeTitle');
  closeButton.setAttribute('aria-label', closeButton.title);
  closeButton.addEventListener('click', close);
  header.append(title, closeButton);

  const form = document.createElement('div');
  form.className = 'easyview-settings-form';
  for (const field of options.fields) {
    const label = document.createElement('div');
    label.className = field.alignTop ? 'easyview-settings-label is-top' : 'easyview-settings-label';
    label.textContent = field.label;
    form.append(label, field.control);
  }
  if (options.note) {
    const note = document.createElement('p');
    note.className = 'easyview-settings-note';
    note.textContent = options.note;
    form.appendChild(note);
  }
  const error = document.createElement('p');
  error.className = 'easyview-settings-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  form.appendChild(error);
  const setError = (message: string | null) => {
    error.textContent = message ?? '';
    error.hidden = !message;
  };

  const footer = document.createElement('div');
  footer.className = 'easyview-settings-footer';
  const cancel = footerButton(tSettingsDialog('close'), false, close);
  const save = footerButton(tSettingsDialog('save'), true, () => {
    setError(null);
    const result = options.onSave();
    if (result === false) return;
    if (!(result instanceof Promise)) {
      close();
      return;
    }
    save.disabled = true;
    result.then(close, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      save.disabled = false;
    });
  });
  footer.append(cancel, save);

  dialog.append(header, form, footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.focus({ preventScroll: true });
  return { element: overlay, close, setError };
}

export function settingsCheckbox(text: string, checked: boolean, onChange: (checked: boolean) => void): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'easyview-settings-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  span.textContent = text;
  label.append(input, span);
  return label;
}

/** A control with a muted hint line under it. */
export function settingsFieldWithHint(control: HTMLElement, hint: string): HTMLElement {
  const stack = document.createElement('div');
  stack.className = 'easyview-settings-stack';
  const text = document.createElement('span');
  text.className = 'easyview-settings-hint';
  text.textContent = hint;
  stack.append(control, text);
  return stack;
}

function footerButton(text: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'easyview-settings-button is-primary' : 'easyview-settings-button';
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

export function ensureSettingsDialogStyles(): void {
  if (document.getElementById('easyview-settings-dialog-styles')) return;
  const style = document.createElement('style');
  style.id = 'easyview-settings-dialog-styles';
  style.textContent = `
.easyview-settings-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px;background:color-mix(in srgb,#000 32%,transparent)}
.easyview-settings-dialog{--es-accent:var(--mdpre-accent,var(--vscode-button-background,#0e639c));--es-border:color-mix(in srgb,currentColor 14%,transparent);display:flex;flex-direction:column;box-sizing:border-box;width:min(520px,100%);max-height:100%;overflow:hidden;border:1px solid var(--vscode-widget-border,var(--es-border));border-radius:10px;color:var(--vscode-editorWidget-foreground,var(--vscode-foreground,#ccc));background:var(--vscode-editorWidget-background,var(--vscode-menu-background,#252526));box-shadow:0 12px 40px color-mix(in srgb,#000 38%,transparent);font-family:var(--vscode-font-family,system-ui,sans-serif);font-size:13px;line-height:1.5;user-select:none;outline:none}
.easyview-settings-header{display:flex;flex:none;align-items:center;gap:8px;padding:14px 14px 10px 20px}
.easyview-settings-title{flex:1;min-width:0;margin:0;overflow:hidden;font-size:14px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.easyview-settings-close{flex:none;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;font-size:18px;line-height:1;cursor:pointer;opacity:.6}
.easyview-settings-close:hover{opacity:1;background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.16))}
.easyview-settings-form{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:14px 24px;min-height:0;overflow:auto;padding:6px 20px 20px}
.easyview-settings-label{color:var(--vscode-descriptionForeground,inherit);opacity:.85;white-space:nowrap}
.easyview-settings-error{grid-column:1/-1;margin:0;color:var(--vscode-errorForeground,#f48771)}
.easyview-settings-error[hidden]{display:none}
.easyview-settings-input{justify-self:start;box-sizing:border-box;width:110px;height:30px;padding:0 10px;border:1px solid var(--vscode-input-border,var(--es-border));border-radius:6px;color:var(--vscode-input-foreground,inherit);background:var(--vscode-input-background,transparent);font:inherit;font-variant-numeric:tabular-nums;user-select:text}
.easyview-settings-input.is-wide{justify-self:stretch;width:100%}
.easyview-settings-textarea{box-sizing:border-box;width:100%;min-height:64px;padding:6px 10px;border:1px solid var(--vscode-input-border,var(--es-border));border-radius:6px;color:var(--vscode-input-foreground,inherit);background:var(--vscode-input-background,transparent);font:inherit;line-height:1.5;resize:vertical;user-select:text}
.easyview-settings-textarea:focus{outline:1px solid var(--vscode-focusBorder,var(--es-accent));outline-offset:-1px}
.easyview-settings-label.is-top{align-self:start;padding-top:5px}
.easyview-settings-stack{display:flex;flex-direction:column;gap:4px;min-width:0}
.easyview-settings-inline{display:flex;align-items:center;gap:10px;min-width:0}
.easyview-settings-hint{font-size:12px;opacity:.6}
.easyview-settings-hint.is-ok{color:var(--vscode-testing-iconPassed,#3fa266);opacity:1}
.easyview-settings-note{grid-column:1/-1;margin:0;padding-top:12px;border-top:1px solid var(--es-border);font-size:12px;line-height:1.6;opacity:.6;user-select:text}
.easyview-settings-input:focus{outline:1px solid var(--vscode-focusBorder,var(--es-accent));outline-offset:-1px}
.easyview-settings-segmented{display:inline-flex;justify-self:start;max-width:100%;padding:2px;border:1px solid var(--es-border);border-radius:7px;background:color-mix(in srgb,currentColor 4%,transparent)}
.easyview-settings-segmented button{display:inline-flex;align-items:center;gap:6px;min-width:0;height:28px;padding:0 12px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;white-space:nowrap;cursor:pointer;opacity:.75}
.easyview-settings-segmented button:hover{opacity:1}
.easyview-settings-segmented button[aria-checked='true']{opacity:1;color:var(--vscode-button-foreground,#fff);background:var(--es-accent)}
.easyview-settings-segment-icon{display:inline-flex}.easyview-settings-segment-icon svg{display:block;width:14px;height:14px}
.easyview-settings-stepper{display:flex;align-items:center;gap:10px}
.easyview-settings-stepper-box{display:inline-flex;align-items:center;border:1px solid var(--es-border);border-radius:7px;overflow:hidden}
.easyview-settings-stepper-box button{width:30px;height:30px;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:15px;cursor:pointer}
.easyview-settings-stepper-box button:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.16))}
.easyview-settings-stepper-box button:disabled{opacity:.35;cursor:default}
.easyview-settings-stepper-value{min-width:52px;text-align:center;font-variant-numeric:tabular-nums;border-inline:1px solid var(--es-border);line-height:30px}
.easyview-settings-link{padding:0;border:0;background:transparent;color:var(--vscode-textLink-foreground,var(--es-accent));font:inherit;cursor:pointer}
.easyview-settings-link:disabled{color:inherit;opacity:.35;cursor:default}
.easyview-settings-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px}
.easyview-settings-check{display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer}
.easyview-settings-check input{flex:none;width:15px;height:15px;margin:0;accent-color:var(--es-accent);cursor:pointer}
.easyview-settings-check span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.easyview-settings-footer{display:flex;flex:none;justify-content:center;gap:12px;padding:12px 20px;border-top:1px solid var(--es-border);background:color-mix(in srgb,currentColor 3%,transparent)}
.easyview-settings-button{min-width:76px;height:30px;padding:0 16px;border:1px solid var(--es-border);border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.easyview-settings-button:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.16))}
.easyview-settings-button:disabled{opacity:.5;cursor:default}
.easyview-settings-button.is-primary{border-color:transparent;color:var(--vscode-button-foreground,#fff);background:var(--es-accent)}
.easyview-settings-button.is-primary:hover:not(:disabled){background:color-mix(in srgb,var(--es-accent) 85%,#fff)}
.easyview-settings-dialog button:focus-visible,.easyview-settings-check input:focus-visible{outline:1px solid var(--vscode-focusBorder,var(--es-accent));outline-offset:1px}
@media (max-width:420px){.easyview-settings-form{grid-template-columns:minmax(0,1fr);gap:6px}.easyview-settings-form>.easyview-settings-label:not(:first-child){margin-top:8px}.easyview-settings-checks{grid-template-columns:minmax(0,1fr)}}
`;
  document.head.appendChild(style);
}
