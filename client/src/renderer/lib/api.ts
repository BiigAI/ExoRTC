// API client for communicating with ExoRTC server

const API_BASE = 'http://localhost:3000/api';

interface ApiResponse<T> {
    data?: T;
    error?: string;
}

class ApiClient {
    private token: string | null = null;

    setToken(token: string | null): void {
        this.token = token;
        if (token) {
            localStorage.setItem('exortc_token', token);
        } else {
            localStorage.removeItem('exortc_token');
        }
    }

    getToken(): string | null {
        if (!this.token) {
            this.token = localStorage.getItem('exortc_token');
        }
        return this.token;
    }

    private async request<T>(method: string, endpoint: string, body?: any): Promise<ApiResponse<T>> {
        const headers: HeadersInit = {
            'Content-Type': 'application/json'
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined
            });

            const data = await response.json();

            if (!response.ok) {
                return { error: data.error || 'Request failed' };
            }

            return { data };
        } catch (error) {
            return { error: 'Network error. Is the server running?' };
        }
    }

    // Auth
    async register(username: string, email: string, password: string) {
        const result = await this.request<{ user: any; token: string }>('POST', '/auth/register', {
            username,
            email,
            password
        });
        if (result.data) {
            this.setToken(result.data.token);
        }
        return result;
    }

    async login(username: string, password: string) {
        const result = await this.request<{ user: any; token: string }>('POST', '/auth/login', {
            username,
            password
        });
        if (result.data) {
            this.setToken(result.data.token);
        }
        return result;
    }

    async getMe() {
        return this.request<{ user: any }>('GET', '/auth/me');
    }

    // Servers
    async getServers() {
        return this.request<{ servers: any[] }>('GET', '/servers');
    }

    async createServer(name: string) {
        return this.request<{ server: any }>('POST', '/servers', { name });
    }

    async joinServer(inviteCode: string) {
        return this.request<{ server: any }>('POST', '/servers/join', { invite_code: inviteCode });
    }

    async getServer(serverId: string) {
        return this.request<{ server: any; members: any[]; shoutUsers: any[] }>('GET', `/servers/${serverId}`);
    }

    // Rooms
    async getRooms(serverId: string) {
        return this.request<{ rooms: any[] }>('GET', `/servers/${serverId}/rooms`);
    }

    async createRoom(serverId: string, name: string) {
        return this.request<{ room: any }>('POST', `/servers/${serverId}/rooms`, { name });
    }

    // Shout permissions
    async grantShoutPermission(serverId: string, userId: string) {
        return this.request<{ success: boolean }>('POST', `/servers/${serverId}/shout-permission`, { user_id: userId });
    }

    logout(): void {
        this.setToken(null);
    }
}

// Export singleton instance
const api = new ApiClient();
(window as any).api = api;
