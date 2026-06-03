// Local Launcher State
let config = {};
let allVersions = [];
let localVersions = [];
let isLaunching = false;
let pendingSkinBase64 = null; // store uploaded skin data before applying
let pendingCapeBase64 = null; // store uploaded cape data before applying
let currentSkinImage = null;  // store skin Image object for redrawing
let currentCapeImage = null;  // store cape Image object for redrawing
let activeModsTab = 'mod';    // 'mod' or 'modpack'

// DOM Elements
const loginOverlay = document.getElementById('login-overlay');
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('main-content');

// Login Elements
const usernameInput = document.getElementById('username-input');
const loginAvatar = document.getElementById('login-avatar');
const btnLogin = document.getElementById('btn-login');

// Sidebar Elements
const sidebarAvatar = document.getElementById('sidebar-avatar');
const sidebarUsername = document.getElementById('sidebar-username');
const btnLogout = document.getElementById('btn-logout');
const navItems = document.querySelectorAll('.nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');

// Titlebar Controls
const btnMinimize = document.getElementById('btn-minimize');
const btnMaximize = document.getElementById('btn-maximize');
const btnClose = document.getElementById('btn-close');

// Play Tab Elements
const playVersionSelect = document.getElementById('play-version-select');
const btnPlay = document.getElementById('btn-play');
const btnPlayText = document.getElementById('btn-play-text');
const launchProgressContainer = document.getElementById('launch-progress-container');
const progressTaskName = document.getElementById('progress-task-name');
const progressPercentageVal = document.getElementById('progress-percentage-val');
const progressBarFill = document.getElementById('progress-bar-fill');

// Versions Tab Elements
const versionSearch = document.getElementById('version-search');
const toggleReleases = document.getElementById('toggle-releases');
const toggleSnapshots = document.getElementById('toggle-snapshots');
const versionListTbody = document.getElementById('version-list-tbody');

// Skins Tab Elements
const skinCanvas = document.getElementById('skin-canvas');
const skinDropZone = document.getElementById('skin-drop-zone');
const btnBrowseSkin = document.getElementById('btn-browse-skin');
const skinFileInput = document.getElementById('skin-file-input');
const btnApplySkin = document.getElementById('btn-apply-skin');
const btnResetSkin = document.getElementById('btn-reset-skin');
const skinStatusMsg = document.getElementById('skin-status-msg');

const capeDropZone = document.getElementById('cape-drop-zone');
const btnBrowseCape = document.getElementById('btn-browse-cape');
const capeFileInput = document.getElementById('cape-file-input');
const btnApplyCape = document.getElementById('btn-apply-cape');
const btnResetCape = document.getElementById('btn-reset-cape');
const capeStatusMsg = document.getElementById('cape-status-msg');

// Mods Tab Elements (Modrinth)
const modsSearchInput = document.getElementById('mods-search-input');
const modsLoaderSelect = document.getElementById('mods-loader-select');
const modsLoaderWrapper = document.getElementById('mods-loader-wrapper');
const btnSearchMods = document.getElementById('btn-search-mods');
const modsSearchResults = document.getElementById('mods-search-results');
const btnToggleMods = document.getElementById('btn-toggle-mods');
const btnToggleModpacks = document.getElementById('btn-toggle-modpacks');

// Settings Tab Elements
const maxRamSlider = document.getElementById('max-ram-slider');
const maxRamVal = document.getElementById('max-ram-val');
const minRamSlider = document.getElementById('min-ram-slider');
const minRamVal = document.getElementById('min-ram-val');
const mcDirInput = document.getElementById('mc-dir-input');
const btnBrowseMcDir = document.getElementById('btn-browse-mc-dir');
const javaPathInput = document.getElementById('java-path-input');
const btnBrowseJava = document.getElementById('btn-browse-java');
const skinServerInput = document.getElementById('skin-server-input');
const geminiKeyInput = document.getElementById('gemini-key-input');
const fpsBoosterInput = document.getElementById('fps-booster-input');
const btnSaveSettings = document.getElementById('btn-save-settings');
const saveStatusMsg = document.getElementById('save-status-msg');
const pvpModsContainer = document.getElementById('pvp-mods-container');

// Logs Tab Elements
const consoleLog = document.getElementById('console-log');
const btnClearLogs = document.getElementById('btn-clear-logs');
const btnAnalyzeLogs = document.getElementById('btn-analyze-logs');
const aiDebugModal = document.getElementById('ai-debug-modal');
const aiDebugContent = document.getElementById('ai-debug-content');
const btnCloseAiDebug = document.getElementById('btn-close-ai-debug');

