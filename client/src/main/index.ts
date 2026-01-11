import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { setupHotkeys, cleanupHotkeys } from './hotkeys';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 600,
        minHeight: 500,
        backgroundColor: '#1a1a2e',
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        titleBarStyle: 'default',
        frame: true
    });

    // Load the main HTML file
    if (app.isPackaged) {
        mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));
    }

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Set up global hotkeys
    setupHotkeys(mainWindow);
}

// IPC handlers
ipcMain.handle('get-settings', async () => {
    // Return stored settings (placeholder for now)
    return {
        pttKey: 'V',
        shoutKey: 'B',
        inputDevice: 'default',
        outputDevice: 'default'
    };
});

ipcMain.handle('save-settings', async (event, settings) => {
    // Save settings (placeholder for now)
    console.log('Saving settings:', settings);
    return true;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    cleanupHotkeys();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

export { mainWindow };
