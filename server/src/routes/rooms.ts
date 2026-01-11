import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import {
    createRoom,
    getRoomsByServerId,
    getRoomById,
    deleteRoom,
    getRoomsWithMemberCounts
} from '../services/rooms';
import { isServerAdmin, getServerById } from '../services/servers';

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

    const rooms = getRoomsWithMemberCounts(serverId);
    res.json({ rooms });
});

// POST /api/servers/:serverId/rooms - Create a room (admin only)
router.post('/servers/:serverId/rooms', (req: AuthenticatedRequest, res: Response) => {
    const { serverId } = req.params;
    const { name } = req.body;

    if (!isServerAdmin(req.user!.id, serverId)) {
        res.status(403).json({ error: 'Admin permission required' });
        return;
    }

    if (!name || name.trim().length === 0) {
        res.status(400).json({ error: 'Room name is required' });
        return;
    }

    const room = createRoom(serverId, name.trim());

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

// DELETE /api/rooms/:id - Delete a room (admin only)
router.delete('/rooms/:id', (req: AuthenticatedRequest, res: Response) => {
    const room = getRoomById(req.params.id);

    if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
    }

    if (!isServerAdmin(req.user!.id, room.server_id)) {
        res.status(403).json({ error: 'Admin permission required' });
        return;
    }

    const success = deleteRoom(req.params.id);
    res.json({ success });
});

export default router;
