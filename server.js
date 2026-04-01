"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const W = 960;
const H = 540;
const PLAYER_R = 10;
const MUZZLE_DIST = PLAYER_R + 20;
const RECOIL_KICK = 300;
const MAX_PLAYER_SPEED = 540;
const WATER_DRAG = 0.878;
const WALL_TOUCH_EPS = 2.8;
const WALL_KICK_MULT = 1.58;
const WALL_POP_PX = 5;
const FLOAT_DRIFT_SPEED = 92;
const FLOAT_FREQ_A = 0.72;
const FLOAT_FREQ_B = 0.58;
const FLOAT_LERP = 2.45;
const BULLET_SPEED = 600;
const SHOOT_CD = 0.1;
const MAX_HP = 3;
const INVULN_AFTER_HIT = 1;
const RESPAWN_MS = 2800;
const WIN_KILLS = 10;
const BULLET_LIFE = 1.2;
const TICK_MS = 1000 / 60;
const BOAT_CLAMP = 34;
/** 颠簸：速度 + 后坐力累积，满则翻船 */
const CAPSIZE_TILT_DECAY = 0.36;
const CAPSIZE_TILT_SPEED = 0.88;
const CAPSIZE_TILT_RECOIL = 0.05;
const CAPSIZE_MULTI_SHOT = 0.06;
const CAPSIZE_FLIP_DURATION = 1.05;
const DISCONNECT_GRACE_MS = 10000;
const FRIENDLY_FIRE = false;
const ENEMY_R_MIN = 9;
const ENEMY_R_MAX = 11;
const ENEMY_TYPES = ["assault", "turret", "charger"];
const PICKUP_LIFE_MS = 12000;
const PICKUP_AUTO_PICK_R = 42;
const PICKUP_DROP_BASE = 0.22;
const SHOTGUN_DURATION_MS = 6000;
const SHIELD_DURATION_MS = 7000;
const RAPIDFIRE_DURATION_MS = 6000;
const GUN_SCALE = 0.55;
const WALL_AUTO_POP_ZONE = 44;
const WALL_AUTO_POP_PUSH = 900;
const EDGE_REPEL_ZONE = 120;
const EDGE_REPEL_FORCE = 260;
const WALL_TURN_ASSIST_ZONE = 56;
const WALL_TURN_ASSIST = 0.38;

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

