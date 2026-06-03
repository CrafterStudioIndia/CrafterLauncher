const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const dgram = require('dgram');

// Force Electron launcher process to also use Dedicated High-Performance GPU
app.commandLine.appendSwitch('force_high_performance_gpu');

// Rebrand to Crafter Launcher and store app data in '.crafter' folder
const appDataPath = app.getPath('appData');
const crafterPath = path.join(appDataPath, '.crafter');
app.setPath('userData', crafterPath);

const fs = require('fs');
const https = require('https');
const httpNode = require('http');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { exec } = require('child_process');
const { Client } = require('minecraft-launcher-core');
const launcher = new Client();

let mainWindow;
const configPath = path.join(app.getPath('userData'), 'launcher_config.json');
const authlibInjectorPath = path.join(app.getPath('userData'), 'authlib-injector-1.2.7.jar');
const logPath = path.join(app.getPath('userData'), 'launcher.log');

// File Logging Helper
function logToFile(msg) {
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
  } catch (e) {
    console.error('Failed to log to file:', e);
  }
}

// Clear log on startup
try {
  fs.writeFileSync(logPath, '--- Crafter Launcher Log Initialized ---\n', 'utf-8');
} catch (e) {}

// RSA Key Pair for Yggdrasil Skin Signatures
let privateKeyPem = '';
let publicKeyPem = '';

// Generate keys on startup
function generateKeys() {
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });
    publicKeyPem = publicKey;
    privateKeyPem = privateKey;
    logToFile('RSA Signatures Key Pair generated successfully.');
  } catch (err) {
    logToFile(`Failed to generate RSA key pair: ${err.message}`);
  }
}

// Generate Offline UUID
function getOfflineUUID(username) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; // Version 3
  hash[8] = (hash[8] & 0x3f) | 0x80; // Variant IETF
  return hash.toString('hex');
}

// Force Windows to use Dedicated GPU for the Java executable
function forceHighPerformanceGPU(javaPath) {
  if (process.platform !== 'win32') return;

  const registerGPUPreference = (exePath) => {
    if (!exePath) return;
    try {
      if (!fs.existsSync(exePath)) return;
      const normalizedPath = path.normalize(exePath);
      const cmd = `reg add "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" /v "${normalizedPath}" /t REG_SZ /d "GpuPreference=2;" /f`;
      exec(cmd, (err) => {
        if (err) {
          logToFile(`[GPU Preference] Failed to set GPU preference for ${normalizedPath}: ${err.message}`);
        } else {
          logToFile(`[GPU Preference] Successfully forced High Performance GPU (Dedicated GPU) for ${normalizedPath}`);
        }
      });

      // Also register javaw.exe if we got java.exe
      if (normalizedPath.toLowerCase().endsWith('java.exe')) {
        const javawPath = normalizedPath.slice(0, -8) + 'javaw.exe';
        if (fs.existsSync(javawPath)) {
          const cmdW = `reg add "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" /v "${javawPath}" /t REG_SZ /d "GpuPreference=2;" /f`;
          exec(cmdW, (err) => {
            if (err) {
              logToFile(`[GPU Preference] Failed to set GPU preference for ${javawPath}: ${err.message}`);
            } else {
              logToFile(`[GPU Preference] Successfully forced High Performance GPU (Dedicated GPU) for ${javawPath}`);
            }
          });
        }
      }
    } catch (e) {
      logToFile(`[GPU Preference Error] ${e.message}`);
    }
  };

  if (javaPath && javaPath !== 'java') {
    registerGPUPreference(javaPath);
  } else {
    // Resolve system java path
    exec('where java', (err, stdout) => {
      if (!err && stdout) {
        const paths = stdout.split('\r\n').map(p => p.trim()).filter(p => p.length > 0 && fs.existsSync(p));
        paths.forEach(p => registerGPUPreference(p));
      }
    });
  }
}

// P2P Peer Map and Discovery
const peers = new Map(); // uuid -> { username, ip, port, hasCape, timestamp }
let discoverySocket = null;
let discoveryInterval = null;
let currentDiscoveryUsername = '';

function startPeerDiscovery(username) {
  currentDiscoveryUsername = username;
  if (discoverySocket) return; // Already running
  
  const uuid = getOfflineUUID(username);
  discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  
  discoverySocket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.uuid && data.uuid !== getOfflineUUID(currentDiscoveryUsername)) {
        peers.set(data.uuid, {
          username: data.username,
          ip: rinfo.address,
          port: data.port || 3003,
          hasCape: !!data.hasCape,
          timestamp: Date.now()
        });
      }
    } catch (e) {}
  });
  
  discoverySocket.on('error', (err) => {
    logToFile(`Discovery socket error: ${err.message}`);
  });
  
  discoverySocket.bind(3006, () => {
    try {
      discoverySocket.setBroadcast(true);
      logToFile('P2P LAN Skin Discovery listening on UDP port 3006.');
    } catch (e) {
      logToFile(`Failed to set UDP broadcast: ${e.message}`);
    }
  });
  
  discoveryInterval = setInterval(() => {
    try {
      const config = loadConfig();
      const currentUsername = config.username || 'Player';
      currentDiscoveryUsername = currentUsername;
      const userUuid = getOfflineUUID(currentUsername);
      const capesDir = path.join(config.minecraftDir, 'capes');
      const hasCape = fs.existsSync(path.join(capesDir, `${currentUsername}.png`));
      
      const payload = JSON.stringify({
        username: currentUsername,
        uuid: userUuid,
        port: 3003,
        hasCape: hasCape
      });
      
      if (discoverySocket) {
        discoverySocket.send(payload, 3006, '255.255.255.255');
      }
    } catch (e) {}
  }, 4000);
  
  // Expiry cleaner
  setInterval(() => {
    const now = Date.now();
    for (const [key, peer] of peers.entries()) {
      if (now - peer.timestamp > 20000) {
        peers.delete(key);
      }
    }
  }, 8000);
}

// Find local username matching offline UUID
function findUsernameByUUID(minecraftDir, uuid) {
  const cleanUuid = uuid.replace(/-/g, '').toLowerCase();
  const skinsDir = path.join(minecraftDir, 'skins');
  if (!fs.existsSync(skinsDir)) return null;
  try {
    const files = fs.readdirSync(skinsDir);
    for (const file of files) {
      if (file.endsWith('.png')) {
        const username = file.slice(0, -4);
        if (getOfflineUUID(username) === cleanUuid) {
          return username;
        }
      }
    }
  } catch (e) {
    logToFile(`Error scanning skins dir: ${e.message}`);
  }
  return null;
}

// Fallback to Mojang to fetch player skin and sign it locally
function fallbackToMojang(uuid, res) {
  const cleanUuid = uuid.replace(/-/g, '').toLowerCase();
  https.get(`https://sessionserver.mojang.com/session/minecraft/profile/${cleanUuid}`, (mojangRes) => {
    let data = '';
    mojangRes.on('data', chunk => data += chunk);
    mojangRes.on('end', () => {
      try {
        if (mojangRes.statusCode === 200) {
          const profile = JSON.parse(data);
          if (profile.properties) {
            profile.properties.forEach(prop => {
              if (prop.name === 'textures') {
                const sign = crypto.createSign('SHA1');
                sign.update(prop.value);
                prop.signature = sign.sign(privateKeyPem, 'base64');
              }
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(profile));
        } else {
          res.writeHead(204);
          res.end();
        }
      } catch (err) {
        res.writeHead(204);
        res.end();
      }
    });
  }).on('error', () => {
    res.writeHead(204);
    res.end();
  });
}

// Helper to save uploaded skins/capes as RGBA PNGs (converts indexed/palette images)
function saveImageAsRGBA(filepath, base64Data) {
  const { nativeImage } = require('electron');
  const cleanBase64 = base64Data.replace(/^data:image\/png;base64,/, "");
  const buf = Buffer.from(cleanBase64, 'base64');
  const img = nativeImage.createFromBuffer(buf);
  fs.writeFileSync(filepath, img.toPNG());
}

// Helper to sanitize existing skins/capes on disk (converting color type 3 indexed images to RGBA)
function sanitizeSkinsAndCapes(minecraftDir) {
  const { nativeImage } = require('electron');
  const skinsDir = path.join(minecraftDir, 'skins');
  const capesDir = path.join(minecraftDir, 'capes');

  const processDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.toLowerCase().endsWith('.png')) {
          const filepath = path.join(dir, file);
          try {
            const buf = fs.readFileSync(filepath);
            // If the PNG has color type 3 (indexed color), convert it to standard RGBA (type 6)
            if (buf.length > 25 && buf[25] === 3) {
              logToFile(`[Sanitize] Found indexed-color PNG: ${filepath}. Converting to RGBA...`);
              const img = nativeImage.createFromBuffer(buf);
              fs.writeFileSync(filepath, img.toPNG());
              logToFile(`[Sanitize] Successfully converted ${file} to RGBA.`);
            }
          } catch (e) {
            logToFile(`[Sanitize Error] Failed to process ${file}: ${e.message}`);
          }
        }
      }
    } catch (err) {
      logToFile(`[Sanitize Error] Failed to scan directory ${dir}: ${err.message}`);
    }
  };

  processDir(skinsDir);
  processDir(capesDir);
}

