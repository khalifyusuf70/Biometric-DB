const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const ZKLib = require('node-zklib');

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
  timeout: process.env.ZK_TIMEOUT || 10000,
  inport: process.env.ZK_INPORT || 4000
};

// Connect to ZKTeco device
async function connectToDevice() {
  try {
    const zkInstance = new ZKLib(ZK_CONFIG.ip, ZK_CONFIG.port, ZK_CONFIG.timeout, ZK_CONFIG.inport);
    await zkInstance.createSocket();
    console.log('✅ ZKTeco device connected');
    return zkInstance;
  } catch (error) {
    console.log('❌ ZKTeco connection failed:', error.message);
    throw error;
  }
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

// 1. Enroll new fingerprint for soldier
app.post('/enroll-fingerprint', async (req, res) => {
  let zkInstance;
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

    zkInstance = await connectToDevice();
    
    // Get user ID from device
    const userId = await getNextAvailableUserId(zkInstance);
    
    // Enroll fingerprint on device
    console.log('Please place finger on device for enrollment...');
    const enrollResult = await zkInstance.regEvent();
    
    if (enrollResult && enrollResult.template) {
      // Store template in database
      await pool.query(
        'UPDATE soldiers SET fingerprint_data = $1 WHERE soldier_id = $2',
        [enrollResult.template, soldier_id]
      );
      
      // Also store on device with user ID
      await zkInstance.setUser(userId, soldier_id, '', 0);
      await zkInstance.addTemplate(enrollResult.template, userId);
      
      res.json({ 
        success: true, 
        message: 'Fingerprint enrolled successfully',
        soldier_id: soldier_id,
        device_user_id: userId
      });
    } else {
      res.status(400).json({ success: false, error: 'Fingerprint enrollment failed' });
    }
    
  } catch (error) {
    console.error('Enrollment error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (zkInstance) {
      await zkInstance.disconnect();
    }
  }
});