const OFFLINE_LEVELS = [
  {
    waves: [
      { count: 2, speedMin: 48, speedMax: 74, hp: 2, shootCdMin: 1.05, shootCdMax: 2 },
      { count: 3, speedMin: 50, speedMax: 80, hp: 2 },
      { count: 3, speedMin: 52, speedMax: 84, hp: 2 },
    ],
  },
  {
    waves: [
      { count: 3 },
      { count: 4 },
      { count: 4, speedMin: 58, speedMax: 98 },
      { count: 5, speedMin: 60, speedMax: 100 },
    ],
  },
  {
    waves: [
      { count: 4, speedMin: 62, speedMax: 102 },
      { count: 5 },
      { count: 5, speedMin: 65, speedMax: 108, shootRange: 440 },
      { count: 6, speedMin: 68, speedMax: 112 },
    ],
  },
  {
    waves: [
      { count: 5 },
      { count: 5, hp: 3, radiusMin: 9.5, radiusMax: 12, speedMin: 55, speedMax: 90 },
      { count: 6, speedMin: 70, speedMax: 115 },
      { count: 6, hp: 3, radiusMin: 10, radiusMax: 12.5, speedMin: 58, speedMax: 95 },
      { count: 7 },
    ],
  },
  {
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

const COLORS = [
  "#4ecdc4",
  "#e94560",
  "#ffe66d",
  "#a855f7",
  "#38bdf8",
  "#f97316",
  "#22c55e",
  "#ec4899",
];

const rooms = new Map();

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

function mergeWaveCfg(w) {
  return Object.assign({}, DEFAULT_WAVE_CFG, w || {});
}

function spawnEnemy(cfg, typeOverride) {
  const c = mergeWaveCfg(cfg);
  const side = (Math.random() * 4) | 0;
  let x, y;
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
  const base = {
    x,
    y,
    r: rand(c.radiusMin || ENEMY_R_MIN, c.radiusMax || ENEMY_R_MAX),
    speed: rand(c.speedMin, c.speedMax),
    hp: c.hp,
    shootCd: rand(0, Math.min(1.35, c.shootCdMax)),
    muzzleFlash: 0,
    gunRecoil: 0,
    shootRange: c.shootRange,
    bulletSpeed: c.bulletSpeed,
    shootCdMin: c.shootCdMin,
    shootCdMax: c.shootCdMax,
    type: typeOverride || "assault",
    chargeCd: rand(1.2, 2.2),
    chargeT: 0,
    chargeDx: 0,
    chargeDy: 0,
  };
  if (base.hp >= 8 || base.r >= 27) base.type = "boss";
  if (base.type === "turret") {
    base.speed *= 0.45;
    base.hp += 1;
    base.shootRange += 120;
    base.bulletSpeed += 45;
    base.shootCdMin += 0.25;
    base.shootCdMax += 0.45;
    base.r += 1.5;
  } else if (base.type === "charger") {
    base.speed *= 0.9;
    base.shootRange *= 0.8;
    base.shootCdMin += 0.1;
    base.shootCdMax += 0.2;
    base.chargeCd = rand(0.9, 1.8);
  } else if (base.type === "boss") {
    base.speed *= 0.72;
    base.shootRange += 120;
    base.bulletSpeed += 20;
  } else {
    base.speed *= 1.12;
    base.bulletSpeed += 18;
  }
  return base;
}

function pickWaveEvent(levelIndex, waveNum) {
  const k = (levelIndex + 1) * 17 + waveNum * 23;
  if (k % 5 === 0) return "storm";
  if (k % 4 === 0) return "fog";
  return "none";
}

function spawnWave(room, levelIndex, waveNum) {
  const lvl = OFFLINE_LEVELS[levelIndex];
  if (!lvl) return;
  const w = lvl.waves[waveNum - 1];
  if (!w) return;
  const cfg = mergeWaveCfg(w);
  room.waveEvent = pickWaveEvent(levelIndex, waveNum);
  const n = Math.max(1, room.players.size);
  const scaledCount = Math.max(1, Math.round(cfg.count * (1 + (n - 1) * 0.4)));
  const isBossWave = waveNum === lvl.waves.length;
  for (let i = 0; i < scaledCount; i++) {
    let t = ENEMY_TYPES[(i + waveNum + levelIndex) % ENEMY_TYPES.length];
    if (isBossWave && i === 0 && levelIndex >= 2) t = "boss";
    room.enemies.push(spawnEnemy(cfg, t));
  }
}

function maybeDropPickup(room, enemy, forceHighValue) {
  const roll = Math.random();
  const pDrop = forceHighValue ? 1 : enemy.type === "boss" ? 1 : PICKUP_DROP_BASE;
  if (roll > pDrop) return;
  const now = Date.now();
  const typeRoll = Math.random();
  const type = typeRoll < 0.5 ? "shotgun" : typeRoll < 0.78 ? "shield" : "rapidfire";
  room.pickups.push({
    id: "pk_" + Math.random().toString(36).slice(2),
    type,
    x: enemy.x + rand(-14, 14),
    y: enemy.y + rand(-14, 14),
    until: now + PICKUP_LIFE_MS,
  });
  if (room.pickups.length > 6) room.pickups.splice(0, room.pickups.length - 6);
}

function getPlayerMuzzleWorld(px, py, angle, r) {
  const bx = -2;
  const by = -16;
  const gx = bx + r * 0.5;
  const gy = by + 4;
  const lx = gx + 34 * GUN_SCALE;
  const ly = gy;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  return {
    x: px + lx * ca - ly * sa,
    y: py + lx * sa + ly * ca,
  };
}

function assignSlots(room) {
  const ids = [...room.players.keys()].sort();
  ids.forEach((id, i) => {
    const p = room.players.get(id);
    if (p) p.slot = i;
  });
}

/** 甲板横排座位：沿 X 等距、略拥挤，略偏上贴合船面 */
function seatOffset(slot, n) {
  const y = -10;
  if (n <= 1) return { x: 0, y };
  const spacing = 30;
  const half = ((n - 1) * spacing) / 2;
  const x = slot * spacing - half;
  return { x, y };
}

function worldPos(room, p) {
  const B = room.boat || { x: W * 0.5, y: H * 0.72 };
  const n = room.players.size;
  const slot = typeof p.slot === "number" ? p.slot : 0;
  const s = seatOffset(slot, n);
  return { x: B.x + s.x, y: B.y + s.y };
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      players: new Map(),
      bullets: [],
      enemies: [],
      pickups: [],
      teamBuffs: {
        shotgunUntil: 0,
        shieldUntil: 0,
        rapidfireUntil: 0,
      },
      started: false,
      matchOver: false,
      winnerId: null,
      levelIndex: 0,
      wave: 1,
      waveEvent: "none",
      boat: {
        x: W * 0.5,
        y: H * 0.72,
        pvx: 0,
        pvy: 0,
        tilt: 0,
      },
      capsizeFx: 0,
      waveReport: null,
    });
  }
  return rooms.get(roomId);
}

function nextColorIndex(room) {
  const used = new Set();
  for (const p of room.players.values()) used.add(p.colorIndex);
  for (let i = 0; i < COLORS.length; i++) {
    if (!used.has(i)) return i;
  }
  return room.players.size % COLORS.length;
}

