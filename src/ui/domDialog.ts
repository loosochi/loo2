/**
 * Small HTML overlay for text entry (player name, level share codes). Canvas games cannot
 * show a native keyboard, so text input uses a real <input>/<textarea> on top of the canvas.
 */
export interface DialogButton {
  label: string;
  primary?: boolean;
  /** Return false to keep the dialog open. */
  action: (value: string) => boolean | void;
}

export interface DialogOptions {
  title: string;
  help?: string;
  value?: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  readOnlySelect?: boolean;
  buttons: DialogButton[];
}

const STYLE_ID = 'tf-dialog-style';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.tf-dlg-back{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:16px;background:rgba(18,23,34,.72);
  font-family:"Segoe UI","Helvetica Neue",Roboto,Arial,sans-serif;color:#f4f6fb;touch-action:auto;user-select:text;-webkit-user-select:text}
.tf-dlg{width:min(460px,100%);box-sizing:border-box;background:#252d40;border:1.5px solid #3d4866;border-radius:20px;padding:20px;
  box-shadow:0 8px 30px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:12px}
.tf-dlg h2{margin:0;font-size:20px;letter-spacing:.04em;text-align:center}
.tf-dlg p{margin:0;color:#9aa4bf;font-size:14px;line-height:1.4;text-align:center}
.tf-dlg input,.tf-dlg textarea{box-sizing:border-box;width:100%;border-radius:12px;border:1.5px solid #3d4866;background:#121722;
  color:#f4f6fb;font-size:17px;padding:12px;font-family:inherit;outline:none}
.tf-dlg textarea{min-height:110px;font-family:"SF Mono",Consolas,"Roboto Mono",monospace;font-size:13px;word-break:break-all;resize:vertical}
.tf-dlg input:focus,.tf-dlg textarea:focus{border-color:#4cc9f0}
.tf-dlg .tf-row{display:flex;gap:10px;flex-wrap:wrap}
.tf-dlg button{flex:1 1 120px;min-height:46px;border-radius:14px;border:1.5px solid #3d4866;background:#303a52;color:#f4f6fb;
  font-weight:700;font-size:15px;letter-spacing:.04em;cursor:pointer;font-family:inherit}
.tf-dlg button.primary{background:#4cc9f0;border-color:#8fe3f8;color:#0f1522}
.tf-dlg button:focus-visible{outline:3px solid #ffd166;outline-offset:2px}
.tf-dlg .tf-msg{min-height:18px;color:#ffc94a;font-size:13px;text-align:center}`;
  document.head.appendChild(st);
}

export interface DialogHandle {
  close(): void;
  setMessage(text: string): void;
  input: HTMLInputElement | HTMLTextAreaElement;
}

export function openDialog(o: DialogOptions): DialogHandle {
  ensureStyle();
  const back = document.createElement('div');
  back.className = 'tf-dlg-back';
  const box = document.createElement('div');
  box.className = 'tf-dlg';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const h = document.createElement('h2');
  h.textContent = o.title;
  box.appendChild(h);
  if (o.help) {
    const p = document.createElement('p');
    p.textContent = o.help;
    box.appendChild(p);
  }
  const input = o.multiline ? document.createElement('textarea') : document.createElement('input');
  input.id = 'tf-dialog-input';
  input.value = o.value ?? '';
  if (o.placeholder) input.placeholder = o.placeholder;
  if (o.maxLength) input.maxLength = o.maxLength;
  input.setAttribute('aria-label', o.title);
  input.spellcheck = false;
  box.appendChild(input);
  const msg = document.createElement('div');
  msg.className = 'tf-msg';
  box.appendChild(msg);
  const row = document.createElement('div');
  row.className = 'tf-row';
  box.appendChild(row);

  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const run = (b: DialogButton) => {
    if (b.action(input.value) !== false) close();
  };
  for (const b of o.buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.label;
    if (b.primary) btn.className = 'primary';
    btn.addEventListener('click', () => run(b));
    row.appendChild(btn);
  }
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && !o.multiline) {
      const primary = o.buttons.find((b) => b.primary) ?? o.buttons[0];
      if (primary) run(primary);
    }
  };
  document.addEventListener('keydown', onKey, true);
  // Keep canvas input handlers from seeing dialog pointer events.
  for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'wheel']) {
    back.addEventListener(ev, (e) => e.stopPropagation());
  }
  back.appendChild(box);
  document.body.appendChild(back);
  setTimeout(() => {
    input.focus();
    if (o.readOnlySelect) input.select();
  }, 30);
  return { close, setMessage: (t) => (msg.textContent = t), input };
}
