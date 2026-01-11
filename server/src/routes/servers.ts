import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import {
    createServer,
    getServersByUserId,
    getServerById,
    joinServer,
    getServerMembers,
    isServerAdmin,
    updateMemberRole,
    canManageMembers,
    getUserRole,
    ServerRole
} from '../services/servers';
import { grantShoutPermission, revokeShoutPermission, getShoutUsers } from '../services/permissions';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// POST /api/servers - Create a new server (admin only)
router.post('/', (req: AuthenticatedRequest, res: Response) => {
    const { name } = req.body;

    // Only app admins can create servers
    if (!req.user?.is_app_admin) {
        res.status(403).json({ error: 'Only app administrators can create servers' });
        return;
    }

    if (!name || name.trim().length === 0) {
        res.status(400).json({ error: 'Server name is required' });
        return;
    }

    const server = createServer(name.trim(), req.user!.id);
    res.status(201).json({ server });
});

// GET /api/servers - List user's servers
router.get('/', (req: AuthenticatedRequest, res: Response) => {
    const servers = getServersByUserId(req.user!.id);
    res.json({ servers });
});

// POST /api/servers/join - Join a server via invite code
router.post('/join', (req: AuthenticatedRequest, res: Response) => {
    const { invite_code } = req.body;

    if (!invite_code) {
        res.status(400).json({ error: 'Invite code is required' });
        return;
    }

    const result = joinServer(req.user!.id, invite_code.toUpperCase());

    if ('error' in result) {
        res.status(400).json({ error: result.error });
        return;
    }

    res.json({ server: result.server });
});

// GET /api/servers/:id - Get server details
router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
    const server = getServerById(req.params.id);

    if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
    }

    const members = getServerMembers(server.id);
    const shoutUsers = getShoutUsers(server.id);

    res.json({ server, members, shoutUsers });
});

// GET /api/servers/:id/members - Get server members
router.get('/:id/members', (req: AuthenticatedRequest, res: Response) => {
    const members = getServerMembers(req.params.id);
    res.json({ members });
});

// POST /api/servers/:id/role - Update member role (admin/owner only)
router.post('/:id/role', (req: AuthenticatedRequest, res: Response) => {
    const { user_id, role } = req.body;

    const requesterRole = getUserRole(req.user!.id, req.params.id);
    if (!canManageMembers(requesterRole)) {
        res.status(403).json({ error: 'Permission denied: cannot manage members' });
        return;
    }

    const validRoles: ServerRole[] = ['admin', 'pmc_member', 'squad_leader', 'member'];
    if (!user_id || !validRoles.includes(role)) {
        res.status(400).json({ error: 'Valid user_id and role required' });
        return;
    }

    const success = updateMemberRole(user_id, req.params.id, role);
    res.json({ success });
});

// POST /api/servers/:id/shout-permission - Grant shout permission (admin only)
router.post('/:id/shout-permission', (req: AuthenticatedRequest, res: Response) => {
    const { user_id } = req.body;

    if (!isServerAdmin(req.user!.id, req.params.id)) {
        res.status(403).json({ error: 'Admin permission required' });
        return;
    }

    if (!user_id) {
        res.status(400).json({ error: 'user_id is required' });
        return;
    }

    const success = grantShoutPermission(user_id, req.params.id, req.user!.id);
    res.json({ success });
});

// DELETE /api/servers/:id/shout-permission - Revoke shout permission (admin only)
router.delete('/:id/shout-permission', (req: AuthenticatedRequest, res: Response) => {
    const { user_id } = req.body;

    if (!isServerAdmin(req.user!.id, req.params.id)) {
        res.status(403).json({ error: 'Admin permission required' });
        return;
    }

    const success = revokeShoutPermission(user_id, req.params.id);
    res.json({ success });
});

export default router;