function addPlayer(room, socketId, clientKey) {
  const p = {
    id: socketId,
    clientKey: clientKey || "",
    connected: true,
    disconnectedUntil: 0,
    slot: 0,
    angle: 0,
    hp: MAX_HP,
    shootCd: 0,
    invuln: 0,
    kills: 0,
    deaths: 0,
    respawnAt: 0,
    colorIndex: nextColorIndex(room),
    shotFx: 0,
    ready: false,
    waveKillsBase: 0,
  };
  room.players.set(socketId, p);
  assignSlots(room);
  return p;
}

function reclaimPlayer(room, oldId, newId) {
  const p = room.players.get(oldId);
  if (!p) return null;
  room.players.delete(oldId);
  p.id = newId;
  p.connected = true;
  p.disconnectedUntil = 0;
  room.players.set(newId, p);
  for (const b of room.bullets) {
    if (b.ownerId === oldId) b.ownerId = newId;
  }
  assignSlots(room);
  return p;
}

function removePlayer(room, socketId) {
  room.players.delete(socketId);
  room.bullets = room.bullets.filter((b) => b.ownerId !== socketId);
  if (room.players.size === 0) rooms.delete(room.id);
  else assignSlots(room);
}

function resetMatch(room) {
  room.started = true;
  room.matchOver = false;
  room.winnerId = null;
  if (!room.boat) room.boat = { x: W * 0.5, y: H * 0.72, pvx: 0, pvy: 0 };
  room.boat.x = W * 0.5;
  room.boat.y = H * 0.72;
  room.boat.pvx = 0;
  room.boat.pvy = 0;
  room.boat.tilt = 0;
  room.capsizeFx = 0;
  room.waveReport = null;
  room.pickups = [];
  room.teamBuffs = { shotgunUntil: 0, shieldUntil: 0, rapidfireUntil: 0 };
  room.levelIndex = 0;
  room.wave = 1;
  room.waveEvent = "none";
  for (const p of room.players.values()) {
    p.hp = MAX_HP;
    p.invuln = 1.5;
    p.shootCd = 0;
    p.respawnAt = 0;
    p.kills = 0;
    p.deaths = 0;
    p.shotFx = 0;
    p.ready = false;
    p.waveKillsBase = 0;
    p.connected = true;
    p.disconnectedUntil = 0;
  }
  assignSlots(room);
  room.bullets = [];
  room.enemies = [];
  spawnWave(room, room.levelIndex, room.wave);
}

function canStartRoom(room) {
  if (!room || room.players.size === 0) return false;
  for (const p of room.players.values()) {
    if (!p.ready) return false;
  }
  return true;
}

function makeWaveReport(room, text) {
  const rows = [];
  for (const p of room.players.values()) {
    const gain = Math.max(0, (p.kills || 0) - (p.waveKillsBase || 0));
    rows.push({ id: p.id, kills: gain });
    p.waveKillsBase = p.kills || 0;
  }
  rows.sort((a, b) => b.kills - a.kills || a.id.localeCompare(b.id));
  room.waveReport = {
    text,
    rows,
    until: Date.now() + 2600,
  };
}

function capsizeRoom(room, io) {
  if (room.matchOver) return;
  const B = room.boat;
  B.tilt = 0;
  B.pvx = 0;
  B.pvy = 0;
  B.x = W * 0.5;
  B.y = H * 0.72;
  room.bullets = [];
  room.pickups = [];
  room.capsizeFx = CAPSIZE_FLIP_DURATION;
  for (const p of room.players.values()) {
    if (p.respawnAt > 0 && Date.now() < p.respawnAt) continue;
    if (p.hp <= 0) continue;
    p.hp -= 1;
    p.invuln = Math.max(p.invuln || 0, 0.55);
    if (p.hp <= 0) {
      p.deaths += 1;
      p.respawnAt = Date.now() + RESPAWN_MS;
    }
  }
  io.to(room.id).emit("hitFx", {
    x: B.x,
    y: B.y + 24,
    vx: 0,
    vy: 160,
    kill: false,
    capsize: true,
  });
}

