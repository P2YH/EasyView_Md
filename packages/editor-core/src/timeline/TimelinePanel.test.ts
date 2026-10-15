/** @vitest-environment happy-dom */
import { it, expect, vi } from 'vitest';
import { TimelinePanel } from './TimelinePanel';
import type { TimelineClient } from '@easyview/contracts';
it('releases selected-file subscriptions after 100 expand/collapse cycles and ignores stale queries',async()=>{
  let active=0,peak=0;
  const client:TimelineClient={
    list:vi.fn(async()=>({entries:[],errors:[]})),open:vi.fn(async()=>{}),restore:vi.fn(async()=>{}),
    watch:()=>{active++;peak=Math.max(peak,active);return{dispose:()=>active--};},loadState:()=>undefined,saveState:vi.fn(),
  };
  const panel=new TimelinePanel(client);document.body.append(panel.element);panel.setFile('/project/test.md');
  const header=panel.element.querySelector<HTMLButtonElement>('.easyview-timeline-header')!;
  for(let i=0;i<100;i++){header.click();expect(active).toBe(0);header.click();expect(active).toBe(1);}
  expect(peak).toBe(1);panel.setVisible(false);expect(active).toBe(0);
  const before=vi.mocked(client.list).mock.calls.length;await Promise.resolve();expect(vi.mocked(client.list).mock.calls.length).toBe(before);
  panel.dispose();panel.dispose();expect(document.querySelector('.easyview-timeline')).toBeNull();expect(active).toBe(0);
});

it('uses a fixed title and an initially fully selected source dropdown', async()=>{
  const client:TimelineClient={list:vi.fn(async()=>({entries:[],errors:[]})),open:vi.fn(async()=>{}),restore:vi.fn(async()=>{}),watch:()=>({dispose:()=>{}}),loadState:()=>undefined,saveState:vi.fn()};
  const panel=new TimelinePanel(client);document.body.append(panel.element);panel.setFile('/project/notes.md');
  expect(panel.element.querySelector('.easyview-timeline-header')?.textContent?.trim()).toBe('⌄  时间线');
  expect(panel.element.querySelector('.easyview-timeline-tools')?.textContent).not.toContain('Cursor');
  const filter=panel.element.querySelector<HTMLButtonElement>('[aria-label="筛选来源"]')!;filter.click();
  const options=[...document.querySelectorAll<HTMLButtonElement>('.easyview-timeline-filter-menu [role="menuitemcheckbox"]')];
  expect(options.map(option=>option.getAttribute('aria-checked'))).toEqual(['true','true','true','true']);
  options[3].click();await Promise.resolve();
  expect(vi.mocked(client.list).mock.calls.at(-1)?.[1]).toEqual(['local','vscode','cursor']);
  expect(options[3].getAttribute('aria-checked')).toBe('false');
  panel.dispose();expect(document.querySelector('.easyview-timeline-filter-menu')).toBeNull();
});

it('keeps version selection across refresh and recycled rows, and clears it on file changes', async()=>{
  const entries = Array.from({length:50},(_,index)=>({id:String(index),source:'git' as const,filePath:'/project/notes.md',timestamp:index,label:`Version ${index}`}));
  const client:TimelineClient={list:vi.fn(async(filePath)=>({entries:entries.map(entry=>({...entry,filePath})),errors:[]})),open:vi.fn(async()=>{}),restore:vi.fn(async()=>{}),watch:()=>({dispose:()=>{}}),loadState:()=>undefined,saveState:vi.fn()};
  const panel=new TimelinePanel(client);document.body.append(panel.element);panel.setFile('/project/notes.md');
  await vi.waitFor(()=>expect(panel.element.querySelectorAll('.easyview-timeline-entry').length).toBeGreaterThan(0));
  panel.element.querySelector<HTMLButtonElement>('.easyview-timeline-entry')!.click();
  expect(panel.element.querySelectorAll('.easyview-timeline-entry.selected')).toHaveLength(1);
  panel.refresh();await Promise.resolve();
  expect(panel.element.querySelector('.easyview-timeline-entry.selected')?.getAttribute('aria-pressed')).toBe('true');
  const list=panel.element.querySelector<HTMLElement>('.easyview-timeline-list')!;
  list.scrollTop=1000;list.dispatchEvent(new Event('scroll'));
  expect(panel.element.querySelector('.easyview-timeline-entry.selected')).toBeNull();
  list.scrollTop=0;list.dispatchEvent(new Event('scroll'));
  expect(panel.element.querySelector('.easyview-timeline-entry.selected')).not.toBeNull();
  panel.element.querySelectorAll<HTMLButtonElement>('.easyview-timeline-entry')[1].click();
  expect(panel.element.querySelectorAll('.easyview-timeline-entry.selected')).toHaveLength(1);
  expect(panel.element.querySelector('.easyview-timeline-entry.selected')?.textContent).toContain('Version 1');
  panel.setFile('/project/other.md');await Promise.resolve();
  expect(panel.element.querySelector('.easyview-timeline-entry.selected')).toBeNull();
  panel.dispose();
});
