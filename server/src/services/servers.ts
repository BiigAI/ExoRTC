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
    role: 'owner' | 'admin' | 'pmc_member' | 'squad_leader' | 'member';
    joined_at: string;
}

// Role-based permission helpers
export type ServerRole = 'owner' | 'admin' | 'pmc_member' | 'squad_leader' | 'member';

export function canManageMembers(role: string | null): boolean {
    return role === 'owner' || role === 'admin';
}

export function canCreateChannels(role: string | null): boolean {
    return role === 'owner' || role === 'admin' || role === 'pmc_member';
}

export function canShout(role: string | null): boolean {
    return role === 'owner' || role === 'admin' || role === 'pmc_member' || role === 'squad_leader';
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
        SELECT s.*, 
        (SELECT expires_at FROM server_kicks sk 
         WHERE sk.server_id = s.id AND sk.user_id = ? AND sk.expires_at > datetime('now') 
         ORDER BY sk.expires_at DESC LIMIT 1) as kick_expires_at
        FROM servers s
        INNER JOIN server_members sm ON s.id = sm.server_id
        WHERE sm.user_id = ?
    `, [userId, userId]);
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

    // Check if user is kicked
    const activeKick = db.get('SELECT expires_at FROM server_kicks WHERE server_id = ? AND user_id = ? AND expires_at > datetime("now")', [server.id, userId]);
    if (activeKick) {
        // @ts-ignore
        const expires = new Date(activeKick.expires_at).toLocaleTimeString();
        return { error: `You are kicked from this server until ${expires}` };
    }

    db.run('INSERT INTO server_members (user_id, server_id, role) VALUES (?, ?, ?)', [userId, server.id, 'member']);
    return { server };
}

export function removeServerMember(serverId: string, userId: string): void {
    db.run('DELETE FROM server_members WHERE server_id = ? AND user_id = ?', [serverId, userId]);
}

export function getServerMembers(serverId: string): any[] {
    return db.all(`
        SELECT sm.user_id, sm.server_id, sm.role, sm.joined_at, u.username, u.email, u.profile_color
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

export function updateMemberRole(userId: string, serverId: string, newRole: ServerRole): boolean {
    // Can't change owner role
    if (newRole === 'owner') return false;
    const result = db.run('UPDATE server_members SET role = ? WHERE user_id = ? AND server_id = ? AND role != ?', [newRole, userId, serverId, 'owner']);
    return result.changes > 0;
}
