import { installAppLogger } from '../application/help/appLogger';
installAppLogger();
import '../adapters/electron/desktopHost';
import { app } from 'electron';
import { startUpdateService } from '../application/update/updateService';
void app.whenReady().then(() => startUpdateService());