// Start built-in Yggdrasil skin server
let skinServer = null;
function startSkinServer() {
  // Ensure default skins/capes folders exist for the current directory initially
  const initialConfig = loadConfig();
  const initialSkinsDir = path.join(initialConfig.minecraftDir, 'skins');
  const initialCapesDir = path.join(initialConfig.minecraftDir, 'capes');
  if (!fs.existsSync(initialSkinsDir)) fs.mkdirSync(initialSkinsDir, { recursive: true });
  if (!fs.existsSync(initialCapesDir)) fs.mkdirSync(initialCapesDir, { recursive: true });

  skinServer = httpNode.createServer((req, res) => {
    const url = req.url;
    const method = req.method;

    logToFile(`[Skin Server Request] ${method} ${url}`);

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Resolve directories dynamically to account for settings updates
    const currentConfig = loadConfig();
    const dynamicMcDir = currentConfig.minecraftDir;
    const skinsDir = path.join(dynamicMcDir, 'skins');
    const capesDir = path.join(dynamicMcDir, 'capes');
    if (!fs.existsSync(skinsDir)) {
      try { fs.mkdirSync(skinsDir, { recursive: true }); } catch (e) {}
    }
    if (!fs.existsSync(capesDir)) {
      try { fs.mkdirSync(capesDir, { recursive: true }); } catch (e) {}
    }

    if (method === 'GET' && (url === '/' || url === '/authserver' || url === '/sessionserver')) {
      // Yggdrasil Root Metadata
      logToFile('[Skin Server] Serving Yggdrasil API root metadata.');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        meta: {
          serverName: "Crafter Skin Server",
          implementationName: "crafter-auth",
          implementationVersion: "1.0.0"
        },
        skinDomains: [
          "localhost",
          "127.0.0.1"
        ],
        signaturePublickey: publicKeyPem,
        signaturePublicKey: publicKeyPem
      }));
    } else if (method === 'GET' && url.startsWith('/sessionserver/session/minecraft/profile/')) {
      // Profile details including textures
      const rawUuid = url.split('/')[5].split('?')[0];
      const uuid = rawUuid.replace(/-/g, '').toLowerCase();
      logToFile(`[Skin Server] Querying profile for UUID: ${uuid}`);

      // 1. Check if it matches a discovered P2P peer first
      const peer = peers.get(uuid);
      if (peer) {
        logToFile(`[Skin Server] Serving P2P Peer Skin for UUID ${uuid} (${peer.username}) from peer IP: ${peer.ip}`);
        const textureJSON = {
          timestamp: Date.now(),
          profileId: uuid,
          profileName: peer.username,
          textures: {
            SKIN: {
              url: `http://localhost:3003/skins/${encodeURIComponent(peer.username)}.png?t=${peer.timestamp}`
            }
          }
        };

        if (peer.hasCape) {
          textureJSON.textures.CAPE = {
            url: `http://localhost:3003/capes/${encodeURIComponent(peer.username)}.png?t=${peer.timestamp}`
          };
        }

        const textureBase64 = Buffer.from(JSON.stringify(textureJSON)).toString('base64');
        const sign = crypto.createSign('SHA1');
        sign.update(textureBase64);
        const signature = sign.sign(privateKeyPem, 'base64');

        const profile = {
          id: uuid,
          name: peer.username,
          properties: [
            {
              name: 'textures',
              value: textureBase64,
              signature: signature
            }
          ]
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(profile));
        return;
      }

      // 2. Check if a local skin exists
      const username = findUsernameByUUID(dynamicMcDir, uuid);
      if (username) {
        logToFile(`[Skin Server] Local skin found for UUID: ${uuid} (Username: ${username})`);
        
        const skinFile = path.join(skinsDir, `${username}.png`);
        let skinTime = Date.now();
        try {
          if (fs.existsSync(skinFile)) {
            skinTime = fs.statSync(skinFile).mtimeMs;
          }
        } catch (e) {}

        const textureJSON = {
          timestamp: Date.now(),
          profileId: uuid,
          profileName: username,
          textures: {
            SKIN: {
              url: `http://localhost:3003/skins/${encodeURIComponent(username)}.png?t=${skinTime}`
            }
          }
        };

        // Check if cape exists locally
        const capeFile = path.join(capesDir, `${username}.png`);
        if (fs.existsSync(capeFile)) {
          let capeTime = Date.now();
          try {
            capeTime = fs.statSync(capeFile).mtimeMs;
          } catch (e) {}
          logToFile(`[Skin Server] Cape found locally for username: ${username}`);
          textureJSON.textures.CAPE = {
            url: `http://localhost:3003/capes/${encodeURIComponent(username)}.png?t=${capeTime}`
          };
        }

        const textureBase64 = Buffer.from(JSON.stringify(textureJSON)).toString('base64');
        const sign = crypto.createSign('SHA1');
        sign.update(textureBase64);
        const signature = sign.sign(privateKeyPem, 'base64');

        const profile = {
          id: uuid,
          name: username,
          properties: [
            {
              name: 'textures',
              value: textureBase64,
              signature: signature
            }
          ]
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(profile));
      } else {
        // 3. Query Central Skin Server (if configured)
        if (currentConfig.centralSkinServer && currentConfig.centralSkinServer.startsWith('http')) {
          const centralUrl = `${currentConfig.centralSkinServer}/api/profiles/${uuid}`;
          logToFile(`[Skin Server] Profile not found locally. Forwarding UUID: ${uuid} to Central Server: ${centralUrl}`);
          const clientModule = currentConfig.centralSkinServer.startsWith('https') ? https : httpNode;

          clientModule.get(centralUrl, (centralRes) => {
            if (centralRes.statusCode === 200) {
              let body = '';
              centralRes.on('data', chunk => body += chunk);
              centralRes.on('end', () => {
                try {
                  const data = JSON.parse(body);
                  let skinUrl = data.skinUrl;
                  if (skinUrl.startsWith('/')) {
                    skinUrl = `${currentConfig.centralSkinServer}${skinUrl}`;
                  }

                  const textureJSON = {
                    timestamp: Date.now(),
                    profileId: uuid,
                    profileName: data.username,
                    textures: {
                      SKIN: {
                        url: skinUrl
                      }
                    }
                  };

                  // Check if cape exists in central profile response
                  if (data.capeUrl) {
                    let capeUrl = data.capeUrl;
                    if (capeUrl.startsWith('/')) {
                      capeUrl = `${currentConfig.centralSkinServer}${capeUrl}`;
                    }
                    textureJSON.textures.CAPE = {
                      url: capeUrl
                    };
                  }
                  
                  const textureBase64 = Buffer.from(JSON.stringify(textureJSON)).toString('base64');
                  const sign = crypto.createSign('SHA1');
                  sign.update(textureBase64);
                  const signature = sign.sign(privateKeyPem, 'base64');

                  const profile = {
                    id: uuid,
                    name: data.username,
                    properties: [
                      {
                        name: 'textures',
                        value: textureBase64,
                        signature: signature
                      }
                    ]
                  };

                  logToFile(`[Skin Server] Served custom skin mapped from Central Server for username: ${data.username}`);
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify(profile));
                } catch (e) {
                  logToFile(`[Skin Server] Error parsing Central Server response: ${e.message}. Falling back to Mojang.`);
                  fallbackToMojang(uuid, res);
                }
              });
            } else {
              logToFile(`[Skin Server] Central Server returned status ${centralRes.statusCode}. Falling back to Mojang.`);
              fallbackToMojang(uuid, res);
            }
          }).on('error', (err) => {
            logToFile(`[Skin Server] Central Server connection error: ${err.message}. Falling back to Mojang.`);
            fallbackToMojang(uuid, res);
          });
        } else {
          logToFile(`[Skin Server] UUID ${uuid} not matched locally and no Central Server configured. Falling back to Mojang.`);
          fallbackToMojang(uuid, res);
        }
      }
    } else if (method === 'GET' && url.startsWith('/skins/')) {
      // Serve local skin file
      const filenameWithQuery = decodeURIComponent(url.substring(7));
      const filename = filenameWithQuery.split('?')[0];
      const filepath = path.join(skinsDir, filename);
      logToFile(`[Skin Server] Client requesting local skin file: ${filename}`);
      if (fs.existsSync(filepath) && fs.statSync(filepath).isFile()) {
        logToFile(`[Skin Server] Found local skin file: ${filepath}. Serving bytes...`);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(filepath).pipe(res);
      } else {
        logToFile(`[Skin Server] Local skin file not found: ${filepath}`);
        res.writeHead(404);
        res.end('Skin not found');
      }
    } else if (method === 'GET' && url.startsWith('/capes/')) {
      // Serve local cape file
      const filenameWithQuery = decodeURIComponent(url.substring(7));
      const filename = filenameWithQuery.split('?')[0];
      const filepath = path.join(capesDir, filename);
      logToFile(`[Skin Server] Client requesting local cape file: ${filename}`);
      if (fs.existsSync(filepath) && fs.statSync(filepath).isFile()) {
        logToFile(`[Skin Server] Found local cape file: ${filepath}. Serving bytes...`);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(filepath).pipe(res);
      } else {
        logToFile(`[Skin Server] Local cape file not found: ${filepath}`);
        res.writeHead(404);
        res.end('Cape not found');
      }
    } else {
      // Complete standard auth routes mocks
      if (method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (url.startsWith('/authserver/authenticate')) {
          logToFile('[Skin Server] Handling mock /authserver/authenticate POST');
          res.end(JSON.stringify({
            accessToken: "crafteraccesstoken",
            clientToken: "crafterclienttoken",
            selectedProfile: { id: "crafteruuid", name: "Player" },
            availableProfiles: [{ id: "crafteruuid", name: "Player" }]
          }));
        } else if (url.startsWith('/authserver/validate')) {
          logToFile('[Skin Server] Handling mock /authserver/validate POST');
          res.writeHead(204);
          res.end();
        } else if (url.startsWith('/sessionserver/session/minecraft/join')) {
          logToFile('[Skin Server] Handling mock /sessionserver/session/minecraft/join POST');
          res.writeHead(204);
          res.end();
        } else {
          res.writeHead(404);
          res.end();
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    }
  });

  skinServer.on('error', (err) => {
    logToFile(`Skin Server Error: ${err.message}`);
  });

  skinServer.listen(3003, () => {
    logToFile('Local Yggdrasil/Skin Server running on http://localhost:3003');
  });
}

