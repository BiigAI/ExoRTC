import { Server as SocketServer, Socket } from 'socket.io';
import { verifyToken } from './auth';
import { joinRoom, leaveRoom, getRoomMembers, getRoomById, getUserCurrentRoom } from './rooms';
import { hasShoutPermission, getActiveShoutUsers, canShoutByRole, getActiveShoutListeners } from './permissions';
import { getUserById } from './auth';

interface AuthenticatedSocket extends Socket {
    userId?: string;
    username?: string;
    currentRoomId?: string;
}

interface SignalingData {
    targetUserId: string;
    signal: any;
}

export function initializeSignaling(io: SocketServer): void {
    // Authentication middleware for socket connections
    io.use((socket: AuthenticatedSocket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication required'));
        }

        const payload = verifyToken(token);
        if (!payload) {
            return next(new Error('Invalid token'));
        }

        const user = getUserById(payload.userId);
        if (!user) {
            return next(new Error('User not found'));
        }

        socket.userId = user.id;
        socket.username = user.username;
        next();
    });

    io.on('connection', (socket: AuthenticatedSocket) => {
        console.log(`User connected: ${socket.username} (${socket.userId})`);

        // Subscribe to a server for room updates
        socket.on('subscribe-server', (serverId: string) => {
            socket.join(`server:${serverId}`);
        });

        // Unsubscribe from a server
        socket.on('unsubscribe-server', (serverId: string) => {
            socket.leave(`server:${serverId}`);
        });

        // Join a voice room
        socket.on('join-room', (roomId: string) => {
            if (!socket.userId) return;

            const room = getRoomById(roomId);
            if (!room) {
                socket.emit('error', { message: 'Room not found' });
                return;
            }

            // Leave current room if any
            if (socket.currentRoomId) {
                leaveRoom(socket.userId);
                socket.leave(socket.currentRoomId);
                io.to(socket.currentRoomId).emit('user-left', {
                    userId: socket.userId,
                    username: socket.username
                });
                // Broadcast updated room counts to server
                io.to(`server:${room.server_id}`).emit('rooms-updated');
            }

            // Join new room
            joinRoom(socket.userId, roomId);
            socket.currentRoomId = roomId;
            socket.join(roomId);

            // Get current room members
            const members = getRoomMembers(roomId);

            // Notify room of new user
            socket.to(roomId).emit('user-joined', {
                userId: socket.userId,
                username: socket.username
            });

            // Send current members to the joining user
            socket.emit('room-joined', {
                roomId,
                members: members.filter(m => m.user_id !== socket.userId)
            });

            // Broadcast updated room counts to server
            io.to(`server:${room.server_id}`).emit('rooms-updated');
        });

        // Leave current room
        socket.on('leave-room', () => {
            if (!socket.userId || !socket.currentRoomId) return;

            const room = getRoomById(socket.currentRoomId);
            leaveRoom(socket.userId);
            socket.leave(socket.currentRoomId);

            io.to(socket.currentRoomId).emit('user-left', {
                userId: socket.userId,
                username: socket.username
            });

            // Broadcast updated room counts to server
            if (room) {
                io.to(`server:${room.server_id}`).emit('rooms-updated');
            }

            socket.currentRoomId = undefined;
            socket.emit('room-left');
        });

        // WebRTC signaling: offer
        socket.on('offer', (data: SignalingData) => {
            const targetSocket = findSocketByUserId(io, data.targetUserId);
            if (targetSocket) {
                targetSocket.emit('offer', {
                    fromUserId: socket.userId,
                    fromUsername: socket.username,
                    signal: data.signal
                });
            }
        });

        // WebRTC signaling: answer
        socket.on('answer', (data: SignalingData) => {
            const targetSocket = findSocketByUserId(io, data.targetUserId);
            if (targetSocket) {
                targetSocket.emit('answer', {
                    fromUserId: socket.userId,
                    signal: data.signal
                });
            }
        });

        // WebRTC signaling: ICE candidate
        socket.on('ice-candidate', (data: SignalingData) => {
            const targetSocket = findSocketByUserId(io, data.targetUserId);
            if (targetSocket) {
                targetSocket.emit('ice-candidate', {
                    fromUserId: socket.userId,
                    signal: data.signal
                });
            }
        });

        // Voice activity indicator
        socket.on('speaking', (isSpeaking: boolean) => {
            if (socket.currentRoomId) {
                socket.to(socket.currentRoomId).emit('user-speaking', {
                    userId: socket.userId,
                    username: socket.username,
                    isSpeaking
                });
            }
        });

        // Shout: broadcast to all users who can hear shouts (role-based) in the server
        socket.on('shout-start', (serverId: string) => {
            if (!socket.userId) return;

            // Verify user has shout permission via role
            if (!canShoutByRole(socket.userId, serverId)) {
                socket.emit('error', { message: 'Shout permission required (role-based)' });
                return;
            }

            const shouterRoomId = socket.currentRoomId;

            // Get all users who can hear shouts (squad_leader, pmc_member, admin, owner)
            const listeners = getActiveShoutListeners(serverId);

            // Notify all listeners that a shout is starting
            listeners.forEach(user => {
                if (user.user_id !== socket.userId) {
                    const targetSocket = findSocketByUserId(io, user.user_id);
                    if (targetSocket) {
                        targetSocket.emit('shout-incoming', {
                            fromUserId: socket.userId,
                            fromUsername: socket.username,
                            serverId,
                            shouterRoomId // So listeners can mute shouter from their channel
                        });
                    }
                }
            });

            // Return list of target users for WebRTC connections
            socket.emit('shout-targets', {
                targets: listeners
                    .filter(u => u.user_id !== socket.userId)
                    .map(u => ({ userId: u.user_id, username: u.username }))
            });
        });

        socket.on('shout-end', (serverId: string) => {
            if (!socket.userId) return;

            const listeners = getActiveShoutListeners(serverId);

            listeners.forEach(user => {
                if (user.user_id !== socket.userId) {
                    const targetSocket = findSocketByUserId(io, user.user_id);
                    if (targetSocket) {
                        targetSocket.emit('shout-ended', {
                            fromUserId: socket.userId
                        });
                    }
                }
            });
        });

        // Ping/Pong for latency measurement
        socket.on('ping', (timestamp: number) => {
            socket.emit('pong', timestamp);
        });

        // Handle disconnect
        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.username}`);

            if (socket.userId && socket.currentRoomId) {
                leaveRoom(socket.userId);
                io.to(socket.currentRoomId).emit('user-left', {
                    userId: socket.userId,
                    username: socket.username
                });
            }
        });
    });
}

// Helper to find a socket by user ID
function findSocketByUserId(io: SocketServer, userId: string): AuthenticatedSocket | undefined {
    for (const [, socket] of io.sockets.sockets) {
        if ((socket as AuthenticatedSocket).userId === userId) {
            return socket as AuthenticatedSocket;
        }
    }
    return undefined;
}
