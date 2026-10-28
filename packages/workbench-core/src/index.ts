import { mountDesktopWorkbench } from './renderer/workbench';
import type { WorkbenchHost } from './host';

export type { WorkbenchHost } from './host';
export { mountDesktopWorkbench } from './renderer/workbench';

/** One browser document owns one shell; the host owns durable flush and close decisions. */
export function createEasyViewWorkbench(options: {
  host: WorkbenchHost;
  showAiChatOnWelcome?: boolean;
  flush(): Promise<void>;
  requestClose(): Promise<boolean>;
}) {
  const shell = mountDesktopWorkbench(options.host, { showAiChatOnWelcome: options.showAiChatOnWelcome });
  return {
    ...shell,
    async openDocument(relativePath: string) {
      await shell.ready;
      const result = await options.host.tabs.openWorkspaceEntry(relativePath);
      if (!result.ok) throw new Error(result.message);
    },
    flush: options.flush,
    requestClose: options.requestClose,
  };
}