// Upload payload to central skin server
function uploadToCentralServer(serverUrl, username, uuid, base64Data, isCape = false) {
  try {
    const urlObj = new URL(`${serverUrl}/api/skins`);
    const clientModule = serverUrl.startsWith('https') ? https : httpNode;
    
    const payload = JSON.stringify({
      username,
      uuid,
      base64Data,
      isCape
    });
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (serverUrl.startsWith('https') ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    const req = clientModule.request(options, (res) => {
      logToFile(`Central Skin/Cape Server upload status: ${res.statusCode}`);
    });
    
    req.on('error', (e) => {
      logToFile(`Central Server upload failed: ${e.message}`);
    });
    
    req.write(payload);
    req.end();
  } catch (err) {
    logToFile(`Error preparing central upload: ${err.message}`);
  }
}

// Download helper with redirect tracking and timeouts
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let request;
    
    const timeout = 300000; // 5 minutes timeout
    let timer = setTimeout(() => {
      if (request) request.destroy();
      file.close();
      fs.unlink(destPath, () => {});
      reject(new Error('Download request timed out'));
    }, timeout);

    const getRequest = (targetUrl) => {
      try {
        const client = targetUrl.startsWith('https') ? https : httpNode;
        request = client.get(targetUrl, (response) => {
          clearTimeout(timer);
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            timer = setTimeout(() => {
              if (request) request.destroy();
              file.close();
              fs.unlink(destPath, () => {});
              reject(new Error('Redirect request timed out'));
            }, timeout);
            getRequest(response.headers.location);
          } else if (response.statusCode === 200) {
            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          } else {
            file.close();
            fs.unlink(destPath, () => {});
            reject(new Error(`Failed to download: status ${response.statusCode}`));
          }
        });

        request.on('error', (err) => {
          clearTimeout(timer);
          file.close();
          fs.unlink(destPath, () => {});
          reject(err);
        });
      } catch (err) {
        clearTimeout(timer);
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      }
    };
    getRequest(url);
  });
}

// Download helper with progress tracking, redirect tracking, and timeouts
function downloadFileWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let request;
    
    const timeout = 600000; // 10 minutes timeout for larger files
    let timer = setTimeout(() => {
      if (request) request.destroy();
      file.close();
      fs.unlink(destPath, () => {});
      reject(new Error('Download request timed out'));
    }, timeout);

    const getRequest = (targetUrl) => {
      try {
        const client = targetUrl.startsWith('https') ? https : httpNode;
        request = client.get(targetUrl, (response) => {
          clearTimeout(timer);
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            timer = setTimeout(() => {
              if (request) request.destroy();
              file.close();
              fs.unlink(destPath, () => {});
              reject(new Error('Redirect request timed out'));
            }, timeout);
            getRequest(response.headers.location);
          } else if (response.statusCode === 200) {
            const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
            let downloadedBytes = 0;
            
            response.on('data', (chunk) => {
              downloadedBytes += chunk.length;
              if (totalBytes > 0 && onProgress) {
                const percent = Math.round((downloadedBytes / totalBytes) * 100);
                onProgress(percent, downloadedBytes, totalBytes);
              }
            });

            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          } else {
            file.close();
            fs.unlink(destPath, () => {});
            reject(new Error(`Failed to download: status ${response.statusCode}`));
          }
        });

        request.on('error', (err) => {
          clearTimeout(timer);
          file.close();
          fs.unlink(destPath, () => {});
          reject(err);
        });
      } catch (err) {
        clearTimeout(timer);
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      }
    };
    getRequest(url);
  });
}