// Initialize the launcher UI
async function init() {
  try {
    // 1. Fetch Configuration
    config = await window.api.getConfig();
    applyConfigToUI();

    // Auto-Login: Bypass login overlay if username exists
    if (config.username && config.username.trim() && config.username !== 'Steve' && config.username !== 'Player') {
      loginUser();
    }
    
    // 2. Set Up Titlebar
    btnMinimize.addEventListener('click', () => window.api.windowControl('minimize'));
    btnMaximize.addEventListener('click', () => window.api.windowControl('maximize'));
    btnClose.addEventListener('click', () => window.api.windowControl('close'));

    // 3. Set Up Login Username Input Avatar Fetching
    let debounceTimer;
    usernameInput.addEventListener('input', async (e) => {
      clearTimeout(debounceTimer);
      const name = e.target.value.trim() || 'Steve';
      debounceTimer = setTimeout(async () => {
        const localSkin = await window.api.getSkin(name);
        if (localSkin) {
          updateAvatarFromBase64(localSkin, loginAvatar);
        } else {
          loginAvatar.src = `https://minotar.net/helm/${name}/128.png`;
        }
      }, 500);
    });

    // 4. Set Up Login Action
    btnLogin.addEventListener('click', loginUser);
    usernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginUser();
    });

    // 5. Logout Action
    btnLogout.addEventListener('click', logoutUser);

    // 6. Navigation Tabs
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tabName = item.getAttribute('data-tab');
        switchTab(tabName);
        if (tabName === 'skins') {
          loadUserSkinForPreview();
        }
      });
    });

    // 7. Settings Range Sliders Text Updates
    maxRamSlider.addEventListener('input', (e) => {
      maxRamVal.textContent = `${e.target.value} MB`;
      if (parseInt(minRamSlider.value) > parseInt(e.target.value)) {
        minRamSlider.value = e.target.value;
        minRamVal.textContent = `${e.target.value} MB`;
      }
    });

    minRamSlider.addEventListener('input', (e) => {
      minRamVal.textContent = `${e.target.value} MB`;
      if (parseInt(maxRamSlider.value) < parseInt(e.target.value)) {
        maxRamSlider.value = e.target.value;
        maxRamVal.textContent = `${e.target.value} MB`;
      }
    });

    // 8. Settings Browse Actions
    btnBrowseMcDir.addEventListener('click', async () => {
      const folder = await window.api.selectFolder();
      if (folder) mcDirInput.value = folder;
    });

    btnBrowseJava.addEventListener('click', async () => {
      const javaFile = await window.api.selectJavaFile();
      if (javaFile) javaPathInput.value = javaFile;
    });

    // 9. Save Settings Button
    btnSaveSettings.addEventListener('click', saveLauncherSettings);

    // 9.5 Reset Launcher Data Button
    const btnClearAppData = document.getElementById('btn-clear-appdata');
    if (btnClearAppData) {
      btnClearAppData.addEventListener('click', async () => {
        const confirmReset = confirm("Are you sure you want to delete all downloaded Minecraft versions, assets, libraries, and Java runtimes? This will reset the launcher and close it.");
        if (confirmReset) {
          await window.api.resetLauncher();
        }
      });
    }

    // 10. Play Version dropdown change
    playVersionSelect.addEventListener('change', (e) => {
      config.lastSelectedVersion = e.target.value;
      window.api.saveConfig(config);
      updateQuickPlaySection();
    });

    // 11. PLAY Button Click
    btnPlay.addEventListener('click', handlePlayClick);

    // 12. Version Manager Filters
    versionSearch.addEventListener('input', renderVersionTable);
    toggleReleases.addEventListener('change', renderVersionTable);
    toggleSnapshots.addEventListener('change', renderVersionTable);

    // 13. Mods search triggers & toggles
    btnSearchMods.addEventListener('click', handleModrinthSearch);
    modsSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleModrinthSearch();
    });

    const btnToggleResourcepacks = document.getElementById('btn-toggle-resourcepacks');

    btnToggleMods.addEventListener('click', () => {
      activeModsTab = 'mod';
      btnToggleMods.classList.add('active');
      btnToggleModpacks.classList.remove('active');
      if (btnToggleResourcepacks) btnToggleResourcepacks.classList.remove('active');
      modsLoaderWrapper.style.display = 'block';
      if (pvpModsContainer) pvpModsContainer.style.display = 'block';
      modsSearchInput.placeholder = 'Search mods (e.g. Sodium, Iris, JEI)...';
      modsSearchResults.innerHTML = '<div class="mods-loading">Search for a mod above to discover items.</div>';
    });

    btnToggleModpacks.addEventListener('click', () => {
      activeModsTab = 'modpack';
      btnToggleModpacks.classList.add('active');
      btnToggleMods.classList.remove('active');
      if (btnToggleResourcepacks) btnToggleResourcepacks.classList.remove('active');
      modsLoaderWrapper.style.display = 'none';
      if (pvpModsContainer) pvpModsContainer.style.display = 'none';
      modsSearchInput.placeholder = 'Search modpacks (e.g. Simply Optimized)...';
      modsSearchResults.innerHTML = '<div class="mods-loading">Search for a modpack above to discover items.</div>';
    });

    if (btnToggleResourcepacks) {
      btnToggleResourcepacks.addEventListener('click', () => {
        activeModsTab = 'resourcepack';
        btnToggleResourcepacks.classList.add('active');
        btnToggleMods.classList.remove('active');
        btnToggleModpacks.classList.remove('active');
        modsLoaderWrapper.style.display = 'none';
        if (pvpModsContainer) pvpModsContainer.style.display = 'none';
        modsSearchInput.placeholder = 'Search resource packs (e.g. Bare Bones)...';
        modsSearchResults.innerHTML = '<div class="mods-loading">Search for a resource pack above to discover items.</div>';
      });
    }

    // 13.2 Mod Loader installation bindings
    const btnInstallFabric = document.getElementById('btn-install-fabric');
    const btnInstallForge = document.getElementById('btn-install-forge');
    const loaderInstallMcVersion = document.getElementById('loader-install-mc-version');
    const loaderInstallStatus = document.getElementById('loader-install-status');
    const forgeNotice = document.getElementById('forge-notice');

    if (btnInstallFabric) {
      btnInstallFabric.addEventListener('click', async () => {
        const ver = loaderInstallMcVersion.value;
        if (!ver) return;
        
        btnInstallFabric.disabled = true;
        loaderInstallStatus.textContent = 'Installing Fabric...';
        loaderInstallStatus.style.color = 'var(--accent-cyan)';
        
        try {
          const result = await window.api.installFabric(ver);
          if (result.success) {
            loaderInstallStatus.textContent = `Fabric installed: ${result.versionId}`;
            loaderInstallStatus.style.color = '#2b9348';
            await fetchVersionsList();
          } else {
            loaderInstallStatus.textContent = `Error: ${result.error}`;
            loaderInstallStatus.style.color = 'var(--accent-pink)';
          }
        } catch (e) {
          loaderInstallStatus.textContent = `Error: ${e.message}`;
          loaderInstallStatus.style.color = 'var(--accent-pink)';
        } finally {
          btnInstallFabric.disabled = false;
        }
      });
    }

    if (btnInstallForge) {
      btnInstallForge.addEventListener('click', async () => {
        const ver = loaderInstallMcVersion.value;
        if (!ver) return;
        
        btnInstallForge.disabled = true;
        loaderInstallStatus.textContent = 'Downloading Forge...';
        loaderInstallStatus.style.color = 'var(--accent-cyan)';
        if (forgeNotice) forgeNotice.style.display = 'none';

        try {
          const result = await window.api.installForge(ver);
          if (result.success) {
            loaderInstallStatus.textContent = 'Forge installer opened!';
            loaderInstallStatus.style.color = '#2b9348';
            if (forgeNotice) {
              forgeNotice.innerHTML = `⚠️ IMPORTANT: When the Forge window pops up, please make sure the path points to:<br><code style="background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; border: 1px solid var(--border-color); color: #fff;">${config.minecraftDir}</code>`;
              forgeNotice.style.display = 'block';
            }
          } else {
            loaderInstallStatus.textContent = `Error: ${result.error}`;
            loaderInstallStatus.style.color = 'var(--accent-pink)';
          }
        } catch (e) {
          loaderInstallStatus.textContent = `Error: ${e.message}`;
          loaderInstallStatus.style.color = 'var(--accent-pink)';
        } finally {
          btnInstallForge.disabled = false;
        }
      });
    }

    // 13.5 Setup PvP presets Quick Install buttons
    setupPvPPresetsHandlers();

    // 14. Clear Logs Console
    btnClearLogs.addEventListener('click', () => {
      consoleLog.innerHTML = '<span class="log-line system-line">[Crafter System] Console cleared. Ready.</span>';
    });

    // 15. Analyze Logs with AI Trigger
    btnAnalyzeLogs.addEventListener('click', handleLogsAIAnalysis);
    btnCloseAiDebug.addEventListener('click', () => {
      aiDebugModal.classList.add('hidden');
    });

    // Mod Versions Selector Modal Close Action
    const modVersionsModal = document.getElementById('mod-versions-modal');
    const btnCloseVersionsModal = document.getElementById('btn-close-versions-modal');
    if (btnCloseVersionsModal) {
      btnCloseVersionsModal.addEventListener('click', () => {
        modVersionsModal.classList.add('hidden');
      });
    }
    if (modVersionsModal) {
      modVersionsModal.addEventListener('click', (e) => {
        if (e.target === modVersionsModal) {
          modVersionsModal.classList.add('hidden');
        }
      });
    }

    // 16. Skin & Cape System Event Handlers
    initSkinUploadHandlers();
    initCapeUploadHandlers();

    // 17. Setup Launch Events IPC Listeners
    setupLaunchListeners();

    // 17.5 Theme selector binding
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        const selectedTheme = e.target.value;
        config.theme = selectedTheme;
        window.api.saveConfig(config);
        applyTheme(selectedTheme);
      });
    }

    // 18. Load MC Versions
    fetchVersionsList();

    // 19. Initialize Profile Management System
    initProfilesSystem();

  } catch (error) {
    console.error('Error initializing launcher:', error);
  }
}

// Apply settings from config object to form fields
async function applyConfigToUI() {
  usernameInput.value = config.username || 'Steve';
  
  const localSkin = await window.api.getSkin(config.username || 'Steve');
  if (localSkin) {
    updateAvatarFromBase64(localSkin, loginAvatar);
  } else {
    loginAvatar.src = `https://minotar.net/helm/${config.username || 'Steve'}/128.png`;
  }
  
  maxRamSlider.value = config.maxMemory || 4096;
  maxRamVal.textContent = `${config.maxMemory || 4096} MB`;
  
  minRamSlider.value = config.minMemory || 1024;
  minRamVal.textContent = `${config.minMemory || 1024} MB`;

  mcDirInput.value = config.minecraftDir;
  javaPathInput.value = config.javaPath === 'java' ? '' : config.javaPath;
  skinServerInput.value = config.centralSkinServer || 'http://localhost:3004';
  geminiKeyInput.value = config.geminiApiKey || '';
  fpsBoosterInput.checked = !!config.fpsBooster;

  if (config.theme) {
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.value = config.theme;
    }
    applyTheme(config.theme);
  } else {
    applyTheme('purple');
  }
}

// Helper to extract 8x8 head face from skin file data url and apply to img element
function updateAvatarFromBase64(base64Data, imgElement) {
  const img = new Image();
  img.onload = () => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 64;
    tempCanvas.height = 64;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.imageSmoothingEnabled = false;
    
    // Draw face base (8,8,8,8) -> (0,0,64,64)
    tempCtx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
    // Draw helm layer (40,8,8,8) -> (0,0,64,64)
    tempCtx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
    
    imgElement.src = tempCanvas.toDataURL();
  };
  img.src = base64Data;
}

// Save settings from the form to disk
async function saveLauncherSettings() {
  config.maxMemory = parseInt(maxRamSlider.value);
  config.minMemory = parseInt(minRamSlider.value);
  config.minecraftDir = mcDirInput.value;
  config.javaPath = javaPathInput.value.trim() || 'java';
  config.centralSkinServer = skinServerInput.value.trim() || 'http://localhost:3004';
  config.geminiApiKey = geminiKeyInput.value.trim();
  config.fpsBooster = fpsBoosterInput.checked;

  const res = await window.api.saveConfig(config);
  
  saveStatusMsg.textContent = 'Settings saved successfully!';
  saveStatusMsg.className = 'save-status success';
  
  setTimeout(() => {
    saveStatusMsg.textContent = '';
  }, 3000);
}

// User Actions: Log In Offline
async function loginUser() {
  const username = usernameInput.value.trim();
  if (!username) {
    alert('Please enter a valid offline username.');
    return;
  }
  
  config.username = username;
  window.api.saveConfig(config);

  // Update Avatar and User Names in Sidebar
  sidebarUsername.textContent = username;
  const localSkin = await window.api.getSkin(username);
  if (localSkin) {
    updateAvatarFromBase64(localSkin, sidebarAvatar);
  } else {
    sidebarAvatar.src = `https://minotar.net/helm/${username}/64.png`;
  }

  // Update Welcome title banner
  const welcomeTitle = document.getElementById('dashboard-welcome-title');
  if (welcomeTitle) {
    welcomeTitle.textContent = `Rise and mine, ${username}`;
  }

  // Toggle View
  loginOverlay.classList.remove('active');
  sidebar.classList.remove('hidden');
  mainContent.classList.remove('hidden');
  
  switchTab('play');
  loadUserSkinForPreview(); // Preload skin & cape system on login/start
}

