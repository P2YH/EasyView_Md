import type { LocalHistorySettings } from '@easyview/contracts';
export async function showHistorySettingsDialog(load: () => Promise<LocalHistorySettings>, save: (settings: LocalHistorySettings) => Promise<void>): Promise<void> {
  const settings = await load();
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'background:var(--vscode-editor-background,#222);color:var(--vscode-editor-foreground,#eee);border:1px solid #666;padding:24px;min-width:320px';
  const title = document.createElement('h3'); title.textContent = '本地历史设置'; dialog.append(title);
  const enabled = document.createElement('input'); enabled.type='checkbox'; enabled.checked=settings.enabled;
  const toggle = document.createElement('label'); toggle.textContent='启用本地历史 '; toggle.append(enabled); dialog.append(toggle);
  const fields: Array<[keyof Pick<LocalHistorySettings,'maxFileSize'|'maxFileEntries'|'mergeWindow'>,string,number]> = [['maxFileSize','最大文件大小（KiB）',1],['maxFileEntries','每文件最多版本数（0 表示不记录）',0],['mergeWindow','同来源保存合并窗口（秒）',1]];
  const inputs = new Map<string, HTMLInputElement>();
  for (const [key,label,min] of fields) {
    const row=document.createElement('label');row.style.cssText='display:flex;justify-content:space-between;gap:16px;margin-top:14px';row.textContent=label;
    const input=document.createElement('input');input.type='number';input.min=String(min);input.value=String(settings[key]);input.style.width='80px';inputs.set(key,input);row.append(input);dialog.append(row);
  }
  const error=document.createElement('p');error.style.color='#f88';dialog.append(error);
  const cancel=document.createElement('button');cancel.textContent='取消';cancel.onclick=()=>dialog.close();
  const confirm=document.createElement('button');confirm.textContent='保存';confirm.style.marginLeft='12px';
  confirm.onclick=()=>{
    const next={ enabled:enabled.checked,maxFileSize:Number(inputs.get('maxFileSize')!.value),maxFileEntries:Number(inputs.get('maxFileEntries')!.value),mergeWindow:Number(inputs.get('mergeWindow')!.value) };
    if (fields.some(([key,,min])=>!Number.isInteger(next[key])||next[key]<min)){error.textContent='请填写有效的整数';return;}
    confirm.disabled=true;void save(next).then(()=>dialog.close()).catch((cause)=>{error.textContent=String(cause);confirm.disabled=false;});
  };
  dialog.append(cancel,confirm);document.body.append(dialog);
  await new Promise<void>((resolve)=>{dialog.addEventListener('close',()=>{dialog.remove();resolve();},{once:true});dialog.showModal();});
}
