const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const net = require('net'); // Built-in Node.js module

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ZKTeco Device Configuration
const ZK_CONFIG = {
  ip: process.env.ZK_IP || '192.168.1.201',
  port: process.env.ZK_PORT || 4370,
  timeout: process.env.ZK_TIMEOUT || 5000
};

// ZKTeco Command Constants
const ZK_COMMANDS = {
  CONNECT: 1000,
  DISCONNECT: 1001,
  GET_USERS: 5,
  GET_ATTENDANCE: 201,
  REG_EVENT: 73
};

// Connect to ZKTeco device via TCP
function connectToZKDevice() {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    }, ZK_CONFIG.timeout);

    socket.connect(ZK_CONFIG.port, ZK_CONFIG.ip, () => {
      clearTimeout(timeout);
      console.log('✅ Connected to ZKTeco device');
      resolve(socket);
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Send command to ZKTeco device
function sendZKCommand(socket, command) {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt16LE(command, 0);
    
    socket.write(buffer);
    
    socket.once('data', (data) => {
      resolve(data);
    });
    
    socket.once('error', reject);
  });
}

// Test database connection
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

// ================== ZKTECO FINGERPRINT ENDPOINTS ==================

// 1. Test ZKTeco device connection
app.get('/zk-test', async (req, res) => {
  let socket;
  try {
    socket = await connectToZKDevice();
    await sendZKCommand(socket, ZK_COMMANDS.CONNECT);
    
    res.json({
      success: true,
      message: 'ZKTeco device connected successfully',
      device_ip: ZK_CONFIG.ip
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `ZKTeco connection failed: ${error.message}`,
      device_ip: ZK_CONFIG.ip,
      note: 'Check device IP, network connection, and ensure device is powered on'
    });
  } finally {
    if (socket) socket.destroy();
  }
});

// 2. Enroll fingerprint (Manual process)
app.post('/enroll-fingerprint', async (req, res) => {
  try {
    const { soldier_id } = req.body;
    
    if (!soldier_id) {
      return res.status(400).json({ success: false, error: 'Soldier ID is required' });
    }

    // Verify soldier exists
    const soldierResult = await pool.query('SELECT * FROM soldiers WHERE soldier_id = $1', [soldier_id]);
    if (soldierResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Soldier not found' });
    }

    res.json({ 
      success: true, 
      message: 'Ready for fingerprint enrollment',
      instructions: [
        '1. Place soldier\'s finger on ZKTeco device',
        '2. Device will capture fingerprint template',
        '3. Manually record the template data from device screen',
        '4. Use the /store-fingerprint endpoint to save the template'
      ],
      soldier_id: soldier_id
    });
    
  } catch (error) {
    console.error('Enrollment error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Store fingerprint template manually
app.post('/store-fingerprint', async (req, res) => {
  try {
    const { soldier_id, fingerprint_template } = req.body;
    
    if (!soldier_id || !fingerprint_template) {
      return res.status(400).json({ 
        success: false, 
        error: 'Soldier ID and fingerprint template are required' 
      });
    }

    // Verify soldier exists
    const soldierResult = await pool.query('SELECT * FROM soldiers WHERE soldier_id = $1', [soldier_id]);
    if (soldierResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Soldier not found' });
    }

    // Store fingerprint template in database
    await pool.query(
      'UPDATE soldiers SET fingerprint_data = $1 WHERE soldier_id = $2',
      [fingerprint_template, soldier_id]
    );
    
    res.json({ 
      success: true, 
      message: 'Fingerprint template stored successfully',
      soldier_id: soldier_id
    });
    
  } catch (error) {
    console.error('Storage error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Manual fingerprint verification
app.post('/verify-fingerprint-manual', async (req, res) => {
  try {
    const { fingerprint_template } = req.body;

    if (!fingerprint_template) {
      return res.status(400).json({ 
        success: false, 
        error: 'Fingerprint template is required' 
      });
    }

    // Find soldier by fingerprint match
    const result = await pool.query(
      'SELECT * FROM soldiers WHERE fingerprint_data = $1',
      [fingerprint_template]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Fingerprint not found in system'
      });
    }

    const soldier = result.rows[0];

    // Record verification
    await pool.query(
      'INSERT INTO fingerprint_verifications (soldier_id, full_names, rank_position, net_salary, horin_platoon) VALUES ($1, $2, $3, $4, $5)',
      [soldier.soldier_id, soldier.full_names, soldier.rank_position, soldier.net_salary, soldier.horin_platoon]
    );

    res.json({
      success: true,
      message: 'Fingerprint verified successfully',
      soldier: {
        soldier_id: soldier.soldier_id,
        full_names: soldier.full_names,
        rank_position: soldier.rank_position,
        net_salary: soldier.net_salary,
        horin_platoon: soldier.horin_platoon,
        verified_at: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 5. Get device status
app.get('/zk-status', async (req, res) => {
  try {
    const socket = await connectToZKDevice();
    await sendZKCommand(socket, ZK_COMMANDS.CONNECT);
    socket.destroy();
    
    res.json({
      success: true,
      status: 'connected',
      device_ip: ZK_CONFIG.ip,
      message: 'ZKTeco device is online and responsive'
    });
  } catch (error) {
    res.json({
      success: false,
      status: 'disconnected',
      device_ip: ZK_CONFIG.ip,
      error: error.message,
      troubleshooting: [
        'Check device power and network connection',
        'Verify IP address matches device settings',
        'Ensure device is on same network',
        'Check firewall settings'
      ]
    });
  }
});

// ================== SOLDIERS MANAGEMENT ENDPOINTS ==================
// [Keep all your existing soldiers endpoints exactly as they are]
// ... (your existing setup-soldiers, soldiers, payroll endpoints)

// ================== BASIC ENDPOINTS ==================

app.get('/health', async (req, res) => {
  try {
    const dbResult = await pool.query('SELECT NOW() as current_time');
    
    // Test ZKTeco connection
    let zkStatus = 'unknown';
    try {
      const socket = await connectToZKDevice();
      zkStatus = 'connected';
      socket.destroy();
    } catch (error) {
      zkStatus = 'disconnected';
    }
    
    res.json({ 
      status: 'OK', 
      database: 'connected',
      zkteco_device: zkStatus,
      device_ip: ZK_CONFIG.ip,
      timestamp: dbResult.rows[0].current_time
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'disconnected',
      error: error.message 
    });
  }
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Jubaland Statehouse Forces Biometric System',
    zkteco_integration: 'TCP Socket Connection',
    endpoints: {
      device_test: '/zk-test & /zk-status',
      fingerprint: {
        enroll: 'POST /enroll-fingerprint',
        store: 'POST /store-fingerprint',
        verify_manual: 'POST /verify-fingerprint-manual'
      },
      soldiers: 'GET/POST /soldiers',
      payroll: 'GET /monthly-payroll',
      health: '/health'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Jubaland Biometric System running on port ${PORT}`);
  console.log(`📱 ZKTeco Device IP: ${ZK_CONFIG.ip}`);
  console.log(`🔌 Using TCP socket connection for ZKTeco integration`);
});