function simRoom(room, dt, io) {
  if (room.players.size === 0) return;
  if (!room.started) return;
  if (room.matchOver) return;

  if (!room.boat) room.boat = { x: W * 0.5, y: H * 0.72, pvx: 0, pvy: 0, tilt: 0 };
  const B = room.boat;
  if (B.tilt == null) B.tilt = 0;
  if (room.capsizeFx == null) room.capsizeFx = 0;
  const n = room.players.size;

  room.simTime = (room.simTime || 0) + dt;

  const inputs = room.lastInputs || new Map();
  room.lastInputs = inputs;
  const nowMs = Date.now();
  const shotgunOn = room.teamBuffs && room.teamBuffs.shotgunUntil > nowMs;
  const shieldOn = room.teamBuffs && room.teamBuffs.shieldUntil > nowMs;
  const rapidfireOn = room.teamBuffs && room.teamBuffs.rapidfireUntil > nowMs;

  for (const [id, p] of [...room.players.entries()]) {
    if (!p.connected && p.disconnectedUntil > 0 && nowMs >= p.disconnectedUntil) {
      removePlayer(room, id);
    }
  }
  if (room.players.size === 0) return;

  let anyShoot = false;
  for (const p of room.players.values()) {
    let inp = inputs.get(p.id) || { shoot: false, angle: p.angle };
    if (!p.connected && room.started && p.hp > 0) {
      let tx = B.x;
      let ty = B.y;
      let best = Infinity;
      for (const e of room.enemies) {
        const d = vecLen(e.x - B.x, e.y - B.y);
        if (d < best) {
          best = d;
          tx = e.x;
          ty = e.y;
        }
      }
      const wp = worldPos(room, p);
      inp = {
        shoot: room.enemies.length > 0,
        angle: Math.atan2(ty - wp.y, tx - wp.x),
      };
      inputs.set(p.id, inp);
    }
    if (p.hp > 0 && inp.shoot) anyShoot = true;
  }

  for (const p of room.players.values()) {
    if (p.shotFx > 0) p.shotFx = Math.max(0, p.shotFx - dt * 7.5);
    const inp = inputs.get(p.id) || {
      shoot: false,
      angle: p.angle,
    };
    p.angle = typeof inp.angle === "number" ? inp.angle : p.angle;

    if (p.respawnAt > 0 && Date.now() < p.respawnAt) continue;
    if (p.respawnAt > 0 && Date.now() >= p.respawnAt) {
      p.hp = MAX_HP;
      p.invuln = 1.5;
      p.respawnAt = 0;
      p.shotFx = 0;
    }

    if (p.hp <= 0) continue;

    if (p.invuln > 0) p.invuln -= dt;
    if (p.shootCd > 0) p.shootCd -= dt;
  }

  const loX = BOAT_CLAMP;
  const hiX = W - BOAT_CLAMP;
  const loY = BOAT_CLAMP;
  const hiY = H - BOAT_CLAMP;
  const eps = WALL_TOUCH_EPS;

  const drag = Math.pow(WATER_DRAG, dt * 60);
  B.pvx *= drag;
  B.pvy *= drag;

  if (!anyShoot) {
    const t = room.simTime;
    const tx = FLOAT_DRIFT_SPEED * Math.sin(t * FLOAT_FREQ_A);
    const ty = FLOAT_DRIFT_SPEED * Math.cos(t * FLOAT_FREQ_B);
    B.pvx += (tx - B.pvx) * FLOAT_LERP * dt;
    B.pvy += (ty - B.pvy) * FLOAT_LERP * dt;
  }

  let shotsThisFrame = 0;
  for (const p of room.players.values()) {
    if (p.respawnAt > 0 && Date.now() < p.respawnAt) continue;
    if (p.hp <= 0) continue;
    const inp = inputs.get(p.id) || { shoot: false, angle: p.angle };
    if (!inp.shoot || p.shootCd > 0) continue;

    let dir = normalize(Math.cos(p.angle), Math.sin(p.angle));
    let kick = RECOIL_KICK;
    if (room.waveEvent === "storm") kick *= 1.2;
    const atLeft = B.x <= loX + eps;
    const atRight = B.x >= hiX - eps;
    const atTop = B.y <= loY + eps;
    const atBottom = B.y >= hiY - eps;
    let awayX = 0;
    let awayY = 0;
    const dl = B.x - loX;
    const dr = hiX - B.x;
    const dtp = B.y - loY;
    const db = hiY - B.y;
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

    const seat = seatOffset(p.slot, n);
    const px = B.x + seat.x;
    const py = B.y + seat.y;
    const mz = getPlayerMuzzleWorld(px, py, p.angle, PLAYER_R);

    if (shotgunOn) {
      const baseA = Math.atan2(dir.y, dir.x);
      const spreads = [-0.279, -0.139, 0, 0.139, 0.279];
      for (const s of spreads) {
        const a = baseA + s;
        room.bullets.push({
          x: mz.x,
          y: mz.y,
          vx: Math.cos(a) * BULLET_SPEED * 0.92,
          vy: Math.sin(a) * BULLET_SPEED * 0.92,
          from: "player",
          ownerId: p.id,
          life: BULLET_LIFE * 0.78,
          damage: 0.55,
          shotgun: true,
        });
      }
    } else {
      room.bullets.push({
        x: mz.x,
        y: mz.y,
        vx: dir.x * BULLET_SPEED,
        vy: dir.y * BULLET_SPEED,
        from: "player",
        ownerId: p.id,
        life: BULLET_LIFE,
        damage: 1,
      });
    }
    const rapidMul = rapidfireOn ? 1.4 : 1;
    p.shootCd = SHOOT_CD / rapidMul;
    p.shotFx = 1.15;
    shotsThisFrame += 1;
    B.pvx -= dir.x * kick;
    B.pvy -= dir.y * kick;
    const tiltMul = room.waveEvent === "storm" ? 1.28 : 1;
    B.tilt += (kick / RECOIL_KICK) * CAPSIZE_TILT_RECOIL * tiltMul;
    const sp = vecLen(B.pvx, B.pvy);
    if (sp > MAX_PLAYER_SPEED) {
      const k = MAX_PLAYER_SPEED / sp;
      B.pvx *= k;
      B.pvy *= k;
    }
    if (atLeft && dir.x < 0) B.x += WALL_POP_PX;
    if (atRight && dir.x > 0) B.x -= WALL_POP_PX;
    if (atTop && dir.y < 0) B.y += WALL_POP_PX;
    if (atBottom && dir.y > 0) B.y -= WALL_POP_PX;
  }

  if (shotsThisFrame >= 2) {
    B.tilt += CAPSIZE_MULTI_SHOT * (shotsThisFrame - 1);
  }

  if (B.x - loX < EDGE_REPEL_ZONE) {
    const k = (EDGE_REPEL_ZONE - (B.x - loX)) / EDGE_REPEL_ZONE;
    B.pvx += EDGE_REPEL_FORCE * k * dt;
  }
  if (hiX - B.x < EDGE_REPEL_ZONE) {
    const k = (EDGE_REPEL_ZONE - (hiX - B.x)) / EDGE_REPEL_ZONE;
    B.pvx -= EDGE_REPEL_FORCE * k * dt;
  }
  if (B.y - loY < EDGE_REPEL_ZONE) {
    const k = (EDGE_REPEL_ZONE - (B.y - loY)) / EDGE_REPEL_ZONE;
    B.pvy += EDGE_REPEL_FORCE * k * dt;
  }
  if (hiY - B.y < EDGE_REPEL_ZONE) {
    const k = (EDGE_REPEL_ZONE - (hiY - B.y)) / EDGE_REPEL_ZONE;
    B.pvy -= EDGE_REPEL_FORCE * k * dt;
  }

  B.x += B.pvx * dt;
  B.y += B.pvy * dt;
  if (B.x - loX < WALL_AUTO_POP_ZONE) {
    const k = (WALL_AUTO_POP_ZONE - (B.x - loX)) / WALL_AUTO_POP_ZONE;
    B.pvx += WALL_AUTO_POP_PUSH * k * dt;
  }
  if (hiX - B.x < WALL_AUTO_POP_ZONE) {
    const k = (WALL_AUTO_POP_ZONE - (hiX - B.x)) / WALL_AUTO_POP_ZONE;
    B.pvx -= WALL_AUTO_POP_PUSH * k * dt;
  }
  if (B.y - loY < WALL_AUTO_POP_ZONE) {
    const k = (WALL_AUTO_POP_ZONE - (B.y - loY)) / WALL_AUTO_POP_ZONE;
    B.pvy += WALL_AUTO_POP_PUSH * k * dt;
  }
  if (hiY - B.y < WALL_AUTO_POP_ZONE) {
    const k = (WALL_AUTO_POP_ZONE - (hiY - B.y)) / WALL_AUTO_POP_ZONE;
    B.pvy -= WALL_AUTO_POP_PUSH * k * dt;
  }
  if (B.x <= loX) {
    B.x = loX;
    if (B.pvx < 0) B.pvx = 0;
  }
  if (B.x >= hiX) {
    B.x = hiX;
    if (B.pvx > 0) B.pvx = 0;
  }
  if (B.y <= loY) {
    B.y = loY;
    if (B.pvy < 0) B.pvy = 0;
  }
  if (B.y >= hiY) {
    B.y = hiY;
    if (B.pvy > 0) B.pvy = 0;
  }

  const spAfter = vecLen(B.pvx, B.pvy);
  B.tilt += (spAfter / MAX_PLAYER_SPEED) * CAPSIZE_TILT_SPEED * dt;
  if (room.waveEvent === "storm") B.tilt += 0.08 * dt;
  B.tilt -= CAPSIZE_TILT_DECAY * dt;
  if (B.tilt < 0) B.tilt = 0;
  if (B.tilt >= 1) {
    capsizeRoom(room, io);
  }

  if (room.capsizeFx > 0) {
    room.capsizeFx = Math.max(0, room.capsizeFx - dt * 1.35);
  }
  room.pickups = room.pickups.filter((pk) => pk.until > nowMs);
  for (let i = room.pickups.length - 1; i >= 0; i--) {
    const pk = room.pickups[i];
    const d = vecLen(pk.x - B.x, pk.y - B.y);
    if (d <= PICKUP_AUTO_PICK_R) {
      if (pk.type === "shotgun") {
        room.teamBuffs.shotgunUntil = Math.max(room.teamBuffs.shotgunUntil || 0, nowMs) + SHOTGUN_DURATION_MS;
      } else if (pk.type === "shield") {
        room.teamBuffs.shieldUntil = Math.max(room.teamBuffs.shieldUntil || 0, nowMs) + SHIELD_DURATION_MS;
      } else if (pk.type === "rapidfire") {
        room.teamBuffs.rapidfireUntil =
          Math.max(room.teamBuffs.rapidfireUntil || 0, nowMs) + RAPIDFIRE_DURATION_MS;
      }
      room.pickups.splice(i, 1);
    }
  }

  for (const e of room.enemies) {
    e.muzzleFlash = Math.max(0, e.muzzleFlash - dt * 9);
    e.gunRecoil = Math.max(0, e.gunRecoil - dt * 3.2);
    let tx = B.x;
    let ty = B.y;
    let best = Infinity;
    for (const p of room.players.values()) {
      if (p.hp <= 0) continue;
      if (p.respawnAt > 0 && Date.now() < p.respawnAt) continue;
      const wp = worldPos(room, p);
      const d = vecLen(wp.x - e.x, wp.y - e.y);
      if (d < best) {
        best = d;
        tx = wp.x;
        ty = wp.y;
      }
    }
    const dir = normalize(tx - e.x, ty - e.y);
    if (e.type === "charger") {
      if (e.chargeT > 0) {
        e.chargeT -= dt;
        e.x += e.chargeDx * e.speed * 3.1 * dt;
        e.y += e.chargeDy * e.speed * 3.1 * dt;
      } else {
        e.x += dir.x * e.speed * dt;
        e.y += dir.y * e.speed * dt;
        e.chargeCd -= dt;
        if (e.chargeCd <= 0) {
          e.chargeCd = rand(1.1, 2.1);
          e.chargeT = 0.42;
          e.chargeDx = dir.x;
          e.chargeDy = dir.y;
        }
      }
    } else {
      e.x += dir.x * e.speed * dt;
      e.y += dir.y * e.speed * dt;
    }
    e.shootCd -= dt;
    const eRange = e.shootRange != null ? e.shootRange : 420;
    const eBulletSpd = e.bulletSpeed != null ? e.bulletSpeed : 340;
    const eCd0 = e.shootCdMin != null ? e.shootCdMin : 0.9;
    const eCd1 = e.shootCdMax != null ? e.shootCdMax : 1.8;
    if (e.shootCd <= 0 && best < eRange && !(e.type === "charger" && e.chargeT > 0)) {
      const bd = normalize(tx - e.x, ty - e.y);
      const md = e.r + 18;
      const shots = e.type === "boss" ? 3 : 1;
      const enemyBulletMul = 0.78;
      for (let si = 0; si < shots; si++) {
        const spread = shots === 1 ? 0 : (si - 1) * 0.2;
        const a = Math.atan2(bd.y, bd.x) + spread;
        room.bullets.push({
          x: e.x + Math.cos(a) * md,
          y: e.y + Math.sin(a) * md,
          vx: Math.cos(a) * eBulletSpd * enemyBulletMul,
          vy: Math.sin(a) * eBulletSpd * enemyBulletMul,
          from: "enemy",
          ownerId: "enemy",
          life: 1.5,
        });
      }
      e.shootCd = rand(eCd0, eCd1);
      e.muzzleFlash = 1.12;
      e.gunRecoil = 0.4;
    }
  }

  // Prevent enemy beans from passing through each other.
  for (let i = 0; i < room.enemies.length; i++) {
    for (let j = i + 1; j < room.enemies.length; j++) {
      const a = room.enemies[i];
      const b = room.enemies[j];
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

  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30 || b.life <= 0) {
      room.bullets.splice(i, 1);
      continue;
    }
    if (b.from === "enemy") {
      for (const p of room.players.values()) {
        if (p.hp <= 0) continue;
        if (p.respawnAt > 0 && Date.now() < p.respawnAt) continue;
        if (p.invuln > 0) continue;
        if (shieldOn) continue;
        const wp = worldPos(room, p);
        const d = vecLen(b.x - wp.x, b.y - wp.y);
        if (d < PLAYER_R + 6) {
          p.hp -= 1;
          if (p.hp <= 0) {
            p.deaths += 1;
            p.respawnAt = Date.now() + RESPAWN_MS;
          } else {
            p.invuln = INVULN_AFTER_HIT;
          }
          room.bullets.splice(i, 1);
          io.to(room.id).emit("hitFx", {
            x: b.x,
            y: b.y,
            vx: b.vx,
            vy: b.vy,
            kill: p.hp <= 0,
          });
          break;
        }
      }
      continue;
    }

    let consumed = false;
    for (let ei = room.enemies.length - 1; ei >= 0; ei--) {
      const e = room.enemies[ei];
      if (vecLen(b.x - e.x, b.y - e.y) < e.r + 6) {
        e.hp -= b.damage != null ? b.damage : 1;
        room.bullets.splice(i, 1);
        consumed = true;
        io.to(room.id).emit("hitFx", {
          x: b.x,
          y: b.y,
          vx: b.vx,
          vy: b.vy,
          kill: e.hp <= 0,
        });
        if (e.hp <= 0) {
          room.enemies.splice(ei, 1);
          const shooter = room.players.get(b.ownerId);
          if (shooter) shooter.kills += 1;
          maybeDropPickup(room, e, e.type === "boss");
        }
        break;
      }
    }
    if (consumed) continue;

    if (!FRIENDLY_FIRE) continue;
    for (const p of room.players.values()) {
      if (p.id === b.ownerId) continue;
      if (p.hp <= 0) continue;
      if (p.respawnAt > 0 && Date.now() < p.respawnAt) continue;
      if (p.invuln > 0) continue;
      const wp = worldPos(room, p);
      const d = vecLen(b.x - wp.x, b.y - wp.y);
      if (d < PLAYER_R + 6) {
        p.hp -= 1;
        if (p.hp <= 0) {
          p.deaths += 1;
          p.respawnAt = Date.now() + RESPAWN_MS;
        } else {
          p.invuln = INVULN_AFTER_HIT;
        }
        room.bullets.splice(i, 1);
        io.to(room.id).emit("hitFx", {
          x: b.x,
          y: b.y,
          vx: b.vx,
          vy: b.vy,
          kill: p.hp <= 0,
        });
        break;
      }
    }
  }

  if (room.enemies.length === 0 && !room.matchOver) {
    const doneWave = room.wave;
    const doneLevel = room.levelIndex + 1;
    room.wave += 1;
    const lvl = OFFLINE_LEVELS[room.levelIndex];
    if (lvl && room.wave > lvl.waves.length) {
      makeWaveReport(room, "第 " + doneLevel + " 关清除");
      room.levelIndex += 1;
      room.wave = 1;
      if (room.levelIndex >= OFFLINE_LEVELS.length) {
        room.matchOver = true;
        room.winnerId = "team";
      } else {
        spawnWave(room, room.levelIndex, room.wave);
      }
    } else {
      makeWaveReport(room, "第 " + doneLevel + " 关 · 第 " + doneWave + " 波已清除");
      spawnWave(room, room.levelIndex, room.wave);
    }
  }
}