// Java Runtime Helpers
function isSystemJavaAvailable() {
  return new Promise((resolve) => {
    exec('java -version', (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function getPortableJavaPath() {
  const jreDir = path.join(app.getPath('userData'), 'jre25');
  if (fs.existsSync(jreDir)) {
    try {
      const subdirs = fs.readdirSync(jreDir).filter(f => fs.statSync(path.join(jreDir, f)).isDirectory());
      for (const subdir of subdirs) {
        const exePath = path.join(jreDir, subdir, 'bin', 'java.exe');
        if (fs.existsSync(exePath)) {
          return exePath;
        }
      }
    } catch (e) {}
  }
  return null;
}

// Check and download authlib-injector
async function verifyAuthlibInjector() {
  if (fs.existsSync(authlibInjectorPath)) {
    return true;
  }
  logToFile('Downloading authlib-injector-1.2.7.jar...');
  const downloadUrl = 'https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.7/authlib-injector-1.2.7.jar';
  try {
    await downloadFile(downloadUrl, authlibInjectorPath);
    logToFile('Downloaded authlib-injector-1.2.7.jar successfully.');
    return true;
  } catch (err) {
    logToFile(`Failed to download authlib-injector: ${err.message}`);
    return false;
  }
}

// Default launcher configuration
const defaultConfig = {
  username: 'Player',
  maxMemory: 4096,
  minMemory: 1024,
  javaPath: 'java',
  minecraftDir: path.join(app.getPath('userData'), 'minecraft'),
  lastSelectedVersion: '26.1.2',
  windowWidth: 1024,
  windowHeight: 650,
  centralSkinServer: 'http://localhost:3004',
  geminiApiKey: '',
  fpsBooster: true,
  profiles: {}
};

// Sync config profiles with local version loaders and current selected version
function syncProfiles(config) {
  if (!config.profiles) {
    config.profiles = {};
  }
  
  // 1. Ensure lastSelectedVersion is in profiles
  const lastVer = config.lastSelectedVersion || '26.1.2';
  if (!config.profiles[lastVer]) {
    let logo = 'vanilla';
    if (lastVer.endsWith('-fabric')) logo = 'fabric';
    else if (lastVer.toLowerCase().includes('forge')) logo = 'forge';
    config.profiles[lastVer] = {
      id: lastVer,
      name: lastVer.endsWith('-fabric') ? `${lastVer.replace('-fabric', '')} Fabric` : (lastVer.toLowerCase().includes('forge') ? `${lastVer} Forge` : `${lastVer} Vanilla`),
      version: lastVer,
      logo: logo
    };
  }

  // 2. Scan local installed loaders and add them as profiles if missing
  try {
    const versionsDir = path.join(config.minecraftDir, 'versions');
    if (fs.existsSync(versionsDir)) {
      const files = fs.readdirSync(versionsDir);
      for (const file of files) {
        const fullPath = path.join(versionsDir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          const jsonPath = path.join(fullPath, `${file}.json`);
          if (fs.existsSync(jsonPath) && !config.profiles[file]) {
            let logo = 'vanilla';
            if (file.endsWith('-fabric')) logo = 'fabric';
            else if (file.toLowerCase().includes('forge')) logo = 'forge';
            
            config.profiles[file] = {
              id: file,
              name: file.endsWith('-fabric') ? `${file.replace('-fabric', '')} Fabric` : (file.toLowerCase().includes('forge') ? `${file} Forge` : `${file} (Local)`),
              version: file,
              logo: logo
            };
          }
        }
      }
    }
  } catch (e) {}

  return config;
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const loaded = { ...defaultConfig, ...JSON.parse(data) };
      return syncProfiles(loaded);
    }
  } catch (err) {
    logToFile(`Failed to load config: ${err.message}`);
  }
  return syncProfiles(defaultConfig);
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    logToFile(`Failed to save config: ${err.message}`);
  }
}

function createWindow() {
  const config = loadConfig();
  
  mainWindow = new BrowserWindow({
    width: config.windowWidth,
    height: config.windowHeight,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#0d0b18',
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Keep devtools closed by default, but logging remains enabled
  });

  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    const current = loadConfig();
    saveConfig({ ...current, windowWidth: width, windowHeight: height });
  });
}

