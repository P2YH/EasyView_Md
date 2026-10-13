import { migrateRenamedHistory } from '../src/timeline/migrate-history';
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, realpath, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { LocalHistoryStore } from '../src/timeline/local-history';
import { TimelineService } from '../src/timeline/timeline-service';
import { hostHistoryHash, hostHistoryUri } from '../src/timeline/history-roots';
import { TimelineChannel } from '../src/timeline/timeline-channel';
import { HistoryTaskQueue } from '../src/timeline/task-queue';
const directories: string[] = [];
async function temporary() { const directory = await mkdtemp(path.join(tmpdir(), 'easyview-timeline-')); directories.push(directory); return directory; }
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
describe('persistent local history', () => {
  it('coalesces captures, protects pre-restore snapshots and releases queues', async () => {
    const directory = await temporary(), file = path.join(directory, '中文.md');
    const store = new LocalHistoryStore(path.join(directory,'history'));
    await store.capture(file, '# old'); await store.capture(file, '# new');
    expect(await store.list(file)).toHaveLength(1);
    await store.preserve(file, '# new', '恢复前磁盘内容');
    await store.capture(file, '# next');
    expect(await store.list(file)).toHaveLength(3);
    expect(await store.read((await store.list(file))[1])).toBe('# new');
    await Promise.all(Array.from({length:100},(_,i) => store.capture(file, `# v${i}`)));
    await store.flush();
    expect(store.diagnostics).toEqual({ queues: 0, pending: 0 });
    expect(await store.read((await store.list(file)).at(-1)!)).toBe('# v99');
    await store.migrate(file,path.join(directory,'renamed.md'));
    expect(await store.list(file)).toHaveLength(0);
    expect(await store.list(path.join(directory,'renamed.md'))).toHaveLength(3);
  });
  it('limits normal captures without blocking mandatory recovery snapshots', async () => {
    const directory=await temporary(), file=path.join(directory,'note.md'), store=new LocalHistoryStore(path.join(directory,'history'));
    const settings={ enabled:true,maxFileSize:1,maxFileEntries:2,mergeWindow:0 };
    await store.capture(file,'x'.repeat(1025),'文件已保存',settings);
    expect(await store.list(file)).toHaveLength(0);
    for(let i=0;i<4;i++) await store.capture(file,String(i),'文件已保存',settings);
    expect(await store.list(file)).toHaveLength(2);
    await store.preserve(file,'x'.repeat(1025),'恢复前未保存内容');
    expect(await store.read((await store.list(file)).at(-1)!)).toHaveLength(1025);
  });
});
describe('host and Git histories', () => {
  it('rejects malformed timeline messages with a controlled error', async () => {
    const service = new TimelineService(path.join(await temporary(), 'history'));
    const channel = new TimelineChannel({ service, authorize: async (file) => file, current: async () => '', open: async () => undefined, restore: async () => undefined, post: () => undefined });
    await expect(channel.handle(null as never)).rejects.toThrow('Timeline 请求无效');
    channel.dispose(); service.dispose();
  });
  it('reads the selected host index only and reports incompatible indices independently', async () => {
    const directory=await temporary(), file=path.join(directory,'中文 文档.md'), root=path.join(directory,'Code/History');
    const folder=path.join(root,hostHistoryHash(pathToFileURL(file).toString())); await mkdir(folder,{recursive:true});
    await writeFile(path.join(folder,'entry.md'),'host version');
    await writeFile(path.join(folder,'entries.json'),JSON.stringify({version:1,resource:pathToFileURL(file).toString(),entries:[{id:'entry.md',timestamp:1}]}));
    const service=new TimelineService(path.join(directory,'local'),[{source:'vscode',path:root}]);
    const page=await service.list(file,['local','vscode']); expect(page.entries).toHaveLength(1);
    expect(await service.read(page.entries[0])).toBe('host version');
    expect((await service.compare(page.entries[0],'current')).content).toBe('current');
    for(let i=0;i<100;i++){const watch=service.watch(file,()=>undefined);watch.dispose();}
    expect(service.diagnostics.watchers).toBe(0);
    await writeFile(path.join(folder,'entries.json'),JSON.stringify({version:2,resource:pathToFileURL(file).toString(),entries:[]}));
    await service.local.capture(file,'local version');
    const incompatible=await service.list(file,['local','vscode']); expect(incompatible.entries).toHaveLength(1); expect(incompatible.errors[0].source).toBe('vscode');
    service.dispose();
  });
  it('paginates Git renames and compares against the previous file revision', async () => {
    const directory=await temporary(), file=path.join(directory,'新名称.md');
    const git=(...args:string[]) => execFileSync('git',['-C',directory,...args],{encoding:'utf8'}).trim();
    git('init','-q');git('config','user.name','Timeline Test');git('config','user.email','timeline@example.test');
    await writeFile(path.join(directory,'旧名称.md'),'# first\n');git('add','.');git('commit','-qm','first');
    git('mv','旧名称.md','新名称.md');git('commit','-qm','rename');
    await writeFile(file,'# third\n');git('add','.');git('commit','-qm','third');
    const service=new TimelineService(path.join(directory,'history'));
    const page=await service.list(file,['git']);expect(page.errors).toEqual([]);expect(page.entries).toHaveLength(3);
    const third=page.entries.find(e=>e.label==='third')!, first=page.entries.find(e=>e.label==='first')!;
    const compare=await service.compare(third,'irrelevant');expect(compare.base).toBe('# first\n');expect(compare.content).toBe('# third\n');
    expect(first.versionPath).toBe('旧名称.md');expect((await service.compare(first,'irrelevant')).base).toBe('');
    const index=git('write-tree'), head=git('rev-parse','HEAD');
    await writeFile(file,await service.read(first));expect(git('write-tree')).toBe(index);expect(git('rev-parse','HEAD')).toBe(head);
    service.dispose();
  });
});
it('cancels queued work and prevents an outdated watch from being attached',async()=>{
  const queue=new HistoryTaskQueue(1);let release!:()=>void;const held=queue.run(()=>new Promise<void>(resolve=>release=resolve));
  const abort=new AbortController();const canceled=queue.run(async()=>{throw new Error('must not run');},abort.signal);abort.abort();await expect(canceled).rejects.toThrow('取消');release();await held;
  const directory=await temporary(),service=new TimelineService(path.join(directory,'history'));
  let resolve!: (value:string)=>void;
  const channel=new TimelineChannel({service,authorize:()=>new Promise<string>(r=>resolve=r),current:async()=>'',open:async()=>{},restore:async()=>{},post:()=>{}});
  const pending=channel.handle({type:'timeline.watch',filePath:path.join(directory,'a.md')});
  await channel.handle({type:'timeline.watch',filePath:null});resolve(path.join(directory,'a.md'));await pending;
  expect(channel.diagnostics.subscriptions).toBe(0);channel.dispose();service.dispose();
});

