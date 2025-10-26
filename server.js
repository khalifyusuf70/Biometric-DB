const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
app.get('/api/setup-soldiers', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS soldiers (
        soldier_id VARCHAR(20) PRIMARY KEY,
        full_names VARCHAR(255) NOT NULL,
        date_of_birth DATE NOT NULL,
        gender VARCHAR(10) CHECK (gender IN ('Male', 'Female')),
        photo TEXT,
        fingerprint_data TEXT,
        
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


// 3. Register new soldier
app.post('/api/soldiers', async (req, res) => {
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
app.get('/api/soldiers', async (req, res) => {
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

// 7. Monthly payroll report
app.get('/api/monthly-payroll', async (req, res) => {
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

app.get('/api/health', async (req, res) => {
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

app.get('/api', (req, res) => {
  res.json({ 
    message: 'Jubaland Statehouse Forces Database System',
    endpoints: {
      setup: '/api/setup-soldiers & /api/setup-verification',
      soldiers: 'GET/POST /api/soldiers',
      verification: {
        manual: 'POST /api/manual-verification',
        today_report: 'GET /api/today-verifications'
      },
      payroll: 'GET /api/monthly-payroll',
      health: '/api/health'
    }
  });
});

// Serve HTML for all non-API routes (MUST BE LAST)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Jubaland Military Database running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔧 API: http://localhost:${PORT}/api`);
});