app.whenReady().then(async () => {
  generateKeys();
  const config = loadConfig();
  
  // Sanitize existing skins and capes (convert palette mode PNGs to standard RGBA)
  try {
    sanitizeSkinsAndCapes(config.minecraftDir);
  } catch (err) {
    logToFile(`Failed to sanitize skins and capes on startup: ${err.message}`);
  }

  // Clear game assets skin cache on startup to ensure no stale glitched skins persist
  try {
    const skinsCacheDir = path.join(config.minecraftDir, 'assets', 'skins');
    if (fs.existsSync(skinsCacheDir)) {
      fs.rmSync(skinsCacheDir, { recursive: true, force: true });
      logToFile('[Cache] Successfully cleared Minecraft assets skins cache on startup.');
    }
  } catch (err) {
    logToFile(`[Cache Error] Failed to clear skins cache on startup: ${err.message}`);
  }

  // Set GPU preferences for the configured Java runtime on startup
  try {
    let startupJava = config.javaPath;
    if (!startupJava || startupJava === 'java') {
      const portableJava = getPortableJavaPath();
      if (portableJava) {
        startupJava = portableJava;
      }
    }
    forceHighPerformanceGPU(startupJava);
  } catch (err) {
    logToFile(`Failed to apply GPU preferences on startup: ${err.message}`);
  }

  startSkinServer();
  createWindow();
  
  // Start P2P LAN Skin/Cape discovery broadcast
  try {
    startPeerDiscovery(config.username || 'Player');
  } catch (err) {
    logToFile(`Failed to start P2P discovery: ${err.message}`);
  }
  
  // Verify authlib-injector asynchronously in background
  verifyAuthlibInjector().catch(e => {
    logToFile(`Background authlib-injector download failed: ${e.message}`);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (skinServer) skinServer.close();
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler - Configuration
ipcMain.handle('get-config', () => {
  return loadConfig();
});

ipcMain.handle('save-config', (event, newConfig) => {
  saveConfig(newConfig);
  
  // Sanitize existing skins and capes in the new Minecraft directory
  try {
    sanitizeSkinsAndCapes(newConfig.minecraftDir);
  } catch (err) {
    logToFile(`Failed to sanitize skins and capes on config save: ${err.message}`);
  }

  return { success: true };
});

ipcMain.handle('get-vanilla-version', (event, versionId) => {
  return getVanillaVersion(versionId);
});

// IPC Handler - Upload Custom Skin
ipcMain.handle('upload-skin', (event, { username, base64Data }) => {
  const config = loadConfig();
  const skinsDir = path.join(config.minecraftDir, 'skins');
  if (!fs.existsSync(skinsDir)) {
    fs.mkdirSync(skinsDir, { recursive: true });
  }

  const filepath = path.join(skinsDir, `${username}.png`);
  try {
    if (!base64Data) {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      if (config.centralSkinServer && config.centralSkinServer.startsWith('http')) {
        uploadToCentralServer(config.centralSkinServer, username, getOfflineUUID(username), null, false);
      }
      return { success: true };
    }
    
    // Save/convert to RGBA format
    saveImageAsRGBA(filepath, base64Data);

    let uploadPayload = base64Data;
    try {
      const convertedBuf = fs.readFileSync(filepath);
      uploadPayload = `data:image/png;base64,${convertedBuf.toString('base64')}`;
    } catch (e) {
      logToFile(`[Upload Skin] Failed to read back converted skin for central upload: ${e.message}`);
    }

    if (config.centralSkinServer && config.centralSkinServer.startsWith('http')) {
      uploadToCentralServer(config.centralSkinServer, username, getOfflineUUID(username), uploadPayload, false);
    }
    return { success: true };
  } catch (err) {
    logToFile(`Failed to save/delete skin: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// IPC Handler - Upload Custom Cape
ipcMain.handle('upload-cape', (event, { username, base64Data }) => {
  const config = loadConfig();
  const capesDir = path.join(config.minecraftDir, 'capes');
  if (!fs.existsSync(capesDir)) {
    fs.mkdirSync(capesDir, { recursive: true });
  }

  const filepath = path.join(capesDir, `${username}.png`);
  try {
    if (!base64Data) {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      if (config.centralSkinServer && config.centralSkinServer.startsWith('http')) {
        uploadToCentralServer(config.centralSkinServer, username, getOfflineUUID(username), null, true);
      }
      return { success: true };
    }
    
    // Save/convert to RGBA format
    saveImageAsRGBA(filepath, base64Data);

    let uploadPayload = base64Data;
    try {
      const convertedBuf = fs.readFileSync(filepath);
      uploadPayload = `data:image/png;base64,${convertedBuf.toString('base64')}`;
    } catch (e) {
      logToFile(`[Upload Cape] Failed to read back converted cape for central upload: ${e.message}`);
    }

    if (config.centralSkinServer && config.centralSkinServer.startsWith('http')) {
      uploadToCentralServer(config.centralSkinServer, username, getOfflineUUID(username), uploadPayload, true);
    }
    return { success: true };
  } catch (err) {
    logToFile(`Failed to save/delete cape: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// IPC Handler - Get User Skin Base64 representation
ipcMain.handle('get-skin', (event, username) => {
  const config = loadConfig();
  const filepath = path.join(config.minecraftDir, 'skins', `${username}.png`);
  if (fs.existsSync(filepath)) {
    const data = fs.readFileSync(filepath);
    return `data:image/png;base64,${data.toString('base64')}`;
  }
  return null;
});

// IPC Handler - Get User Cape Base64 representation
ipcMain.handle('get-cape', (event, username) => {
  const config = loadConfig();
  const filepath = path.join(config.minecraftDir, 'capes', `${username}.png`);
  if (fs.existsSync(filepath)) {
    const data = fs.readFileSync(filepath);
    return `data:image/png;base64,${data.toString('base64')}`;
  }
  return null;
});

// IPC Handler - Select Folder for Minecraft directory
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC Handler - Open Instance Folder in Windows Explorer
ipcMain.handle('open-instance-folder', (event, instanceId) => {
  const config = loadConfig();
  const folderPath = path.join(config.minecraftDir, 'instances', instanceId);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  shell.openPath(folderPath);
  return { success: true };
});

// IPC Handler - Select Standalone Client Executable Path
ipcMain.handle('select-external-client', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Executables / Launchers', extensions: ['exe', 'bat', 'cmd', '*'] }
    ]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC Handler - Select File for Java path
ipcMain.handle('select-java-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Java Executable', extensions: ['exe', 'bin', '*'] }
    ]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC Handler - Window Controls
ipcMain.handle('window-control', (event, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') {
    mainWindow.minimize();
  } else if (action === 'maximize') {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  } else if (action === 'close') {
    mainWindow.close();
  }
});

// IPC Handler - Get Minecraft Versions from Mojang API
ipcMain.handle('get-mc-versions', () => {
  return new Promise((resolve, reject) => {
    https.get('https://launchermeta.mojang.com/mc/game/version_manifest.json', (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(rawData);
          resolve(parsedData.versions);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (e) => {
      reject(e);
    });
  });
});

// IPC Handler - Get Local Installed Versions
ipcMain.handle('get-local-versions', async () => {
  const config = loadConfig();
  const versionsDir = path.join(config.minecraftDir, 'versions');
  if (!fs.existsSync(versionsDir)) return [];
  try {
    const files = fs.readdirSync(versionsDir);
    const locals = [];
    for (const file of files) {
      const fullPath = path.join(versionsDir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        const jsonPath = path.join(fullPath, `${file}.json`);
        if (fs.existsSync(jsonPath)) {
          locals.push(file);
        }
      }
    }
    return locals;
  } catch (e) {
    logToFile(`Error scanning local versions: ${e.message}`);
    return [];
  }
});

// Helper to get vanilla version from profile ID
function getVanillaVersion(versionId) {
  const config = loadConfig();
  let targetVerId = versionId;
  
  if (versionId && versionId.startsWith('profile_')) {
    const profile = config.profiles && config.profiles[versionId];
    if (profile) {
      targetVerId = profile.version;
    }
  }

  const localVersionJsonPath = path.join(config.minecraftDir, 'versions', targetVerId, `${targetVerId}.json`);
  if (fs.existsSync(localVersionJsonPath)) {
    try {
      const localVersionJson = JSON.parse(fs.readFileSync(localVersionJsonPath, 'utf-8'));
      if (localVersionJson.inheritsFrom) {
        return localVersionJson.inheritsFrom;
      }
    } catch (e) {
      logToFile(`Failed to read local JSON inheritsFrom check: ${e.message}`);
    }
  }
  return targetVerId.split('-')[0];
}

// IPC Handler - Install Mod from Modrinth API
ipcMain.handle('install-mod', async (event, { projectId, gameVersion, loader, projectType, downloadUrl, filename }) => {
  const config = loadConfig();
  const subFolder = (projectType === 'resourcepack') ? 'resourcepacks' : 'mods';
  
  // Use separate instance folder for mods/resource packs
  const targetDir = path.join(config.minecraftDir, 'instances', gameVersion, subFolder);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Support direct download if url & filename are provided
  if (downloadUrl && filename) {
    const destPath = path.join(targetDir, filename);
    logToFile(`[Direct Download] Downloading selected file: ${downloadUrl} -> ${destPath}`);
    try {
      await downloadFile(downloadUrl, destPath);
      return { success: true, filename };
    } catch (e) {
      logToFile(`[Direct Download] Failed to download: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  const queryVersion = getVanillaVersion(gameVersion);
  let modrinthUrl;
  if (projectType === 'resourcepack') {
    const versionParam = encodeURIComponent(JSON.stringify([queryVersion]));
    modrinthUrl = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=${versionParam}`;
  } else {
    const loaderParam = encodeURIComponent(JSON.stringify([loader]));
    const versionParam = encodeURIComponent(JSON.stringify([queryVersion]));
    modrinthUrl = `https://api.modrinth.com/v2/project/${projectId}/version?loaders=${loaderParam}&game_versions=${versionParam}`;
  }

  return new Promise((resolve) => {
    const urlObj = new URL(modrinthUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Crafter-Launcher/1.0.0 (contact@crafterlauncher.com)'
      }
    };

    https.get(options, (res) => {
      if (res.statusCode !== 200) {
        resolve({ success: false, error: `Modrinth API returned status code ${res.statusCode}` });
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const versions = JSON.parse(data);
          if (versions.length === 0) {
            const errorMsg = (projectType === 'resourcepack')
              ? `No compatible resource pack file found on Modrinth for MC ${queryVersion}.`
              : `No compatible version file found on Modrinth for MC ${queryVersion} and loader ${loader}.`;
            resolve({ success: false, error: errorMsg });
            return;
          }

          const latestVersion = versions[0];
          if (!latestVersion.files || latestVersion.files.length === 0) {
            resolve({ success: false, error: 'No files associated with this version.' });
            return;
          }

          const fileInfo = latestVersion.files[0];
          const downloadUrl = fileInfo.url;
          const filename = fileInfo.filename;
          const destPath = path.join(targetDir, filename);

          logToFile(`Downloading ${projectType || 'mod'}: ${downloadUrl} -> ${destPath}`);
          await downloadFile(downloadUrl, destPath);
          resolve({ success: true, filename });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', (e) => {
      resolve({ success: false, error: e.message });
    });
  });
});

// IPC Handler - Install Modpack from Modrinth
ipcMain.handle('install-modpack', async (event, { projectId, gameVersion, versionId }) => {
  const config = loadConfig();
  
  // Install modpack directly to its specific instance folder
  const mcDir = path.join(config.minecraftDir, 'instances', gameVersion);
  const tempDir = path.join(config.minecraftDir, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const queryVersion = getVanillaVersion(gameVersion);
  // Fetch modpack versions matching the resolved vanilla game version
  const modrinthUrl = versionId
    ? `https://api.modrinth.com/v2/version/${versionId}`
    : `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=["${queryVersion}"]`;

  return new Promise((resolve) => {
    const urlObj = new URL(modrinthUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Aether-Launcher/1.0.0 (contact@aetherlauncher.com)'
      }
    };

    https.get(options, (res) => {
      if (res.statusCode !== 200) {
        resolve({ success: false, error: `Modrinth API returned status ${res.statusCode}` });
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const apiData = JSON.parse(data);
          let latestVersion;
          if (versionId) {
            latestVersion = apiData;
          } else {
            const packVersions = apiData.filter(v => v.featured || true);
            if (packVersions.length === 0) {
              resolve({ success: false, error: `No compatible modpack version found for MC ${queryVersion}.` });
              return;
            }
            latestVersion = packVersions[0];
          }

          if (!latestVersion.files || latestVersion.files.length === 0) {
            resolve({ success: false, error: 'No files associated with this modpack version.' });
            return;
          }

          const fileInfo = latestVersion.files[0];
          const downloadUrl = fileInfo.url;
          const mrpackPath = path.join(tempDir, 'modpack.mrpack');

          logToFile(`Downloading Modrinth Modpack from ${downloadUrl}`);
          await downloadFile(downloadUrl, mrpackPath);

          // Extract mrpack contents
          const zip = new AdmZip(mrpackPath);
          const zipEntries = zip.getEntries();

          // Parse modrinth.index.json
          const indexEntry = zipEntries.find(e => e.entryName === 'modrinth.index.json');
          if (!indexEntry) {
            resolve({ success: false, error: 'modrinth.index.json not found in modpack!' });
            return;
          }

          const indexData = JSON.parse(indexEntry.getData().toString('utf8'));
          const filesToDownload = indexData.files.filter(f => f.env && f.env.client !== 'unsupported');

          logToFile(`Installing modpack ${indexData.name}. Downloading ${filesToDownload.length} files...`);

          for (const file of filesToDownload) {
            const fileUrl = file.downloads[0];
            const fileDest = path.join(mcDir, file.path);
            
            const fileDir = path.dirname(fileDest);
            if (!fs.existsSync(fileDir)) {
              fs.mkdirSync(fileDir, { recursive: true });
            }

            logToFile(`Downloading pack file: ${fileUrl} -> ${fileDest}`);
            await downloadFile(fileUrl, fileDest);
          }

          // Extract overrides
          zipEntries.forEach(entry => {
            if (entry.entryName.startsWith('overrides/')) {
              const relativePath = entry.entryName.substring(10);
              if (relativePath) {
                const destPath = path.join(mcDir, relativePath);
                if (entry.isDirectory) {
                  fs.mkdirSync(destPath, { recursive: true });
                } else {
                  fs.mkdirSync(path.dirname(destPath), { recursive: true });
                  fs.writeFileSync(destPath, entry.getData());
                }
              }
            }
          });

          // Clean up
          fs.unlinkSync(mrpackPath);

          let loader = null;
          let loaderVersion = null;
          if (indexData.dependencies) {
            if (indexData.dependencies['fabric-loader']) {
              loader = 'fabric';
              loaderVersion = indexData.dependencies['fabric-loader'];
            } else if (indexData.dependencies['forge']) {
              loader = 'forge';
              loaderVersion = indexData.dependencies['forge'];
            }
          }

          resolve({ 
            success: true, 
            name: indexData.name || 'Custom Modpack',
            loader,
            loaderVersion,
            mcVersion: indexData.dependencies ? indexData.dependencies['minecraft'] : queryVersion
          });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', (e) => {
      resolve({ success: false, error: e.message });
    });
  });
});

// IPC Handler - Install Fabric Loader
ipcMain.handle('install-fabric', async (event, { gameVersion }) => {
  try {
    logToFile(`Fabric installation initiated for Minecraft version ${gameVersion}`);
    const loadersUrl = `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`;
    const loaderList = await new Promise((resolve, reject) => {
      https.get(loadersUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Fabric meta returned status ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });

    if (!loaderList || loaderList.length === 0) {
      return { success: false, error: `No Fabric loader found for Minecraft version ${gameVersion}` };
    }

    const latestLoader = loaderList[0].loader;
    const loaderVersion = latestLoader.version;
    logToFile(`Found latest Fabric loader version: ${loaderVersion}`);

    const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}/profile/json`;
    const profileJson = await new Promise((resolve, reject) => {
      https.get(profileUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Fabric profile endpoint returned status ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });

    const config = loadConfig();
    const targetId = `${gameVersion}-fabric`;
    profileJson.id = targetId;

    const versionDir = path.join(config.minecraftDir, 'versions', targetId);
    if (!fs.existsSync(versionDir)) {
      fs.mkdirSync(versionDir, { recursive: true });
    }

    const targetFile = path.join(versionDir, `${targetId}.json`);
    fs.writeFileSync(targetFile, JSON.stringify(profileJson, null, 2), 'utf-8');
    logToFile(`Successfully wrote Fabric profile JSON to ${targetFile}`);

    return { success: true, versionId: targetId };
  } catch (err) {
    logToFile(`Fabric installation failed: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// IPC Handler - Install Forge Loader
ipcMain.handle('install-forge', async (event, { gameVersion }) => {
  try {
    logToFile(`Forge installation initiated for Minecraft version ${gameVersion}`);
    const promosUrl = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
    const promosData = await new Promise((resolve, reject) => {
      https.get(promosUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Forge promotions returned status ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });

    const promos = promosData.promos || {};
    let forgeVersion = promos[`${gameVersion}-recommended`] || promos[`${gameVersion}-latest`];

    if (!forgeVersion) {
      const keys = Object.keys(promos);
      const matchingKey = keys.find(k => k.startsWith(gameVersion));
      if (matchingKey) {
        forgeVersion = promos[matchingKey];
      }
    }

    if (!forgeVersion) {
      return { success: false, error: `Could not find a valid Forge version for Minecraft ${gameVersion} in promotions.` };
    }

    logToFile(`Found Forge version: ${forgeVersion} for MC ${gameVersion}`);

    const downloadUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${gameVersion}-${forgeVersion}/forge-${gameVersion}-${forgeVersion}-installer.jar`;
    const config = loadConfig();
    const tempDir = path.join(config.minecraftDir, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const installerPath = path.join(tempDir, `forge-${gameVersion}-${forgeVersion}-installer.jar`);

    logToFile(`Downloading Forge Installer from: ${downloadUrl}`);
    await downloadFile(downloadUrl, installerPath);
    logToFile(`Forge Installer downloaded to ${installerPath}`);

    let finalJavaPath = 'java';
    const configJava = config.javaPath;
    if (configJava && configJava !== 'java' && fs.existsSync(configJava)) {
      finalJavaPath = configJava;
    } else {
      const portableJava = getPortableJavaPath();
      if (portableJava) {
        finalJavaPath = portableJava;
      }
    }

    const command = `"${finalJavaPath}" -jar "${installerPath}"`;
    logToFile(`Executing Forge Installer: ${command}`);

    exec(command, (err, stdout, stderr) => {
      if (err) {
        logToFile(`Forge Installer execution error: ${err.message}`);
      }
      logToFile(`Forge Installer output: ${stdout}`);
      if (stderr) {
        logToFile(`Forge Installer stderr: ${stderr}`);
      }
      try {
        fs.unlinkSync(installerPath);
      } catch (e) {}
    });

    return { success: true, message: `Forge installer GUI opened. Please point the installer directory to: ${config.minecraftDir}` };
  } catch (err) {
    logToFile(`Forge installation failed: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// Helper to call Google Gemini API for log analysis
function callGemini(apiKey, logs) {
  return new Promise((resolve) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const payload = JSON.stringify({
      contents: [{
        parts: [{
          text: `You are a Minecraft Java game crash analyzer. Below are the game console logs. Analyze the logs, find the exact cause of the crash, and give 2-3 bullet points of simple, actionable instructions for the player on how to fix it. Keep the response concise, formatted in clean markdown, and use warning blockquotes where appropriate.\n\nLOGS:\n${logs.substring(logs.length - 8000)}`
        }]
      }]
    });

    try {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts[0].text) {
              resolve({ success: true, text: json.candidates[0].content.parts[0].text });
            } else if (json.error) {
              resolve({ success: false, error: json.error.message });
            } else {
              resolve({ success: false, error: 'Unknown response format from Gemini API.' });
            }
          } catch (e) {
            resolve({ success: false, error: e.message });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      req.write(payload);
      req.end();
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

// Built-in offline diagnostic parser
function runOfflineDiagnostics(logs) {
  let diagnostics = "";
  
  if (logs.includes("java.lang.OutOfMemoryError") || logs.includes("OutOfMemory")) {
    diagnostics = `### ⚠️ Out of Memory (OOM) Detected
- **Cause**: Minecraft ran out of allocated RAM.
- **Solution**: Go to the **Settings** tab in the launcher, and drag the **Maximum RAM** slider to a higher value (at least 3072 MB or 4096 MB, depending on your system RAM). Click **Save Settings** and try again.`;
  } else if (logs.includes("UnsupportedClassVersionError") || logs.includes("has been compiled by a more recent version of the Java Runtime")) {
    diagnostics = `### ⚠️ Java Runtime Version Mismatch
- **Cause**: The selected Minecraft version (or a mod) requires a newer Java version than the one currently used.
- **Solution**:
  - Minecraft 1.20.5+ requires **Java 21**.
  - Minecraft 1.18 - 1.20.4 requires **Java 17**.
  - Minecraft 1.17 requires **Java 16**.
  - Minecraft 1.16.5 and older requires **Java 8**.
  - Open **Settings**, install the correct Java version on your system, and browse to select the new \`java.exe\` path under **Java Executable Path**.`;
  } else if (logs.includes("Pixel format not accelerated") || logs.includes("org.lwjgl.LWJGLException: Pixel format not accelerated") || logs.includes("GLFW error 65542")) {
    diagnostics = `### ⚠️ Graphics Driver / OpenGL Error Detected
- **Cause**: Your computer's graphics card drivers do not support the OpenGL standard required by Minecraft.
- **Solution**: Update your graphics card drivers (Intel HD Graphics, NVIDIA, or AMD Radeon) to the latest version. If on a laptop with dual GPUs, ensure Minecraft is running on your high-performance GPU.`;
  } else if (logs.includes("Mixin transformation failed") || logs.includes("org.spongepowered.asm.mixin.transformer.throwables")) {
    diagnostics = `### ⚠️ Mod Conflict / Loading Exception
- **Cause**: Two or more mods are trying to modify the same Minecraft code classes and are conflicting, or a mod is corrupt/incompatible with this Minecraft version.
- **Solution**: Try disabling your most recently installed mods by moving them out of the \`mods/\` folder, and verify that all installed mods are compatible with Minecraft.`;
  } else {
    diagnostics = `### 🔍 General Crash Diagnostic
- **Heuristic**: No specific known crash signature detected in logs.
- **Troubleshooting Steps**:
  1. Open the **Console Logs** tab to inspect the last few lines before the game closed. Look for line starting with \`Caused by:\` or \`Exception in thread "main"\`.
  2. Make sure you have allocated sufficient memory (at least 2-4GB).
  3. Ensure your Java Executable path in settings matches the version required by your Minecraft loader.
  4. Try creating a clean instance by changing the Minecraft Directory in settings.`;
  }
  
  return { success: true, text: diagnostics };
}

// IPC Handler - Analyze Logs (Gemini or Offline Diagnostics)
ipcMain.handle('analyze-logs', async (event, { logs, apiKey }) => {
  if (apiKey && apiKey.trim()) {
    logToFile('Sending logs to Gemini API for analysis...');
    return await callGemini(apiKey.trim(), logs);
  } else {
    logToFile('Running built-in offline diagnostics...');
    return runOfflineDiagnostics(logs);
  }
});

// Launching Logic
let activeGameProcess = null;
ipcMain.handle('launch-game', async (event, launchConfig) => {
  if (activeGameProcess) {
    return { success: false, error: 'A game is already running!' };
  }

  const { username, maxMemory, minMemory, javaPath, minecraftDir, versionNumber, instanceId, externalPath } = launchConfig;
  
  // Check and run standalone client executable directly if configured
  if (externalPath && externalPath.trim()) {
    const cleanPath = externalPath.trim();
    if (fs.existsSync(cleanPath)) {
      logToFile(`Launching standalone client: "${cleanPath}"`);
      mainWindow.webContents.send('launch-started');
      mainWindow.webContents.send('launch-log-batch', [{ type: 'system', text: `=== Launching Standalone Client: ${path.basename(cleanPath)} ===` }]);

      try {
        forceHighPerformanceGPU(cleanPath);
      } catch (e) {
        logToFile(`[GPU Preference Error] Failed to set GPU preference for client: ${e.message}`);
      }

      const proc = exec(`"${cleanPath}"`, (err) => {
        if (err) {
          logToFile(`Standalone client execution error: ${err.message}`);
          mainWindow.webContents.send('launch-error', err.message);
        }
      });

      if (proc) {
        activeGameProcess = proc;
        proc.on('close', (code) => {
          logToFile(`Standalone client process closed (Exit Code: ${code}).`);
          activeGameProcess = null;
          mainWindow.webContents.send('launch-closed', code);
        });
        proc.on('error', (err) => {
          logToFile(`Standalone client process error: ${err.message}`);
          activeGameProcess = null;
          mainWindow.webContents.send('launch-error', err.message);
        });
        return { success: true };
      } else {
        return { success: false, error: 'Failed to spawn standalone client process.' };
      }
    } else {
      return { success: false, error: `Configured standalone launcher executable not found at: ${cleanPath}` };
    }
  }

  // Use instanceId for folder targeting, falling back to versionNumber if not provided
  const targetInstanceId = instanceId || versionNumber;

  logToFile(`Initiating launch process: user=${username}, version=${versionNumber}, instance=${targetInstanceId}, RAM=${maxMemory}M`);

  // Make sure directories exist
  if (!fs.existsSync(minecraftDir)) {
    fs.mkdirSync(minecraftDir, { recursive: true });
  }

  // Clear game assets skin cache before launch to force client re-downloads of the RGBA textures
  try {
    const skinsCacheDir = path.join(minecraftDir, 'assets', 'skins');
    if (fs.existsSync(skinsCacheDir)) {
      fs.rmSync(skinsCacheDir, { recursive: true, force: true });
      logToFile('[Cache] Successfully cleared Minecraft assets skins cache before launch.');
    }
  } catch (err) {
    logToFile(`[Cache Error] Failed to clear skins cache before launch: ${err.message}`);
  }

  // Failsafe check for authlib-injector before launch
  const authlibOk = await verifyAuthlibInjector();
  if (!authlibOk) {
    return { success: false, error: 'Failed to download required authentication library (authlib-injector.jar). Please check your internet connection.' };
  }

  // Create custom Yggdrasil offline auth session block
  const offlineUuid = getOfflineUUID(username || 'Player');
  const auth = {
    access_token: 'crafteraccesstoken',
    client_token: 'crafterclienttoken',
    uuid: offlineUuid,
    name: username || 'Player',
    user_properties: '{}'
  };

  // Verify memory formats
  const maxMemStr = `${maxMemory}M`;
  const minMemStr = `${minMemory}M`;

  const versionOpts = {
    number: versionNumber,
    type: 'release'
  };

  // Check if this is a custom version (e.g. Fabric/Forge profile) inheriting from a base vanilla version
  const localVersionJsonPath = path.join(minecraftDir, 'versions', versionNumber, `${versionNumber}.json`);
  if (fs.existsSync(localVersionJsonPath)) {
    try {
      const localVersionJson = JSON.parse(fs.readFileSync(localVersionJsonPath, 'utf-8'));
      if (localVersionJson.inheritsFrom) {
        versionOpts.number = localVersionJson.inheritsFrom;
        versionOpts.custom = versionNumber;
        logToFile(`Detected custom profile ${versionNumber} inheriting from base version ${localVersionJson.inheritsFrom}`);
      }
    } catch (e) {
      logToFile(`Failed to read local version JSON: ${e.message}`);
    }
  }

  const instanceDir = path.join(minecraftDir, 'instances', targetInstanceId);
  if (!fs.existsSync(instanceDir)) {
    fs.mkdirSync(instanceDir, { recursive: true });
  }

  const opts = {
    authorization: auth,
    root: minecraftDir,
    version: versionOpts,
    memory: {
      max: maxMemStr,
      min: minMemStr
    },
    overrides: {
      gameDirectory: instanceDir
    }
  };

  // Determine Java Executable
  let finalJavaPath = null;
  if (javaPath && javaPath !== 'java' && fs.existsSync(javaPath)) {
    finalJavaPath = javaPath;
    logToFile(`Using custom Java Executable: ${finalJavaPath}`);
  } else {
    // 1. Check for local portable JRE 25
    const portableJava = getPortableJavaPath();
    if (portableJava) {
      finalJavaPath = portableJava;
      logToFile(`Using local portable Java Executable: ${finalJavaPath}`);
    } else {
      // 2. Check for system Java
      const systemJavaOk = await isSystemJavaAvailable();
      if (systemJavaOk) {
        logToFile(`Using system Java path.`);
        finalJavaPath = 'java';
      } else {
        // 3. Download Adoptium JRE 25
        logToFile('System Java and portable runtimes not found. Downloading Adoptium JRE 25...');
        if (mainWindow) {
          mainWindow.webContents.send('launch-progress', {
            type: 'java-download',
            task: 'Downloading Java Runtime Environment 25 (Required)...',
            total: 100,
            current: 0
          });
        }
        
        try {
          const jreDir = path.join(app.getPath('userData'), 'jre25');
          if (!fs.existsSync(jreDir)) {
            fs.mkdirSync(jreDir, { recursive: true });
          }
          const zipPath = path.join(jreDir, 'jre25.zip');
          const downloadUrl = 'https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jre/hotspot/normal/eclipse';
          
          await downloadFileWithProgress(downloadUrl, zipPath, (percent) => {
            if (mainWindow) {
              mainWindow.webContents.send('launch-progress', {
                type: 'java-download',
                task: `Downloading Java Runtime Environment 25... ${percent}%`,
                total: 100,
                current: percent
              });
            }
          });
          
          if (mainWindow) {
            mainWindow.webContents.send('launch-progress', {
              type: 'java-extract',
              task: 'Extracting Java Runtime Environment...',
              total: 100,
              current: 50
            });
          }
          
          logToFile('Extracting Adoptium JRE 25 Zip...');
          const zip = new AdmZip(zipPath);
          zip.extractAllTo(jreDir, true);
          fs.unlinkSync(zipPath);
          
          logToFile('Portable JRE 25 extracted successfully.');
          
          const newlyDownloadedJava = getPortableJavaPath();
          if (newlyDownloadedJava) {
            finalJavaPath = newlyDownloadedJava;
          } else {
            throw new Error('Failed to locate java.exe in extracted JRE folder.');
          }
        } catch (err) {
          logToFile(`Failed to download/extract portable Java: ${err.message}`);
          return { success: false, error: `Java not found on your system, and automatic download of JRE 25 failed: ${err.message}` };
        }
      }
    }
  }

  if (finalJavaPath && finalJavaPath !== 'java') {
    opts.javaPath = finalJavaPath;
  }

  // Force Windows to launch this Java process on the Dedicated GPU
  try {
    forceHighPerformanceGPU(finalJavaPath);
  } catch (err) {
    logToFile(`[GPU Preference Error] Failed to invoke GPU forcing: ${err.message}`);
  }

  // Build custom JVM args
  let customArgs = [];
  
  // 1. Inject authlib-injector for skin server redirection
  if (fs.existsSync(authlibInjectorPath)) {
    customArgs.push(`-javaagent:${authlibInjectorPath}=http://localhost:3003`);
    logToFile(`Injected authlib-injector JavaAgent: http://localhost:3003`);
  }

  // 2. Inject performance-oriented FPS Booster JVM flags if enabled in config
  try {
    const activeConfig = loadConfig();
    if (activeConfig.fpsBooster) {
      const performanceFlags = [
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=200',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:+DisableExplicitGC',
        '-XX:+AlwaysPreTouch',
        '-XX:G1NewSizePercent=30',
        '-XX:G1MaxNewSizePercent=40',
        '-XX:G1ReservePercent=20',
        '-XX:G1HeapRegionSize=32m',
        '-XX:G1MixedGCCountTarget=8',
        '-XX:InitiatingHeapOccupancyPercent=15',
        '-XX:G1MixedGCLiveThresholdPercent=90',
        '-XX:G1RSetUpdatingPauseTimePercent=5',
        '-XX:SurvivorRatio=32',
        '-XX:+PerfDisableSharedMem',
        '-XX:MaxTenuringThreshold=1'
      ];
      customArgs = customArgs.concat(performanceFlags);
      logToFile('FPS Booster enabled in config: Appended optimal JVM garbage collection tuning flags.');
    }
  } catch (err) {
    logToFile(`Failed to check FPS Booster config: ${err.message}`);
  }

  opts.customArgs = customArgs;

  let logBuffer = [];
  const logInterval = setInterval(() => {
    if (logBuffer.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launch-log-batch', logBuffer);
      logBuffer = [];
    }
  }, 250);

  try {
    // Setup launcher events
    launcher.removeAllListeners();
    
    launcher.on('debug', (e) => {
      logToFile(`[MCLC DEBUG] ${e}`);
      logBuffer.push({ type: 'debug', text: `[DEBUG] ${e}` });
    });
    
    launcher.on('data', (e) => {
      const text = e.toString();
      logToFile(`[MCLC DATA] ${text}`);
      let type = 'info';
      if (text.includes('[WARN]') || text.toLowerCase().includes('warning')) {
        type = 'debug';
      } else if (text.includes('[ERROR]') || text.toLowerCase().includes('severe') || text.toLowerCase().includes('exception')) {
        type = 'error';
      }
      logBuffer.push({ type, text });
    });

    launcher.on('progress', (e) => {
      logToFile(`[MCLC PROGRESS] type=${e.type}, task=${e.task}, total=${e.total}`);
      if (mainWindow) {
        mainWindow.webContents.send('launch-progress', e);
      }
    });

    launcher.on('download-status', (e) => {
      logToFile(`[MCLC DOWNLOAD-STATUS] type=${e.type}, name=${e.name}, task=${e.task}, total=${e.total}`);
      if (mainWindow) {
        mainWindow.webContents.send('launch-download-status', e);
      }
    });

    // CRITICAL: Bind launcher error emitter to prevent infinite UI loader hang
    launcher.on('error', (err) => {
      logToFile(`[MCLC ERROR] ${err}`);
      clearInterval(logInterval);
      if (mainWindow) {
        mainWindow.webContents.send('launch-error', err.toString());
      }
    });

    mainWindow.webContents.send('launch-started');
    logToFile('Starting download & launch sequence via minecraft-launcher-core...');

    // Run launcher
    activeGameProcess = await launcher.launch(opts);

    if (activeGameProcess) {
      logToFile('Minecraft client process spawned successfully.');
      logBuffer.push({ type: 'system', text: '=== Minecraft Process Started ===' });

      // VM Optimization: Elevate OS process priority of Minecraft process
      try {
        const os = require('os');
        os.setPriority(activeGameProcess.pid, os.constants.priority.HIGH_PRIORITY);
        logToFile(`[VM Optimization] Elevated Minecraft process (PID: ${activeGameProcess.pid}) priority to HIGH_PRIORITY.`);
      } catch (err) {
        logToFile(`[VM Warning] Failed to elevate process priority: ${err.message}`);
      }
      
      activeGameProcess.on('close', (code) => {
        logToFile(`Minecraft client process closed (Exit Code: ${code}).`);
        clearInterval(logInterval);
        activeGameProcess = null;
        if (mainWindow) {
          mainWindow.webContents.send('launch-closed', code);
        }
      });
      
      activeGameProcess.on('error', (err) => {
        logToFile(`Minecraft process encountered runtime error: ${err.message}`);
        clearInterval(logInterval);
        activeGameProcess = null;
        if (mainWindow) {
          mainWindow.webContents.send('launch-error', err.message);
        }
      });
    }

    return { success: true };
  } catch (error) {
    clearInterval(logInterval);
    logToFile(`MCLC failed during download/launch execution: ${error.stack || error.message}`);
    console.error('Launch error:', error);
    activeGameProcess = null;
    return { success: false, error: error.message };
  }
});

// IPC Handler - Reset Launcher / Factory Reset AppData
ipcMain.handle('reset-launcher', async () => {
  const userDataPath = app.getPath('userData');
  logToFile(`Initiating full AppData Factory Reset of: ${userDataPath}`);
  
  const foldersToClear = [
    path.join(userDataPath, 'minecraft'),
    path.join(userDataPath, 'jre25'),
    path.join(userDataPath, 'skins'),
    path.join(userDataPath, 'capes'),
    path.join(userDataPath, 'launcher_config.json'),
    authlibInjectorPath
  ];

  for (const item of foldersToClear) {
    try {
      if (fs.existsSync(item)) {
        const stat = fs.statSync(item);
        if (stat.isDirectory()) {
          fs.rmSync(item, { recursive: true, force: true });
        } else {
          fs.unlinkSync(item);
        }
      }
    } catch (err) {
      logToFile(`Failed to delete reset target ${item}: ${err.message}`);
    }
  }

  logToFile('Factory Reset finished. Relaunching app.');
  app.relaunch();
  app.exit(0);
  return { success: true };
});