// User Actions: Log Out
function logoutUser() {
  config.username = '';
  window.api.saveConfig(config);
  usernameInput.value = '';
  loginOverlay.classList.add('active');
  sidebar.classList.add('hidden');
  mainContent.classList.add('hidden');
}

// Switch dashboard panels/tabs
function switchTab(tabName) {
  navItems.forEach(item => {
    if (item.getAttribute('data-tab') === tabName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  tabPanels.forEach(panel => {
    if (panel.id === `tab-${tabName}`) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });
}

// Fetch available official versions
async function fetchVersionsList() {
  try {
    const list = await window.api.getMcVersions();
    allVersions = list;

    try {
      localVersions = await window.api.getLocalVersions();
    } catch (err) {
      console.error('Failed to load local versions:', err);
    }
    
    populateVersionSelectors();
    renderVersionTable();
  } catch (error) {
    console.error('Failed to load version manifest:', error);
    versionListTbody.innerHTML = `<tr><td colspan="4" class="table-loading" style="color: var(--accent-pink);">Failed to fetch versions from Mojang. Check connection.</td></tr>`;
  }
}

// Populate selectors/dropdowns in play card
function populateVersionSelectors() {
  playVersionSelect.innerHTML = '';
  
  const logoEmojis = {
    vanilla: '📦',
    fabric: '⚡',
    forge: '🛠️',
    pvp: '⚔️',
    survival: '🛡️',
    diamond: '💎',
    custom: '⚙️',
    feather: '🪶',
    lunar: '🌙',
    badlion: '🦁'
  };

  // Populate play version select dropdown from config.profiles
  if (config.profiles && Object.keys(config.profiles).length > 0) {
    Object.values(config.profiles).forEach(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      const emoji = logoEmojis[profile.logo] || '📦';
      option.textContent = `${emoji} ${profile.name} (${profile.version})`;
      if (profile.id === config.lastSelectedVersion) {
        option.selected = true;
      }
      playVersionSelect.appendChild(option);
    });
  } else {
    // Fallback if profiles is empty
    localVersions.forEach(ver => {
      const option = document.createElement('option');
      option.value = ver;
      let displayName = ver;
      if (ver.endsWith('-fabric')) displayName = `${ver.replace('-fabric', '')} Fabric`;
      else if (ver.toLowerCase().includes('forge')) displayName = `${ver} Forge`;
      else displayName = `${ver} (Local)`;
      option.textContent = displayName;
      if (ver === config.lastSelectedVersion) option.selected = true;
      playVersionSelect.appendChild(option);
    });
  }

  updateQuickPlaySection();

  // Populate loader installer Minecraft version selector with vanilla releases
  const loaderInstallMcVersion = document.getElementById('loader-install-mc-version');
  if (loaderInstallMcVersion) {
    loaderInstallMcVersion.innerHTML = '';
    const releases = allVersions.filter(v => v.type === 'release').slice(0, 40);
    releases.forEach(v => {
      const option = document.createElement('option');
      option.value = v.id;
      option.textContent = v.id;
      loaderInstallMcVersion.appendChild(option);
    });
  }

  // Populate Add Profile form version selector
  const newProfileVersionSelect = document.getElementById('new-profile-version');
  if (newProfileVersionSelect) {
    newProfileVersionSelect.innerHTML = '';
    
    // First add local versions (loaders)
    localVersions.forEach(ver => {
      const option = document.createElement('option');
      option.value = ver;
      option.textContent = ver;
      newProfileVersionSelect.appendChild(option);
    });
    
    // Then add Mojang releases
    const releases = allVersions.filter(v => v.type === 'release').slice(0, 40);
    releases.forEach(v => {
      if (localVersions.includes(v.id)) return;
      const option = document.createElement('option');
      option.value = v.id;
      option.textContent = v.id;
      newProfileVersionSelect.appendChild(option);
    });
  }
}

function updateQuickPlaySection() {
  const quickPlayVer = document.getElementById('quick-play-ver');
  const quickPlayIconContainer = document.getElementById('quick-play-icon-container');
  const activeProfile = config.profiles && config.profiles[config.lastSelectedVersion];
  
  const logoEmojis = {
    vanilla: '📦',
    fabric: '⚡',
    forge: '🛠️',
    pvp: '⚔️',
    survival: '🛡️',
    diamond: '💎',
    custom: '⚙️',
    feather: '🪶',
    lunar: '🌙',
    badlion: '🦁'
  };

  if (activeProfile) {
    if (quickPlayVer) {
      quickPlayVer.textContent = activeProfile.name;
    }
    if (quickPlayIconContainer) {
      quickPlayIconContainer.textContent = logoEmojis[activeProfile.logo] || '📦';
    }
  } else {
    if (quickPlayVer) {
      quickPlayVer.textContent = config.lastSelectedVersion || '26.1.2';
    }
    if (quickPlayIconContainer) {
      let emoji = '📦';
      const lastVer = config.lastSelectedVersion || '';
      if (lastVer.endsWith('-fabric')) emoji = '⚡';
      else if (lastVer.toLowerCase().includes('forge')) emoji = '🛠️';
      quickPlayIconContainer.textContent = emoji;
    }
  }
}

// Render the big scrollable table in the versions panel
function renderVersionTable() {
  const query = versionSearch.value.toLowerCase().trim();
  const showReleases = toggleReleases.checked;
  const showSnapshots = toggleSnapshots.checked;

  let filtered = allVersions;

  if (query) {
    filtered = filtered.filter(v => v.id.toLowerCase().includes(query));
  }

  filtered = filtered.filter(v => {
    if (v.type === 'release' && showReleases) return true;
    if (v.type === 'snapshot' && showSnapshots) return true;
    if ((v.type === 'old_beta' || v.type === 'old_alpha') && query) return true;
    return false;
  });

  if (filtered.length === 0) {
    versionListTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No matching versions found.</td></tr>`;
    return;
  }

  versionListTbody.innerHTML = '';
  
  filtered.slice(0, 150).forEach(v => {
    const row = document.createElement('tr');
    
    const date = new Date(v.releaseTime).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    const badgeClass = v.type === 'release' ? 'badge-release' : 'badge-snapshot';
    const typeLabel = v.type.toUpperCase();

    row.innerHTML = `
      <td style="font-weight: 700;">${v.id}</td>
      <td><span class="badge ${badgeClass}">${typeLabel}</span></td>
      <td>${date}</td>
      <td style="text-align: right;">
        <button class="secondary-btn btn-select-ver" data-version="${v.id}">
          <i data-lucide="check"></i>
          <span>Select</span>
        </button>
      </td>
    `;
    
    versionListTbody.appendChild(row);
  });

  lucide.createIcons();

  document.querySelectorAll('.btn-select-ver').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const btnEl = e.currentTarget;
      const ver = btnEl.getAttribute('data-version');
      
      config.lastSelectedVersion = ver;
      window.api.saveConfig(config);
      
      populateVersionSelectors();
      
      const originalText = btnEl.innerHTML;
      btnEl.innerHTML = `<i data-lucide="check-circle" style="color: var(--accent-cyan);"></i> <span>Selected!</span>`;
      lucide.createIcons();
      btnEl.style.borderColor = 'var(--accent-cyan)';
      
      setTimeout(() => {
        btnEl.innerHTML = originalText;
        btnEl.style.borderColor = '';
        lucide.createIcons();
        switchTab('play');
      }, 1000);
    });
  });
}

// ----------------- MODRINTH MOD BROWSER & DOWNLOADER -----------------

async function handleModrinthSearch() {
  const query = modsSearchInput.value.trim();
  const loader = modsLoaderSelect.value;
  const rawVersion = config.lastSelectedVersion || '26.1.2';
  const gameVersion = await window.api.getVanillaVersion(rawVersion);

  if (!query) {
    modsSearchResults.innerHTML = `<div class="mods-loading">Please type a search query.</div>`;
    return;
  }

  if (activeModsTab === 'mod') {
    modsSearchResults.innerHTML = `<div class="mods-loading">Searching Modrinth for compatible ${loader} mods...</div>`;

    try {
      // 1. Request Modrinth search API (CORS is open)
      const facets = encodeURIComponent(JSON.stringify([
        [`categories:${loader}`],
        [`versions:${gameVersion}`],
        ["project_type:mod"]
      ]));
      const modrinthUrl = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${facets}`;
      
      const response = await fetch(modrinthUrl, {
        headers: { 'User-Agent': 'Aether-Launcher/1.0.0 (contact@aetherlauncher.com)' }
      });
      
      if (!response.ok) {
        throw new Error(`Modrinth returned status ${response.status}`);
      }

      const searchData = await response.json();
      const hits = searchData.hits;

      if (hits.length === 0) {
        modsSearchResults.innerHTML = `<div class="mods-loading">No compatible mods found for ${query} on MC ${gameVersion} (${loader}).</div>`;
        return;
      }

      modsSearchResults.innerHTML = '';
      
      // 2. Render Mod Cards
      hits.forEach(hit => {
        const card = document.createElement('div');
        card.className = 'mod-card';
        
        const iconUrl = hit.icon_url || 'https://raw.githubusercontent.com/modrinth/code/master/assets/logo.png';
        const downloads = hit.downloads.toLocaleString();
        const author = hit.author;
        
        card.innerHTML = `
          <div class="mod-icon-wrapper">
            <img src="${iconUrl}" alt="${hit.title} Icon">
          </div>
          <div class="mod-info-wrapper">
            <span class="mod-title">${hit.title}</span>
            <span class="mod-author">by ${author}</span>
            <p class="mod-description">${hit.description}</p>
            <div class="mod-footer">
              <span class="mod-downloads">
                <i data-lucide="download"></i>
                <span>${downloads}</span>
              </span>
              <button class="primary-btn mod-install-btn" 
                      data-project-id="${hit.project_id}"
                      data-title="${encodeURIComponent(hit.title)}"
                      data-icon="${iconUrl}"
                      data-desc="${encodeURIComponent(hit.description || '')}">
                <i data-lucide="download-cloud"></i>
                <span>Install</span>
              </button>
            </div>
          </div>
        `;
        modsSearchResults.appendChild(card);
      });

      lucide.createIcons();

      // 3. Attach Install Action Buttons
      document.querySelectorAll('.mod-install-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const btnEl = e.currentTarget;
          const projectId = btnEl.getAttribute('data-project-id');
          const title = decodeURIComponent(btnEl.getAttribute('data-title'));
          const icon = btnEl.getAttribute('data-icon');
          const desc = decodeURIComponent(btnEl.getAttribute('data-desc'));
          
          showModVersionsModal({
            projectId,
            hitTitle: title,
            hitIconUrl: icon,
            hitDesc: desc,
            projectType: 'mod',
            loader,
            cleanVanillaVersion: gameVersion,
            profileId: rawVersion,
            originalBtn: btnEl
          });
        });
      });

    } catch (error) {
      console.error('Failed to search Modrinth:', error);
      modsSearchResults.innerHTML = `<div class="mods-loading" style="color: var(--accent-pink);">Failed to fetch search results from Modrinth: ${error.message}</div>`;
    }
  } else if (activeModsTab === 'resourcepack') {
    modsSearchResults.innerHTML = `<div class="mods-loading">Searching Modrinth for compatible resource packs...</div>`;
    try {
      const facets = encodeURIComponent(JSON.stringify([
        [`versions:${gameVersion}`],
        ["project_type:resourcepack"]
      ]));
      const modrinthUrl = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${facets}`;
      
      const response = await fetch(modrinthUrl, {
        headers: { 'User-Agent': 'Crafter-Launcher/1.0.0 (contact@crafterlauncher.com)' }
      });
      
      if (!response.ok) throw new Error(`Modrinth API status: ${response.status}`);
      const searchData = await response.json();
      const hits = searchData.hits;

      if (hits.length === 0) {
        modsSearchResults.innerHTML = `<div class="mods-loading">No compatible resource packs found for "${query}" on MC ${gameVersion}.</div>`;
        return;
      }

      modsSearchResults.innerHTML = '';
      hits.forEach(hit => {
        const card = document.createElement('div');
        card.className = 'mod-card';
        const iconUrl = hit.icon_url || 'https://raw.githubusercontent.com/modrinth/code/master/assets/logo.png';
        const downloads = hit.downloads.toLocaleString();
        
        card.innerHTML = `
          <div class="mod-icon-wrapper">
            <img src="${iconUrl}" alt="${hit.title} Icon">
          </div>
          <div class="mod-info-wrapper">
            <span class="mod-title">${hit.title}</span>
            <span class="mod-author">by ${hit.author}</span>
            <p class="mod-description">${hit.description}</p>
            <div class="mod-footer">
              <span class="mod-downloads">
                <i data-lucide="download"></i>
                <span>${downloads}</span>
              </span>
              <button class="primary-btn resourcepack-install-btn" 
                      data-project-id="${hit.project_id}"
                      data-title="${encodeURIComponent(hit.title)}"
                      data-icon="${iconUrl}"
                      data-desc="${encodeURIComponent(hit.description || '')}">
                <i data-lucide="download-cloud"></i>
                <span>Install Pack</span>
              </button>
            </div>
          </div>
        `;
        modsSearchResults.appendChild(card);
      });
      lucide.createIcons();

      // Hook up resource pack install click listener
      document.querySelectorAll('.resourcepack-install-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const btnEl = e.currentTarget;
          const projectId = btnEl.getAttribute('data-project-id');
          const title = decodeURIComponent(btnEl.getAttribute('data-title'));
          const icon = btnEl.getAttribute('data-icon');
          const desc = decodeURIComponent(btnEl.getAttribute('data-desc'));
          
          showModVersionsModal({
            projectId,
            hitTitle: title,
            hitIconUrl: icon,
            hitDesc: desc,
            projectType: 'resourcepack',
            loader: null,
            cleanVanillaVersion: gameVersion,
            profileId: rawVersion,
            originalBtn: btnEl
          });
        });
      });
    } catch (error) {
      console.error('Failed to search Modrinth resource packs:', error);
      modsSearchResults.innerHTML = `<div class="mods-loading" style="color: var(--accent-pink);">Failed to fetch search results from Modrinth: ${error.message}</div>`;
    }
  } else {
    // Modpacks search logic
    modsSearchResults.innerHTML = `<div class="mods-loading">Searching Modrinth for compatible modpacks...</div>`;
    try {
      const facets = encodeURIComponent(JSON.stringify([
        [`versions:${gameVersion}`],
        ["project_type:modpack"]
      ]));
      const modrinthUrl = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${facets}`;
      
      const response = await fetch(modrinthUrl, {
        headers: { 'User-Agent': 'Aether-Launcher/1.0.0 (contact@aetherlauncher.com)' }
      });
      
      if (!response.ok) throw new Error(`Modrinth API status: ${response.status}`);
      const searchData = await response.json();
      const hits = searchData.hits;

      if (hits.length === 0) {
        modsSearchResults.innerHTML = `<div class="mods-loading">No compatible modpacks found for "${query}" on MC ${gameVersion}.</div>`;
        return;
      }

      modsSearchResults.innerHTML = '';
      hits.forEach(hit => {
        const card = document.createElement('div');
        card.className = 'mod-card';
        const iconUrl = hit.icon_url || 'https://raw.githubusercontent.com/modrinth/code/master/assets/logo.png';
        const downloads = hit.downloads.toLocaleString();
        
        card.innerHTML = `
          <div class="mod-icon-wrapper">
            <img src="${iconUrl}" alt="${hit.title} Icon">
          </div>
          <div class="mod-info-wrapper">
            <span class="mod-title">${hit.title}</span>
            <span class="mod-author">by ${hit.author}</span>
            <p class="mod-description">${hit.description}</p>
            <div class="mod-footer">
              <span class="mod-downloads">
                <i data-lucide="download"></i>
                <span>${downloads}</span>
              </span>
              <button class="primary-btn modpack-install-btn" 
                      data-project-id="${hit.project_id}"
                      data-title="${encodeURIComponent(hit.title)}"
                      data-icon="${iconUrl}"
                      data-desc="${encodeURIComponent(hit.description || '')}">
                <i data-lucide="download-cloud"></i>
                <span>Install Pack</span>
              </button>
            </div>
          </div>
        `;
        modsSearchResults.appendChild(card);
      });
      lucide.createIcons();

      // Hook up modpack install click listener
      document.querySelectorAll('.modpack-install-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const btnEl = e.currentTarget;
          const projectId = btnEl.getAttribute('data-project-id');
          const title = decodeURIComponent(btnEl.getAttribute('data-title'));
          const icon = btnEl.getAttribute('data-icon');
          const desc = decodeURIComponent(btnEl.getAttribute('data-desc'));
          
          showModVersionsModal({
            projectId,
            hitTitle: title,
            hitIconUrl: icon,
            hitDesc: desc,
            projectType: 'modpack',
            loader: null,
            cleanVanillaVersion: gameVersion,
            profileId: rawVersion,
            originalBtn: btnEl
          });
        });
      });
    } catch (error) {
      console.error('Failed to search Modrinth modpacks:', error);
      modsSearchResults.innerHTML = `<div class="mods-loading" style="color: var(--accent-pink);">Failed to fetch search results from Modrinth: ${error.message}</div>`;
    }
  }
}