// 2. Live fingerprint verification
app.post('/verify-fingerprint-live', async (req, res) => {
  let zkInstance;
  try {
    zkInstance = await connectToDevice();
    
    console.log('Waiting for fingerprint scan...');
    
    // Listen for fingerprint event
    const scanResult = await zkInstance.regEvent();
    
    if (scanResult && scanResult.template) {
      const liveTemplate = scanResult.template;
      
      // Get all soldiers with fingerprints
      const soldiersResult = await pool.query(
        'SELECT * FROM soldiers WHERE fingerprint_data IS NOT NULL'
      );
      
      let verifiedSoldier = null;
      
      // Compare with stored templates
      for (let soldier of soldiersResult.rows) {
        try {
          const match = await zkInstance.matchTemplate(liveTemplate, soldier.fingerprint_data);
          if (match) {
            verifiedSoldier = soldier;
            break;
          }
        } catch (matchError) {
          console.log(`Template match error for ${soldier.soldier_id}:`, matchError.message);
          continue;
        }
      }
      
      if (verifiedSoldier) {
        // Record verification in database
        await pool.query(
          `INSERT INTO fingerprint_verifications 
           (soldier_id, full_names, rank_position, net_salary, horin_platoon) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            verifiedSoldier.soldier_id, 
            verifiedSoldier.full_names, 
            verifiedSoldier.rank_position, 
            verifiedSoldier.net_salary, 
            verifiedSoldier.horin_platoon
          ]
        );
        
        res.json({ 
          success: true, 
          message: 'Fingerprint verified successfully',
          soldier: {
            soldier_id: verifiedSoldier.soldier_id,
            full_names: verifiedSoldier.full_names,
            rank_position: verifiedSoldier.rank_position,
            net_salary: verifiedSoldier.net_salary,
            horin_platoon: verifiedSoldier.horin_platoon,
            verified_at: new Date()
          }
        });
      } else {
        res.status(404).json({ 
          success: false, 
          message: 'Fingerprint not recognized in system' 
        });
      }
    } else {
      res.status(400).json({ 
        success: false, 
        error: 'No fingerprint detected or scan failed' 
      });
    }
    
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (zkInstance) {
      await zkInstance.disconnect();
    }
  }
});

// 3. Get device users
app.get('/device-users', async (req, res) => {
  let zkInstance;
  try {
    zkInstance = await connectToDevice();
    const users = await zkInstance.getUsers();
    res.json({ success: true, users: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (zkInstance) {
      await zkInstance.disconnect();
    }
  }
});

// 4. Clear device data
app.post('/clear-device', async (req, res) => {
  let zkInstance;
  try {
    zkInstance = await connectToDevice();
    await zkInstance.clearData();
    res.json({ success: true, message: 'Device data cleared successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (zkInstance) {
      await zkInstance.disconnect();
    }
  }
});

// Helper function to get next available user ID on device
async function getNextAvailableUserId(zkInstance) {
  try {
    const users = await zkInstance.getUsers();
    if (users && users.length > 0) {
      const maxId = Math.max(...users.map(user => user.userId));
      return maxId + 1;
    }
    return 1;
  } catch (error) {
    console.log('Error getting users, starting from ID 1:', error.message);
    return 1;
  }
}

// ================== SOLDIERS MANAGEMENT ENDPOINTS ==================

// 1. Create soldiers table
app.get('/setup-soldiers', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS soldiers (
        soldier_id VARCHAR(20) PRIMARY KEY,
        full_names VARCHAR(255) NOT NULL,
        date_of_birth DATE NOT NULL,
        gender VARCHAR(10) CHECK (gender IN ('Male', 'Female')),
        photo TEXT,
        fingerprint_data TEXT,
        rank_position VARCHAR(50) CHECK (rank_position IN ('Askari', 'Taliye Unug', 'Taliye Koox', 'Taliye Horin', 'Abandule', 'Taliye Guuto')),
        date_of_enlistment DATE NOT NULL,
        horin_platoon VARCHAR(50) CHECK (horin_platoon IN ('Horin1', 'Horin2', 'Horin3', 'Horin4', 'Horin5', 'Horin6', 'Taliska', 'Fiat')),
        horin_commander VARCHAR(255),
        net_salary DECIMAL(10,2),
        tel_number VARCHAR(15) UNIQUE,
        clan VARCHAR(100),
        guarantor_name VARCHAR(255),
        guarantor_phone VARCHAR(15),
        emergency_contact_name VARCHAR(255),
        emergency_contact_phone VARCHAR(15),
        home_address TEXT,
        blood_group VARCHAR(5) CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
        status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Wounded', 'Discharged', 'Dead')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    res.json({
      success: true,
      message: 'Soldiers table created successfully with all 20 attributes'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 2. Create fingerprint verification table
app.get('/setup-verification', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fingerprint_verifications (
        id SERIAL PRIMARY KEY,
        soldier_id VARCHAR(20) REFERENCES soldiers(soldier_id),
        full_names VARCHAR(255),
        rank_position VARCHAR(50),
        net_salary DECIMAL(10,2),
        horin_platoon VARCHAR(50),
        verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    res.json({
      success: true,
      message: 'Fingerprint verification table created successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 3. Register new soldier
app.post('/soldiers', async (req, res) => {
  try {
    const {
      full_names, date_of_birth, gender, photo, fingerprint_data,
      rank_position, date_of_enlistment, horin_platoon, horin_commander,
      net_salary, tel_number, clan, guarantor_name, guarantor_phone,
      emergency_contact_name, emergency_contact_phone, home_address,
      blood_group, status
    } = req.body;

    // Generate Soldier ID (CMJ00001 format)
    const countResult = await pool.query('SELECT COUNT(*) FROM soldiers');
    const count = parseInt(countResult.rows[0].count) + 1;
    const soldier_id = `CMJ${String(count).padStart(5, '0')}`;

    const query = `
      INSERT INTO soldiers (
        soldier_id, full_names, date_of_birth, gender, photo, fingerprint_data,
        rank_position, date_of_enlistment, horin_platoon, horin_commander,
        net_salary, tel_number, clan, guarantor_name, guarantor_phone,
        emergency_contact_name, emergency_contact_phone, home_address,
        blood_group, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `;

    const values = [
      soldier_id, full_names, date_of_birth, gender, photo, fingerprint_data,
      rank_position, date_of_enlistment, horin_platoon, horin_commander,
      net_salary, tel_number, clan, guarantor_name, guarantor_phone,
      emergency_contact_name, emergency_contact_phone, home_address,
      blood_group, status || 'Active'
    ];

    const result = await pool.query(query, values);
    
    res.json({
      success: true,
      message: 'Soldier registered successfully',
      soldier: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 4. Get all soldiers
app.get('/soldiers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM soldiers ORDER BY soldier_id');
    res.json({
      success: true,
      soldiers: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 5. ZKTeco Fingerprint Verification endpoint
app.post('/verify-fingerprint', async (req, res) => {
  try {
    const { fingerprint_template } = req.body;

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

// 6. Monthly payroll report
app.get('/monthly-payroll', async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear = year || new Date().getFullYear();

    const query = `
      SELECT 
        soldier_id,
        full_names,
        rank_position,
        net_salary,
        horin_platoon,
        verified_at
      FROM fingerprint_verifications 
      WHERE EXTRACT(MONTH FROM verified_at) = $1 
        AND EXTRACT(YEAR FROM verified_at) = $2
      ORDER BY horin_platoon, rank_position
    `;

    const result = await pool.query(query, [currentMonth, currentYear]);
    
    const totalSoldiers = result.rows.length;
    const totalSalary = result.rows.reduce((sum, soldier) => sum + parseFloat(soldier.net_salary), 0);

    res.json({
      success: true,
      report: {
        month: currentMonth,
        year: currentYear,
        total_soldiers: totalSoldiers,
        total_salary: totalSalary,
        soldiers: result.rows
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================== BASIC ENDPOINTS ==================

app.get('/health', async (req, res) => {
  try {
    const dbResult = await pool.query('SELECT NOW() as current_time');
    
    // Test ZKTeco connection
    let zkStatus = 'disconnected';
    try {
      const zkInstance = await connectToDevice();
      zkStatus = 'connected';
      await zkInstance.disconnect();
    } catch (zkError) {
      zkStatus = 'disconnected';
    }
    
    res.json({ 
      status: 'OK', 
      database: 'connected',
      zkteco_device: zkStatus,
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
    endpoints: {
      setup: '/setup-soldiers & /setup-verification',
      soldiers: 'GET/POST /soldiers',
      fingerprint: {
        enroll: 'POST /enroll-fingerprint',
        verify_live: 'POST /verify-fingerprint-live',
        device_users: 'GET /device-users',
        clear: 'POST /clear-device'
      },
      payroll: 'GET /monthly-payroll',
      health: '/health'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Jubaland Biometric System running on port ${PORT}`);
  console.log(`📱 ZKTeco Device IP: ${ZK_CONFIG.ip}`);
});
