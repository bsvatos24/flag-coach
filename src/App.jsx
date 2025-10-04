import React, { useEffect, useMemo, useState } from "react";

/**
 * 7v7 Flag Football Coach – Mobile-first + Random-Balanced Positions (v7)
 * -----------------------------------------------------------------------
 * Highlights:
 * 1) Positions are random-balanced per game with no immediate repeats inside the same role family.
 * 2) Captains are selected with balanced counts across the remaining games.
 * 3) Attendance modal lets you toggle QB and Center eligibility for each player.
 * 4) Offense formation: QB, RB1, RB2, C, WR, TE1, TE2. (Defense unchanged.)
 * 5) Dark, phone-friendly UI with a sticky bottom bar.
 */

const DEFAULT_ROSTER = [
  "Atticus",
  "Barrett",
  "CJ",
  "Elijah",
  "Gunnar",
  "Jeremiah",
  "Logan L",
  "Logan M",
  "Niko",
  "Sully",
];

// Updated offense formation
const OFFENSE_POSITIONS = [
  { key: "off_te_left", label: "TE" },
  { key: "off_c", label: "C" },
  { key: "off_te_right", label: "TE" },
  { key: "off_wr", label: "WR" },
  { key: "off_rb_left", label: "RB" },
  { key: "off_qb", label: "QB" },
  { key: "off_rb_right", label: "RB" },
];

const OFFENSE_LAYOUT = [
  ["off_te_left", "off_c", "off_te_right", "off_wr"],
  ["off_rb_left", "off_qb", "off_rb_right", null],
];

const DEFENSE_POSITIONS = [
  { key: "def_cb_left", label: "CB" },
  { key: "def_de_left", label: "DE" },
  { key: "def_dt", label: "DT" },
  { key: "def_de_right", label: "DE" },
  { key: "def_cb_right", label: "CB" },
  { key: "def_spy", label: "Spy" },
  { key: "def_blitzer", label: "Blitzer" },
];

const DEFENSE_LAYOUT = [
  ["def_cb_left", "def_de_left", "def_dt", "def_de_right", "def_cb_right"],
  [null, null, "def_spy", null, null],
  [null, null, "def_blitzer", null, null],
];

const OFFENSE_ROLES = OFFENSE_POSITIONS.map((pos) => pos.key);
const DEFENSE_ROLES = DEFENSE_POSITIONS.map((pos) => pos.key);

const ROLE_META = Object.fromEntries(
  [...OFFENSE_POSITIONS, ...DEFENSE_POSITIONS].map((pos) => [pos.key, pos]),
);

const LEGACY_ROLE_MAP = {
  QB: "off_qb",
  RB1: "off_rb_left",
  RB2: "off_rb_right",
  C: "off_c",
  WR: "off_wr",
  TE1: "off_te_left",
  TE2: "off_te_right",
  DT: "def_dt",
  DE1: "def_de_left",
  DE2: "def_de_right",
  CB1: "def_cb_left",
  CB2: "def_cb_right",
  Spy: "def_spy",
  Blitzer: "def_blitzer",
};

const ROLE_ABILITY_CHECK = {
  off_qb: (player) => player.canQB !== false,
  off_c: (player) => player.canCenter !== false,
};

function roleGroup(role) {
  if (!role) return role;
  return ROLE_META[role]?.label || role.replace(/\d+$/, "");
}

function migrateRoleKey(role) {
  if (!role) return role;
  return LEGACY_ROLE_MAP[role] || role;
}

const LS_KEY = "ffb-rotation-state-v7";
const DEFAULT_CAPTAIN_GAMES = 3;

function calculateCaptainGroups(playerCount, gamesRemaining) {
  const games = Math.max(1, gamesRemaining || DEFAULT_CAPTAIN_GAMES);
  if (playerCount <= 0) return [];
  const base = Math.floor(playerCount / games);
  const remainder = playerCount % games;
  const groups = new Array(games).fill(base);
  for (let i = 0; i < remainder; i++) {
    const idx = groups.length - 1 - i;
    if (idx >= 0) {
      groups[idx] += 1;
    }
  }
  return groups.filter((size) => size > 0);
}

// ---------- Helpers ----------
function createEmptyTallies(name) {
  const pos = {};
  [...OFFENSE_ROLES, ...DEFENSE_ROLES].forEach((r) => (pos[r] = 0));
  return {
    name,
    active: true,
    sits: 0,
    captains: 0,
    pos,
    id: crypto.randomUUID(),
    canQB: true,
    canCenter: true,
  };
}
function rngShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const r = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[r]] = [a[r], a[i]];
  }
  return a;
}

// Build a fresh roster: positions zeroed; seed captain counts (season-to-date)
function buildInitialRoster() {
  const roster = DEFAULT_ROSTER.map((n) => createEmptyTallies(n)).sort((a, b) => a.name.localeCompare(b.name));
  return roster;
}

