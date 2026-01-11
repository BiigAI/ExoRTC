import db from '../config/database';

export interface ShoutPermission {
    user_id: string;
    server_id: string;
    granted_at: string;
    granted_by: string;
}

export function grantShoutPermission(userId: string, serverId: string, grantedBy: string): boolean {
    try {
        // Delete existing permission first (for REPLACE behavior)
        db.run('DELETE FROM shout_permissions WHERE user_id = ? AND server_id = ?', [userId, serverId]);
        db.run('INSERT INTO shout_permissions (user_id, server_id, granted_by) VALUES (?, ?, ?)', [userId, serverId, grantedBy]);
        return true;
    } catch {
        return false;
    }
}

export function revokeShoutPermission(userId: string, serverId: string): boolean {
    const result = db.run('DELETE FROM shout_permissions WHERE user_id = ? AND server_id = ?', [userId, serverId]);
    return result.changes > 0;
}

export function hasShoutPermission(userId: string, serverId: string): boolean {
    const row = db.get<{ '1': number }>('SELECT 1 FROM shout_permissions WHERE user_id = ? AND server_id = ?', [userId, serverId]);
    return !!row;
}

export function getShoutUsers(serverId: string): { user_id: string; username: string }[] {
    return db.all<{ user_id: string; username: string }>(`
        SELECT sp.user_id, u.username
        FROM shout_permissions sp
        INNER JOIN users u ON sp.user_id = u.id
        WHERE sp.server_id = ?
    `, [serverId]);
}

// Get all users with shout permission who are currently in a room (for broadcasting)
export function getActiveShoutUsers(serverId: string): { user_id: string; username: string; room_id: string }[] {
    return db.all<{ user_id: string; username: string; room_id: string }>(`
        SELECT sp.user_id, u.username, rm.room_id
        FROM shout_permissions sp
        INNER JOIN users u ON sp.user_id = u.id
        INNER JOIN room_members rm ON sp.user_id = rm.user_id
        INNER JOIN rooms r ON rm.room_id = r.id
        WHERE sp.server_id = ? AND r.server_id = ?
    `, [serverId, serverId]);
}
