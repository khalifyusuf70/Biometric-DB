const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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

// 1. Create soldiersRepository table with Gun_number (with migration)
app.get('/api/setup-soldiers', async (req, res) => {
  try {
    // First, check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'soldiersrepository'
      );
    `);

    const tableExists = tableCheck.rows[0].exists;

    if (!tableExists) {
      // Create new table with gun_number
      await pool.query(`
        CREATE TABLE soldiersRepository (
          soldier_id VARCHAR(20) PRIMARY KEY,
          full_names VARCHAR(255) NOT NULL,
          date_of_birth DATE NOT NULL,
          gender VARCHAR(10) CHECK (gender IN ('Male', 'Female')),
          photo TEXT,
          fingerprint_data TEXT,
          rank_position VARCHAR(50),
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
          gun_number VARCHAR(50),
          status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Wounded', 'Discharged', 'Dead')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      // Table exists, check if gun_number column exists
      const columnCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'soldiersrepository' AND column_name = 'gun_number'
      `);

      const columnExists = columnCheck.rows.length > 0;

      if (!columnExists) {
        // Add gun_number column to existing table
        await pool.query(`
          ALTER TABLE soldiersRepository 
          ADD COLUMN gun_number VARCHAR(50)
        `);
        console.log('✅ Added gun_number column to existing table');
      }
    }

    res.json({
      success: true,
      message: 'Soldiers table setup completed with gun_number field'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 2. Register new soldier with Gun_number
app.post('/api/soldiers', async (req, res) => {
  try {
    const {
      full_names, date_of_birth, gender, photo, fingerprint_data,
      rank_position, date_of_enlistment, horin_platoon, horin_commander,
      net_salary, tel_number, clan, guarantor_name, guarantor_phone,
      emergency_contact_name, emergency_contact_phone, home_address,
      blood_group, gun_number, status
    } = req.body;

    // Generate Soldier ID (CMJ00001 format)
    const countResult = await pool.query('SELECT COUNT(*) FROM soldiersRepository');
    const count = parseInt(countResult.rows[0].count) + 1;
    const soldier_id = `CMJ${String(count).padStart(5, '0')}`;

    const query = `
      INSERT INTO soldiersRepository (
        soldier_id, full_names, date_of_birth, gender, photo, fingerprint_data,
        rank_position, date_of_enlistment, horin_platoon, horin_commander,
        net_salary, tel_number, clan, guarantor_name, guarantor_phone,
        emergency_contact_name, emergency_contact_phone, home_address,
        blood_group, gun_number, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `;

    const values = [
      soldier_id, full_names, date_of_birth, gender, photo, fingerprint_data,
      rank_position, date_of_enlistment, horin_platoon, horin_commander,
      net_salary, tel_number, clan, guarantor_name, guarantor_phone,
      emergency_contact_name, emergency_contact_phone, home_address,
      blood_group, gun_number || null, status || 'Active'
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

// 3. Get all soldiers
app.get('/api/soldiers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM soldiersRepository ORDER BY soldier_id');
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

// 4. Get single soldier by ID
app.get('/api/soldiers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM soldiersRepository WHERE soldier_id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Soldier not found'
      });
    }

    res.json({
      success: true,
      soldier: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 5. Search soldiers by ID or name
app.get('/api/soldiers-search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const searchQuery = `
      SELECT * FROM soldiersRepository 
      WHERE soldier_id ILIKE $1 OR full_names ILIKE $1
      ORDER BY soldier_id
    `;
    
    const result = await pool.query(searchQuery, [`%${query}%`]);
    
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

// 6. Update soldier with Gun_number
app.put('/api/soldiers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      full_names, date_of_birth, gender, photo, fingerprint_data,
      rank_position, date_of_enlistment, horin_platoon, horin_commander,
      net_salary, tel_number, clan, guarantor_name, guarantor_phone,
      emergency_contact_name, emergency_contact_phone, home_address,
      blood_group, gun_number, status
    } = req.body;

    const query = `
      UPDATE soldiersRepository SET
        full_names = $1, date_of_birth = $2, gender = $3, photo = $4, fingerprint_data = $5,
        rank_position = $6, date_of_enlistment = $7, horin_platoon = $8, horin_commander = $9,
        net_salary = $10, tel_number = $11, clan = $12, guarantor_name = $13, guarantor_phone = $14,
        emergency_contact_name = $15, emergency_contact_phone = $16, home_address = $17,
        blood_group = $18, gun_number = $19, status = $20, updated_at = CURRENT_TIMESTAMP
      WHERE soldier_id = $21
      RETURNING *
    `;

    const values = [
      full_names, date_of_birth, gender, photo, fingerprint_data,
      rank_position, date_of_enlistment, horin_platoon, horin_commander,
      net_salary, tel_number, clan, guarantor_name, guarantor_phone,
      emergency_contact_name, emergency_contact_phone, home_address,
      blood_group, gun_number || null, status, id
    ];

    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Soldier not found'
      });
    }

    res.json({
      success: true,
      message: 'Soldier updated successfully',
      soldier: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 7. Delete soldier
app.delete('/api/soldiers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM soldiersRepository WHERE soldier_id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Soldier not found'
      });
    }

    res.json({
      success: true,
      message: 'Soldier deleted successfully',
      soldier: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 8. NEW: Get soldiers data for Excel-like table view
app.get('/api/soldiers-table', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        soldier_id,
        full_names,
        date_of_birth,
        gender,
        rank_position,
        date_of_enlistment,
        horin_platoon,
        horin_commander,
        gun_number,
        net_salary,
        tel_number,
        clan,
        guarantor_name,
        guarantor_phone,
        emergency_contact_name,
        emergency_contact_phone,
        blood_group,
        status
      FROM soldiersRepository 
      ORDER BY soldier_id
    `);
    
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

// 9. Monthly payroll report
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

// 10. Reset database (DANGEROUS - use with caution)
app.get('/api/reset-database', async (req, res) => {
  try {
    // Drop and recreate table (WILL DELETE ALL DATA)
    await pool.query('DROP TABLE IF EXISTS soldiersRepository');
    
    await pool.query(`
      CREATE TABLE soldiersRepository (
        soldier_id VARCHAR(20) PRIMARY KEY,
        full_names VARCHAR(255) NOT NULL,
        date_of_birth DATE NOT NULL,
        gender VARCHAR(10) CHECK (gender IN ('Male', 'Female')),
        photo TEXT,
        fingerprint_data TEXT,
        rank_position VARCHAR(50),
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
        gun_number VARCHAR(50),
        status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Wounded', 'Discharged', 'Dead')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    res.json({
      success: true,
      message: 'Database reset successfully with gun_number field'
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
      setup: '/api/setup-soldiers (safe migration)',
      reset: '/api/reset-database (DANGEROUS - deletes all data)',
      soldiers: {
        getAll: 'GET /api/soldiers',
        getOne: 'GET /api/soldiers/:id',
        create: 'POST /api/soldiers',
        update: 'PUT /api/soldiers/:id',
        delete: 'DELETE /api/soldiers/:id',
        search: 'GET /api/soldiers-search?query=',
        table: 'GET /api/soldiers-table (Excel-like format)'
      },
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
  console.log(`🔄 Run http://localhost:${PORT}/api/setup-soldiers to add gun_number column`);
});