async function showModVersionsModal({ projectId, hitTitle, hitIconUrl, hitDesc, projectType, loader, cleanVanillaVersion, profileId, originalBtn }) {
  const modVersionsModal = document.getElementById('mod-versions-modal');
  const versionsModalList = document.getElementById('versions-modal-list');
  const versionsModalTitle = document.getElementById('versions-modal-title');
  const versionsModalIcon = document.getElementById('versions-modal-icon');
  const versionsModalDesc = document.getElementById('versions-modal-desc');

  // Set header details
  versionsModalTitle.textContent = `Select Version: ${hitTitle}`;
  versionsModalIcon.src = hitIconUrl || 'https://raw.githubusercontent.com/modrinth/code/master/assets/logo.png';
  versionsModalDesc.textContent = hitDesc || 'Choose a compatible version below to install.';

  // Show modal
  modVersionsModal.classList.remove('hidden');

  // Loading state
  versionsModalList.innerHTML = `
    <tr>
      <td colspan="4" style="text-align: center; padding: 3rem;">
        <i data-lucide="loader" class="btn-spin-icon" style="width: 28px; height: 28px; margin: 0 auto 0.5rem auto; display: block; color: var(--accent-cyan);"></i>
        <div style="color: var(--text-color-muted);">Retrieving compatible versions...</div>
      </td>
    </tr>
  `;
  lucide.createIcons();

  try {
    let modrinthUrl;
    if (projectType === 'resourcepack') {
      const versionParam = encodeURIComponent(JSON.stringify([cleanVanillaVersion]));
      modrinthUrl = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=${versionParam}`;
    } else if (projectType === 'modpack') {
      const versionParam = encodeURIComponent(JSON.stringify([cleanVanillaVersion]));
      modrinthUrl = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=${versionParam}`;
    } else {
      const loaderParam = encodeURIComponent(JSON.stringify([loader]));
      const versionParam = encodeURIComponent(JSON.stringify([cleanVanillaVersion]));
      modrinthUrl = `https://api.modrinth.com/v2/project/${projectId}/version?loaders=${loaderParam}&game_versions=${versionParam}`;
    }

    const response = await fetch(modrinthUrl, {
      headers: { 'User-Agent': 'Crafter-Launcher/1.0.0 (contact@crafterlauncher.com)' }
    });

    if (!response.ok) {
      throw new Error(`Modrinth returned status ${response.status}`);
    }

    const versions = await response.json();
    if (!versions || versions.length === 0) {
      versionsModalList.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            No compatible versions found for MC ${cleanVanillaVersion}${projectType === 'mod' ? ' (' + loader + ')' : ''}.
          </td>
        </tr>
      `;
      return;
    }

    versionsModalList.innerHTML = '';

    versions.forEach(v => {
      const row = document.createElement('tr');
      
      const fileInfo = v.files && v.files.length > 0 ? v.files[0] : null;
      const downloadEnabled = !!fileInfo;

      const dateStr = new Date(v.date_published).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });

      let typeBadgeClass = 'badge-release';
      if (v.version_type === 'beta') typeBadgeClass = 'badge-snapshot';
      if (v.version_type === 'alpha') typeBadgeClass = 'badge-snapshot';

      row.innerHTML = `
        <td>
          <div style="font-weight: 600; color: #fff;">${v.version_number}</div>
          <div style="font-size: 11px; color: var(--text-muted); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${v.name}">${v.name}</div>
        </td>
        <td>
          <span class="badge ${typeBadgeClass}">${v.version_type}</span>
        </td>
        <td style="color: var(--text-muted); font-size: 13px;">
          ${dateStr}
        </td>
        <td style="text-align: right;">
          <button class="primary-btn row-download-btn" 
                  data-version-id="${v.id}"
                  data-download-url="${fileInfo ? fileInfo.url : ''}"
                  data-filename="${fileInfo ? fileInfo.filename : ''}"
                  ${!downloadEnabled ? 'disabled' : ''}
                  style="padding: 6px 14px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; border-radius: 4px;">
            <i data-lucide="download"></i>
            <span>Install</span>
          </button>
        </td>
      `;
      versionsModalList.appendChild(row);
    });

    lucide.createIcons();

    // Bind action button clicks
    const rowButtons = versionsModalList.querySelectorAll('.row-download-btn');
    rowButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const rowBtn = e.currentTarget;
        const versionId = rowBtn.getAttribute('data-version-id');
        const downloadUrl = rowBtn.getAttribute('data-download-url');
        const filename = rowBtn.getAttribute('data-filename');

        // Disable all buttons in modal during install
        rowButtons.forEach(b => b.disabled = true);
        
        rowBtn.innerHTML = `<i data-lucide="loader" class="btn-spin-icon"></i> <span>Installing...</span>`;
        lucide.createIcons();

        let result;
        if (projectType === 'modpack') {
          result = await window.api.installModpack({
            projectId,
            gameVersion: profileId,
            versionId
          });
        } else {
          result = await window.api.installMod({
            projectId,
            gameVersion: profileId,
            loader,
            projectType,
            downloadUrl,
            filename
          });
        }

        if (result.success) {
          rowBtn.className = 'secondary-btn';
          rowBtn.style.borderColor = 'var(--accent-cyan)';
          rowBtn.innerHTML = `<i data-lucide="check" style="color: var(--accent-cyan);"></i> <span style="color: var(--accent-cyan);">Installed!</span>`;
          lucide.createIcons();

          // Update original card button
          if (originalBtn) {
            originalBtn.className = `secondary-btn ${projectType}-install-btn`;
            originalBtn.style.borderColor = 'var(--accent-cyan)';
            originalBtn.innerHTML = `<i data-lucide="check" style="color: var(--accent-cyan);"></i> <span style="color: var(--accent-cyan);">Installed!</span>`;
            lucide.createIcons();
          }

          // Show confirmation log
          if (projectType === 'modpack') {
            appendLogLine(`[Modpack] Installed pack: ${result.name} successfully. Loader: ${result.loader} v${result.loaderVersion}`, 'system');
          } else {
            appendLogLine(`[${projectType === 'resourcepack' ? 'Resource Pack' : 'Mod'}] Installed: ${result.filename} successfully.`, 'system');
          }

          // Close modal after 1s
          setTimeout(() => {
            modVersionsModal.classList.add('hidden');
          }, 1000);

        } else {
          // Re-enable other download buttons
          rowButtons.forEach(b => {
            const hasFile = b.getAttribute('data-download-url') !== '';
            b.disabled = !hasFile;
          });
          
          rowBtn.className = 'primary-btn danger-btn-hover';
          rowBtn.innerHTML = `<i data-lucide="alert-triangle"></i> <span>Failed</span>`;
          lucide.createIcons();
          alert(`Installation failed:\n${result.error}`);
        }
      });
    });

  } catch (err) {
    console.error('Failed to load version details:', err);
    versionsModalList.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 2rem; color: var(--accent-pink);">
          Error: ${err.message}
        </td>
      </tr>
    `;
  }
}

// ----------------- SKIN SYSTEM RENDERING & HANDLERS -----------------

function initSkinUploadHandlers() {
  btnBrowseSkin.addEventListener('click', () => skinFileInput.click());
  skinDropZone.addEventListener('click', (e) => {
    if (e.target !== btnBrowseSkin) skinFileInput.click();
  });

  skinFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleSelectedSkinFile(file);
  });

  skinDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    skinDropZone.classList.add('dragover');
  });

  skinDropZone.addEventListener('dragleave', () => {
    skinDropZone.classList.remove('dragover');
  });

  skinDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    skinDropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleSelectedSkinFile(file);
  });

  btnApplySkin.addEventListener('click', saveUploadedSkin);
  btnResetSkin.addEventListener('click', resetSkinToDefault);
}

