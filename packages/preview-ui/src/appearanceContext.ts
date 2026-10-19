import * as React from 'react';
import type { PreviewThemeMode } from './theme';

/** File-scoped appearance for simple viewers hosted by the shared document chrome. */
export const PreviewAppearanceContext = React.createContext<PreviewThemeMode | undefined>(undefined);