function serializeRoom(room) {
  const players = [];
  const B = room.boat || { x: W * 0.5, y: H * 0.72 };
  for (const p of room.players.values()) {
    const wp = worldPos(room, p);
    players.push({
      id: p.id,
      x: wp.x,
      y: wp.y,
      angle: p.angle,
      hp: p.hp,
      invuln: p.invuln,
      kills: p.kills,
      deaths: p.deaths,
      colorIndex: p.colorIndex,
      respawnMs: p.respawnAt > Date.now() ? p.respawnAt - Date.now() : 0,
      shotFx: p.shotFx || 0,
      slot: p.slot,
      ready: !!p.ready,
      connected: !!p.connected,
    });
  }
  players.sort((a, b) => a.id.localeCompare(b.id));
  const bullets = room.bullets.map((b) => ({
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    from: b.from || "player",
    shotgun: !!b.shotgun,
    ownerId: b.ownerId,
  }));
  const pickups = room.pickups.map((pk) => ({
    id: pk.id,
    type: pk.type,
    x: pk.x,
    y: pk.y,
    ttlMs: Math.max(0, pk.until - Date.now()),
  }));
  const enemies = room.enemies.map((e) => ({
    x: e.x,
    y: e.y,
    r: e.r,
    hp: e.hp,
    type: e.type || "assault",
    muzzleFlash: e.muzzleFlash || 0,
    gunRecoil: e.gunRecoil || 0,
  }));
  const wr = room.waveReport;
  const now = Date.now();
  return {
    roomId: room.id,
    w: W,
    h: H,
    boat: {
      x: B.x,
      y: B.y,
      pvx: B.pvx,
      pvy: B.pvy,
      tilt: B.tilt != null ? B.tilt : 0,
      capsizeFx: room.capsizeFx != null ? room.capsizeFx : 0,
    },
    started: !!room.started,
    players,
    enemies,
    pickups,
    bullets,
    colors: COLORS,
    levelIndex: room.levelIndex || 0,
    wave: room.wave || 1,
    levelCount: OFFLINE_LEVELS.length,
    waveTotal: OFFLINE_LEVELS[room.levelIndex || 0]
      ? OFFLINE_LEVELS[room.levelIndex || 0].waves.length
      : 0,
    waveEvent: room.waveEvent || "none",
    teamBuffs: {
      shotgunMs: Math.max(0, (room.teamBuffs && room.teamBuffs.shotgunUntil ? room.teamBuffs.shotgunUntil : 0) - now),
      shieldMs: Math.max(0, (room.teamBuffs && room.teamBuffs.shieldUntil ? room.teamBuffs.shieldUntil : 0) - now),
      rapidfireMs: Math.max(
        0,
        (room.teamBuffs && room.teamBuffs.rapidfireUntil ? room.teamBuffs.rapidfireUntil : 0) - now
      ),
    },
    waveReport:
      wr && wr.until > now
        ? {
            text: wr.text,
            rows: wr.rows,
            ttlMs: wr.until - now,
          }
        : null,
    matchOver: room.matchOver,
    winnerId: room.winnerId,
    winKills: WIN_KILLS,
  };
}

