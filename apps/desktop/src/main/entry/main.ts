import { installAppLogger } from '../application/help/appLogger';
installAppLogger();
import { desktopStarted } from '../adapters/electron/desktopHost';
import { startUpdateService } from '../application/update/updateService';
void desktopStarted.then(() => startUpdateService());