function normalizePlayer(player) {
  if (!player) return player;
  const normalized = { ...player };

  const pos = { ...(normalized.pos || {}) };
  Object.entries(LEGACY_ROLE_MAP).forEach(([legacy, current]) => {
    if (Object.prototype.hasOwnProperty.call(pos, legacy)) {
      const value = typeof pos[legacy] === "number" ? pos[legacy] : 0;
      pos[current] = (typeof pos[current] === "number" ? pos[current] : 0) + value;
      delete pos[legacy];
    }
  });
  [...OFFENSE_ROLES, ...DEFENSE_ROLES].forEach((role) => {
    pos[role] = typeof pos[role] === "number" ? pos[role] : 0;
  });
  normalized.pos = pos;

  const hadAbilityFlags = Object.prototype.hasOwnProperty.call(player, "canQB") ||
    Object.prototype.hasOwnProperty.call(player, "canCenter");

  normalized.canQB = player.canQB !== undefined ? player.canQB : true;
  normalized.canCenter = player.canCenter !== undefined ? player.canCenter : true;

  normalized.captains = typeof player.captains === "number" ? player.captains : 0;
  if (!hadAbilityFlags) {
    normalized.captains = 0;
  }

  normalized.sits = typeof player.sits === "number" ? player.sits : 0;
  normalized.active = player.active !== undefined ? player.active : true;

  return normalized;
}

function normalizeRecentMap(map) {
  if (!map) return {};
  const result = {};
  Object.entries(map).forEach(([pid, rec]) => {
    if (!rec) return;
    result[pid] = {
      role: roleGroup(rec.role),
      series: rec.series || 0,
    };
  });
  return result;
}

function normalizeHistoryEntries(history) {
  if (!Array.isArray(history)) return [];
  return history.map((entry) => {
    if (!entry) return entry;
    const mapRoles = (mapping) => {
      if (!mapping) return mapping;
      const next = {};
      Object.entries(mapping).forEach(([role, pid]) => {
        const migrated = migrateRoleKey(role);
        next[migrated] = pid;
      });
      return next;
    };

    return {
      ...entry,
      offense: mapRoles(entry.offense),
      defense: mapRoles(entry.defense),
    };
  });
}

function loadInitialState() {
  const baseRoster = buildInitialRoster().map((p) => normalizePlayer(p));
  const baseSettings = {
    teamSize: 7,
    noRepeatWindow: 1, // block same role in consecutive series
    assignment: "randBalanced", // random among balanced group
  };
  const baseState = {
    roster: baseRoster,
    queue: baseRoster.map((p) => p.id),
    series: 0,
    history: [],
    settings: baseSettings,
    recentRoleByPlayer: {},
    captainPlan: {
      seasonTargetTotal: baseRoster.length * 2,
      recentPicks: [],
      pendingPicks: [],
      gamesRemaining: DEFAULT_CAPTAIN_GAMES,
      nextGroupIndex: 0,
    },
    lastQB: null,
    gameNumber: 1,
    seasonHistory: [],
    ui: { showAttendance: false, showSettings: false },
  };

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const { captainQueue: _discardQueue, captainIndex: _discardIndex, ...restData } = data || {};
      const storedRoster = (restData.roster || []).map((p) => normalizePlayer(p));
      const activeIds = storedRoster.filter((p) => p.active).map((p) => p.id);
      const storedQueue = (restData.queue || []).filter((id) => activeIds.includes(id));
      const queueTail = activeIds.filter((id) => !storedQueue.includes(id));
      const normalizedRecent = normalizeRecentMap(restData.recentRoleByPlayer);
      return {
        ...baseState,
        ...restData,
        roster: storedRoster.length ? storedRoster : baseRoster,
        queue: [...storedQueue, ...queueTail].length ? [...storedQueue, ...queueTail] : baseState.queue,
        settings: { ...baseSettings, ...(restData.settings || {}) },
        captainPlan: (() => {
          const plan = { ...baseState.captainPlan, ...(restData.captainPlan || {}) };
          plan.seasonTargetTotal = (restData.captainPlan && restData.captainPlan.seasonTargetTotal)
            || storedRoster.length * 2
            || baseRoster.length * 2;
          plan.gamesRemaining = (restData.captainPlan && restData.captainPlan.gamesRemaining !== undefined)
            ? restData.captainPlan.gamesRemaining
            : baseState.captainPlan.gamesRemaining;
          plan.nextGroupIndex = (restData.captainPlan && restData.captainPlan.nextGroupIndex !== undefined)
            ? restData.captainPlan.nextGroupIndex
            : 0;
          const validIds = new Set(storedRoster.map((p) => p.id));
          plan.recentPicks = (plan.recentPicks || []).filter((id) => validIds.has(id));
          plan.pendingPicks = (plan.pendingPicks || []).filter((id) => validIds.has(id));
          return plan;
        })(),
        history: normalizeHistoryEntries(restData.history || []),
        recentRoleByPlayer: normalizedRecent,
        seasonHistory: restData.seasonHistory || [],
      };
    }
  } catch {}

  return baseState;
}

