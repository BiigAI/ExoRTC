import { BrowserWindow } from 'electron';

// Note: uiohook-napi requires native compilation, we'll use a keyboard event polling approach
// as a fallback for simplicity. In production, you'd want to ensure uiohook-napi builds correctly.

let pttKey = 'KeyV';
let shoutKey = 'KeyB';
let isPttPressed = false;
let isShoutPressed = false;
let targetWindow: BrowserWindow | null = null;
let pollInterval: NodeJS.Timeout | null = null;

interface KeyState {
    [key: string]: boolean;
}

const keyState: KeyState = {};

export function setupHotkeys(window: BrowserWindow): void {
    targetWindow = window;

    // Try to use uiohook-napi for global hotkeys
    try {
        const { uIOhook, UiohookKey } = require('uiohook-napi');

        uIOhook.on('keydown', (e: any) => {
            handleKeyDown(e.keycode);
        });

        uIOhook.on('keyup', (e: any) => {
            handleKeyUp(e.keycode);
        });

        uIOhook.start();
        console.log('Global hotkeys initialized with uiohook-napi');
    } catch (error) {
        console.warn('uiohook-napi not available, using fallback');
        // Fallback: use IPC from renderer for hotkeys when window is focused
        // Global hotkeys will only work when focused in this case
    }
}

function handleKeyDown(keycode: number): void {
    if (!targetWindow) return;

    // V key (keycode 47 for uiohook)
    if (keycode === 47 && !isPttPressed) {
        isPttPressed = true;
        targetWindow.webContents.send('hotkey', { key: 'ptt', pressed: true });
    }
    // B key (keycode 48 for uiohook)
    if (keycode === 48 && !isShoutPressed) {
        isShoutPressed = true;
        targetWindow.webContents.send('hotkey', { key: 'shout', pressed: true });
    }
}

function handleKeyUp(keycode: number): void {
    if (!targetWindow) return;

    if (keycode === 47 && isPttPressed) {
        isPttPressed = false;
        targetWindow.webContents.send('hotkey', { key: 'ptt', pressed: false });
    }
    if (keycode === 48 && isShoutPressed) {
        isShoutPressed = false;
        targetWindow.webContents.send('hotkey', { key: 'shout', pressed: false });
    }
}

export function cleanupHotkeys(): void {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }

    try {
        const { uIOhook } = require('uiohook-napi');
        uIOhook.stop();
    } catch {
        // uiohook not available
    }
}

export function updatePttKey(key: string): void {
    pttKey = key;
}

export function updateShoutKey(key: string): void {
    shoutKey = key;
}
