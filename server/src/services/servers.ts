import { v4 as uuidv4 } from 'uuid';
import db from '../config/database';
import { grantShoutPermission } from './permissions';

export interface Server {
    id: string;
    name: string;
    invite_code: string;
    owner_id: string;
    created_at: string;
}

export interface ServerMember {
    user_id: string;
    server_id: string;
    role: 'owner' | 'admin' | 'member';
    joined_at: string;
}

function generateInviteCode(): string {
    // Generate a 6-character alphanumeric code
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function createServer(name: string, ownerId: string): Server {
    const id = uuidv4();
    const invite_code = generateInviteCode();

    db.run('INSERT INTO servers (id, name, invite_code, owner_id) VALUES (?, ?, ?, ?)', [id, name, invite_code, ownerId]);

    // Add owner as member with owner role
    db.run('INSERT INTO server_members (user_id, server_id, role) VALUES (?, ?, ?)', [ownerId, id, 'owner']);

    // Auto-grant shout permission to owner
    grantShoutPermission(ownerId, id, ownerId);

    return {
        id,
        name,
        invite_code,
        owner_id: ownerId,
        created_at: new Date().toISOString()
    };
}

export function getServersByUserId(userId: string): Server[] {
    return db.all<Server>(`
        SELECT s.* FROM servers s
        INNER JOIN server_members sm ON s.id = sm.server_id
        WHERE sm.user_id = ?
    `, [userId]);
}

export function getServerById(serverId: string): Server | null {
    return db.get<Server>('SELECT * FROM servers WHERE id = ?', [serverId]) || null;
}

export function getServerByInviteCode(inviteCode: string): Server | null {
    return db.get<Server>('SELECT * FROM servers WHERE invite_code = ?', [inviteCode]) || null;
}

export function joinServer(userId: string, inviteCode: string): { server: Server } | { error: string } {
    const server = getServerByInviteCode(inviteCode);
    if (!server) {
        return { error: 'Invalid invite code' };
    }

    // Check if already a member
    const existing = db.get<ServerMember>('SELECT * FROM server_members WHERE user_id = ? AND server_id = ?', [userId, server.id]);
    if (existing) {
        return { error: 'Already a member of this server' };
    }

    db.run('INSERT INTO server_members (user_id, server_id, role) VALUES (?, ?, ?)', [userId, server.id, 'member']);
    return { server };
}

export function getServerMembers(serverId: string): { user_id: string; username: string; role: string }[] {
    return db.all<{ user_id: string; username: string; role: string }>(`
        SELECT u.id as user_id, u.username, sm.role
        FROM server_members sm
        INNER JOIN users u ON sm.user_id = u.id
        WHERE sm.server_id = ?
    `, [serverId]);
}

export function getUserRole(userId: string, serverId: string): string | null {
    const row = db.get<{ role: string }>('SELECT role FROM server_members WHERE user_id = ? AND server_id = ?', [userId, serverId]);
    return row?.role || null;
}

export function isServerAdmin(userId: string, serverId: string): boolean {
    const role = getUserRole(userId, serverId);
    return role === 'owner' || role === 'admin';
}

export function updateMemberRole(userId: string, serverId: string, newRole: 'admin' | 'member'): boolean {
    const result = db.run('UPDATE server_members SET role = ? WHERE user_id = ? AND server_id = ? AND role != ?', [newRole, userId, serverId, 'owner']);
    return result.changes > 0;
}
