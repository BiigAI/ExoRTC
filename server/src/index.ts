import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import database and initialize
import { initDatabase } from './config/database';

// Import routes
import authRoutes from './routes/auth';
import serverRoutes from './routes/servers';
import roomRoutes, { setSocketIO } from './routes/rooms';

// Import signaling
import { initializeSignaling } from './services/signaling';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api', roomRoutes);

// Initialize WebRTC signaling
initializeSignaling(io);

// Set up socket.io for routes that need it
setSocketIO(io);

// Start server after database initialization
const PORT = process.env.PORT || 3000;

async function start() {
    try {
        await initDatabase();
        console.log('📦 Database initialized');

        httpServer.listen(PORT, () => {
            console.log(`🚀 ExoRTC Server running on port ${PORT}`);
            console.log(`📡 WebSocket signaling ready`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

start();

export { app, httpServer, io };
