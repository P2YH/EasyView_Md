import type { LocalHistorySettings } from '@easyview/contracts';
import { tTimeline } from './timeline.i18n';
export async function showHistorySettingsDialog(load: () => Promise<LocalHistorySettings>, save: (settings: LocalHistorySettings) => Promise<void>): Promise<void> {
  const settings = await load();
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'background:var(--vscode-editor-background,#222);color:var(--vscode-editor-foreground,#eee);border:1px solid #666;padding:24px;min-width:320px';
  const title = document.createElement('h3'); title.textContent = tTimeline('settings.title'); dialog.append(title);
  const enabled = document.createElement('input'); enabled.type='checkbox'; enabled.checked=settings.enabled;
  const toggle = document.createElement('label'); toggle.textContent=tTimeline('settings.enabled'); toggle.append(enabled); dialog.append(toggle);
  const fields: Array<[keyof Pick<LocalHistorySettings,'maxFileSize'|'maxFileEntries'|'mergeWindow'>,string,number]> = [['maxFileSize',tTimeline('settings.maxFileSize'),1],['maxFileEntries',tTimeline('settings.maxFileEntries'),0],['mergeWindow',tTimeline('settings.mergeWindow'),1]];
  const inputs = new Map<string, HTMLInputElement>();
  for (const [key,label,min] of fields) {
    const row=document.createElement('label');row.style.cssText='display:flex;justify-content:space-between;gap:16px;margin-top:14px';row.textContent=label;
    const input=document.createElement('input');input.type='number';input.min=String(min);input.value=String(settings[key]);input.style.width='80px';inputs.set(key,input);row.append(input);dialog.append(row);
  }
  const error=document.createElement('p');error.style.color='#f88';dialog.append(error);
  const cancel=document.createElement('button');cancel.textContent=tTimeline('settings.cancel');cancel.onclick=()=>dialog.close();
  const confirm=document.createElement('button');confirm.textContent=tTimeline('settings.save');confirm.style.marginLeft='12px';
  confirm.onclick=()=>{
    const next={ enabled:enabled.checked,maxFileSize:Number(inputs.get('maxFileSize')!.value),maxFileEntries:Number(inputs.get('maxFileEntries')!.value),mergeWindow:Number(inputs.get('mergeWindow')!.value) };
    if (fields.some(([key,,min])=>!Number.isInteger(next[key])||next[key]<min)){error.textContent=tTimeline('settings.invalidInteger');return;}
    confirm.disabled=true;void save(next).then(()=>dialog.close()).catch((cause)=>{error.textContent=String(cause);confirm.disabled=false;});
  };
  dialog.append(cancel,confirm);document.body.append(dialog);
  await new Promise<void>((resolve)=>{dialog.addEventListener('close',()=>{dialog.remove();resolve();},{once:true});dialog.showModal();});
}
