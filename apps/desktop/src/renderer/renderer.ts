import type { EasyViewDesktopApi } from '@easyview/workbench-core/host';
import { mountDesktopWorkbench } from '@easyview/workbench-core';

declare const window: Window & { easyViewDesktop: EasyViewDesktopApi };
const api = window.easyViewDesktop;
void mountDesktopWorkbench(api).ready;