export default function App() {
  const [state, setState] = useState(loadInitialState);
  const [showTally, setShowTally] = useState(false);
  const {
    roster, queue, series, history, settings, recentRoleByPlayer,
    captainPlan,
    gameNumber, seasonHistory, ui,
  } = state;

  const byId = useMemo(() => {
    const m = new Map();
    roster.forEach((p) => m.set(p.id, p));
    return m;
  }, [roster]);

  // Derived
  const activePlayers = useMemo(() => roster.filter((p) => p.active), [roster]);
  const totalActive = activePlayers.length;
  const sitCount = Math.max(totalActive - settings.teamSize, 0);
  const captainGroups = useMemo(
    () => calculateCaptainGroups(totalActive, captainPlan?.gamesRemaining || DEFAULT_CAPTAIN_GAMES),
    [totalActive, captainPlan?.gamesRemaining],
  );
  const nextCaptainGroupSize = captainGroups.length
    ? captainGroups[Math.min(captainPlan?.nextGroupIndex || 0, captainGroups.length - 1)]
    : 0;
  const pendingCaptainIds = captainPlan?.pendingPicks || [];
  const pendingCaptainSet = new Set(pendingCaptainIds);
  const canAcceptCaptains = nextCaptainGroupSize > 0 && pendingCaptainIds.length === nextCaptainGroupSize;
  const pendingCaptainNames = pendingCaptainIds.map((id) => byId.get(id)?.name).filter(Boolean);
  const recentCaptainNames = (captainPlan?.recentPicks || []).map((id) => byId.get(id)?.name).filter(Boolean);

  // Persist
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }, [state]);

  // Keep queue limited to active players (preserve order among actives)
  useEffect(() => {
    const activeIds = activePlayers.map((p) => p.id);
    const filtered = queue.filter((id) => activeIds.includes(id));
    const missing = activeIds.filter((id) => !filtered.includes(id));
    if (filtered.length !== queue.length || missing.length) {
      setState((s) => ({ ...s, queue: [...filtered, ...missing] }));
    }
  }, [activePlayers, queue]);

  useEffect(() => {
    if (nextCaptainGroupSize >= 0 && pendingCaptainIds.length > nextCaptainGroupSize) {
      setState((s) => {
        const pending = s.captainPlan?.pendingPicks || [];
        if (pending.length <= nextCaptainGroupSize) return s;
        return {
          ...s,
          captainPlan: {
            ...s.captainPlan,
            pendingPicks: pending.slice(0, nextCaptainGroupSize),
          },
        };
      });
    }
  }, [nextCaptainGroupSize, pendingCaptainIds.length]);

  // ---------- Resets ----------
  function resetPositionsOnly() {
    const base = roster.map((p) => ({ ...p, pos: Object.fromEntries(Object.keys(p.pos).map((k) => [k, 0])) }));
    setState((s) => ({ ...s, roster: base, series: 0, history: [], recentRoleByPlayer: {}, lastQB: null }));
  }

  function startNewGame() {
    // Archive a tiny summary
    const summary = {
      game: gameNumber || 1,
      endedAt: new Date().toISOString(),
      attendance: roster.filter((p) => p.active).map((p) => p.name),
      seriesPlayed: history.length,
    };
    // Reset sits + ALL per-game position counts to 0; keep captain tallies
    const base = roster.map((p) => ({ ...p, sits: 0, pos: Object.fromEntries(Object.keys(p.pos).map((k) => [k, 0])) }));
    const newQueue = base.filter((p) => p.active).map((p) => p.id);
    setState((s) => ({
      ...s,
      roster: base,
      queue: newQueue,
      series: 0,
      history: [],
      recentRoleByPlayer: {},
      lastQB: null,
      gameNumber: (gameNumber || 1) + 1,
      seasonHistory: [...(seasonHistory || []), summary],
      captainPlan: { ...s.captainPlan, recentPicks: [], pendingPicks: [] },
    }));
  }

  function exportState() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flag-coach-state-series-${series}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function importState(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        setState(data);
      } catch (err) {
        alert("Invalid file");
      }
    };
    reader.readAsText(file);
  }

  // ---------- Roster actions ----------
  function addPlayer() {
    const name = prompt("Player name");
    if (!name) return;
    setState((s) => {
      const exists = s.roster.some((p) => p.name.toLowerCase() === name.toLowerCase());
      const newPlayer = createEmptyTallies(name);
      const roster = exists ? s.roster : [...s.roster, newPlayer].sort((a, b) => a.name.localeCompare(b.name));
      const queue = roster.filter((p) => p.active).map((p) => p.id);
      const activeCount = roster.filter((p) => p.active).length;
      const groups = calculateCaptainGroups(activeCount, s.captainPlan?.gamesRemaining || DEFAULT_CAPTAIN_GAMES);
      const captainPlan = {
        ...s.captainPlan,
        seasonTargetTotal: roster.length * 2,
        nextGroupIndex: Math.min(s.captainPlan?.nextGroupIndex || 0, Math.max(groups.length - 1, 0)),
      };
      return { ...s, roster, queue, captainPlan };
    });
  }
  function removePlayer(id) {
    setState((s) => {
      const roster = s.roster.filter((p) => p.id !== id);
      const queue = s.queue.filter((q) => q !== id);
      const activeCount = roster.filter((p) => p.active).length;
      const groups = calculateCaptainGroups(activeCount, s.captainPlan?.gamesRemaining || DEFAULT_CAPTAIN_GAMES);
      const captainPlan = {
        ...s.captainPlan,
        seasonTargetTotal: roster.length * 2,
        nextGroupIndex: Math.min(s.captainPlan?.nextGroupIndex || 0, Math.max(groups.length - 1, 0)),
        recentPicks: (s.captainPlan?.recentPicks || []).filter((pid) => pid !== id),
        pendingPicks: (s.captainPlan?.pendingPicks || []).filter((pid) => pid !== id),
      };
      const recentRoleByPlayer = Object.fromEntries(Object.entries(s.recentRoleByPlayer || {}).filter(([pid]) => pid !== id));
      return { ...s, roster, queue, captainPlan, recentRoleByPlayer };
    });
  }
  function toggleActive(id) {
    setState((s) => {
      const player = s.roster.find((p) => p.id === id);
      const willBeActive = player ? !player.active : false;
      const roster = s.roster.map((p) => (p.id === id ? { ...p, active: !p.active } : p));
      const queue = roster.filter((p) => p.active).map((p) => p.id);
      const activeCount = roster.filter((p) => p.active).length;
      const groups = calculateCaptainGroups(activeCount, s.captainPlan?.gamesRemaining || DEFAULT_CAPTAIN_GAMES);
      const captainPlan = {
        ...s.captainPlan,
        nextGroupIndex: Math.min(s.captainPlan?.nextGroupIndex || 0, Math.max(groups.length - 1, 0)),
        pendingPicks: willBeActive
          ? s.captainPlan?.pendingPicks || []
          : (s.captainPlan?.pendingPicks || []).filter((pid) => pid !== id),
      };
      return { ...s, roster, queue, captainPlan };
    });
  }

  function toggleAbilityFlag(id, key) {
    setState((s) => ({
      ...s,
      roster: s.roster.map((p) => (p.id === id ? { ...p, [key]: !p[key] } : p)),
    }));
  }

   // ---------- Captains (balanced groups) ----------
  function pickNextCaptains() {
    setState((s) => {
      const activePlayersState = s.roster.filter((p) => p.active);
      if (!activePlayersState.length) return s;

      const groups = calculateCaptainGroups(
        activePlayersState.length,
        s.captainPlan?.gamesRemaining || DEFAULT_CAPTAIN_GAMES,
      );
      if (!groups.length) return s;

      const currentIndex = Math.min(s.captainPlan?.nextGroupIndex || 0, groups.length - 1);
      const targetCount = groups[currentIndex] || 0;
      if (!targetCount) return s;

      const shuffled = rngShuffle(activePlayersState);
      shuffled.sort((a, b) => {
        const diff = (a.captains || 0) - (b.captains || 0);
        if (diff) return diff;
        return a.name.localeCompare(b.name);
      });

      const picks = shuffled.slice(0, targetCount).map((p) => p.id);
      if (!picks.length) return s;

    return {
        ...s,
        captainPlan: {
          ...s.captainPlan,
          pendingPicks: picks,
        },
      };
    });
  }

  function clearPendingCaptains() {
    setState((s) => ({
      ...s,
      captainPlan: {
        ...s.captainPlan,
        pendingPicks: [],
      },
    }));
  }

  function togglePendingCaptain(id) {
    setState((s) => {
      const activePlayersState = s.roster.filter((p) => p.active);
      if (!activePlayersState.find((p) => p.id === id)) return s;

      const groups = calculateCaptainGroups(
        activePlayersState.length,
        s.captainPlan?.gamesRemaining || DEFAULT_CAPTAIN_GAMES,
      );
      if (!groups.length) return s;

      const currentIndex = Math.min(s.captainPlan?.nextGroupIndex || 0, groups.length - 1);
      const targetCount = groups[currentIndex] || 0;
      if (!targetCount) return s;

      const pending = s.captainPlan?.pendingPicks || [];

      if (pending.includes(id)) {
        return {
          ...s,
          captainPlan: {
            ...s.captainPlan,
            pendingPicks: pending.filter((pid) => pid !== id),
          },
        };
      }

      if (pending.length >= targetCount) {
        return s;
      }

      return {
        ...s,
        captainPlan: {
          ...s.captainPlan,
          pendingPicks: [...pending, id],
        },
      };
    });
  }

  function acceptPendingCaptains() {
    setState((s) => {
      const activePlayersState = s.roster.filter((p) => p.active);
      if (!activePlayersState.length) return s;

      const groups = calculateCaptainGroups(
        activePlayersState.length,
        s.captainPlan?.gamesRemaining || DEFAULT_CAPTAIN_GAMES,
      );
      if (!groups.length) return s;

      const currentIndex = Math.min(s.captainPlan?.nextGroupIndex || 0, groups.length - 1);
      const targetCount = groups[currentIndex] || 0;
      if (!targetCount) return s;

      const activeIdSet = new Set(activePlayersState.map((p) => p.id));
      const pending = (s.captainPlan?.pendingPicks || []).filter((id) => activeIdSet.has(id));
      const uniquePending = [...new Set(pending)];

      if (uniquePending.length !== targetCount) {
        return s;
      }

      const updatedRoster = s.roster.map((p) => (
        uniquePending.includes(p.id)
          ? { ...p, captains: (p.captains || 0) + 1 }
          : p
      ));

      const nextIndex = Math.min(currentIndex + 1, Math.max(groups.length - 1, 0));

      return {
        ...s,
        roster: updatedRoster,
        captainPlan: {
          ...s.captainPlan,
          recentPicks: uniquePending,
          pendingPicks: [],
          nextGroupIndex: nextIndex,
        },
      };
    });
  }

  // ---------- Position assignment engine (random + balanced per game) ----------
  function eligiblePoolForRole(role, candidates, alreadyAssigned, currentSeries) {
    const abilityCheck = ROLE_ABILITY_CHECK[role];

    const allowed = candidates.filter((id) => {
      if (alreadyAssigned.has(id)) return false;
      const player = byId.get(id);
      if (!player) return false;
      if (abilityCheck && !abilityCheck(player)) return false;
      return true;
    });

    if (!allowed.length) return [];
    
    let pool = allowed;

    // Optional: no-repeat same role family in last N series
    if (settings.noRepeatWindow && settings.noRepeatWindow > 0) {
      const group = roleGroup(role);
      const filtered = pool.filter((id) => {
        const rec = recentRoleByPlayer[id];
        if (!rec) return true;
        const within = rec.series >= currentSeries - settings.noRepeatWindow;
        return !(within && rec.role === group);
      });
      if (filtered.length) {
        pool = filtered;
      }
    }

    // Prefer players who haven't played this role yet this game
    const zeroPool = pool.filter((id) => byId.get(id).pos[role] === 0);
    if (zeroPool.length) return rngShuffle(zeroPool);

    // Otherwise, pick from minimum per-game count for this role
    const counts = pool.map((id) => byId.get(id).pos[role]);
    const minCount = Math.min(...counts);
    const minPool = pool.filter((id) => byId.get(id).pos[role] === minCount);
    return rngShuffle(minPool);
  }

  function pickForRole(role, candidates, alreadyAssigned, currentSeries) {
    const pool = eligiblePoolForRole(role, candidates, alreadyAssigned, currentSeries);
    if (!pool.length) return null;
    return pool[0] || null; // already shuffled randomly
  }

  function nextSeries(which) {
    const currentSeries = series + 1;
    if (totalActive < settings.teamSize) {
      alert(`Need at least ${settings.teamSize} active players. Currently ${totalActive}.`);
      return;
    }

    const advance = Math.max(1, sitCount);
    const sitIds = queue.slice(0, sitCount);
    const playIds = queue.slice(sitCount, sitCount + settings.teamSize);

    let offense = null, defense = null;
    const assigned = new Set();

    if (which === "Offense") {
      const mapping = {};
      for (const r of OFFENSE_ROLES) {
        const id = pickForRole(r, playIds, assigned, currentSeries);
        if (id) { mapping[r] = id; assigned.add(id); }
      }
      offense = mapping;
    } else {
      const mapping = {};
      for (const r of DEFENSE_ROLES) {
        const id = pickForRole(r, playIds, assigned, currentSeries);
        if (id) { mapping[r] = id; assigned.add(id); }
      }
      defense = mapping;
    }

    const entry = { phase: which, series: currentSeries, sitIds, playIds, offense, defense, recentBefore: recentRoleByPlayer };

    const updatedRoster = roster.map((p) => {
      if (sitIds.includes(p.id)) return { ...p, sits: p.sits + 1 };
      const roleMap = which === 'Offense' ? offense : defense;
      const myRole = Object.entries(roleMap || {}).find(([, pid]) => pid === p.id)?.[0];
      if (myRole && p.pos[myRole] !== undefined) return { ...p, pos: { ...p.pos, [myRole]: p.pos[myRole] + 1 } };
      return p;
    });

    const recentUpdate = { ...recentRoleByPlayer };
    const mappingNow = which === 'Offense' ? offense : defense;
    Object.entries(mappingNow || {}).forEach(([role, pid]) => {
      recentUpdate[pid] = { role: roleGroup(role), series: currentSeries };
    });

    const newQueue = [...queue.slice(advance), ...queue.slice(0, advance)];

     setState((s) => ({
      ...s,
      roster: updatedRoster,
      queue: newQueue,
      series: currentSeries,
      history: [...s.history, entry],
      recentRoleByPlayer: recentUpdate,
      }));
  }

  function undo() {
    if (!history.length) return;
    const last = history[history.length - 1];

    const restored = roster.map((p) => {
      if (last.sitIds.includes(p.id)) return { ...p, sits: Math.max(0, p.sits - 1) };
      if (last.phase === "Offense" && last.offense) {
        const myRole = Object.entries(last.offense).find(([, pid]) => pid === p.id)?.[0];
        if (myRole && p.pos[myRole] !== undefined) return { ...p, pos: { ...p.pos, [myRole]: Math.max(0, p.pos[myRole] - 1) } };
      }
      if (last.phase === "Defense" && last.defense) {
        const myRole = Object.entries(last.defense).find(([, pid]) => pid === p.id)?.[0];
        if (myRole && p.pos[myRole] !== undefined) return { ...p, pos: { ...p.pos, [myRole]: Math.max(0, p.pos[myRole] - 1) } };
      }
      return p;
    });

    const advance = Math.max(1, Math.max(totalActive - settings.teamSize, 0));
    const newQueue = [...queue.slice(-advance), ...queue.slice(0, -advance)];

    setState({
      ...state,
      roster: restored,
      queue: newQueue,
      series: Math.max(0, series - 1),
      history: history.slice(0, -1),
      recentRoleByPlayer: normalizeRecentMap(last.recentBefore || {}),
    });
  }

  // ---------- UI helpers ----------
  function PlayerTag({ id, className = "" }) {
    const p = byId.get(id);
    if (!p) return null;
    return (
      <span
        className={`inline-flex items-center rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-sm ${className}`.trim()}
      >
        {p.name}
      </span>
    );
  }
  function FormationBoard({ title, layout, mapping }) {
    const columns = layout.reduce((max, row) => Math.max(max, row.length), 0);
    const columnClassMap = {
      1: "grid-cols-1",
      2: "grid-cols-2",
      3: "grid-cols-3",
      4: "grid-cols-4",
      5: "grid-cols-5",
    };
    const columnClass = columnClassMap[columns] || "grid-cols-1";

    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="mb-3 font-semibold">{title}</div>
        <div className="space-y-2">
          {layout.map((row, rowIndex) => (
            <div key={rowIndex} className={`grid gap-2 ${columnClass}`}>
              {row.map((slot, slotIndex) => {
                if (!slot) {
                  return (
                    <div
                      key={`empty-${rowIndex}-${slotIndex}`}
                      className="flex items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-gray-500"
                    >
                      None
                    </div>
                  );
                }

                const label = ROLE_META[slot]?.label || slot;
                const assigned = mapping?.[slot];

                return (
                  <div
                    key={slot}
                    className="flex min-h-[72px] flex-col items-center justify-center rounded-xl bg-white/10 px-3 py-2 text-center"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-300">{label}</span>
                    {assigned ? (
                      <PlayerTag id={assigned} className="mt-2" />
                    ) : (
                      <span className="mt-2 text-xs text-gray-400">(open)</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const lastEntry = history[history.length - 1];
  const captainUsed = roster.reduce((sum, p) => sum + (p.captains || 0), 0);
  const captainNeeded = Math.max(0, (captainPlan.seasonTargetTotal || 0) - captainUsed);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 mx-auto max-w-6xl pb-28">
      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-gray-900/90 backdrop-blur supports-[backdrop-filter]:bg-gray-900/70">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">7v7 Flag Coach</h1>
            <p className="text-xs text-gray-300">Game {gameNumber} • Series {series} • Active {totalActive} • Sit {sitCount}</p>
          </div>
          <div className="flex gap-2">
            <button className="rounded-2xl border border-white/30 hover:border-white/60 bg-white/5 px-3 py-1 text-sm" onClick={() => setState((s)=>({...s, ui:{...s.ui, showAttendance:true}}))}>Attendance</button>
            <button className="rounded-2xl border border-white/30 hover:border-white/60 bg-white/5 px-3 py-1 text-sm" onClick={() => setState((s)=>({...s, ui:{...s.ui, showSettings:true}}))}>Settings</button>
          </div>
        </div>
      </header>

      <main className="px-4 space-y-3">
        {/* Current Assignments */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Current Assignments</h2>
            <span className="text-sm text-gray-300">{lastEntry ? `${lastEntry.phase} • Series ${lastEntry.series}` : "(none yet)"}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormationBoard title="Offense" layout={OFFENSE_LAYOUT} mapping={lastEntry?.offense || {}} />
            <FormationBoard title="Defense" layout={DEFENSE_LAYOUT} mapping={lastEntry?.defense || {}} />
          </div>
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 font-semibold">Sitting this series</div>
            <div className="flex flex-wrap gap-2">
              {(lastEntry?.sitIds || []).map((id) => (<PlayerTag key={id} id={id} />))}
              {!(lastEntry?.sitIds || []).length && <div className="text-sm text-gray-300">(none yet)</div>}
            </div>
          </div>
        </section>

        {/* Next Bench Preview */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="mb-1 font-semibold">Next bench (preview)</div>
          <div className="flex flex-wrap gap-2">
            {queue.slice(0, sitCount).map((id) => (<PlayerTag key={id} id={id} />))}
            {!sitCount && <div className="text-sm text-gray-300">(no one sits)</div>}
          </div>
        </section>

        {/* Captains: Alphabetical Queue */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Captains</h2>
            <div className="text-sm">Used <b>{captainUsed}</b> / Target <b>{captainPlan.seasonTargetTotal}</b> • Rem <b>{captainNeeded}</b></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-2xl border border-white/30 hover:border-white/60 bg-white/5 px-4 py-2 disabled:opacity-50 disabled:hover:border-white/30"
              onClick={pickNextCaptains}
              disabled={!nextCaptainGroupSize}
            >
              {nextCaptainGroupSize ? `Pick Next Captains (${nextCaptainGroupSize})` : "Pick Next Captains"}
            </button>
            <button
              className="rounded-2xl border border-emerald-400/40 hover:border-emerald-300 bg-emerald-400/10 px-4 py-2 text-emerald-200 disabled:border-white/20 disabled:bg-transparent disabled:text-gray-400 disabled:hover:border-white/20"
              onClick={acceptPendingCaptains}
              disabled={!canAcceptCaptains}
            >
              Accept Captains
            </button>
            <button
              className="rounded-2xl border border-white/20 hover:border-white/40 bg-white/5 px-3 py-2 text-sm disabled:opacity-50 disabled:hover:border-white/20"
              onClick={clearPendingCaptains}
              disabled={!pendingCaptainIds.length}
            >
              Clear Selection
            </button>
          </div>
          <div className="mt-3 space-y-1 text-sm text-gray-200">
            <div>
              Next group size: <b>{nextCaptainGroupSize || "--"}</b>
              {nextCaptainGroupSize ? ` • Selected ${pendingCaptainIds.length}/${nextCaptainGroupSize}` : ""}
            </div>
            {pendingCaptainNames.length ? (
              <div>Pending: {pendingCaptainNames.join(", ")}</div>
            ) : (
              <div className="text-gray-400">No captains selected yet.</div>
            )}
          </div>
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wide text-gray-400">
              Tap to toggle captains
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {activePlayers.length ? (
                activePlayers.map((p) => {
                  const isSelected = pendingCaptainSet.has(p.id);
                  const allowSelection = nextCaptainGroupSize > 0;
                  const atLimit = !isSelected && pendingCaptainIds.length >= nextCaptainGroupSize && allowSelection;
                  const disabled = (!allowSelection && !isSelected) || atLimit;
                  return (
                    <button
                      key={p.id}
                      className={`rounded-xl border px-3 py-2 text-sm transition ${
                        isSelected
                          ? "border-emerald-300 bg-emerald-300/20 text-emerald-100"
                          : disabled
                            ? "border-white/10 bg-white/5 text-gray-500"
                            : "border-white/20 bg-white/5 text-gray-200 hover:border-white/40"
                      }`}
                      onClick={() => togglePendingCaptain(p.id)}
                      disabled={disabled}
                    >
                      {p.name}
                    </button>
                  );
                })
              ) : (
                <div className="text-sm text-gray-400">No active players available.</div>
              )}
            </div>
          </div>
          <div className="mt-3 space-y-1 text-xs text-gray-300">
            <div>
              Last accepted: {recentCaptainNames.length ? recentCaptainNames.join(", ") : "(none)"}
            </div>
            <div>
              Plan: {captainGroups.length ? captainGroups.join(" • ") : "--"} captains over {captainGroups.length || 0} game{captainGroups.length === 1 ? "" : "s"} • Games left setting: {captainPlan.gamesRemaining || DEFAULT_CAPTAIN_GAMES}
            </div>
          </div>         
        </section>

        {/* Tally Board (mobile scroll) */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <button
            className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left"
            onClick={() => setShowTally((v) => !v)}
          >
            <span className="text-lg font-semibold">Tally Board</span>
            <span className="text-sm text-gray-300">{showTally ? "Hide" : "Show"}</span>
          </button>
          {showTally && (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="p-2">Player</th>
                    <th className="p-2 border-l border-white/10">Capt</th>
                    <th className="p-2 border-l border-white/10">Sits</th>
                    <th className="p-2 border-l border-white/10 text-center" colSpan={OFFENSE_ROLES.length}>Offense</th>
                    <th className="p-2 border-l border-white/10 text-center" colSpan={DEFENSE_ROLES.length}>Defense</th>
                  </tr>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-300">
                    <th className="p-2"></th>
                    <th className="p-2 border-l border-white/10"></th>
                    <th className="p-2 border-l border-white/10"></th>
                    {OFFENSE_ROLES.map((r, idx) => (
                      <th
                        key={r}
                        className={"p-2" + (idx === 0 ? " border-l border-white/10" : "")}
                        title={r}
                      >
                        {ROLE_META[r]?.label || r}
                      </th>
                    ))}
                    {DEFENSE_ROLES.map((r, idx) => (
                      <th
                        key={r}
                        className={"p-2" + (idx === 0 ? " border-l border-white/10" : "")}
                        title={r}
                      >
                        {ROLE_META[r]?.label || r}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((p) => (
                    <tr key={p.id} className={!p.active ? "opacity-60" : undefined}>
                      <td className="p-2 whitespace-nowrap">{p.name}</td>
                      <td className="p-2 border-l border-white/10">{p.captains || 0}</td>
                      <td className="p-2 border-l border-white/10">{p.sits}</td>
                      {OFFENSE_ROLES.map((r, idx) => (
                        <td key={r} className={"p-2" + (idx === 0 ? " border-l border-white/10" : "")}>{p.pos[r]}</td>
                      ))}
                      {DEFENSE_ROLES.map((r, idx) => (
                        <td key={r} className={"p-2" + (idx === 0 ? " border-l border-white/10" : "")}>{p.pos[r]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Notes */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-gray-300">
          <details>
            <summary className="cursor-pointer font-medium">Notes (tap)</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Positions are random-balanced per game: prefer 0-count, otherwise minimum count; tie-break random.</li>
                <li>Captains are balanced: lowest totals are picked first using the remaining-games plan (3 • 3 • 4 by default).</li>
                <li>Start New Game clears **all positions & sits** but keeps captain counts.</li>
              </ul>
          </details>
        </section>
      </main>

      {/* Sticky bottom control bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-gray-900/95 backdrop-blur border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-3 grid grid-cols-2 gap-3">
          <button className="h-12 rounded-2xl text-base font-semibold border border-white/30 bg-white/5" onClick={() => nextSeries('Offense')}>Offense</button>
          <button className="h-12 rounded-2xl text-base font-semibold border border-white/30 bg-white/5" onClick={() => nextSeries('Defense')}>Defense</button>
          <button className="col-span-2 h-10 rounded-xl text-sm border border-white/20 bg-white/5" onClick={undo} disabled={!history.length}>Undo</button>
          <div className="col-span-2 grid grid-cols-3 gap-2 text-xs">
            <button className="rounded-xl border border-white/20 bg-white/5 py-2" onClick={startNewGame}>Start New Game</button>
            <button className="rounded-xl border border-white/20 bg-white/5 py-2" onClick={resetPositionsOnly}>Reset Positions</button>
            <button className="rounded-xl border border-white/20 bg-white/5 py-2" onClick={addPlayer}>Add Player</button>
          </div>
        </div>
      </div>

      {/* Attendance Modal */}
      {ui.showAttendance && (
        <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={() => setState((s)=>({...s, ui:{...s.ui, showAttendance:false}}))}>
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-white/10 bg-gray-900" onClick={(e)=>e.stopPropagation()}>
            <div className="p-4 flex items-center justify-between border-b border-white/10">
              <h3 className="text-lg font-semibold">Attendance</h3>
              <button className="rounded-xl border border-white/30 bg-white/10 px-3 py-1 text-sm" onClick={() => setState((s)=>({...s, ui:{...s.ui, showAttendance:false}}))}>Close</button>
            </div>
            <div className="p-3 space-y-2 max-h-[70vh] overflow-auto">
              {roster.map((p) => (
                 <div key={p.id} className="flex flex-col gap-2 rounded-xl bg-white/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex items-center gap-3 text-base">
                    <input type="checkbox" className="h-5 w-5" checked={p.active} onChange={() => toggleActive(p.id)} />
                    <span>{p.name}</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1">
                        <input type="checkbox" className="h-4 w-4" checked={!!p.canQB} onChange={() => toggleAbilityFlag(p.id, "canQB")} />
                        <span>QB ok</span>
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" className="h-4 w-4" checked={!!p.canCenter} onChange={() => toggleAbilityFlag(p.id, "canCenter")} />
                        <span>C ok</span>
                      </label>
                    </div>
                    <span>Capt: {p.captains || 0}</span>                  
                    <button className="rounded-lg border border-white/30 bg-white/10 px-2 py-1" onClick={() => removePlayer(p.id)}>remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {ui.showSettings && (
        <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={() => setState((s)=>({...s, ui:{...s.ui, showSettings:false}}))}>
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-white/10 bg-gray-900" onClick={(e)=>e.stopPropagation()}>
            <div className="p-4 flex items-center justify-between border-b border-white/10">
              <h3 className="text-lg font-semibold">Settings</h3>
              <button className="rounded-xl border border-white/30 bg-white/10 px-3 py-1 text-sm" onClick={() => setState((s)=>({...s, ui:{...s.ui, showSettings:false}}))}>Close</button>
            </div>
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Team size on field</span>
                <input type="number" className="w-20 rounded border border-white/20 bg-transparent px-2 py-1" value={settings.teamSize}
                  onChange={(e)=>setState((s)=>({...s, settings:{...s.settings, teamSize: Math.max(1, Math.floor(+e.target.value||7))}}))} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">No repeat same role in last 1 series</span>
                <input type="checkbox" className="h-5 w-5" checked={!!settings.noRepeatWindow}
                  onChange={()=>setState((s)=>({...s, settings:{...s.settings, noRepeatWindow: s.settings.noRepeatWindow ? 0 : 1}}))} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Captain games remaining</span>
                <input
                  type="number"
                  className="w-20 rounded border border-white/20 bg-transparent px-2 py-1"
                  value={captainPlan.gamesRemaining || DEFAULT_CAPTAIN_GAMES}
                  min={1}
                  onChange={(e) => {
                    const value = Math.max(1, Math.floor(+e.target.value || DEFAULT_CAPTAIN_GAMES));
                    setState((s) => {
                      const activeCount = s.roster.filter((p) => p.active).length;
                      const groups = calculateCaptainGroups(activeCount, value);
                      return {
                        ...s,
                        captainPlan: {
                          ...s.captainPlan,
                          gamesRemaining: value,
                          nextGroupIndex: Math.min(s.captainPlan?.nextGroupIndex || 0, Math.max(groups.length - 1, 0)),
                        },
                      };
                    });
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
