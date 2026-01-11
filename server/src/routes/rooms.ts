import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import {
    createRoom,
    getRoomsByServerId,
    getRoomById,
    deleteRoom,
    getRoomsWithMembers
} from '../services/rooms';
import { isServerAdmin, getServerById, canCreateChannels, getUserRole } from '../services/servers';

const router = Router();

// We'll get io from the main module when needed
let ioInstance: any = null;
export function setSocketIO(io: any) {
    ioInstance = io;
}

// All routes require authentication
router.use(authMiddleware);

// GET /api/servers/:serverId/rooms - List rooms in a server
router.get('/servers/:serverId/rooms', (req: AuthenticatedRequest, res: Response) => {
    const { serverId } = req.params;

    const server = getServerById(serverId);
    if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
    }

    const rooms = getRoomsWithMembers(serverId);
    res.json({ rooms });
});

// POST /api/servers/:serverId/rooms - Create a room (pmc_member, admin, owner)
router.post('/servers/:serverId/rooms', (req: AuthenticatedRequest, res: Response) => {
    const { serverId } = req.params;
    const { name, voice_mode } = req.body;

    const userRole = getUserRole(req.user!.id, serverId);
    if (!canCreateChannels(userRole)) {
        res.status(403).json({ error: 'Permission denied: cannot create channels' });
        return;
    }

    if (!name || name.trim().length === 0) {
        res.status(400).json({ error: 'Room name is required' });
        return;
    }

    const voiceMode = voice_mode === 'open' ? 'open' : 'ptt';
    const room = createRoom(serverId, name.trim(), voiceMode);

    // Broadcast to all users subscribed to this server
    if (ioInstance) {
        ioInstance.to(`server:${serverId}`).emit('rooms-updated');
    }

    res.status(201).json({ room });
});

// GET /api/rooms/:id - Get room details
router.get('/rooms/:id', (req: AuthenticatedRequest, res: Response) => {
    const room = getRoomById(req.params.id);

    if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
    }

    res.json({ room });
});

// DELETE /api/rooms/:id - Delete a room (pmc_member, admin, owner)
router.delete('/rooms/:id', (req: AuthenticatedRequest, res: Response) => {
    const room = getRoomById(req.params.id);

    if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
    }

    const userRole = getUserRole(req.user!.id, room.server_id);
    if (!canCreateChannels(userRole)) {
        res.status(403).json({ error: 'Permission denied: cannot delete channels' });
        return;
    }

    // Broadcast room deletion to kick users before deleting
    if (ioInstance) {
        ioInstance.to(`room:${req.params.id}`).emit('room-deleted', { roomId: req.params.id });
        ioInstance.to(`server:${room.server_id}`).emit('rooms-updated');
    }

    const success = deleteRoom(req.params.id);
    res.json({ success });
});

export default router;
