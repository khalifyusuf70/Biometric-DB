const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

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

// 5. Fingerprint Verification endpoint (Simulated)
app.post('/verify-fingerprint', async (req, res) => {
  try {
    const { fingerprint_template } = req.body;

    // Find soldier by fingerprint match (simulated)
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

// 6. Simulated fingerprint enrollment
app.post('/enroll-fingerprint', async (req, res) => {
  try {
    const { soldier_id, fingerprint_data } = req.body;
    
    if (!soldier_id) {
      return res.status(400).json({ success: false, error: 'Soldier ID is required' });
    }

    // Verify soldier exists
    const soldierResult = await pool.query('SELECT * FROM soldiers WHERE soldier_id = $1', [soldier_id]);
    if (soldierResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Soldier not found' });
    }

    // Store fingerprint template in database
    await pool.query(
      'UPDATE soldiers SET fingerprint_data = $1 WHERE soldier_id = $2',
      [fingerprint_data, soldier_id]
    );
    
    res.json({ 
      success: true, 
      message: 'Fingerprint enrolled successfully (Simulated)',
      soldier_id: soldier_id
    });
    
  } catch (error) {
    console.error('Enrollment error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. Monthly payroll report
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
    
    res.json({ 
      status: 'OK', 
      database: 'connected',
      timestamp: dbResult.rows[0].current_time,
      message: 'ZKTeco integration disabled - using simulated fingerprint system'
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
    note: 'ZKTeco integration disabled - using simulated fingerprint system',
    endpoints: {
      setup: '/setup-soldiers & /setup-verification',
      soldiers: 'GET/POST /soldiers',
      fingerprint: {
        enroll: 'POST /enroll-fingerprint',
        verify: 'POST /verify-fingerprint'
      },
      payroll: 'GET /monthly-payroll',
      health: '/health'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Jubaland Biometric System running on port ${PORT}`);
  console.log(`ℹ️  ZKTeco integration disabled - using simulated fingerprint system`);
});