function handleSelectedSkinFile(file) {
  if (file.type !== 'image/png') {
    showSkinStatus('Skin file must be a PNG image!', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      if ((img.width === 64 && img.height === 64) || (img.width === 64 && img.height === 32)) {
        pendingSkinBase64 = e.target.result;
        currentSkinImage = img;
        redrawCanvas();
        btnApplySkin.disabled = false;
        showSkinStatus('Skin file loaded! Click "Apply Skin" to save.', 'success');
      } else {
        showSkinStatus(`Invalid skin dimensions (${img.width}x${img.height})! Must be 64x64 or 64x32.`, 'error');
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function redrawCanvas() {
  const ctx = skinCanvas.getContext('2d');
  ctx.clearRect(0, 0, skinCanvas.width, skinCanvas.height);
  ctx.imageSmoothingEnabled = false;

  const s = 10;

  if (currentSkinImage) {
    // 1. Draw Cape behind torso first (sticking out on sides)
    if (currentCapeImage) {
      // Draw cape back texture (centered behind player torso)
      ctx.drawImage(currentCapeImage, 2, 2, 10, 16, 3 * s, 8 * s, 10 * s, 13 * s);
    }

    // 2. Draw Head
    ctx.drawImage(currentSkinImage, 8, 8, 8, 8, 4 * s, 0 * s, 8 * s, 8 * s);
    ctx.drawImage(currentSkinImage, 40, 8, 8, 8, 4 * s, 0 * s, 8 * s, 8 * s); // helm

    // 3. Torso
    ctx.drawImage(currentSkinImage, 20, 20, 8, 12, 4 * s, 8 * s, 8 * s, 12 * s);
    if (currentSkinImage.height === 64) {
      ctx.drawImage(currentSkinImage, 20, 36, 8, 12, 4 * s, 8 * s, 8 * s, 12 * s);
    }

    // 4. Left Arm
    ctx.drawImage(currentSkinImage, 44, 20, 4, 12, 0 * s, 8 * s, 4 * s, 12 * s);
    if (currentSkinImage.height === 64) {
      ctx.drawImage(currentSkinImage, 44, 36, 4, 12, 0 * s, 8 * s, 4 * s, 12 * s);
    }

    // 5. Right Arm
    if (currentSkinImage.height === 64) {
      ctx.drawImage(currentSkinImage, 32, 48, 4, 12, 12 * s, 8 * s, 4 * s, 12 * s);
      ctx.drawImage(currentSkinImage, 48, 48, 4, 12, 12 * s, 8 * s, 4 * s, 12 * s);
    } else {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(currentSkinImage, 44, 20, 4, 12, -16 * s, 8 * s, 4 * s, 12 * s);
      ctx.restore();
    }

    // 6. Left Leg
    ctx.drawImage(currentSkinImage, 0, 20, 4, 12, 4 * s, 20 * s, 4 * s, 12 * s);
    if (currentSkinImage.height === 64) {
      ctx.drawImage(currentSkinImage, 0, 36, 4, 12, 4 * s, 20 * s, 4 * s, 12 * s);
    }

    // 7. Right Leg
    if (currentSkinImage.height === 64) {
      ctx.drawImage(currentSkinImage, 16, 48, 4, 12, 8 * s, 20 * s, 4 * s, 12 * s);
      ctx.drawImage(currentSkinImage, 0, 48, 4, 12, 8 * s, 20 * s, 4 * s, 12 * s);
    } else {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(currentSkinImage, 0, 20, 4, 12, -12 * s, 20 * s, 4 * s, 12 * s);
      ctx.restore();
    }
  }
}

// Keep backward compatibility if draw2DSkinPreview is called elsewhere
function draw2DSkinPreview(img) {
  currentSkinImage = img;
  redrawCanvas();
}

function setupPvPPresetsHandlers() {
  document.querySelectorAll('.quick-install-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const btnEl = e.currentTarget;
      const projectId = btnEl.getAttribute('data-project-id');
      const loader = modsLoaderSelect.value;
      const gameVersion = config.lastSelectedVersion || '26.1.2';

      btnEl.disabled = true;
      btnEl.innerHTML = `<i data-lucide="loader" class="btn-spin-icon" style="width:14px; height:14px;"></i> <span>Installing...</span>`;
      lucide.createIcons();

      const result = await window.api.installMod({
        projectId: projectId,
        gameVersion: gameVersion,
        loader: loader
      });

      if (result.success) {
        btnEl.className = 'secondary-btn quick-install-btn';
        btnEl.style.borderColor = 'var(--accent-cyan)';
        btnEl.innerHTML = `<i data-lucide="check" style="color: var(--accent-cyan); width:14px; height:14px;"></i> <span style="color: var(--accent-cyan);">Installed!</span>`;
        lucide.createIcons();
      } else {
        btnEl.disabled = false;
        btnEl.innerHTML = `<i data-lucide="alert-triangle" style="width:14px; height:14px;"></i> <span>Failed</span>`;
        lucide.createIcons();
        alert(`Failed to install preset mod:\n${result.error}`);
      }
    });
  });
}

// CAPE SYSTEM EVENT HANDLERS
function initCapeUploadHandlers() {
  btnBrowseCape.addEventListener('click', () => capeFileInput.click());
  capeDropZone.addEventListener('click', (e) => {
    if (e.target !== btnBrowseCape) capeFileInput.click();
  });

  capeFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleSelectedCapeFile(file);
  });

  capeDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    capeDropZone.classList.add('dragover');
  });

  capeDropZone.addEventListener('dragleave', () => {
    capeDropZone.classList.remove('dragover');
  });

  capeDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    capeDropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleSelectedCapeFile(file);
  });

  btnApplyCape.addEventListener('click', saveUploadedCape);
  btnResetCape.addEventListener('click', resetCapeToDefault);
}