const app = express();
app.use(express.static(path.join(__dirname)));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
});

io.on("connection", (socket) => {
  let currentRoomId = null;

  socket.on("join", (payload, cb) => {
    const roomId = String((payload && payload.roomId) || "public").slice(0, 32) || "public";
    const clientKey = String((payload && payload.clientKey) || "").slice(0, 64);
    if (currentRoomId) {
      const old = rooms.get(currentRoomId);
      if (old) {
        socket.leave(currentRoomId);
        const meOld = old.players.get(socket.id);
        if (meOld) {
          meOld.connected = false;
          meOld.disconnectedUntil = Date.now() + DISCONNECT_GRACE_MS;
        }
        const oldAfter = rooms.get(currentRoomId);
        if (oldAfter) io.to(currentRoomId).emit("state", serializeRoom(oldAfter));
      }
    }
    socket.join(roomId);
    currentRoomId = roomId;
    const room = getOrCreateRoom(roomId);
    let reused = false;
    if (clientKey) {
      for (const [pid, p] of room.players.entries()) {
        if (p.clientKey === clientKey && !p.connected) {
          reclaimPlayer(room, pid, socket.id);
          reused = true;
          break;
        }
      }
    }
    if (!reused) {
      addPlayer(room, socket.id, clientKey);
      if (!room.started) {
        room.matchOver = false;
        room.winnerId = null;
        room.waveReport = null;
      }
    }
    if (typeof cb === "function") cb({ ok: true, roomId });
    io.to(roomId).emit("state", serializeRoom(room));
  });

  socket.on("input", (payload) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || !room.players.has(socket.id)) return;
    if (!room.lastInputs) room.lastInputs = new Map();
    const a = payload && typeof payload.angle === "number" ? payload.angle : 0;
    room.lastInputs.set(socket.id, {
      up: !!(payload && payload.up),
      down: !!(payload && payload.down),
      left: !!(payload && payload.left),
      right: !!(payload && payload.right),
      shoot: !!(payload && payload.shoot),
      angle: a,
    });
  });

  socket.on("setReady", (payload) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.ready = !!(payload && payload.ready);
    if (canStartRoom(room)) {
      resetMatch(room);
    }
    io.to(currentRoomId).emit("state", serializeRoom(room));
  });

  socket.on("restartMatch", () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || !room.players.has(socket.id)) return;
    room.started = false;
    room.matchOver = false;
    room.winnerId = null;
    room.enemies = [];
    room.bullets = [];
    room.waveReport = null;
    for (const q of room.players.values()) {
      q.ready = false;
    }
    io.to(currentRoomId).emit("state", serializeRoom(room));
  });

  socket.on("disconnect", () => {
    if (!currentRoomId) return;
    const roomId = currentRoomId;
    const room = rooms.get(roomId);
    if (!room) return;
    socket.leave(roomId);
    const p = room.players.get(socket.id);
    if (!p) return;
    p.connected = false;
    p.disconnectedUntil = Date.now() + DISCONNECT_GRACE_MS;
    if (!room.started) p.ready = false;
    const after = rooms.get(roomId);
    if (after) io.to(roomId).emit("state", serializeRoom(after));
  });
});

setInterval(() => {
  const dt = TICK_MS / 1000;
  for (const room of rooms.values()) {
    simRoom(room, dt, io);
    io.to(room.id).emit("state", serializeRoom(room));
  }
}, TICK_MS);

const PORT = process.env.PORT || 3333;
httpServer.listen(PORT, () => {
  console.log("枪豆人 服务器 http://localhost:" + PORT);
});
