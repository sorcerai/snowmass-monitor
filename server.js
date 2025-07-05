// server.js - Local development server
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Import monitor handler
import monitorHandler from './api/snowmass-monitor.js';

// Routes
app.get('/', (req, res) => {
  res.json({ 
    status: '🏔️ Snowmass Monitor - Local Development',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: 'GET /health',
      monitor: 'POST /api/snowmass-monitor',
      test: 'POST /test'
    },
    timestamp: new Date().toISOString() 
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    playwright: 'ready',
    jwt_secret: process.env.JWT_SECRET ? '✅ Set' : '❌ Missing',
    timestamp: new Date().toISOString() 
  });
});

// Main monitor endpoint
app.all('/api/snowmass-monitor', monitorHandler);

// Test endpoint for local development
app.post('/test', async (req, res) => {
  try {
    console.log('🧪 Test endpoint called');
    
    // Simple test without authentication
    res.json({
      success: true,
      message: 'Test endpoint working',
      body: req.body,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('🚨 Global error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString() 
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Snowmass Monitor running locally`);
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🔍 Health: http://localhost:${PORT}/health`);
  console.log(`🏔️  Monitor: http://localhost:${PORT}/api/snowmass-monitor`);
  console.log(`🧪 Test: http://localhost:${PORT}/test`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 Received SIGINT, shutting down gracefully');
  process.exit(0);
});