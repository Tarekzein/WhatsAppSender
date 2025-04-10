const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const socketIO = require('socket.io');
const fs = require('fs');
const csv = require('csv-parser');
const multer = require('multer');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = require('http').createServer(app);
const io = socketIO(server);

// Set up SQLite database
const db = new sqlite3.Database('whatsapp_sessions.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        // Create sessions table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.json());

// Initialize WhatsApp client with local authentication
const client = new Client({
    puppeteer: {
        headless: true,
        args: ['--no-sandbox']
    },
    authStrategy: new LocalAuth({
        clientId: "client-one" // Unique identifier for this client
    })
});

let clientReady = false;
let qrCodeData = null;

// Handle QR code generation
client.on('qr', async (qr) => {
    try {
        qrCodeData = await qrcode.toDataURL(qr);
        io.emit('qrCode', qrCodeData);
    } catch (err) {
        console.error('QR Code generation error:', err);
    }
});

// Handle client ready state
client.on('ready', () => {
    clientReady = true;
    io.emit('clientReady');
    console.log('Client is ready!');
});

// Handle authentication success
client.on('authenticated', (session) => {
    console.log('Client authenticated');
    // Store session data in SQLite
    const sessionData = JSON.stringify(session);
    db.run('INSERT INTO sessions (session_data) VALUES (?)', [sessionData], (err) => {
        if (err) {
            console.error('Error storing session:', err);
        }
    });
});

// Initialize client
client.initialize();

// Add endpoint to check authentication status
app.get('/auth-status', (req, res) => {
    res.json({
        authenticated: clientReady,
        qrCode: qrCodeData
    });
});

// Add endpoint to logout
app.post('/logout', async (req, res) => {
    try {
        await client.logout();
        clientReady = false;
        qrCodeData = null;
        // Clear session from database
        db.run('DELETE FROM sessions WHERE id = (SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1)');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Handle file upload and message sending
app.post('/send-messages', upload.single('file'), async (req, res) => {
    if (!clientReady) {
        return res.status(400).json({ error: 'WhatsApp client not ready' });
    }

    const message = req.body.message;
    const delay = parseInt(req.body.delay) || 5000;
    const numbers = [];

    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
            if (row.number) {
                numbers.push(row.number);
            }
        })
        .on('end', async () => {
            try {
                io.emit('totalMessages', numbers.length);
                for (const number of numbers) {
                    const formattedNumber = formatPhoneNumber(number);
                    if (formattedNumber) {
                        try {
                            await client.sendMessage(`${formattedNumber}@c.us`, message);
                            io.emit('messageSent', { number: formattedNumber, status: 'success' });
                            await new Promise(resolve => setTimeout(resolve, delay));
                        } catch (err) {
                            io.emit('messageSent', { number: formattedNumber, status: 'failed' });
                        }
                    }
                }

                fs.unlinkSync(req.file.path);
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
});

function formatPhoneNumber(number) {
    let cleaned = number.replace(/\D/g, '');
    if (!cleaned.startsWith('2')) {
        cleaned = '2' + cleaned;
    }
    return cleaned;
}

// Add endpoint to force new QR code generation
app.post('/generate-new-qr', async (req, res) => {
    try {
        await client.destroy();
        await client.initialize();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