it('pages Git history without repeating versions or losing pre-rename paths',async()=>{
  const directory=await temporary(),file=path.join(directory,'new.md');
  const git=(...args:string[])=>execFileSync('git',['-C',directory,...args],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Timeline Test');git('config','user.email','timeline@example.test');git('config','commit.gpgsign','false');
  const service=new TimelineService(path.join(directory,'history'));
  await writeFile(file,'0');expect((await service.list(file,['git'])).errors).toEqual([]);await rm(file);
  await writeFile(path.join(directory,'old.md'),'# 0\n');git('add','old.md');git('commit','-qm','v0');
  git('mv','old.md','new.md');git('commit','-qm','rename');
  for(let i=1;i<53;i++){await writeFile(file,`# ${i}\n`);git('add','new.md');git('commit','-qm',`v${i}`);}
  const first=await service.list(file,['git']);expect(first.entries).toHaveLength(50);expect(first.cursor).toBeTruthy();
  const second=await service.list(file,['git'],first.cursor);expect(second.entries).toHaveLength(4);
  const ids=[...first.entries,...second.entries].map(entry=>entry.id);expect(new Set(ids).size).toBe(54);
  const oldest=second.entries.at(-1)!;expect(oldest.versionPath).toBe('old.md');expect(await service.read(oldest)).toBe('# 0\n');service.dispose();
});

it('uses VS Code file URI encoding for Windows drives, UNC paths and reserved characters',()=>{
  expect(hostHistoryUri('C:\\Users\\Name\\notes.md')).toBe('file:///c%3A/Users/Name/notes.md');
  expect(hostHistoryUri('\\\\Server\\Share\\notes.md')).toBe('file://server/Share/notes.md');
  expect(hostHistoryUri('/Users/name/a:b.md')).toBe('file:///Users/name/a%3Ab.md');
});

it('migrates closed-file histories through directory renames and merges a new-path capture',async()=>{
  const directory=await temporary(),oldDirectory=path.join(directory,'old'),nextDirectory=path.join(directory,'next');
  await mkdir(path.join(oldDirectory,'nested'),{recursive:true});const oldFile=path.join(oldDirectory,'nested','notes.md');await writeFile(oldFile,'current');
  const canonicalOld=await realpath(oldFile),store=new LocalHistoryStore(path.join(directory,'history'));
  await store.capture(canonicalOld,'old version');await rename(oldDirectory,nextDirectory);
  const canonicalNext=await realpath(path.join(nextDirectory,'nested','notes.md'));await store.capture(canonicalNext,'current');
  await migrateRenamedHistory(store,oldDirectory,nextDirectory);
  expect(await store.list(canonicalOld)).toHaveLength(0);const entries=await store.list(canonicalNext);expect(entries).toHaveLength(2);
  expect(await store.read(entries[0])).toBe('old version');expect(await store.read(entries[1])).toBe('current');expect(store.diagnostics).toEqual({queues:0,pending:0});
});
