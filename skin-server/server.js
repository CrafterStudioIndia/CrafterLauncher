/**
 * Central Skin Server for Aether Launcher
 * 
 * This is a lightweight Node.js/Express server that acts as a shared repository
 * for players to upload and synchronize custom skins.
 * 
 * Deploy this server to a free hosting service (like Glitch, Render, or Railway)
 * or run it on a private VPS so players can see each other's custom skins.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3004;

// Enable CORS and body parsing
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SKINS_DIR = path.join(__dirname, 'skins');
const MAPPINGS_FILE = path.join(__dirname, 'mappings.json');

if (!fs.existsSync(SKINS_DIR)) {
  fs.mkdirSync(SKINS_DIR, { recursive: true });
}

// Load mappings
let mappings = {};
if (fs.existsSync(MAPPINGS_FILE)) {
  try {
    mappings = JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf-8'));
  } catch (err) {
    console.error('Failed to load mappings:', err);
  }
}

function saveMappings() {
  try {
    fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(mappings, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save mappings:', err);
  }
}

// 1. GET /api/skins/:uuid.png - Retrieves a player's skin image directly
app.get('/api/skins/:uuid.png', (req, res) => {
  const uuid = req.params.uuid;
  const filepath = path.join(SKINS_DIR, `${uuid}.png`);

  if (fs.existsSync(filepath)) {
    res.setHeader('Content-Type', 'image/png');
    fs.createReadStream(filepath).pipe(res);
  } else {
    res.status(404).send('Skin not found.');
  }
});

// 2. GET /api/profiles/:uuid - Retrieves profile mapping (uuid, username, skinUrl)
app.get('/api/profiles/:uuid', (req, res) => {
  const uuid = req.params.uuid;
  const username = mappings[uuid];
  const filepath = path.join(SKINS_DIR, `${uuid}.png`);

  if (username && fs.existsSync(filepath)) {
    res.json({
      uuid: uuid,
      username: username,
      skinUrl: `/api/skins/${uuid}.png`
    });
  } else {
    res.status(404).json({ error: 'Profile skin not found' });
  }
});

// 3. POST /api/skins - Uploads a player's skin
app.post('/api/skins', (req, res) => {
  const { username, uuid, base64Data } = req.body;

  if (!username || !uuid) {
    return res.status(400).json({ error: 'Username and UUID are required' });
  }

  const filepath = path.join(SKINS_DIR, `${uuid}.png`);

  if (!base64Data) {
    // If base64Data is empty, delete the skin and mapping
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
    delete mappings[uuid];
    saveMappings();
    return res.json({ success: true, message: 'Skin deleted successfully' });
  }

  try {
    const cleanBase64 = base64Data.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(filepath, Buffer.from(cleanBase64, 'base64'));
    
    // Save username mapping
    mappings[uuid] = username;
    saveMappings();
    
    console.log(`Saved skin for player ${username} (${uuid})`);
    res.json({ success: true, message: 'Skin saved successfully' });
  } catch (err) {
    console.error('Failed to save central skin:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Central Skin Server running on port ${PORT}`);
  console.log(`Configure your launcher to use: http://<your_server_ip>:${PORT}`);
});