function handleSelectedCapeFile(file) {
  if (file.type !== 'image/png') {
    showCapeStatus('Cape file must be a PNG image!', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      pendingCapeBase64 = e.target.result;
      currentCapeImage = img;
      redrawCanvas();
      btnApplyCape.disabled = false;
      showCapeStatus('Cape file loaded! Click "Apply Cape" to save.', 'success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveUploadedCape() {
  if (!pendingCapeBase64) return;
  
  const result = await window.api.uploadCape({
    username: config.username || 'Steve',
    base64Data: pendingCapeBase64
  });

  if (result.success) {
    showCapeStatus('Cape applied successfully! Visible in multiplayer.', 'success');
    btnApplyCape.disabled = true;
  } else {
    showCapeStatus(`Failed to apply cape: ${result.error}`, 'error');
  }
}

async function resetCapeToDefault() {
  const result = await window.api.uploadCape({
    username: config.username || 'Steve',
    base64Data: ""
  });

  if (result.success) {
    pendingCapeBase64 = null;
    currentCapeImage = null;
    redrawCanvas();
    btnApplyCape.disabled = true;
    showCapeStatus('Cape reset/removed.', 'success');
  }
}

function showCapeStatus(msg, type) {
  capeStatusMsg.textContent = msg;
  capeStatusMsg.className = `skin-status ${type}`;
  setTimeout(() => {
    capeStatusMsg.textContent = '';
  }, 4000);
}

async function loadUserSkinForPreview() {
  const localSkin = await window.api.getSkin(config.username || 'Steve');
  const localCape = await window.api.getCape(config.username || 'Steve');
  
  const skinImg = new Image();
  skinImg.onload = () => {
    currentSkinImage = skinImg;
    
    if (localCape) {
      const capeImg = new Image();
      capeImg.onload = () => {
        currentCapeImage = capeImg;
        redrawCanvas();
      };
      capeImg.src = localCape;
    } else {
      currentCapeImage = null;
      redrawCanvas();
    }
  };
  
  if (localSkin) {
    skinImg.src = localSkin;
  } else {
    // default steve
    skinImg.src = 'https://textures.minecraft.net/texture/3b60a1f4d2568cfd4d8234140130f14cb08345aa8a96e9d9e6decf4b5f4896';
  }
}

function loadDefaultStevePreview() {
  currentCapeImage = null;
  const img = new Image();
  img.onload = () => {
    currentSkinImage = img;
    redrawCanvas();
  };
  img.src = 'https://textures.minecraft.net/texture/3b60a1f4d2568cfd4d8234140130f14cb08345aa8a96e9d9e6decf4b5f4896';
}

async function saveUploadedSkin() {
  if (!pendingSkinBase64) return;
  
  const result = await window.api.uploadSkin({
    username: config.username || 'Steve',
    base64Data: pendingSkinBase64
  });

  if (result.success) {
    showSkinStatus('Skin applied successfully! Visible in multiplayer.', 'success');
    btnApplySkin.disabled = true;
    
    const localSkin = await window.api.getSkin(config.username || 'Steve');
    updateAvatarFromBase64(localSkin, sidebarAvatar);
    updateAvatarFromBase64(localSkin, loginAvatar);
  } else {
    showSkinStatus(`Failed to apply skin: ${result.error}`, 'error');
  }
}

async function resetSkinToDefault() {
  const result = await window.api.uploadSkin({
    username: config.username || 'Steve',
    base64Data: ""
  });

  if (result.success) {
    pendingSkinBase64 = null;
    loadDefaultStevePreview();
    btnApplySkin.disabled = true;
    showSkinStatus('Skin reset to Steve (Default).', 'success');
    
    sidebarAvatar.src = `https://minotar.net/helm/${config.username || 'Steve'}/64.png`;
    loginAvatar.src = `https://minotar.net/helm/${config.username || 'Steve'}/128.png`;
  }
}

function showSkinStatus(msg, type) {
  skinStatusMsg.textContent = msg;
  skinStatusMsg.className = `skin-status ${type}`;
  setTimeout(() => {
    skinStatusMsg.textContent = '';
  }, 4000);
}

// ----------------- AI BUG DIAGNOSTICS & PROCESS ANALYSIS -----------------

// Helper to convert AI Markdown responses to HTML elements
function parseMarkdown(text) {
  let html = text;
  
  // Escape raw HTML tags
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  
  // Convert Markdown headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  
  // Convert Blockquotes
  html = html.replace(/^&gt;\s*(.*$)/gim, '<blockquote>$1</blockquote>');
  
  // Convert Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Convert Inline Code
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  
  // Convert Bullet points
  html = html.replace(/^\-\s*(.*$)/gim, '<li>$1</li>');
  html = html.replace(/^\*\s*(.*$)/gim, '<li>$1</li>');
  
  // Convert newlines to line breaks
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

// Read log content, execute analysis via Gemini API or Offline Diagnostics
async function handleLogsAIAnalysis() {
  // Extract console log text
  const logLines = Array.from(consoleLog.querySelectorAll('.log-line'))
    .map(line => line.textContent)
    .join('\n');
    
  if (logLines.trim().length < 50) {
    alert('Log console is currently empty or too short. Run the game first to compile launch logs.');
    return;
  }

  aiDebugContent.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <i data-lucide="loader" class="btn-spin-icon" style="color:var(--accent-cyan); width:18px; height:18px;"></i>
      <span>Analyzing console logs with Crafter AI...</span>
    </div>
  `;
  lucide.createIcons();
  aiDebugModal.classList.remove('hidden');

  try {
    const result = await window.api.analyzeLogs({
      logs: logLines,
      apiKey: config.geminiApiKey
    });

    if (result.success) {
      aiDebugContent.innerHTML = parseMarkdown(result.text);
    } else {
      aiDebugContent.innerHTML = `
        <h3 style="color:var(--accent-pink);">Analysis Failed</h3>
        <p>${result.error}</p>
        <blockquote style="margin-top:10px;">
          <strong>Recommendation:</strong> Double check your Gemini API key in Settings, or delete the key to run offline heuristics analysis.
        </blockquote>
      `;
    }
  } catch (err) {
    aiDebugContent.innerHTML = `<h3 style="color:var(--accent-pink);">Error executing diagnostic:</h3><p>${err.message}</p>`;
  }
}

// ----------------- LAUNCHER LOGIC & PROCESS HANDLERS -----------------

// Add line to console logger
function appendLogLine(text, type = 'info') {
  const line = document.createElement('span');
  line.className = `log-line ${type}-line`;
  line.textContent = text;
  
  consoleLog.appendChild(line);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

// Handle clicking PLAY
async function handlePlayClick() {
  if (isLaunching) return;

  const profileId = playVersionSelect.value;
  if (!profileId) {
    alert('Please select a profile to play first.');
    return;
  }

  const activeProfile = config.profiles && config.profiles[profileId];
  const mcVersion = activeProfile ? activeProfile.version : profileId;

  isLaunching = true;
  btnPlay.disabled = true;
  btnPlayText.textContent = 'PREPARING...';
  progressBarFill.style.width = '0%';
  progressPercentageVal.textContent = '0%';
  progressTaskName.textContent = 'Starting installation sequence...';
  launchProgressContainer.classList.remove('hidden');

  appendLogLine(`[Launcher] Launching Minecraft ${mcVersion} (${activeProfile ? activeProfile.name : 'Raw Version'}) for user ${config.username}...`, 'system');

  const launchConfig = {
    username: config.username || 'Steve',
    maxMemory: config.maxMemory || 4096,
    minMemory: config.minMemory || 1024,
    javaPath: config.javaPath || 'java',
    minecraftDir: config.minecraftDir,
    versionNumber: mcVersion,
    instanceId: profileId,
    externalPath: activeProfile ? activeProfile.externalPath : ''
  };

  const result = await window.api.launchGame(launchConfig);
  
  if (!result.success) {
    appendLogLine(`[Launch Error] ${result.error}`, 'error');
    resetPlayButtonState();
    alert(`Launch failed: ${result.error}`);
  }
}

function resetPlayButtonState() {
  isLaunching = false;
  btnPlay.disabled = false;
  btnPlayText.textContent = 'PLAY GAME';
  launchProgressContainer.classList.add('hidden');
}

// Setup IPC events listeners
function setupLaunchListeners() {
  window.api.removeAllListeners();

  window.api.onLaunchStarted(() => {
    btnPlayText.textContent = 'LAUNCHING...';
    progressTaskName.textContent = 'Starting client process...';
    appendLogLine('[Launcher] Files verified. Launching Java Virtual Machine...', 'system');
  });

  window.api.onLaunchProgress((prog) => {
    let percentage = 0;
    if (prog.total > 0) {
      percentage = Math.round((prog.task / prog.total) * 100);
    }
    
    progressBarFill.style.width = `${percentage}%`;
    progressPercentageVal.textContent = `${percentage}%`;
    
    const taskName = prog.type.charAt(0).toUpperCase() + prog.type.slice(1);
    progressTaskName.textContent = `Processing ${taskName}... (${prog.task}/${prog.total})`;
  });

  window.api.onLaunchDownloadStatus((status) => {
    let percentage = 0;
    if (status.total > 0) {
      percentage = Math.round((status.task / status.total) * 100);
    }
    
    progressBarFill.style.width = `${percentage}%`;
    progressPercentageVal.textContent = `${percentage}%`;
    
    progressTaskName.textContent = `Downloading ${status.type}: ${status.name || ''} (${status.task}/${status.total})`;
  });

  window.api.onLaunchLogBatch((batch) => {
    batch.forEach(item => {
      appendLogLine(item.text, item.type);
    });
  });

  window.api.onLaunchClosed((code) => {
    appendLogLine(`=== Minecraft Process Closed (Exit Code: ${code}) ===`, 'system');
    resetPlayButtonState();
  });

  window.api.onLaunchError((err) => {
    appendLogLine(`[Process Error] ${err}`, 'error');
    resetPlayButtonState();
  });
}

const themePresets = {
  purple: {
    primary: '#9d4edd',
    primaryGlow: 'rgba(157, 78, 221, 0.6)',
    primaryDark: '#7b2cbf',
    secondary: '#240046',
    accentCyan: '#00f5d4',
    accentCyanGlow: 'rgba(0, 245, 212, 0.4)',
    bgDeep: '#080610',
    bgDark: '#0f0b1e',
    bgCard: 'rgba(22, 17, 43, 0.45)',
    border: 'rgba(157, 78, 221, 0.2)'
  },
  cyan: {
    primary: '#00b4d8',
    primaryGlow: 'rgba(0, 180, 216, 0.6)',
    primaryDark: '#0077b6',
    secondary: '#03045e',
    accentCyan: '#00f5d4',
    accentCyanGlow: 'rgba(0, 245, 212, 0.4)',
    bgDeep: '#0b132b',
    bgDark: '#1c2541',
    bgCard: 'rgba(28, 37, 65, 0.45)',
    border: 'rgba(0, 180, 216, 0.2)'
  },
  green: {
    primary: '#38b000',
    primaryGlow: 'rgba(56, 176, 0, 0.6)',
    primaryDark: '#007200',
    secondary: '#004b23',
    accentCyan: '#70e000',
    accentCyanGlow: 'rgba(112, 224, 0, 0.4)',
    bgDeep: '#040d06',
    bgDark: '#0b1e10',
    bgCard: 'rgba(11, 30, 16, 0.45)',
    border: 'rgba(56, 176, 0, 0.2)'
  },
  red: {
    primary: '#e63946',
    primaryGlow: 'rgba(230, 57, 70, 0.6)',
    primaryDark: '#d90429',
    secondary: '#3d0007',
    accentCyan: '#ff7096',
    accentCyanGlow: 'rgba(255, 112, 150, 0.4)',
    bgDeep: '#0f0507',
    bgDark: '#1f0d11',
    bgCard: 'rgba(31, 13, 17, 0.45)',
    border: 'rgba(230, 57, 70, 0.2)'
  }
};

function applyTheme(themeName) {
  const t = themePresets[themeName] || themePresets.purple;
  const root = document.documentElement;
  root.style.setProperty('--primary', t.primary);
  root.style.setProperty('--primary-glow', t.primaryGlow);
  root.style.setProperty('--primary-dark', t.primaryDark);
  root.style.setProperty('--secondary', t.secondary);
  root.style.setProperty('--accent-cyan', t.accentCyan);
  root.style.setProperty('--accent-cyan-glow', t.accentCyanGlow);
  root.style.setProperty('--bg-deep', t.bgDeep);
  root.style.setProperty('--bg-dark', t.bgDark);
  root.style.setProperty('--bg-card', t.bgCard);
  root.style.setProperty('--border-color', t.border);
}

// ----------------- INSTANCE PROFILE MANAGEMENT SYSTEM -----------------

function initProfilesSystem() {
  const btnShowAddProfile = document.getElementById('btn-show-add-profile');
  const addProfileForm = document.getElementById('add-profile-form');
  const newProfileName = document.getElementById('new-profile-name');
  const newProfileVersion = document.getElementById('new-profile-version');
  const newProfileLogo = document.getElementById('new-profile-logo');
  const newProfileExternal = document.getElementById('new-profile-external');
  const btnBrowseNewExternal = document.getElementById('btn-browse-new-external');
  const btnSaveNewProfile = document.getElementById('btn-save-new-profile');
  const btnCancelNewProfile = document.getElementById('btn-cancel-new-profile');
  
  const editProfileForm = document.getElementById('edit-profile-form');
  const editProfileId = document.getElementById('edit-profile-id');
  const editProfileName = document.getElementById('edit-profile-name');
  const editProfileLogo = document.getElementById('edit-profile-logo');
  const editProfileExternal = document.getElementById('edit-profile-external');
  const btnBrowseEditExternal = document.getElementById('btn-browse-edit-external');
  const btnSaveEditProfile = document.getElementById('btn-save-edit-profile');
  const btnCancelEditProfile = document.getElementById('btn-cancel-edit-profile');

  // Browse actions for external launchers
  if (btnBrowseNewExternal) {
    btnBrowseNewExternal.addEventListener('click', async () => {
      const filePath = await window.api.selectExternalClient();
      if (filePath) {
        newProfileExternal.value = filePath;
      }
    });
  }

  if (btnBrowseEditExternal) {
    btnBrowseEditExternal.addEventListener('click', async () => {
      const filePath = await window.api.selectExternalClient();
      if (filePath) {
        editProfileExternal.value = filePath;
      }
    });
  }

  // Toggle Forms
  if (btnShowAddProfile) {
    btnShowAddProfile.addEventListener('click', () => {
      editProfileForm.classList.add('hidden');
      if (addProfileForm.classList.contains('hidden')) {
        addProfileForm.classList.remove('hidden');
        newProfileName.value = '';
        if (newProfileExternal) newProfileExternal.value = '';
        newProfileName.focus();
      } else {
        addProfileForm.classList.add('hidden');
      }
    });
  }

  if (btnCancelNewProfile) {
    btnCancelNewProfile.addEventListener('click', () => {
      addProfileForm.classList.add('hidden');
      if (newProfileExternal) newProfileExternal.value = '';
    });
  }

  if (btnCancelEditProfile) {
    btnCancelEditProfile.addEventListener('click', () => {
      editProfileForm.classList.add('hidden');
      if (editProfileExternal) editProfileExternal.value = '';
    });
  }

  // Create Profile
  if (btnSaveNewProfile) {
    btnSaveNewProfile.addEventListener('click', async () => {
      const name = newProfileName.value.trim() || 'Unnamed Instance';
      const version = newProfileVersion.value;
      const logo = newProfileLogo.value;
      const externalPath = newProfileExternal ? newProfileExternal.value.trim() : '';
      
      const newId = `profile_${Date.now()}`;
      
      if (!config.profiles) {
        config.profiles = {};
      }
      
      config.profiles[newId] = {
        id: newId,
        name: name,
        version: version,
        logo: logo,
        externalPath: externalPath
      };
      
      config.lastSelectedVersion = newId;
      await window.api.saveConfig(config);
      
      addProfileForm.classList.add('hidden');
      if (newProfileExternal) newProfileExternal.value = '';
      
      populateVersionSelectors();
      renderProfilesList();
      appendLogLine(`[Profiles] Created new profile: "${name}" (${version})`, 'system');
    });
  }

  // Edit Profile
  if (btnSaveEditProfile) {
    btnSaveEditProfile.addEventListener('click', async () => {
      const profileId = editProfileId.value;
      const name = editProfileName.value.trim() || 'Unnamed Instance';
      const logo = editProfileLogo.value;
      const externalPath = editProfileExternal ? editProfileExternal.value.trim() : '';
      
      if (config.profiles && config.profiles[profileId]) {
        config.profiles[profileId].name = name;
        config.profiles[profileId].logo = logo;
        config.profiles[profileId].externalPath = externalPath;
        
        await window.api.saveConfig(config);
        
        editProfileForm.classList.add('hidden');
        if (editProfileExternal) editProfileExternal.value = '';
        
        populateVersionSelectors();
        renderProfilesList();
        appendLogLine(`[Profiles] Updated profile: "${name}"`, 'system');
      }
    });
  }

  // Render initial list
  renderProfilesList();
}

function renderProfilesList() {
  const profilesList = document.getElementById('profiles-list');
  if (!profilesList) return;
  
  profilesList.innerHTML = '';
  
  if (!config.profiles || Object.keys(config.profiles).length === 0) {
    profilesList.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 10px;">No profiles created yet.</div>';
    return;
  }

  const logoEmojis = {
    vanilla: '📦',
    fabric: '⚡',
    forge: '🛠️',
    pvp: '⚔️',
    survival: '🛡️',
    diamond: '💎',
    custom: '⚙️',
    feather: '🪶',
    lunar: '🌙',
    badlion: '🦁'
  };

  Object.values(config.profiles).forEach(profile => {
    const card = document.createElement('div');
    card.style.display = 'flex';
    card.style.alignItems = 'center';
    card.style.justifyContent = 'space-between';
    card.style.padding = '10px 14px';
    card.style.borderRadius = '8px';
    card.style.background = profile.id === config.lastSelectedVersion ? 'rgba(0, 245, 212, 0.08)' : 'rgba(8, 6, 16, 0.4)';
    card.style.border = profile.id === config.lastSelectedVersion ? '1px solid var(--accent-cyan)' : '1px solid rgba(255, 255, 255, 0.05)';
    card.style.transition = 'all 0.2s ease';
    card.style.marginBottom = '8px';

    const emoji = logoEmojis[profile.logo] || '📦';
    
    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
        <span style="font-size: 20px; filter: drop-shadow(0 0 4px rgba(255,255,255,0.1));">${emoji}</span>
        <div style="display: flex; flex-direction: column; min-width: 0;">
          <strong style="color: #fff; font-size: 13px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${profile.name}</strong>
          <span style="font-size: 10px; color: var(--text-muted);">${profile.version}</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="secondary-btn btn-select-profile" data-id="${profile.id}" style="padding: 4px 8px; font-size: 11px; border-radius: 4px; border-color: ${profile.id === config.lastSelectedVersion ? 'var(--accent-cyan)' : ''}; display: flex; align-items: center; gap: 4px; background: transparent; cursor: pointer;">
          <i data-lucide="${profile.id === config.lastSelectedVersion ? 'check-circle' : 'circle'}" style="width: 12px; height: 12px; color: ${profile.id === config.lastSelectedVersion ? 'var(--accent-cyan)' : ''}"></i>
          <span>${profile.id === config.lastSelectedVersion ? 'Active' : 'Select'}</span>
        </button>
        <button class="secondary-btn btn-folder-profile" data-id="${profile.id}" style="padding: 4px; font-size: 11px; border-radius: 4px; background: transparent; cursor: pointer;" title="Open Mods/Instance Folder">
          <i data-lucide="folder" style="width: 12px; height: 12px; color: var(--accent-cyan);"></i>
        </button>
        <button class="secondary-btn btn-edit-profile" data-id="${profile.id}" style="padding: 4px; font-size: 11px; border-radius: 4px; background: transparent; cursor: pointer;" title="Rename/Edit">
          <i data-lucide="edit-2" style="width: 12px; height: 12px;"></i>
        </button>
        <button class="secondary-btn btn-delete-profile" data-id="${profile.id}" style="padding: 4px; font-size: 11px; border-radius: 4px; background: transparent; cursor: pointer;" title="Delete Profile" ${Object.keys(config.profiles).length <= 1 ? 'disabled style="opacity:0.5; pointer-events:none;"' : ''}>
          <i data-lucide="trash-2" style="width: 12px; height: 12px; color: var(--accent-pink);"></i>
        </button>
      </div>
    `;

    profilesList.appendChild(card);
  });

  lucide.createIcons();

  // Bind selection
  profilesList.querySelectorAll('.btn-select-profile').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      config.lastSelectedVersion = id;
      await window.api.saveConfig(config);
      populateVersionSelectors();
      renderProfilesList();
      
      // Go to play tab
      switchTab('play');
    });
  });

  // Bind folder opening
  profilesList.querySelectorAll('.btn-folder-profile').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      await window.api.openInstanceFolder(id);
    });
  });

  // Bind editing
  profilesList.querySelectorAll('.btn-edit-profile').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const profile = config.profiles[id];
      if (profile) {
        document.getElementById('add-profile-form').classList.add('hidden');
        
        const editForm = document.getElementById('edit-profile-form');
        editForm.classList.remove('hidden');
        
        document.getElementById('edit-profile-id').value = id;
        document.getElementById('edit-profile-name').value = profile.name;
        document.getElementById('edit-profile-logo').value = profile.logo;
        
        const extInput = document.getElementById('edit-profile-external');
        if (extInput) {
          extInput.value = profile.externalPath || '';
        }
        
        document.getElementById('edit-profile-name').focus();
      }
    });
  });

  // Bind deleting
  profilesList.querySelectorAll('.btn-delete-profile').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const profile = config.profiles[id];
      if (profile && confirm(`Are you sure you want to delete profile "${profile.name}"? This will delete the profile but keep download files. AppData resets are done inside Settings.`)) {
        delete config.profiles[id];
        
        // If we deleted the active profile, select another one
        if (config.lastSelectedVersion === id) {
          config.lastSelectedVersion = Object.keys(config.profiles)[0];
        }
        
        await window.api.saveConfig(config);
        populateVersionSelectors();
        renderProfilesList();
        appendLogLine(`[Profiles] Deleted profile: "${profile.name}"`, 'system');
      }
    });
  });
}

// Start Initialization
init();
