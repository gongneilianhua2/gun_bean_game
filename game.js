(function () {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const hudScore = document.getElementById("score");
  const hudHealth = document.getElementById("health");
  const lobbyHint = document.getElementById("lobby-hint");
  const hudOnlineMeta = document.getElementById("hud-online-meta");
  const hudOnlineBadges = document.getElementById("hud-online-badges");
  const hudRoom = document.getElementById("hud-room");
  const hudPlayers = document.getElementById("hud-players");
  const btnReady = document.getElementById("btn-ready");
  const titleScreen = document.getElementById("title-screen");
  const onlinePanel = document.getElementById("online-panel");
  const roomIdInput = document.getElementById("room-id");
  const netStatus = document.getElementById("net-status");
  const gameOverEl = document.getElementById("game-over");
  const goTitle = document.getElementById("go-title");
  const goMsg = document.getElementById("go-msg");
  const btnOffline = document.getElementById("btn-offline");
  const btnOnline = document.getElementById("btn-online");
  const btnJoin = document.getElementById("btn-join");
  const restartBtn = document.getElementById("restart-btn");
  const btnBackMenu = document.getElementById("btn-back-menu");
  const hud = document.getElementById("hud");
  const offlineLevelPanel = document.getElementById("offline-level-panel");
  const offlineLevelList = document.getElementById("offline-level-list");
  const btnOfflineBack = document.getElementById("btn-offline-back");
  const tutorialOverlay = document.getElementById("tutorial-overlay");
  const tutorialTitle = document.getElementById("tutorial-title");
  const tutorialText = document.getElementById("tutorial-text");
  const btnTutorialNext = document.getElementById("btn-tutorial-next");
  const btnTutorialSkip = document.getElementById("btn-tutorial-skip");
  const perkOverlay = document.getElementById("perk-overlay");
  const perkSubtitle = document.getElementById("perk-subtitle");
  const perkOptions = document.getElementById("perk-options");

  /** 逻辑场地尺寸（与 server.js 一致）；物理分辨率由画布 backing store × letterbox 拉伸 */
  const W = 960;
  const H = 540;

  let canvasBackingDpr = 1;

  function syncCanvasBackingStore() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvasBackingDpr = dpr;
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
  }

  function arenaLetterboxParams(rect) {
    const cssW = rect.width;
    const cssH = rect.height;
    const scale = Math.min(cssW / W, cssH / H);
    const ox = (cssW - W * scale) / 2;
    const oy = (cssH - H * scale) / 2;
    return { scale, ox, oy };
  }

  function beginArenaCanvas(theme) {
    syncCanvasBackingStore();
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const { scale, ox, oy } = arenaLetterboxParams(rect);
    const dpr = canvasBackingDpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    drawMarginDecor(cssW, cssH, ox, oy, scale, theme);
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
  }

  function clientToArena(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const { scale, ox, oy } = arenaLetterboxParams(rect);
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    return {
      x: (cssX - ox) / scale,
      y: (cssY - oy) / scale,
    };
  }

  const PR = 10;
  const MUZZLE_DIST = PR + 20;
  const RECOIL_IMPULSE = 300;
  const WATER_DRAG = 0.878;
  const MAX_PLAYER_SPEED = 540;
  const PLAYER_BULLET_SPEED = 600;
  const PLAYER_SHOOT_CD = 0.1;
  const WALL_TOUCH_EPS = 2.8;
  const WALL_KICK_MULT = 1.58;
  const WALL_POP_PX = 5;
  const FLOAT_DRIFT_SPEED = 92;
  const FLOAT_FREQ_A = 0.72;
  const FLOAT_FREQ_B = 0.58;
  const FLOAT_LERP = 2.45;
  const PICKUP_LIFE = 12;
  const PICKUP_DROP_BASE = 0.22;
  const PICKUP_AUTO_PICK_RADIUS = 42;
  const SHOTGUN_BUFF_DURATION = 6;
  const SHIELD_BUFF_DURATION = 7;
  const RAPIDFIRE_BUFF_DURATION = 6;
  const BOAT_HULL_SCALE = 0.55;
  const GUN_SCALE = 0.55;
  const WALL_AUTO_POP_ZONE = 44;
  const WALL_AUTO_POP_PUSH = 900;
  const EDGE_REPEL_ZONE = 120;
  const EDGE_REPEL_FORCE = 260;
  const WALL_TURN_ASSIST_ZONE = 56;
  const WALL_TURN_ASSIST = 0.38;
  /** 设为 true 时不生成小怪，方便单独测手感 */
  const OFFLINE_ENEMIES_DISABLED = false;

  const DEFAULT_WAVE_CFG = {
    count: 3,
    speedMin: 55,
    speedMax: 95,
    hp: 2,
    radiusMin: 9,
    radiusMax: 11,
    shootRange: 420,
    bulletSpeed: 340,
    shootCdMin: 0.9,
    shootCdMax: 1.8,
  };

  const DEFAULT_ARENA_THEME = {
    skyTop: "#0a1428",
    skyMid: "#0d2238",
    skyBot: "#0c3048",
    waterStops: [
      [35, 110, 145, 0],
      [28, 95, 125, 0.08],
      [22, 78, 108, 0.12],
      [18, 65, 92, 0.16],
    ],
    waveDeep: [25, 85, 118],
    waveMid: [55, 140, 175],
    waveFoam: [210, 245, 255],
    grid: [255, 255, 255, 0.06],
    border: [233, 69, 96, 0.35],
  };

  const OFFLINE_LEVELS = [
    {
      title: "浅湾热身",
      healOnLevelClear: 0,
      arena: {
        skyTop: "#0c1a28",
        skyMid: "#103248",
        skyBot: "#154058",
        waterStops: [
          [32, 125, 138, 0],
          [26, 108, 128, 0.09],
          [20, 88, 108, 0.13],
          [16, 72, 92, 0.17],
        ],
        waveDeep: [22, 98, 118],
        waveMid: [48, 155, 168],
        waveFoam: [200, 248, 255],
        grid: [220, 245, 255, 0.055],
        border: [78, 205, 196, 0.38],
      },
      waves: [
        { count: 2, speedMin: 48, speedMax: 74, hp: 2, shootCdMin: 1.05, shootCdMax: 2 },
        { count: 3, speedMin: 50, speedMax: 80, hp: 2 },
        { count: 3, speedMin: 52, speedMax: 84, hp: 2 },
      ],
    },
    {
      title: "涌浪区",
      healOnLevelClear: 1,
      arena: {
        skyTop: "#061828",
        skyMid: "#0a2842",
        skyBot: "#0d3658",
        waterStops: [
          [28, 140, 168, 0],
          [22, 118, 152, 0.1],
          [18, 98, 135, 0.14],
          [14, 78, 115, 0.18],
        ],
        waveDeep: [18, 95, 135],
        waveMid: [42, 165, 195],
        waveFoam: [185, 250, 255],
        grid: [200, 240, 255, 0.065],
        border: [56, 189, 248, 0.4],
      },
      waves: [
        { count: 3 },
        { count: 4 },
        { count: 4, speedMin: 58, speedMax: 98 },
        { count: 5, speedMin: 60, speedMax: 100 },
      ],
    },
    {
      title: "红潮",
      healOnLevelClear: 0,
      arena: {
        skyTop: "#240f14",
        skyMid: "#381820",
        skyBot: "#4a2228",
        waterStops: [
          [110, 42, 58, 0],
          [88, 36, 52, 0.1],
          [68, 30, 48, 0.14],
          [52, 24, 42, 0.19],
        ],
        waveDeep: [120, 48, 62],
        waveMid: [195, 90, 105],
        waveFoam: [255, 210, 215],
        grid: [255, 200, 200, 0.055],
        border: [255, 107, 107, 0.42],
      },
      waves: [
        { count: 4, speedMin: 62, speedMax: 102 },
        { count: 5 },
        { count: 5, speedMin: 65, speedMax: 108, shootRange: 440 },
        { count: 6, speedMin: 68, speedMax: 112 },
      ],
    },
    {
      title: "暴风雨前",
      healOnLevelClear: 1,
      arena: {
        skyTop: "#0f0820",
        skyMid: "#181030",
        skyBot: "#221840",
        waterStops: [
          [48, 38, 108, 0],
          [38, 32, 92, 0.11],
          [30, 28, 78, 0.15],
          [22, 22, 62, 0.2],
        ],
        waveDeep: [72, 62, 150],
        waveMid: [120, 140, 230],
        waveFoam: [220, 210, 255],
        grid: [180, 170, 255, 0.06],
        border: [167, 139, 250, 0.45],
      },
      waves: [
        { count: 5 },
        { count: 5, hp: 3, radiusMin: 9.5, radiusMax: 12, speedMin: 55, speedMax: 90 },
        { count: 6, speedMin: 70, speedMax: 115 },
        { count: 6, hp: 3, radiusMin: 10, radiusMax: 12.5, speedMin: 58, speedMax: 95 },
        { count: 7 },
      ],
    },
    {
      title: "深潮王座",
      healOnLevelClear: 0,
      arena: {
        skyTop: "#03060c",
        skyMid: "#060a14",
        skyBot: "#0a101c",
        waterStops: [
          [18, 48, 78, 0],
          [14, 40, 68, 0.09],
          [12, 34, 58, 0.13],
          [10, 28, 48, 0.17],
        ],
        waveDeep: [35, 75, 95],
        waveMid: [140, 175, 155],
        waveFoam: [255, 235, 190],
        grid: [200, 190, 150, 0.05],
        border: [212, 175, 55, 0.48],
      },
      waves: [
        { count: 6, speedMin: 72, speedMax: 118, bulletSpeed: 355 },
        { count: 7, speedMin: 75, speedMax: 120 },
        {
          count: 1,
          hp: 10,
          radiusMin: 14,
          radiusMax: 15,
          speedMin: 40,
          speedMax: 54,
          shootRange: 500,
          bulletSpeed: 320,
          shootCdMin: 1.15,
          shootCdMax: 2.2,
        },
      ],
    },
  ];

  const TUTORIAL_KEY = "qdr_tutorial_done_v1";
  let tutorialActive = false;
  let tutorialStep = 0;
  const TUTORIAL_STEPS = [
    {
      title: "1/4 核心移动",
      text: "本作不是 WASD 移动。你要用鼠标瞄准并开枪，利用后坐力把自己往反方向推开。",
    },
    {
      title: "2/4 墙边技巧",
      text: "贴近边缘朝墙开枪，会获得更强反冲。可快速变向脱离危险区域。",
    },
    {
      title: "3/4 风险控制",
      text: "持续高强度开火会更难控位。注意边界、敌群和自身生命，避免被连击。",
    },
    {
      title: "4/4 拾取与节奏",
      text: "击败敌人会掉落强化。优先保证生存，再追求高输出与连杀节奏。",
    },
  ];

  const keys = {};
  let mouse = { x: 0, y: 0, down: false };
  let screenShake = 0;
  let prevMyShotFx = 0;
  let prevOnlineCapsizeFx = 0;
  const ONLINE_CAPSIZE_FX_MAX = 1.05;

  let mode = "menu";
  let socket = null;
  let netState = null;
  let onlineMatchEndShown = false;

  let player;
  let bullets;
  let enemies;
  let pickups;
  let offlineBuffs;
  let offlinePerks;
  let offlineWaveClearPending;
  let particles = [];
  let hitIndicators = [];
  let score;
  let wave;
  let offlineLevelIndex;
  let offlineStartLevelIndex;

  function vecLen(x, y) {
    return Math.hypot(x, y);
  }

  function normalize(x, y) {
    const l = vecLen(x, y);
    if (l < 1e-6) return { x: 0, y: 0 };
    return { x: x / l, y: y / l };
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function socketOrigin() {
    if (window.location.protocol === "file:") return "http://localhost:3333";
    return window.location.origin;
  }

  function getClientKey() {
    const k = "qdr_client_key";
    try {
      let v = localStorage.getItem(k);
      if (!v) {
        v = "ck_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (_e) {
      return "ck_mem_" + Math.random().toString(36).slice(2);
    }
  }

  function shouldShowTutorial() {
    try {
      return localStorage.getItem(TUTORIAL_KEY) !== "1";
    } catch (_e) {
      return true;
    }
  }

  function markTutorialDone() {
    try {
      localStorage.setItem(TUTORIAL_KEY, "1");
    } catch (_e) {}
  }

  function renderTutorialStep() {
    const step = TUTORIAL_STEPS[tutorialStep];
    if (!step) return;
    tutorialTitle.textContent = step.title;
    tutorialText.textContent = step.text;
    btnTutorialNext.textContent =
      tutorialStep >= TUTORIAL_STEPS.length - 1 ? "开始战斗" : "下一步";
  }

  function startTutorial() {
    tutorialActive = true;
    tutorialStep = 0;
    tutorialOverlay.classList.remove("hidden");
    renderTutorialStep();
  }

  function endTutorial(completed) {
    tutorialActive = false;
    tutorialOverlay.classList.add("hidden");
    if (completed) markTutorialDone();
  }

  function advanceTutorialStep() {
    if (!tutorialActive) return;
    tutorialStep += 1;
    if (tutorialStep >= TUTORIAL_STEPS.length) {
      endTutorial(true);
      return;
    }
    renderTutorialStep();
  }

  function spawnPlayer() {
    return {
      x: W * 0.5,
      y: H * 0.75,
      r: PR,
      vx: 0,
      vy: 0,
      hp: 3,
      maxHp: 3,
      shootCd: 0,
      angle: 0,
      invuln: 0,
      muzzleFlash: 0,
      gunRecoil: 0,
      floatT: 0,
      floatOff: rand(0, Math.PI * 2),
    };
  }

  function mergeWaveCfg(w) {
    return Object.assign({}, DEFAULT_WAVE_CFG, w);
  }

  function spawnEnemy(fromEdge, waveCfg) {
    const cfg = mergeWaveCfg(waveCfg || {});
    let x, y;
    if (fromEdge) {
      const side = (Math.random() * 4) | 0;
      if (side === 0) {
        x = rand(40, W - 40);
        y = 30;
      } else if (side === 1) {
        x = W - 30;
        y = rand(40, H - 40);
      } else if (side === 2) {
        x = rand(40, W - 40);
        y = H - 30;
      } else {
        x = 30;
        y = rand(40, H - 40);
      }
    } else {
      x = rand(60, W - 60);
      y = rand(60, H - 60);
    }
    return {
      x,
      y,
      r: rand(cfg.radiusMin, cfg.radiusMax),
      speed: rand(cfg.speedMin, cfg.speedMax),
      hp: cfg.hp,
      shootCd: rand(0, Math.min(1.35, cfg.shootCdMax)),
      muzzleFlash: 0,
      gunRecoil: 0,
      shootRange: cfg.shootRange,
      bulletSpeed: cfg.bulletSpeed,
      shootCdMin: cfg.shootCdMin,
      shootCdMax: cfg.shootCdMax,
    };
  }

  function spawnOfflineWave(waveNum) {
    const lvl = OFFLINE_LEVELS[offlineLevelIndex];
    if (!lvl || waveNum < 1 || waveNum > lvl.waves.length) return;
    const wc = mergeWaveCfg(lvl.waves[waveNum - 1]);
    for (let i = 0; i < wc.count; i++) enemies.push(spawnEnemy(true, wc));
  }

  function resetOffline() {
    player = spawnPlayer();
    bullets = [];
    enemies = [];
    pickups = [];
    offlineBuffs = { shotgunT: 0, shieldT: 0, rapidfireT: 0 };
    offlinePerks = {
      recoilMul: 1,
      bulletSpeedMul: 1,
      fireRateMul: 1,
      pickupRadiusBonus: 0,
      maxHpBonus: 0,
    };
    offlineWaveClearPending = false;
    particles = [];
    score = 0;
    const start = Math.max(
      0,
      Math.min(OFFLINE_LEVELS.length - 1, offlineStartLevelIndex | 0)
    );
    offlineLevelIndex = start;
    wave = 1;
    if (!OFFLINE_ENEMIES_DISABLED) spawnOfflineWave(1);
    hudScore.textContent = "得分 " + score;
    updateHealthHudOffline();
  }

  function updateHealthHudOffline() {
    const mh = Math.max(1, player.maxHp || 3);
    const h = Math.max(0, Math.min(mh, player.hp));
    hudHealth.textContent = "生命 " + "♥".repeat(h) + (h < mh ? "♡".repeat(mh - h) : "");
  }

  function applyOfflinePickup(type) {
    if (!offlineBuffs) return;
    if (type === "shotgun") {
      offlineBuffs.shotgunT = Math.max(offlineBuffs.shotgunT || 0, SHOTGUN_BUFF_DURATION);
      return;
    }
    if (type === "shield") {
      offlineBuffs.shieldT = Math.max(offlineBuffs.shieldT || 0, SHIELD_BUFF_DURATION);
      return;
    }
    if (type === "rapidfire") {
      offlineBuffs.rapidfireT = Math.max(offlineBuffs.rapidfireT || 0, RAPIDFIRE_BUFF_DURATION);
    }
  }

  function randomPickupTypeOffline() {
    const r = Math.random();
    if (r < 0.5) return "shotgun";
    if (r < 0.78) return "shield";
    return "rapidfire";
  }

  const OFFLINE_PERK_POOL = [
    {
      id: "recoil_boost",
      title: "推进强化",
      desc: "后坐力 +20%",
      apply() {
        offlinePerks.recoilMul *= 1.2;
      },
    },
    {
      id: "bullet_speed",
      title: "高压弹芯",
      desc: "子弹速度 +15%",
      apply() {
        offlinePerks.bulletSpeedMul *= 1.15;
      },
    },
    {
      id: "rapid_fire",
      title: "快扳机",
      desc: "射速 +18%",
      apply() {
        offlinePerks.fireRateMul *= 1.18;
      },
    },
    {
      id: "magnet",
      title: "磁吸回收",
      desc: "拾取范围 +30%",
      apply() {
        offlinePerks.pickupRadiusBonus += 0.3;
      },
    },
    {
      id: "reinforced",
      title: "加固船体",
      desc: "最大生命 +1，并回复 1 点",
      apply() {
        offlinePerks.maxHpBonus += 1;
        player.maxHp = 3 + offlinePerks.maxHpBonus;
        player.hp = Math.min(player.maxHp, player.hp + 1);
      },
    },
  ];

  function pickPerkOptions(n) {
    const pool = OFFLINE_PERK_POOL.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    return pool.slice(0, Math.min(n, pool.length));
  }

  function applyOfflinePerk(perkId) {
    const perk = OFFLINE_PERK_POOL.find((p) => p.id === perkId);
    if (!perk) return;
    perk.apply();
    player.maxHp = 3 + (offlinePerks.maxHpBonus || 0);
    player.hp = Math.min(player.maxHp, player.hp);
    updateHealthHudOffline();
  }

  function openOfflinePerkChoice() {
    if (!perkOverlay || !perkOptions) {
      finishOfflineWaveClear();
      return;
    }
    const choices = pickPerkOptions(3);
    perkOptions.innerHTML = "";
    for (const c of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "perk-pick";
      btn.textContent = c.title + "\n" + c.desc;
      btn.addEventListener("click", () => {
        applyOfflinePerk(c.id);
        closeOfflinePerkChoiceAndProceed();
      });
      perkOptions.appendChild(btn);
    }
    const lvl = OFFLINE_LEVELS[offlineLevelIndex];
    perkSubtitle.textContent =
      "第 " +
      (offlineLevelIndex + 1) +
      " 关 · 第 " +
      wave +
      "/" +
      (lvl ? lvl.waves.length : 1) +
      " 波已完成，选择一个强化后继续。";
    perkOverlay.classList.remove("hidden");
  }

  function closeOfflinePerkChoiceAndProceed() {
    if (perkOverlay) perkOverlay.classList.add("hidden");
    finishOfflineWaveClear();
  }

  function finishOfflineWaveClear() {
    if (!offlineWaveClearPending) return;
    offlineWaveClearPending = false;
    const lvl = OFFLINE_LEVELS[offlineLevelIndex];
    if (!lvl) {
      endGameOffline(true);
      return;
    }
    wave++;
    if (wave > lvl.waves.length) {
      const heal = lvl.healOnLevelClear != null ? lvl.healOnLevelClear : 0;
      if (heal > 0) {
        player.hp = Math.min(player.maxHp || 3, player.hp + heal);
        updateHealthHudOffline();
      }
      offlineLevelIndex++;
      if (offlineLevelIndex >= OFFLINE_LEVELS.length) {
        endGameOffline(true);
        return;
      }
      wave = 1;
      spawnOfflineWave(1);
    } else {
      spawnOfflineWave(wave);
    }
  }

  function updateHudOnline() {
    if (!netState || !socket) return;
    const me = netState.players.find((p) => p.id === socket.id);
    const readyCount = netState.players.filter((p) => p.ready).length;
    if (hudOnlineMeta) hudOnlineMeta.classList.remove("hidden");
    if (hudRoom) hudRoom.textContent = "房间 " + (netState.roomId || "");
    if (hudPlayers) hudPlayers.textContent = "在线 " + netState.players.length + " 人";
    if (me) {
      const lv = (netState.levelIndex || 0) + 1;
      const lvN = netState.levelCount || 1;
      const w = netState.wave || 1;
      const wN = netState.waveTotal || 1;
      if (!netState.started) {
        hudScore.textContent =
          "等待准备 " + readyCount + "/" + netState.players.length + " · 关卡合作模式";
      } else {
        hudScore.textContent =
          "关卡 " + lv + "/" + lvN + " · 波次 " + w + "/" + wN + " · 击杀 " + me.kills;
      }
      const h = Math.max(0, me.hp);
      hudHealth.textContent = "生命 " + "♥".repeat(h) + (h < 3 ? "♡".repeat(3 - h) : "");
      if (me.respawnMs > 0) {
        hudHealth.textContent += " · 复活 " + Math.ceil(me.respawnMs / 1000) + "s";
      }
    } else {
      hudScore.textContent = "连接中…";
    }
    lobbyHint.classList.add("hidden");
    if (hudOnlineBadges) {
      const badges = [];
      const b = netState.boat;
      if (b) {
        badges.push({
          kind: "warn",
          text: "颠簸 " + Math.round((b.tilt || 0) * 100) + "%",
        });
      }
      if (!netState.started) {
        badges.push({
          kind: "info",
          text: "准备 " + readyCount + "/" + netState.players.length,
        });
      }
      if (netState.waveEvent === "fog") badges.push({ kind: "info", text: "事件：浓雾" });
      if (netState.waveEvent === "storm") badges.push({ kind: "warn", text: "事件：风暴" });
      if (netState.teamBuffs && netState.teamBuffs.shotgunMs > 0) {
        badges.push({
          kind: "buff",
          text: "散弹 " + (netState.teamBuffs.shotgunMs / 1000).toFixed(1) + "s",
        });
      }
      if (netState.teamBuffs && netState.teamBuffs.shieldMs > 0) {
        badges.push({
          kind: "buff",
          text: "护盾 " + (netState.teamBuffs.shieldMs / 1000).toFixed(1) + "s",
        });
      }
      if (netState.teamBuffs && netState.teamBuffs.rapidfireMs > 0) {
        badges.push({
          kind: "buff",
          text: "快射 " + (netState.teamBuffs.rapidfireMs / 1000).toFixed(1) + "s",
        });
      }
      if (badges.length > 0) {
        hudOnlineBadges.innerHTML = badges
          .map((it) => '<span class="hud-badge ' + it.kind + '">' + it.text + "</span>")
          .join("");
        hudOnlineBadges.classList.remove("hidden");
      } else {
        hudOnlineBadges.innerHTML = "";
        hudOnlineBadges.classList.add("hidden");
      }
    }
    if (btnReady) {
      const show = mode === "online" && !netState.started && !netState.matchOver;
      btnReady.classList.toggle("hidden", !show);
      if (show) {
        btnReady.textContent = me && me.ready ? "已准备（点我取消）" : "准备";
      }
    }
  }

  function startOffline(levelIndex) {
    if (levelIndex != null) {
      offlineStartLevelIndex = Math.max(
        0,
        Math.min(OFFLINE_LEVELS.length - 1, levelIndex | 0)
      );
    }
    gameOverEl.classList.add("hidden");
    titleScreen.classList.add("hidden");
    onlinePanel.classList.add("hidden");
    offlineLevelPanel.classList.add("hidden");
    hud.classList.remove("hidden");
    lobbyHint.classList.add("hidden");
    if (hudOnlineMeta) hudOnlineMeta.classList.add("hidden");
    if (hudOnlineBadges) {
      hudOnlineBadges.classList.add("hidden");
      hudOnlineBadges.innerHTML = "";
    }
    const rect = canvas.getBoundingClientRect();
    mouse.x = rect.left + rect.width * 0.5;
    mouse.y = rect.top + rect.height * 0.5;
    resetOffline();
    mode = "offline";
    state = "play";
    if (shouldShowTutorial()) {
      startTutorial();
    }
  }

  function teardownSocket() {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    netState = null;
  }

  function connectOnline() {
    netStatus.textContent = "连接中…";
    teardownSocket();
    socket = io(socketOrigin(), { transports: ["websocket", "polling"] });
    socket.on("connect", () => {
      netStatus.textContent = "已连接";
      const roomId = (roomIdInput.value || "").trim().slice(0, 32) || "public";
      socket.emit("join", { roomId, clientKey: getClientKey() });
    });
    socket.on("connect_error", () => {
      netStatus.textContent = "无法连接服务器，请确认已运行 npm start（默认端口 3333）";
    });
    socket.on("disconnect", () => {
      if (mode === "online") netStatus.textContent = "连接已断开";
    });
    socket.on("state", (s) => {
      netState = s;
      if (mode === "online") {
        updateHudOnline();
        if (!s.matchOver) onlineMatchEndShown = false;
        else if (s.winnerId && !onlineMatchEndShown) {
          onlineMatchEndShown = true;
          showOnlineMatchOver(s.winnerId === "team" || s.winnerId === socket.id);
        }
      }
    });
    socket.on("hitFx", (d) => {
      if (!d || mode !== "online") return;
      if (d.capsize) {
        addScreenShake(16);
        addHitScatter(d.x, d.y, d.vx, d.vy, "impactHeavy");
        addParticles(d.x, d.y, "#b8e8ff", 36);
        return;
      }
      if (netState && socket && netState.players) {
        const me = netState.players.find((p) => p.id === socket.id);
        if (me && vecLen(d.x - me.x, d.y - me.y) < 80) {
          pushHitIndicator(Math.atan2(-(d.vy || 0.001), -(d.vx || 0.001)));
        }
      }
      const pal = d.kill ? "impactHeavy" : "impact";
      addHitScatter(d.x, d.y, d.vx, d.vy, pal);
    });
  }

  function showOnlineMatchOver(won) {
    state = "over";
    goTitle.textContent = won ? "通关！" : "本局结束";
    const short = (id) => (id ? id.slice(0, 8) : "?");
    if (netState && netState.winnerId === "team") {
      goMsg.textContent = "合作闯关完成，全部关卡已清空！";
    } else {
      goMsg.textContent = won
        ? "率先达到 " + (netState && netState.winKills ? netState.winKills : 10) + " 杀！"
        : "胜者：玩家 " + short(netState && netState.winnerId);
    }
    gameOverEl.classList.remove("hidden");
    if (btnReady) btnReady.classList.add("hidden");
  }

  function startOnlinePlay() {
    gameOverEl.classList.add("hidden");
    titleScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    lobbyHint.classList.remove("hidden");
    const rect = canvas.getBoundingClientRect();
    mouse.x = rect.left + rect.width * 0.5;
    mouse.y = rect.top + rect.height * 0.5;
    mode = "online";
    prevMyShotFx = 0;
    particles.length = 0;
    if (hudOnlineMeta) hudOnlineMeta.classList.remove("hidden");
    connectOnline();
  }

  function endGameOffline(won) {
    state = "over";
    goTitle.textContent = won ? "通关！" : "游戏结束";
    const nLv = OFFLINE_LEVELS.length;
    goMsg.textContent = won
      ? "得分 " + score + " — " +
        (offlineStartLevelIndex > 0
          ? "从第 " + (offlineStartLevelIndex + 1) + " 关起连胜至通关！"
          : "完成全部 " + nLv + " 关！")
      : "得分 " + score + " — 第 " + (offlineLevelIndex + 1) + " 关 · 第 " + wave + " 波";
    gameOverEl.classList.remove("hidden");
  }

  let state = "menu";

  function mergeArenaTheme(partial) {
    const t = JSON.parse(JSON.stringify(DEFAULT_ARENA_THEME));
    if (!partial) return t;
    if (partial.skyTop != null) t.skyTop = partial.skyTop;
    if (partial.skyMid != null) t.skyMid = partial.skyMid;
    if (partial.skyBot != null) t.skyBot = partial.skyBot;
    if (partial.waterStops) t.waterStops = partial.waterStops.map((s) => s.slice());
    if (partial.waveDeep) t.waveDeep = partial.waveDeep.slice();
    if (partial.waveMid) t.waveMid = partial.waveMid.slice();
    if (partial.waveFoam) t.waveFoam = partial.waveFoam.slice();
    if (partial.grid) t.grid = partial.grid.slice();
    if (partial.border) t.border = partial.border.slice();
    return t;
  }

  function getOfflineArenaTheme() {
    const lvl = OFFLINE_LEVELS[offlineLevelIndex];
    return mergeArenaTheme(lvl && lvl.arena);
  }

  function rgbaFrom4(tuple) {
    return "rgba(" + tuple[0] + "," + tuple[1] + "," + tuple[2] + "," + tuple[3] + ")";
  }

  function rgbaFrom3(rgb, alpha) {
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")";
  }

  function hexToRgb(hex) {
    const h = (hex || "#0a1428").replace("#", "");
    if (h.length !== 6) return [10, 20, 40];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function marginPaletteFromTheme(theme) {
    const th = theme != null ? theme : DEFAULT_ARENA_THEME;
    return {
      top: hexToRgb(th.skyTop),
      mid: hexToRgb(th.skyMid),
      bot: hexToRgb(th.skyBot),
      wave: th.waveMid.slice(),
      rim: th.border.slice(0, 3),
    };
  }

  function drawDecorBean(cx, cy, r, aim, hexFill, phase, tAnim) {
    const bob = Math.sin(tAnim * 2.1 + phase) * (r * 0.12);
    const sway = Math.sin(tAnim * 0.65 + phase * 1.7) * 0.12;
    ctx.save();
    ctx.translate(cx, cy + bob);
    ctx.rotate(aim + sway);
    ctx.fillStyle = hexFill;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.14, r * 0.2, 0, Math.PI * 2);
    ctx.arc(r * 0.3, -r * 0.14, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(20,24,32,0.92)";
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.14, r * 0.09, 0, Math.PI * 2);
    ctx.arc(r * 0.3, -r * 0.14, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = Math.max(1, r * 0.11);
    ctx.beginPath();
    ctx.moveTo(r * 0.32, r * 0.02);
    ctx.lineTo(r * 1.22, r * 0.02);
    ctx.stroke();
    ctx.strokeStyle = hexFill;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(1.2, r * 0.14);
    ctx.beginPath();
    ctx.arc(0, r * 0.35, r * 0.55, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawMarginWakeLine(yBase, cssW, tAnim, waveRgb, ampl, phase) {
    ctx.strokeStyle = rgbaFrom3(waveRgb, 0.14);
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    for (let x = 0; x <= cssW; x += 5) {
      const yy = yBase + Math.sin(x * 0.014 + tAnim * 2.2 + phase) * ampl;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
    ctx.strokeStyle = rgbaFrom3(waveRgb, 0.08);
    ctx.beginPath();
    for (let x = 0; x <= cssW; x += 5) {
      const yy = yBase + Math.sin(x * 0.011 + tAnim * 1.6 + phase + 1.2) * ampl * 0.7;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  function drawMarginDecor(cssW, cssH, ox, oy, s, theme) {
    const aw = W * s;
    const ah = H * s;
    const topH = oy;
    const botY = oy + ah;
    const botH = cssH - botY;
    const leftW = ox;
    const rightX = ox + aw;
    const rightW = cssW - rightX;
    if (topH < 0.5 && botH < 0.5 && leftW < 0.5 && rightW < 0.5) return;

    const pal = marginPaletteFromTheme(theme);
    const t = performance.now() * 0.001;

    ctx.save();

    function fillBand(x, y, bw, bh, leanTop) {
      if (bh < 0.5 || bw < 0.5) return;
      const g = leanTop
        ? ctx.createLinearGradient(0, y, 0, y + bh)
        : ctx.createLinearGradient(0, y + bh, 0, y);
      g.addColorStop(0, rgbaFrom3(pal.top, 0.92));
      g.addColorStop(0.55, rgbaFrom3(pal.mid, 0.88));
      g.addColorStop(1, rgbaFrom3(pal.bot, 0.82));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, bw, bh);
    }

    fillBand(0, 0, cssW, topH, true);
    fillBand(0, botY, cssW, botH, false);
    if (leftW > 0.5) fillBand(0, oy, leftW, ah, true);
    if (rightW > 0.5) fillBand(rightX, oy, rightW, ah, true);

    ctx.strokeStyle = rgbaFrom3(pal.rim, 0.22);
    ctx.lineWidth = 1;
    if (topH > 1) drawMarginWakeLine(topH - 6, cssW, t, pal.wave, 4.5, 0);
    if (botH > 1) drawMarginWakeLine(botY + 8, cssW, t, pal.wave, 4, 1.7);

    function beansInRect(rx, ry, rw, rh, count, seed) {
      if (rw < 28 || rh < 28) return;
      const cols = ["#4ecdc4", "#e94560", "#ffe66d", "#95e1d3"];
      for (let i = 0; i < count; i++) {
        const j = seed + i * 19.17;
        let u =
          0.12 +
          0.76 *
            (0.5 +
              0.5 * Math.sin(j + t * 0.35) +
              0.25 * Math.sin(t * 0.22 + i * 1.1));
        let v =
          0.1 +
          0.8 *
            (0.5 +
              0.5 * Math.cos(j * 0.8 + t * 0.28) +
              0.2 * Math.sin(t * 0.31 + i * 0.7));
        const br = 10 + (i % 3) * 2.5;
        u = Math.max(br / rw, Math.min(1 - br / rw, u));
        v = Math.max(br / rh, Math.min(1 - br / rh, v));
        const ux = rx + rw * u;
        const uy = ry + rh * v;
        const aim = t * 0.4 + i * 0.85;
        drawDecorBean(ux, uy, br, aim, cols[i % cols.length], j, t);
      }
    }

    const bn = Math.min(5, 2 + ((cssW + cssH) / 400) | 0);
    if (topH > 20) beansInRect(0, 0, cssW, topH, bn, 1.1);
    if (botH > 20) beansInRect(0, botY, cssW, botH, bn, 2.3);
    if (leftW > 20) beansInRect(0, oy, leftW, ah, bn - 1, 3.7);
    if (rightW > 20) beansInRect(rightX, oy, rightW, ah, bn - 1, 4.9);

    const step = 52;
    for (let x = step; x < cssW; x += step) {
      for (let y = step; y < cssH; y += step) {
        const inside = x >= ox && x <= ox + aw && y >= oy && y <= oy + ah;
        if (inside) continue;
        const ix = (x / step) | 0;
        const iy = (y / step) | 0;
        const n = Math.sin(ix * 2.1 + iy * 3.7 + t * 0.5) * 0.5 + 0.5;
        if (n <= 0.52) continue;
        const pr = 2.2 + (n - 0.52) * 5;
        ctx.fillStyle = rgbaFrom3(pal.wave, 0.12 + (n - 0.52) * 0.35);
        ctx.beginPath();
        ctx.ellipse(x, y, pr, pr * 0.88, (ix + iy + t) * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawArena(theme) {
    const th = theme != null ? theme : DEFAULT_ARENA_THEME;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.skyTop);
    g.addColorStop(0.55, th.skyMid);
    g.addColorStop(1, th.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const t = performance.now() * 0.001;

    const waterTop = H * 0.16;
    const gw = ctx.createLinearGradient(0, waterTop, 0, H);
    const ws = th.waterStops;
    gw.addColorStop(0, rgbaFrom4(ws[0]));
    gw.addColorStop(0.4, rgbaFrom4(ws[1]));
    gw.addColorStop(0.78, rgbaFrom4(ws[2]));
    gw.addColorStop(1, rgbaFrom4(ws[3]));
    ctx.fillStyle = gw;
    ctx.fillRect(0, waterTop, W, H - waterTop);

    function waveH(x, layer, amp) {
      const s = layer * 1.71;
      return (
        amp * Math.sin(x * 0.0068 - t * 1.55 + s) +
        amp * 0.58 * Math.sin(x * 0.0135 + t * 1.05 + s * 1.2) +
        amp * 0.35 * Math.sin(x * 0.024 - t * 1.75 + s * 0.6)
      );
    }

    function foamRnd(ix, iy) {
      const n = Math.sin(ix * 12.9898 + iy * 78.233 + t * 4.2) * 43758.5453;
      return n - Math.floor(n);
    }

    const layers = 6;
    const layerGap = (H - waterTop - 50) / layers;
    ctx.save();
    for (let L = 0; L < layers; L++) {
      const depth = L / layers;
      const base = waterTop + 40 + L * layerGap;
      const amp = 11 + L * 2.8;
      const hAt = function (x) {
        return waveH(x, L, amp);
      };

      ctx.strokeStyle = rgbaFrom3(th.waveDeep, 0.22 + depth * 0.18);
      ctx.lineWidth = 2.4 - depth * 0.45;
      ctx.beginPath();
      ctx.moveTo(0, base + hAt(0));
      for (let x = 4; x <= W; x += 4) {
        ctx.lineTo(x, base + hAt(x));
      }
      ctx.stroke();

      ctx.strokeStyle = rgbaFrom3(th.waveMid, 0.2 + depth * 0.12);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(0, base + hAt(0) + 5 + depth * 3);
      for (let x = 4; x <= W; x += 4) {
        ctx.lineTo(x, base + hAt(x) + 5 + depth * 3);
      }
      ctx.stroke();

      ctx.strokeStyle = rgbaFrom3(th.waveFoam, 0.14 + depth * 0.1);
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      let first = true;
      for (let x = 0; x <= W; x += 3) {
        const h = hAt(x);
        const crestLift = Math.max(0, h - amp * 0.25) * 0.22;
        const y = base + h - 3 - crestLift;
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      for (let x = 0; x <= W; x += 6) {
        const h = hAt(x);
        const hm = hAt(Math.max(0, x - 6));
        const hp = hAt(Math.min(W, x + 6));
        if (h > hm && h > hp && h > amp * 0.38) {
          const fy = base + h - 1;
          const fr = foamRnd(x, L);
          const rx = 3.5 + fr * 5;
          const ry = 1.6 + foamRnd(x + 1, L) * 2.2;
          ctx.fillStyle = rgbaFrom3(th.waveFoam, 0.1 + (h / amp) * 0.22);
          ctx.beginPath();
          ctx.ellipse(x, fy, rx, ry, (x * 0.02 + t + L) * 0.35, 0, Math.PI * 2);
          ctx.fill();
          if (foamRnd(x + 3, L) > 0.62) {
            ctx.strokeStyle = rgbaFrom3(th.waveFoam, 0.12 + depth * 0.08);
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(x - 2, fy - 4);
            ctx.lineTo(x + 3 + fr * 4, fy - 9 - depth * 2);
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();

    ctx.strokeStyle = rgbaFrom4(th.grid);
    ctx.lineWidth = 1;
    const grid = 48;
    for (let x = 0; x <= W; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.strokeStyle = rgbaFrom4(th.border);
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);
  }

  function addScreenShake(amt) {
    screenShake = Math.min(screenShake + amt, 11);
  }

  function addDirectedSparks(x, y, aimAngle, n, baseSpeed) {
    const spd = baseSpeed || 360;
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 1.8;
      const back = Math.PI + spread * 0.35;
      const a = aimAngle + back + (Math.random() - 0.5) * 0.9;
      const sp = spd * rand(0.45, 1.35);
      const hue =
        Math.random() < 0.5 ? "#fffef0" : Math.random() < 0.5 ? "#ffcc33" : "#ff8844";
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.12, 0.35),
        color: hue,
        size: rand(2, 5),
        drag: 0.88,
      });
    }
  }

  function drawMuzzleFlashLocal(muzzle, recoil) {
    if (muzzle <= 0.02) return;
    const s = Math.min(muzzle * 1.25, 1.35);
    const kick = (recoil || 0) * 10;
    const pulse = performance.now() * 0.018;
    const wobble = Math.sin(pulse) * 3 * s;
    ctx.save();
    ctx.translate(34 - kick + wobble, Math.sin(pulse * 1.3) * 2 * s);
    ctx.rotate(Math.sin(pulse * 0.9) * 0.12 * s);

    const rg = ctx.createRadialGradient(4, 0, 0, 4, 0, 42 * s);
    rg.addColorStop(0, "rgba(255,255,255," + (0.95 * s) + ")");
    rg.addColorStop(0.25, "rgba(255,240,140," + (0.65 * s) + ")");
    rg.addColorStop(0.55, "rgba(255,120,40," + (0.35 * s) + ")");
    rg.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(4, 0, 44 * s, 0, Math.PI * 2);
    ctx.fill();

    const spikes = 16;
    ctx.fillStyle = "rgba(255, 252, 220, " + (0.88 * s) + ")";
    ctx.beginPath();
    ctx.moveTo(16 * s, 0);
    for (let i = 0; i <= spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const rad = (i % 2 === 0 ? 26 : 12) * s;
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 220, 100, " + (0.85 * s) + ")";
    ctx.lineWidth = 3;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + pulse * 0.5;
      const len = (22 + (k % 3) * 8) * s;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(6 + Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(120, 220, 255, " + (0.55 * s) + ")";
    ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * (32 * s), Math.sin(a) * (32 * s));
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255, 255, 255, " + s + ")";
    ctx.beginPath();
    ctx.ellipse(8, 0, 10 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, " + (0.6 * s) + ")";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(6, 0, 18 * s, -0.5, 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(6, 0, 28 * s, -0.35, 0.35);
    ctx.stroke();

    ctx.restore();
  }

  function drawPistolLocal(recoil, muzzle) {
    const kick = (recoil || 0) * 22;
    ctx.save();
    ctx.translate(-kick, 0);
    ctx.scale(GUN_SCALE, GUN_SCALE);
    ctx.fillStyle = "#2a2a32";
    ctx.strokeStyle = "#15151a";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-2, 4);
    ctx.lineTo(-8, 10);
    ctx.lineTo(-10, 18);
    ctx.lineTo(-4, 20);
    ctx.lineTo(2, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#4a4a55";
    ctx.fillRect(0, -5, 26, 10);
    ctx.strokeRect(0, -5, 26, 10);
    ctx.fillStyle = "#1a1a22";
    ctx.fillRect(20, -4, 10, 8);
    ctx.fillStyle = "#d4a01a";
    ctx.fillRect(16, -2, 10, 2);
    drawMuzzleFlashLocal(muzzle, recoil);
    ctx.restore();
  }

  function getPlayerMuzzleWorld(x, y, angle, r, recoil) {
    const bx = -2;
    const by = -16;
    const gx = bx + r * 0.5;
    const gy = by + 4;
    const kick = (recoil || 0) * 22;
    const lx = gx - kick + 34 * GUN_SCALE;
    const ly = gy;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    return {
      x: x + lx * ca - ly * sa,
      y: y + lx * sa + ly * ca,
    };
  }

  function drawBoatDeckAt(x, y, scale) {
    scale = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.scale(BOAT_HULL_SCALE, BOAT_HULL_SCALE);
    ctx.fillStyle = "#3d2e22";
    ctx.strokeStyle = "#241a12";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-34, 8);
    ctx.quadraticCurveTo(-24, 18, -6, 16);
    ctx.quadraticCurveTo(14, 14, 28, 6);
    ctx.quadraticCurveTo(32, -2, 22, -10);
    ctx.quadraticCurveTo(0, -14, -22, -8);
    ctx.quadraticCurveTo(-36, 0, -34, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-20, 2);
    ctx.quadraticCurveTo(4, -4, 20, 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoatBeanOnly(x, y, r, color, angle, opts) {
    opts = opts || {};
    const eyeOffset = opts.eyeOffset || 0;
    const muzzle = opts.muzzleFlash != null ? opts.muzzleFlash : 0;
    const recoil = opts.gunRecoil != null ? opts.gunRecoil : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const bx = -2;
    const by = -16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(bx, by, r, r * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(bx, by + r * 0.35, r * 0.85, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const ex = r * 0.35 + eyeOffset;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(bx + ex, by - r * 0.15, r * 0.22, 0, Math.PI * 2);
    ctx.arc(bx - ex, by - r * 0.15, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(bx + ex + 2, by - r * 0.12, r * 0.1, 0, Math.PI * 2);
    ctx.arc(bx - ex + 2, by - r * 0.12, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

    const gx = bx + r * 0.5;
    const gy = by + 4;
    ctx.save();
    ctx.translate(gx, gy);
    drawPistolLocal(recoil, muzzle);
    ctx.restore();

    // Strong forward cue: nose marker + short aim guide
    ctx.strokeStyle = "rgba(255,255,255,0.78)";
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.beginPath();
    ctx.moveTo(r * 0.9, -r * 0.1);
    ctx.lineTo(r * 1.65, -r * 0.1);
    ctx.stroke();
    ctx.fillStyle = "#ffe66d";
    ctx.beginPath();
    ctx.moveTo(r * 1.8, -r * 0.1);
    ctx.lineTo(r * 1.48, -r * 0.3);
    ctx.lineTo(r * 1.48, r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255, 236, 150, 0.45)";
    ctx.beginPath();
    ctx.ellipse(r * 1.95, -r * 0.1, r * 0.22, r * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawBoatBean(x, y, r, color, angle, opts) {
    opts = opts || {};
    if (opts.beanOnly) {
      drawBoatBeanOnly(x, y, r, color, angle, opts);
      return;
    }
    const eyeOffset = opts.eyeOffset || 0;
    const muzzle = opts.muzzleFlash != null ? opts.muzzleFlash : 0;
    const recoil = opts.gunRecoil != null ? opts.gunRecoil : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.save();
    ctx.scale(BOAT_HULL_SCALE, BOAT_HULL_SCALE);
    ctx.fillStyle = "#3d2e22";
    ctx.strokeStyle = "#241a12";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-34, 8);
    ctx.quadraticCurveTo(-24, 18, -6, 16);
    ctx.quadraticCurveTo(14, 14, 28, 6);
    ctx.quadraticCurveTo(32, -2, 22, -10);
    ctx.quadraticCurveTo(0, -14, -22, -8);
    ctx.quadraticCurveTo(-36, 0, -34, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-20, 2);
    ctx.quadraticCurveTo(4, -4, 20, 2);
    ctx.stroke();
    ctx.restore();

    const bx = -2;
    const by = -16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(bx, by, r, r * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(bx, by + r * 0.35, r * 0.85, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const ex = r * 0.35 + eyeOffset;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(bx + ex, by - r * 0.15, r * 0.22, 0, Math.PI * 2);
    ctx.arc(bx - ex, by - r * 0.15, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(bx + ex + 2, by - r * 0.12, r * 0.1, 0, Math.PI * 2);
    ctx.arc(bx - ex + 2, by - r * 0.12, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

    const gx = bx + r * 0.5;
    const gy = by + 4;
    ctx.save();
    ctx.translate(gx, gy);
    drawPistolLocal(recoil, muzzle);
    ctx.restore();

    // Strong forward cue: nose marker + short aim guide
    ctx.strokeStyle = "rgba(255,255,255,0.78)";
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.beginPath();
    ctx.moveTo(r * 0.9, -r * 0.1);
    ctx.lineTo(r * 1.65, -r * 0.1);
    ctx.stroke();
    ctx.fillStyle = "#ffe66d";
    ctx.beginPath();
    ctx.moveTo(r * 1.8, -r * 0.1);
    ctx.lineTo(r * 1.48, -r * 0.3);
    ctx.lineTo(r * 1.48, r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255, 236, 150, 0.45)";
    ctx.beginPath();
    ctx.ellipse(r * 1.95, -r * 0.1, r * 0.22, r * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function addParticles(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(80, 220);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.2, 0.45),
        color,
      });
    }
  }

  function pushHitIndicator(angle, ttl) {
    hitIndicators.push({
      angle,
      ttl: ttl != null ? ttl : 0.75,
      life: ttl != null ? ttl : 0.75,
    });
    if (hitIndicators.length > 8) hitIndicators.splice(0, hitIndicators.length - 8);
  }

  function updateHitIndicators(dt) {
    for (let i = hitIndicators.length - 1; i >= 0; i--) {
      const h = hitIndicators[i];
      h.ttl -= dt;
      if (h.ttl <= 0) hitIndicators.splice(i, 1);
    }
  }

  function drawHitIndicatorsAt(cx, cy) {
    for (const h of hitIndicators) {
      const a = Math.max(0, Math.min(1, h.ttl / h.life));
      const r = 40;
      const x = cx + Math.cos(h.angle) * r;
      const y = cy + Math.sin(h.angle) * r;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(h.angle);
      ctx.globalAlpha = 0.2 + a * 0.8;
      ctx.fillStyle = "rgba(255,86,86,0.95)";
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-8, -7);
      ctx.lineTo(-8, 7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,220,220,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(-4, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function addHitScatter(x, y, bvx, bvy, palette) {
    const blues = ["#f0ffff", "#b8f5ee", "#6ee7de", "#4ecdc4", "#2a8a82"];
    const reds = ["#ffffff", "#ffd0d0", "#ff9a9a", "#ff6b6b", "#c92a2a"];
    const impact = ["#fffef5", "#fff3c4", "#ffc978", "#ff8a50", "#e8a088"];
    const heavy = ["#ffffff", "#fffde7", "#ffeb3b", "#ff9100", "#ff5722"];
    let colors;
    let count = 24;
    let sparkMul = 1;
    if (palette === "victimPlayer") colors = blues;
    else if (palette === "victimEnemy") colors = reds;
    else if (palette === "impactHeavy") {
      colors = heavy;
      count = 38;
      sparkMul = 1.2;
    } else {
      colors = impact;
    }
    const base = Math.atan2(bvy || 0.001, bvx || 0.001);
    const spawnR = 12;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 2.45;
      const forward = base + (Math.random() - 0.45) * 0.75;
      const back = base + Math.PI + (Math.random() - 0.5) * 1.25;
      const useForward = Math.random() < 0.3;
      const a = useForward ? forward + spread * 0.42 : back + spread * 0.62;
      const sp = rand(90, 340) * sparkMul;
      particles.push({
        x: x + (Math.random() - 0.5) * spawnR,
        y: y + (Math.random() - 0.5) * spawnR,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.18, 0.55),
        color: colors[(Math.random() * colors.length) | 0],
        size: rand(1, 4.5),
        drag: rand(0.91, 0.97),
        spin: rand(-18, 18),
        rot: Math.random() * Math.PI * 2,
      });
    }
    const sparks = Math.ceil(14 * sparkMul);
    for (let i = 0; i < sparks; i++) {
      const a = base + (Math.random() - 0.5) * 3.35;
      const sp = rand(180, 460) * sparkMul;
      particles.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(a) * sp * 0.92,
        vy: Math.sin(a) * sp * 0.92,
        life: rand(0.08, 0.22),
        color: Math.random() < 0.62 ? "#ffffff" : "#fff9c4",
        size: rand(0.8, 2.2),
        drag: 0.86,
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.spin != null) p.rot = (p.rot || 0) + p.spin * dt;
      if (p.drag) {
        const d = Math.pow(p.drag, dt * 55);
        p.vx *= d;
        p.vy *= d;
      } else {
        p.vy += 400 * dt;
      }
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticlesBatch() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 3.2));
      ctx.fillStyle = p.color;
      const sz = p.size != null ? p.size : 3;
      if (p.spin != null) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillRect(-sz, -sz * 0.45, sz * 2, sz * 0.9);
        ctx.restore();
      } else {
        ctx.fillRect(p.x - sz, p.y - sz, sz * 2, sz * 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  function updateOffline(dt) {
    if (mode !== "offline" || state !== "play") return;
    if (tutorialActive) return;
    if (offlineWaveClearPending) return;

    const p = clientToArena(mouse.x, mouse.y);
    const mx = p.x;
    const my = p.y;
    player.angle = Math.atan2(my - player.y, mx - player.x);

    if (player.invuln > 0) player.invuln -= dt;
    if (player.shootCd > 0) player.shootCd -= dt;
    player.muzzleFlash = Math.max(0, player.muzzleFlash - dt * 9);
    player.gunRecoil = Math.max(0, player.gunRecoil - dt * 3.2);

    const loX = player.r + 4;
    const hiX = W - player.r - 4;
    const loY = player.r + 4;
    const hiY = H - player.r - 4;

    const drag = Math.pow(WATER_DRAG, dt * 60);
    player.vx *= drag;
    player.vy *= drag;

    player.floatT = (player.floatT || 0) + dt;
    if (!mouse.down) {
      const t = player.floatT + (player.floatOff || 0);
      const tx = FLOAT_DRIFT_SPEED * Math.sin(t * FLOAT_FREQ_A);
      const ty = FLOAT_DRIFT_SPEED * Math.cos(t * FLOAT_FREQ_B);
      player.vx += (tx - player.vx) * FLOAT_LERP * dt;
      player.vy += (ty - player.vy) * FLOAT_LERP * dt;
    }

    if (offlineBuffs && offlineBuffs.shotgunT > 0) {
      offlineBuffs.shotgunT = Math.max(0, offlineBuffs.shotgunT - dt);
    }
    if (offlineBuffs && offlineBuffs.shieldT > 0) {
      offlineBuffs.shieldT = Math.max(0, offlineBuffs.shieldT - dt);
    }
    if (offlineBuffs && offlineBuffs.rapidfireT > 0) {
      offlineBuffs.rapidfireT = Math.max(0, offlineBuffs.rapidfireT - dt);
    }
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pk = pickups[i];
      pk.life -= dt;
      if (pk.life <= 0) {
        pickups.splice(i, 1);
        continue;
      }
      const pickR =
        PICKUP_AUTO_PICK_RADIUS * (1 + (offlinePerks ? offlinePerks.pickupRadiusBonus : 0));
      if (vecLen(pk.x - player.x, pk.y - player.y) <= pickR) {
        applyOfflinePickup(pk.type);
        pickups.splice(i, 1);
      }
    }

    if (mouse.down && player.shootCd <= 0) {
      let dir = normalize(Math.cos(player.angle), Math.sin(player.angle));
      const eps = WALL_TOUCH_EPS;
      let kick = RECOIL_IMPULSE * (offlinePerks ? offlinePerks.recoilMul : 1);
      const atLeft = player.x <= loX + eps;
      const atRight = player.x >= hiX - eps;
      const atTop = player.y <= loY + eps;
      const atBottom = player.y >= hiY - eps;
      let awayX = 0;
      let awayY = 0;
      const dl = player.x - loX;
      const dr = hiX - player.x;
      const dtp = player.y - loY;
      const db = hiY - player.y;
      if (dl < WALL_TURN_ASSIST_ZONE) awayX += 1;
      if (dr < WALL_TURN_ASSIST_ZONE) awayX -= 1;
      if (dtp < WALL_TURN_ASSIST_ZONE) awayY += 1;
      if (db < WALL_TURN_ASSIST_ZONE) awayY -= 1;
      if (awayX !== 0 || awayY !== 0) {
        const away = normalize(awayX, awayY);
        const dot = dir.x * away.x + dir.y * away.y;
        if (dot < 0) {
          const edgeK =
            Math.max(
              Math.max(0, (WALL_TURN_ASSIST_ZONE - dl) / WALL_TURN_ASSIST_ZONE),
              Math.max(0, (WALL_TURN_ASSIST_ZONE - dr) / WALL_TURN_ASSIST_ZONE),
              Math.max(0, (WALL_TURN_ASSIST_ZONE - dtp) / WALL_TURN_ASSIST_ZONE),
              Math.max(0, (WALL_TURN_ASSIST_ZONE - db) / WALL_TURN_ASSIST_ZONE)
            ) * WALL_TURN_ASSIST;
          dir = normalize(
            dir.x * (1 - edgeK) + away.x * edgeK,
            dir.y * (1 - edgeK) + away.y * edgeK
          );
        }
      }
      let wallBoost = 1;
      if (atLeft && dir.x < 0) wallBoost = Math.max(wallBoost, WALL_KICK_MULT);
      if (atRight && dir.x > 0) wallBoost = Math.max(wallBoost, WALL_KICK_MULT);
      if (atTop && dir.y < 0) wallBoost = Math.max(wallBoost, WALL_KICK_MULT);
      if (atBottom && dir.y > 0) wallBoost = Math.max(wallBoost, WALL_KICK_MULT);
      kick *= wallBoost;

      const mz = getPlayerMuzzleWorld(player.x, player.y, player.angle, player.r, player.gunRecoil);
      const mzx = mz.x;
      const mzy = mz.y;
      const shotgunOn = offlineBuffs && offlineBuffs.shotgunT > 0;
      if (shotgunOn) {
        const baseA = Math.atan2(dir.y, dir.x);
        const spreads = [-0.279, -0.139, 0, 0.139, 0.279];
        for (const s of spreads) {
          const a = baseA + s;
          bullets.push({
            x: mzx,
            y: mzy,
            vx: Math.cos(a) * PLAYER_BULLET_SPEED * (offlinePerks ? offlinePerks.bulletSpeedMul : 1) * 0.92,
            vy: Math.sin(a) * PLAYER_BULLET_SPEED * (offlinePerks ? offlinePerks.bulletSpeedMul : 1) * 0.92,
            from: "player",
            life: 1.2 * 0.78,
            damage: 0.55,
            shotgun: true,
          });
        }
      } else {
        bullets.push({
          x: mzx,
          y: mzy,
          vx: dir.x * PLAYER_BULLET_SPEED * (offlinePerks ? offlinePerks.bulletSpeedMul : 1),
          vy: dir.y * PLAYER_BULLET_SPEED * (offlinePerks ? offlinePerks.bulletSpeedMul : 1),
          from: "player",
          life: 1.2,
          damage: 1,
        });
      }
      const rapidMul = offlineBuffs && offlineBuffs.rapidfireT > 0 ? 1.4 : 1;
      player.shootCd = PLAYER_SHOOT_CD / ((offlinePerks ? offlinePerks.fireRateMul : 1) * rapidMul);
      player.muzzleFlash = 1.18;
      player.gunRecoil = 0.45;
      player.vx -= dir.x * kick;
      player.vy -= dir.y * kick;
      const psp = vecLen(player.vx, player.vy);
      if (psp > MAX_PLAYER_SPEED) {
        const k = MAX_PLAYER_SPEED / psp;
        player.vx *= k;
        player.vy *= k;
      }
      if (atLeft && dir.x < 0) player.x += WALL_POP_PX;
      if (atRight && dir.x > 0) player.x -= WALL_POP_PX;
      if (atTop && dir.y < 0) player.y += WALL_POP_PX;
      if (atBottom && dir.y > 0) player.y -= WALL_POP_PX;
      addScreenShake(3.8);
      addParticles(mzx, mzy, "#fffef5", 14);
      addDirectedSparks(mzx, mzy, player.angle, 22, 480);
    }

    if (player.x - loX < EDGE_REPEL_ZONE) {
      const k = (EDGE_REPEL_ZONE - (player.x - loX)) / EDGE_REPEL_ZONE;
      player.vx += EDGE_REPEL_FORCE * k * dt;
    }
    if (hiX - player.x < EDGE_REPEL_ZONE) {
      const k = (EDGE_REPEL_ZONE - (hiX - player.x)) / EDGE_REPEL_ZONE;
      player.vx -= EDGE_REPEL_FORCE * k * dt;
    }
    if (player.y - loY < EDGE_REPEL_ZONE) {
      const k = (EDGE_REPEL_ZONE - (player.y - loY)) / EDGE_REPEL_ZONE;
      player.vy += EDGE_REPEL_FORCE * k * dt;
    }
    if (hiY - player.y < EDGE_REPEL_ZONE) {
      const k = (EDGE_REPEL_ZONE - (hiY - player.y)) / EDGE_REPEL_ZONE;
      player.vy -= EDGE_REPEL_FORCE * k * dt;
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;
    if (player.x - loX < WALL_AUTO_POP_ZONE) {
      const k = (WALL_AUTO_POP_ZONE - (player.x - loX)) / WALL_AUTO_POP_ZONE;
      player.vx += WALL_AUTO_POP_PUSH * k * dt;
    }
    if (hiX - player.x < WALL_AUTO_POP_ZONE) {
      const k = (WALL_AUTO_POP_ZONE - (hiX - player.x)) / WALL_AUTO_POP_ZONE;
      player.vx -= WALL_AUTO_POP_PUSH * k * dt;
    }
    if (player.y - loY < WALL_AUTO_POP_ZONE) {
      const k = (WALL_AUTO_POP_ZONE - (player.y - loY)) / WALL_AUTO_POP_ZONE;
      player.vy += WALL_AUTO_POP_PUSH * k * dt;
    }
    if (hiY - player.y < WALL_AUTO_POP_ZONE) {
      const k = (WALL_AUTO_POP_ZONE - (hiY - player.y)) / WALL_AUTO_POP_ZONE;
      player.vy -= WALL_AUTO_POP_PUSH * k * dt;
    }
    if (player.x <= loX) {
      player.x = loX;
      if (player.vx < 0) player.vx = 0;
    }
    if (player.x >= hiX) {
      player.x = hiX;
      if (player.vx > 0) player.vx = 0;
    }
    if (player.y <= loY) {
      player.y = loY;
      if (player.vy < 0) player.vy = 0;
    }
    if (player.y >= hiY) {
      player.y = hiY;
      if (player.vy > 0) player.vy = 0;
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20 || b.life <= 0) {
        bullets.splice(i, 1);
        continue;
      }
      if (b.from === "enemy") {
        const d = vecLen(b.x - player.x, b.y - player.y);
        const shieldOn = offlineBuffs && offlineBuffs.shieldT > 0;
        if (d < player.r + 4 && player.invuln <= 0 && !shieldOn) {
          player.hp--;
          player.invuln = 1;
          pushHitIndicator(Math.atan2(-(b.vy || 0.001), -(b.vx || 0.001)));
          addHitScatter(
            b.x,
            b.y,
            b.vx,
            b.vy,
            player.hp <= 0 ? "impactHeavy" : "victimPlayer"
          );
          bullets.splice(i, 1);
          updateHealthHudOffline();
          if (player.hp <= 0) endGameOffline(false);
        }
      }
    }

    if (!OFFLINE_ENEMIES_DISABLED) {
      for (const e of enemies) {
        e.muzzleFlash = Math.max(0, e.muzzleFlash - dt * 9);
        e.gunRecoil = Math.max(0, e.gunRecoil - dt * 3.2);
        const dir = normalize(player.x - e.x, player.y - e.y);
        e.x += dir.x * e.speed * dt;
        e.y += dir.y * e.speed * dt;
        e.shootCd -= dt;
        const eRange = e.shootRange != null ? e.shootRange : 420;
        const eBulletSpd = e.bulletSpeed != null ? e.bulletSpeed : 340;
        const eCd0 = e.shootCdMin != null ? e.shootCdMin : 0.9;
        const eCd1 = e.shootCdMax != null ? e.shootCdMax : 1.8;
        if (e.shootCd <= 0 && vecLen(player.x - e.x, player.y - e.y) < eRange) {
          const bd = normalize(player.x - e.x, player.y - e.y);
          const md = e.r + 18;
          const enemyBulletMul = 0.78;
          bullets.push({
            x: e.x + bd.x * md,
            y: e.y + bd.y * md,
            vx: bd.x * eBulletSpd * enemyBulletMul,
            vy: bd.y * eBulletSpd * enemyBulletMul,
            from: "enemy",
            life: 1.5,
          });
          e.shootCd = rand(eCd0, eCd1);
          e.muzzleFlash = 1.12;
          e.gunRecoil = 0.4;
          const ex = e.x + bd.x * md;
          const ey = e.y + bd.y * md;
          addParticles(ex, ey, "#ffe0c8", 12);
          addDirectedSparks(ex, ey, Math.atan2(bd.y, bd.x), 16, 340);
          addScreenShake(1.9);
        }
      }

      // Prevent enemy beans from passing through each other.
      for (let i = 0; i < enemies.length; i++) {
        for (let j = i + 1; j < enemies.length; j++) {
          const a = enemies[i];
          const b = enemies[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.0001;
          const minD = a.r + b.r + 2;
          if (d < minD) {
            const overlap = (minD - d) * 0.5;
            const nx = dx / d;
            const ny = dy / d;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
          }
        }
      }

      outer: for (let bi = bullets.length - 1; bi >= 0; bi--) {
        const b = bullets[bi];
        if (b.from !== "player") continue;
        for (let ei = enemies.length - 1; ei >= 0; ei--) {
          const e = enemies[ei];
          if (vecLen(b.x - e.x, b.y - e.y) < e.r + 6) {
            e.hp -= b.damage != null ? b.damage : 1;
            bullets.splice(bi, 1);
            addHitScatter(b.x, b.y, b.vx, b.vy, e.hp <= 0 ? "impactHeavy" : "victimEnemy");
            if (e.hp <= 0) {
              if (Math.random() < PICKUP_DROP_BASE || e.r >= 26 || e.hp <= -4) {
                pickups.push({
                  type: randomPickupTypeOffline(),
                  x: e.x + rand(-14, 14),
                  y: e.y + rand(-14, 14),
                  life: PICKUP_LIFE,
                });
                if (pickups.length > 6) pickups.splice(0, pickups.length - 6);
              }
              enemies.splice(ei, 1);
              score += 100;
              hudScore.textContent = "得分 " + score;
            }
            continue outer;
          }
        }
      }

      if (enemies.length === 0) {
        offlineWaveClearPending = true;
        openOfflinePerkChoice();
      }
    }
  }

  function renderOffline() {
    beginArenaCanvas(getOfflineArenaTheme());
    const t = performance.now() * 0.02;
    const sh = screenShake;
    ctx.save();
    ctx.translate(Math.sin(t * 6.2) * sh * 0.18, Math.cos(t * 5.1) * sh * 0.16);

    drawArena(getOfflineArenaTheme());
    if (!OFFLINE_ENEMIES_DISABLED) {
      for (const e of enemies) {
        const ang = Math.atan2(player.y - e.y, player.x - e.x);
        drawBoatBean(e.x, e.y, e.r, "#e94560", ang, {
          eyeOffset: 0,
          muzzleFlash: e.muzzleFlash,
          gunRecoil: e.gunRecoil,
        });
      }
    }
    const flash = player.invuln > 0 && (performance.now() / 100) % 2 < 1;
    if (flash) ctx.globalAlpha = 0.45;
    drawBoatBean(player.x, player.y, player.r, "#4ecdc4", player.angle, {
      eyeOffset: 1,
      muzzleFlash: player.muzzleFlash,
      gunRecoil: player.gunRecoil,
    });
    if (flash) ctx.globalAlpha = 1;

    for (const b of bullets) {
      const pl = b.from === "player";
      const g = ctx.createLinearGradient(
        b.x - b.vx * 0.06,
        b.y - b.vy * 0.06,
        b.x,
        b.y
      );
      if (pl) {
        if (b.shotgun) {
          g.addColorStop(0, "rgba(255, 210, 140, 0)");
          g.addColorStop(0.4, "rgba(255, 170, 90, 0.5)");
          g.addColorStop(1, "rgba(255, 130, 60, 0.9)");
        } else {
          g.addColorStop(0, "rgba(255, 250, 200, 0)");
          g.addColorStop(0.4, "rgba(255, 240, 120, 0.45)");
          g.addColorStop(1, "rgba(255, 220, 80, 0.85)");
        }
      } else {
        g.addColorStop(0, "rgba(255, 200, 160, 0)");
        g.addColorStop(0.45, "rgba(255, 140, 100, 0.5)");
        g.addColorStop(1, "rgba(255, 100, 60, 0.85)");
      }
      ctx.strokeStyle = g;
      ctx.lineWidth = pl ? 4 : 3;
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.055, b.y - b.vy * 0.055);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = pl ? "rgba(255, 255, 220, 0.65)" : "rgba(255, 200, 160, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.04, b.y - b.vy * 0.04);
      ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
      ctx.stroke();
      ctx.fillStyle = pl ? "#fff8c0" : "#ffbc90";
      if (pl && b.shotgun) ctx.fillStyle = "#ffba7a";
      ctx.beginPath();
      ctx.arc(b.x, b.y, pl ? 4.8 : 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pl ? "#ffffff" : "#ffe8d0";
      if (pl && b.shotgun) ctx.fillStyle = "#fff1d8";
      ctx.beginPath();
      ctx.arc(b.x - b.vx * 0.008, b.y - b.vy * 0.008, pl ? 2.4 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const pk of pickups) {
      const blink = pk.life < 2.5 && (performance.now() / 120) % 2 < 1;
      if (blink) ctx.globalAlpha = 0.45;
      if (pk.type === "shotgun") {
        ctx.fillStyle = "rgba(255,175,80,0.18)";
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,185,95,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pk.x - 10, pk.y + 6);
        ctx.lineTo(pk.x + 10, pk.y - 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pk.x - 10, pk.y - 2);
        ctx.lineTo(pk.x + 10, pk.y - 10);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pk.x - 10, pk.y + 12);
        ctx.lineTo(pk.x + 10, pk.y + 2);
        ctx.stroke();
      } else if (pk.type === "shield") {
        ctx.fillStyle = "rgba(80,170,255,0.16)";
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(125,200,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 10, Math.PI * 0.2, Math.PI * 1.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pk.x, pk.y - 10);
        ctx.lineTo(pk.x, pk.y + 10);
        ctx.stroke();
      } else if (pk.type === "rapidfire") {
        ctx.fillStyle = "rgba(255,120,80,0.16)";
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,170,120,0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pk.x - 8, pk.y + 8);
        ctx.lineTo(pk.x - 1, pk.y - 8);
        ctx.lineTo(pk.x + 2, pk.y - 1);
        ctx.lineTo(pk.x + 8, pk.y - 1);
        ctx.lineTo(pk.x + 1, pk.y + 8);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    drawHitIndicatorsAt(player.x, player.y);
    drawParticlesBatch();
    if (mode === "offline" && state === "play" && !OFFLINE_ENEMIES_DISABLED) {
      const lvl = OFFLINE_LEVELS[offlineLevelIndex];
      let subtitle = lvl
        ? lvl.title + " · 第 " + wave + "/" + lvl.waves.length + " 波 · 关 " + (offlineLevelIndex + 1) + "/" + OFFLINE_LEVELS.length
        : "第 " + wave + " 波";
      if (offlineBuffs && offlineBuffs.shotgunT > 0) {
        subtitle += " · 散弹 " + offlineBuffs.shotgunT.toFixed(1) + "s";
      }
      if (offlineBuffs && offlineBuffs.shieldT > 0) {
        subtitle += " · 护盾 " + offlineBuffs.shieldT.toFixed(1) + "s";
      }
      if (offlineBuffs && offlineBuffs.rapidfireT > 0) {
        subtitle += " · 快射 " + offlineBuffs.rapidfireT.toFixed(1) + "s";
      }
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.font = "13px sans-serif";
      ctx.fillText(subtitle, 12, H - 12);
    }
    ctx.restore();
  }

  function renderOnline() {
    beginArenaCanvas(null);
    const t = performance.now() * 0.02;
    const sh = screenShake;
    ctx.save();
    ctx.translate(Math.sin(t * 6.2) * sh * 0.18, Math.cos(t * 5.1) * sh * 0.16);

    drawArena(null);
    if (!netState || !netState.players) {
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("等待服务器数据…", W / 2, H / 2);
      ctx.textAlign = "left";
      ctx.restore();
      return;
    }
    const mePl = netState.players.find((q) => socket && q.id === socket.id);
    if (mePl && mePl.shotFx > 0.82 && prevMyShotFx < 0.38) addScreenShake(2.7);
    prevMyShotFx = mePl ? mePl.shotFx : 0;

    const colors = netState.colors || [];
    const deck = netState.boat;
    const crewR = deck ? 8 : PR;
    function drawOnlineCrew() {
      for (const p of netState.players) {
        if (p.respawnMs > 0 && p.hp <= 0) continue;
        const col = colors[p.colorIndex] || "#888";
        const flash = p.invuln > 0 && (performance.now() / 100) % 2 < 1;
        const sfx = p.shotFx != null ? p.shotFx : 0;
        if (flash) ctx.globalAlpha = 0.45;
        drawBoatBean(p.x, p.y, crewR, col, p.angle, {
          beanOnly: !!deck,
          eyeOffset: socket && p.id === socket.id ? 1 : 0,
          muzzleFlash: sfx * 1.08,
          gunRecoil: sfx * 0.32,
        });
        ctx.globalAlpha = 1;
        if (socket && p.id === socket.id) {
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, crewR + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    if (deck) {
      const bx = deck.x;
      const by = deck.y;
      const lean = (deck.tilt || 0) * 0.48 * Math.sin(performance.now() * 0.0035);
      const flip =
        Math.min(1, (deck.capsizeFx || 0) / ONLINE_CAPSIZE_FX_MAX) * Math.PI * 0.88;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(lean + flip);
      ctx.translate(-bx, -by);
      drawBoatDeckAt(bx, by, 1.08);
      drawOnlineCrew();
      ctx.restore();
      if (deck.capsizeFx > 0.35 && prevOnlineCapsizeFx < 0.12) addScreenShake(9);
      prevOnlineCapsizeFx = deck.capsizeFx || 0;
    } else {
      prevOnlineCapsizeFx = 0;
      drawOnlineCrew();
    }
    for (const e of netState.enemies || []) {
      const ec =
        e.type === "turret"
          ? "#ff9f43"
          : e.type === "charger"
            ? "#ff5e7e"
            : e.type === "boss"
              ? "#c77dff"
              : "#e94560";
      const ang = Math.atan2(deck ? deck.y - e.y : H * 0.75 - e.y, deck ? deck.x - e.x : W * 0.5 - e.x);
      drawBoatBean(e.x, e.y, e.r || 20, ec, ang, {
        eyeOffset: 0,
        muzzleFlash: e.muzzleFlash || 0,
        gunRecoil: e.gunRecoil || 0,
      });
    }
    for (const b of netState.bullets || []) {
      const vx = b.vx != null ? b.vx : 0;
      const vy = b.vy != null ? b.vy : 0;
      const pl = b.from !== "enemy";
      const g = ctx.createLinearGradient(b.x - vx * 0.06, b.y - vy * 0.06, b.x, b.y);
      if (pl) {
        if (b.shotgun) {
          g.addColorStop(0, "rgba(255, 210, 140, 0)");
          g.addColorStop(0.4, "rgba(255, 170, 90, 0.5)");
          g.addColorStop(1, "rgba(255, 130, 60, 0.9)");
        } else {
          g.addColorStop(0, "rgba(255, 250, 200, 0)");
          g.addColorStop(0.4, "rgba(255, 240, 120, 0.45)");
          g.addColorStop(1, "rgba(255, 220, 80, 0.85)");
        }
      } else {
        g.addColorStop(0, "rgba(255, 200, 160, 0)");
        g.addColorStop(0.45, "rgba(255, 140, 100, 0.5)");
        g.addColorStop(1, "rgba(255, 100, 60, 0.85)");
      }
      ctx.strokeStyle = g;
      ctx.lineWidth = pl ? 4 : 3;
      ctx.beginPath();
      ctx.moveTo(b.x - vx * 0.055, b.y - vy * 0.055);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = pl ? "rgba(255, 255, 220, 0.65)" : "rgba(255, 200, 160, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x - vx * 0.04, b.y - vy * 0.04);
      ctx.lineTo(b.x - vx * 0.012, b.y - vy * 0.012);
      ctx.stroke();
      ctx.fillStyle = pl ? "#fff8c0" : "#ffbc90";
      if (pl && b.shotgun) ctx.fillStyle = "#ffba7a";
      ctx.beginPath();
      ctx.arc(b.x, b.y, pl ? 4.8 : 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pl ? "#ffffff" : "#ffe8d0";
      if (pl && b.shotgun) ctx.fillStyle = "#fff1d8";
      ctx.beginPath();
      ctx.arc(b.x - vx * 0.008, b.y - vy * 0.008, pl ? 2.4 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const pk of netState.pickups || []) {
      const blink = pk.ttlMs < 2500 && (performance.now() / 120) % 2 < 1;
      if (blink) ctx.globalAlpha = 0.45;
      if (pk.type === "shotgun") {
        ctx.fillStyle = "rgba(255,175,80,0.18)";
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,185,95,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pk.x - 10, pk.y + 6);
        ctx.lineTo(pk.x + 10, pk.y - 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pk.x - 10, pk.y - 2);
        ctx.lineTo(pk.x + 10, pk.y - 10);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pk.x - 10, pk.y + 12);
        ctx.lineTo(pk.x + 10, pk.y + 2);
        ctx.stroke();
      } else if (pk.type === "shield") {
        ctx.fillStyle = "rgba(80,170,255,0.16)";
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(125,200,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 10, Math.PI * 0.2, Math.PI * 1.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pk.x, pk.y - 10);
        ctx.lineTo(pk.x, pk.y + 10);
        ctx.stroke();
      } else if (pk.type === "rapidfire") {
        ctx.fillStyle = "rgba(255,120,80,0.16)";
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,170,120,0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pk.x - 8, pk.y + 8);
        ctx.lineTo(pk.x - 1, pk.y - 8);
        ctx.lineTo(pk.x + 2, pk.y - 1);
        ctx.lineTo(pk.x + 8, pk.y - 1);
        ctx.lineTo(pk.x + 1, pk.y + 8);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (socket && netState.players) {
      const me = netState.players.find((p) => p.id === socket.id);
      if (me) drawHitIndicatorsAt(me.x, me.y);
    }
    drawParticlesBatch();
    if (netState.waveEvent === "fog") {
      const fx = deck ? deck.x : W * 0.5;
      const fy = deck ? deck.y : H * 0.72;
      const rg = ctx.createRadialGradient(fx, fy, 120, fx, fy, Math.max(W, H) * 0.7);
      rg.addColorStop(0, "rgba(210,220,230,0)");
      rg.addColorStop(0.7, "rgba(190,200,210,0.18)");
      rg.addColorStop(1, "rgba(165,175,185,0.36)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    } else if (netState.waveEvent === "storm") {
      const tStorm = performance.now() * 0.02;
      ctx.fillStyle = "rgba(140,170,210,0.08)";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(230,245,255,0.22)";
      ctx.lineWidth = 1.1;
      for (let x = -80; x < W + 80; x += 46) {
        const y = ((x * 1.7 + tStorm * 18) % (H + 80)) - 40;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 24, y - 32);
        ctx.stroke();
      }
    }

    if (netState.matchOver) {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, W, H);
    }
    if (netState.waveReport && netState.waveReport.ttlMs > 0) {
      const alpha = Math.max(0, Math.min(1, netState.waveReport.ttlMs / 800));
      const bw = 360;
      const bh = 126;
      const bx = W * 0.5 - bw * 0.5;
      const by = 28;
      ctx.globalAlpha = 0.82 * alpha;
      ctx.fillStyle = "rgba(15,20,35,0.86)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(netState.waveReport.text || "波次结算", W * 0.5, by + 24);
      ctx.textAlign = "left";
      ctx.font = "13px sans-serif";
      const rows = netState.waveReport.rows || [];
      for (let i = 0; i < Math.min(4, rows.length); i++) {
        const r = rows[i];
        const name = "玩家 " + (r.id ? String(r.id).slice(0, 6) : "?");
        ctx.fillText(name + "  + " + (r.kills || 0) + " 击杀", bx + 18, by + 50 + i * 18);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }
    ctx.restore();
  }

  function sendOnlineInput() {
    if (mode !== "online" || !socket || !socket.connected) return;
    if (tutorialActive) return;
    const p = clientToArena(mouse.x, mouse.y);
    const mx = p.x;
    const my = p.y;
    let angle = 0;
    if (netState && netState.players) {
      const me = netState.players.find((p) => p.id === socket.id);
      if (me) angle = Math.atan2(my - me.y, mx - me.x);
    }
    socket.emit("input", {
      shoot: mouse.down,
      angle,
    });
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    screenShake = Math.max(0, screenShake - dt * 40);
    if (mode === "offline" && state === "play") {
      updateOffline(dt);
    } else if (mode === "online") {
      sendOnlineInput();
    }
    updateParticles(dt);
    updateHitIndicators(dt);

    if (mode === "offline" && state === "play") {
      renderOffline();
    } else if (mode === "online") {
      renderOnline();
    } else {
      beginArenaCanvas(mode === "offline" ? getOfflineArenaTheme() : null);
      drawArena(mode === "offline" ? getOfflineArenaTheme() : null);
      drawParticlesBatch();
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    if (["Space", "ArrowUp", "ArrowDown"].includes(e.key)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
  });
  function onGlobalMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }
  canvas.addEventListener("mousemove", onGlobalMouseMove);
  window.addEventListener("mousemove", onGlobalMouseMove);
  canvas.addEventListener("mousedown", () => {
    mouse.down = true;
  });
  window.addEventListener("mouseup", () => {
    mouse.down = false;
  });
  window.addEventListener("blur", () => {
    mouse.down = false;
  });

  btnOffline.addEventListener("click", () => {
    onlinePanel.classList.add("hidden");
    offlineLevelPanel.classList.remove("hidden");
  });

  btnOfflineBack.addEventListener("click", () => {
    offlineLevelPanel.classList.add("hidden");
  });

  btnOnline.addEventListener("click", () => {
    offlineLevelPanel.classList.add("hidden");
    onlinePanel.classList.toggle("hidden");
  });

  btnJoin.addEventListener("click", () => {
    if (typeof io !== "function") {
      netStatus.textContent = "未加载 Socket.IO 客户端，请检查网络或 CDN";
      return;
    }
    state = "play";
    startOnlinePlay();
  });

  if (btnReady) {
    btnReady.addEventListener("click", () => {
      if (!socket || !socket.connected || !netState) return;
      const me = netState.players.find((p) => p.id === socket.id);
      const next = !(me && me.ready);
      socket.emit("setReady", { ready: next });
    });
  }

  restartBtn.addEventListener("click", () => {
    if (mode === "offline") {
      gameOverEl.classList.add("hidden");
      resetOffline();
      state = "play";
      if (perkOverlay) perkOverlay.classList.add("hidden");
    } else if (mode === "online" && socket) {
      gameOverEl.classList.add("hidden");
      onlineMatchEndShown = false;
      socket.emit("restartMatch");
    }
  });

  if (btnTutorialNext) {
    btnTutorialNext.addEventListener("click", () => {
      advanceTutorialStep();
    });
  }

  if (btnTutorialSkip) {
    btnTutorialSkip.addEventListener("click", () => {
      endTutorial(true);
    });
  }

  btnBackMenu.addEventListener("click", () => {
    gameOverEl.classList.add("hidden");
    titleScreen.classList.remove("hidden");
    offlineLevelPanel.classList.add("hidden");
    hud.classList.add("hidden");
    lobbyHint.classList.add("hidden");
    if (perkOverlay) perkOverlay.classList.add("hidden");
    if (hudOnlineMeta) hudOnlineMeta.classList.add("hidden");
    if (hudOnlineBadges) {
      hudOnlineBadges.classList.add("hidden");
      hudOnlineBadges.innerHTML = "";
    }
    mode = "menu";
    state = "menu";
    prevMyShotFx = 0;
    teardownSocket();
    netStatus.textContent = "";
  });

  if (offlineLevelList) {
    OFFLINE_LEVELS.forEach((lvl, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "level-pick";
      const nw = lvl.waves ? lvl.waves.length : 0;
      btn.textContent = "第 " + (i + 1) + " 关 · " + lvl.title + "（" + nw + " 波）";
      btn.addEventListener("click", () => startOffline(i));
      offlineLevelList.appendChild(btn);
    });
  }

  beginArenaCanvas(null);
  drawArena(null);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("选择模式开始", W / 2, H / 2 + 80);
  ctx.textAlign = "left";

  window.addEventListener("resize", syncCanvasBackingStore);

  requestAnimationFrame(frame);
})();
