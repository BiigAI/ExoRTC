// Configuration for different environments
const isDevelopment = process.env.NODE_ENV === 'development';

export const config = {
    // In production, you would change this to your hosted server URL
    // e.g., 'https://your-server.com/api'
    API_BASE: isDevelopment ? 'http://localhost:3000/api' : 'http://localhost:3000/api',
    SOCKET_URL: isDevelopment ? 'http://localhost:3000' : 'http://localhost:3000',

    // Feature flags
    DEBUG_MODE: isDevelopment,
};

export const getApiUrl = (endpoint: string) => `${config.API_BASE}${endpoint}`;
