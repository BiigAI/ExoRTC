import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use 
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),

    // Hotkey events from main process
    onHotkey: (callback: (data: { key: string; pressed: boolean }) => void) => {
        ipcRenderer.on('hotkey', (event, data) => callback(data));
    },

    // Remove hotkey listener
    removeHotkeyListener: () => {
        ipcRenderer.removeAllListeners('hotkey');
    }
});

// Type definitions for the exposed API
declare global {
    interface Window {
        electronAPI: {
            getSettings: () => Promise<{
                pttKey: string;
                shoutKey: string;
                inputDevice: string;
                outputDevice: string;
            }>;
            saveSettings: (settings: any) => Promise<boolean>;
            onHotkey: (callback: (data: { key: string; pressed: boolean }) => void) => void;
            removeHotkeyListener: () => void;
        };
    }
}
