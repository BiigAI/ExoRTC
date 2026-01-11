import { config } from '../config';

const SOCKET_URL = config.SOCKET_URL;

type EventCallback = (...args: any[]) => void;

class SocketManager {
    private socket: any = null;
    private eventHandlers: Map<string, EventCallback[]> = new Map();

    async connect(token: string): Promise<boolean> {
        return new Promise((resolve) => {
            // @ts-ignore - Socket.IO will be loaded from CDN or bundled
            if (typeof io === 'undefined') {
                console.error('Socket.IO not loaded');
                resolve(false);
                return;
            }

            // @ts-ignore
            this.socket = io(SOCKET_URL, {
                auth: { token },
                transports: ['websocket']
            });

            this.socket.on('connect', () => {
                console.log('Socket connected');
                resolve(true);
            });

            this.socket.on('connect_error', (error: any) => {
                console.error('Socket connection error:', error.message);
                resolve(false);
            });

            this.socket.on('disconnect', () => {
                console.log('Socket disconnected');
                this.emit('disconnected');
            });

            // Re-register event handlers
            this.eventHandlers.forEach((handlers, event) => {
                handlers.forEach(handler => {
                    this.socket.on(event, handler);
                });
            });
        });
    }

    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    on(event: string, callback: EventCallback): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event)!.push(callback);

        if (this.socket) {
            this.socket.on(event, callback);
        }
    }

    off(event: string, callback?: EventCallback): void {
        if (callback) {
            const handlers = this.eventHandlers.get(event);
            if (handlers) {
                const index = handlers.indexOf(callback);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
            if (this.socket) {
                this.socket.off(event, callback);
            }
        } else {
            this.eventHandlers.delete(event);
            if (this.socket) {
                this.socket.off(event);
            }
        }
    }

    emit(event: string, ...args: any[]): void {
        if (this.socket) {
            this.socket.emit(event, ...args);
        }
    }

    // Room management
    joinRoom(roomId: string): void {
        this.emit('join-room', roomId);
    }

    leaveRoom(): void {
        this.emit('leave-room');
    }

    // WebRTC signaling
    sendOffer(targetUserId: string, signal: any): void {
        this.emit('offer', { targetUserId, signal });
    }

    sendAnswer(targetUserId: string, signal: any): void {
        this.emit('answer', { targetUserId, signal });
    }

    sendIceCandidate(targetUserId: string, signal: any): void {
        this.emit('ice-candidate', { targetUserId, signal });
    }

    // Voice activity
    setSpeaking(isSpeaking: boolean): void {
        this.emit('speaking', isSpeaking);
    }

    // Shout
    startShout(serverId: string): void {
        this.emit('shout-start', serverId);
    }

    endShout(serverId: string): void {
        this.emit('shout-end', serverId);
    }

    isConnected(): boolean {
        return this.socket?.connected || false;
    }
}

// Export singleton
const socketManager = new SocketManager();
(window as any).socketManager = socketManager;
