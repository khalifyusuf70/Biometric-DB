
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection on startup
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL connected successfully');
    client.release();
  } catch (error) {
    console.log('❌ Database connection failed:', error.message);
  }
}
testConnection();

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    res.json({ 
      status: 'OK', 
      database: 'connected',
      timestamp: result.rows[0].current_time
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'disconnected',
      error: error.message 
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Biometric API is running!',
    database: 'PostgreSQL on Render'
  });
});

// Create a simple users table and test endpoint
app.get('/setup', async (req, res) => {
  try {
    // Create table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert sample data
    await pool.query(`
      INSERT INTO users (name, email) 
      VALUES ('John Doe', 'john@example.com')
      ON CONFLICT DO NOTHING
    `);

    // Get all users
    const result = await pool.query('SELECT * FROM users');
    
    res.json({
      success: true,
      message: 'Database setup completed',
      users: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all users
app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY id');
    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 PostgreSQL database connected`);
});
