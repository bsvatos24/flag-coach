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
const OFFENSE_ROLE_SET = new Set(OFFENSE_ROLES);
const DEFENSE_ROLE_SET = new Set(DEFENSE_ROLES);

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

const PLAYER_ROLE_RESTRICTIONS = {
  Atticus: {
    offense: ["off_te_left", "off_te_right"],
    defense: ["def_de_left", "def_de_right", "def_dt"],
  },
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
const BENCH_PRIORITY_FIRST_OFFENSE = ["Logan L", "Atticus", "Gunnar"];
const MUST_PLAY_FIRST_DEFENSE = BENCH_PRIORITY_FIRST_OFFENSE;
const BENCH_NEVER_ALL = ["CJ", "Niko", "Barrett"];
const DEFAULT_BENCH_META = { firstOffenseHandled: false, firstDefenseHandled: false };

// ---------- Helpers ----------
function createEmptyTallies(name) {
  const pos = {};
  [...OFFENSE_ROLES, ...DEFENSE_ROLES].forEach((r) => (pos[r] = 0));
  return {
    name,
    active: true,
    sits: 0,
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

function buildQueueFromActive(roster, previousQueue = []) {
  const activeIds = roster.filter((p) => p.active).map((p) => p.id);
  if (!activeIds.length) return [];
  const preserved = previousQueue.filter((id) => activeIds.includes(id));
  if (preserved.length === activeIds.length && preserved.length) {
    return preserved;
  }
  const missing = activeIds.filter((id) => !preserved.includes(id));
  const shuffledMissing = rngShuffle(missing);
  return preserved.length ? [...preserved, ...shuffledMissing] : shuffledMissing;
}

function findActivePlayerIdByName(roster, name) {
  const target = roster.find((p) => p.active && p.name.toLowerCase() === name.toLowerCase());
  return target ? target.id : null;
}

// Build a fresh roster: positions zeroed
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
    queue: buildQueueFromActive(baseRoster),
    series: 0,
    history: [],
    settings: baseSettings,
    recentRoleByPlayer: {},
    benchMeta: { ...DEFAULT_BENCH_META },
    lastQB: null,
    gameNumber: 1,
    seasonHistory: [],
    ui: { showAttendance: false, showSettings: false },
  };

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const { captainQueue: _discardQueue, captainIndex: _discardIndex, captainPlan: _legacyCaptain, ...restData } = data || {};
      const storedRoster = (restData.roster || []).map((p) => normalizePlayer(p));
      const activeIds = storedRoster.filter((p) => p.active).map((p) => p.id);
      const storedQueue = (restData.queue || []).filter((id) => activeIds.includes(id));
      const normalizedRecent = normalizeRecentMap(restData.recentRoleByPlayer);
      const normalizedRoster = storedRoster.length ? storedRoster : baseRoster;
      const queueFromStorage = buildQueueFromActive(normalizedRoster, storedQueue);
      return {
        ...baseState,
        ...restData,
        roster: normalizedRoster,
        queue: queueFromStorage.length ? queueFromStorage : baseState.queue,
        settings: { ...baseSettings, ...(restData.settings || {}) },
        history: normalizeHistoryEntries(restData.history || []),
        recentRoleByPlayer: normalizedRecent,
        seasonHistory: restData.seasonHistory || [],
        benchMeta: restData.benchMeta ? { ...DEFAULT_BENCH_META, ...restData.benchMeta } : baseState.benchMeta,
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
    benchMeta,
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
  
  // Persist
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }, [state]);

  // Keep queue limited to active players (preserve order among actives)
  useEffect(() => {
    const activeIds = activePlayers.map((p) => p.id);
    const filtered = queue.filter((id) => activeIds.includes(id));
    if (filtered.length !== queue.length || filtered.length !== activeIds.length) {
      const missing = activeIds.filter((id) => !filtered.includes(id));
      const updated = missing.length ? [...filtered, ...rngShuffle(missing)] : filtered;
      setState((s) => ({ ...s, queue: updated }));
    }
  }, [activePlayers, queue]);

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
    // Reset sits + ALL per-game position counts to 0
    const base = roster.map((p) => ({ ...p, sits: 0, pos: Object.fromEntries(Object.keys(p.pos).map((k) => [k, 0])) }));
    const newQueue = buildQueueFromActive(base);
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
      benchMeta: { ...DEFAULT_BENCH_META },
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
      if (exists) return s;
      const newPlayer = createEmptyTallies(name);
      const roster = [...s.roster, newPlayer].sort((a, b) => a.name.localeCompare(b.name));
      const queue = buildQueueFromActive(roster, s.queue);
      return { ...s, roster, queue };
    });
  }
  function removePlayer(id) {
    setState((s) => {
      const roster = s.roster.filter((p) => p.id !== id);
      const filteredQueue = s.queue.filter((q) => q !== id);
      const queue = buildQueueFromActive(roster, filteredQueue);
      const recentRoleByPlayer = Object.fromEntries(Object.entries(s.recentRoleByPlayer || {}).filter(([pid]) => pid !== id));
      return { ...s, roster, queue, recentRoleByPlayer };
    });
  }
  function toggleActive(id) {
    setState((s) => {
      const roster = s.roster.map((p) => (p.id === id ? { ...p, active: !p.active } : p));
      const queue = buildQueueFromActive(roster, s.queue);
      return { ...s, roster, queue };
    });
  }

  function toggleAbilityFlag(id, key) {
    setState((s) => ({
      ...s,
      roster: s.roster.map((p) => (p.id === id ? { ...p, [key]: !p[key] } : p)),
    }));
  }

  // ---------- Position assignment engine (random + balanced per game) ----------
  function eligiblePoolForRole(role, candidates, alreadyAssigned, currentSeries) {
    const abilityCheck = ROLE_ABILITY_CHECK[role];

    const allowed = candidates.filter((id) => {
      if (alreadyAssigned.has(id)) return false;
      const player = byId.get(id);
      if (!player) return false;
      if (abilityCheck && !abilityCheck(player)) return false;
      const restrictions = PLAYER_ROLE_RESTRICTIONS[player.name];
      if (restrictions) {
        const scope = OFFENSE_ROLE_SET.has(role)
          ? restrictions.offense
          : DEFENSE_ROLE_SET.has(role)
          ? restrictions.defense
          : null;
        if (scope && !scope.includes(role)) return false;
      }
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
    const benchMetaBefore = benchMeta || DEFAULT_BENCH_META;
    let nextBenchMeta = benchMetaBefore;
    let workingQueue = [...queue];

    if (which === "Offense" && !benchMetaBefore.firstOffenseHandled) {
      if (sitCount > 0) {
        const priorityIds = BENCH_PRIORITY_FIRST_OFFENSE
          .map((name) => findActivePlayerIdByName(roster, name))
          .filter((id) => id && workingQueue.includes(id));
        if (priorityIds.length) {
          const seats = Math.min(sitCount, priorityIds.length);
          const idsToFront = priorityIds.slice(0, seats);
          const rest = workingQueue.filter((id) => !idsToFront.includes(id));
          workingQueue = [...idsToFront, ...rest];
        }
      }
      nextBenchMeta = { ...benchMetaBefore, firstOffenseHandled: true };
    }

    if (which === "Defense" && !benchMetaBefore.firstDefenseHandled) {
      const requiredIds = MUST_PLAY_FIRST_DEFENSE
        .map((name) => findActivePlayerIdByName(roster, name))
        .filter((id) => id && workingQueue.includes(id));
      if (requiredIds.length) {
        const requiredOrdered = [...requiredIds].sort(
          (a, b) => workingQueue.indexOf(a) - workingQueue.indexOf(b),
        );
        const requiredSet = new Set(requiredOrdered);
        const filteredQueue = workingQueue.filter((id) => !requiredSet.has(id));
        const benchSlice = filteredQueue.slice(0, sitCount);
        const playSlice = filteredQueue.slice(sitCount);
        workingQueue = [...benchSlice, ...requiredOrdered, ...playSlice];
      }
      nextBenchMeta = { ...nextBenchMeta, firstDefenseHandled: true };
    }
    
    let sitIds = workingQueue.slice(0, sitCount);
    let playIds = workingQueue.slice(sitCount, sitCount + settings.teamSize);

    if (sitCount > 0) {
      const avoidIds = BENCH_NEVER_ALL
        .map((name) => findActivePlayerIdByName(roster, name))
        .filter((id) => id && workingQueue.includes(id));
      if (avoidIds.length === BENCH_NEVER_ALL.length && avoidIds.every((id) => sitIds.includes(id))) {
        const avoidSet = new Set(avoidIds);
        const swapCandidate = playIds.find((id) => !avoidSet.has(id));
        if (swapCandidate) {
          const swapInBench = avoidIds.find((id) => sitIds.includes(id));
          const benchIndex = workingQueue.indexOf(swapInBench);
          const playIndex = workingQueue.indexOf(swapCandidate);
          if (benchIndex >= 0 && playIndex >= 0) {
            const updatedQueue = [...workingQueue];
            [updatedQueue[benchIndex], updatedQueue[playIndex]] = [updatedQueue[playIndex], updatedQueue[benchIndex]];
            workingQueue = updatedQueue;
            sitIds = workingQueue.slice(0, sitCount);
            playIds = workingQueue.slice(sitCount, sitCount + settings.teamSize);
          }
        }
      }
    }

    let offense = null, defense = null;
    const assigned = new Set();

    if (which === "Offense") {
      const mapping = {};
      const prioritizedRoles = [
        ...["off_qb", "off_c"].filter((role) => OFFENSE_ROLES.includes(role)),
        ...OFFENSE_ROLES.filter((role) => role !== "off_qb" && role !== "off_c"),
      ];
      for (const r of prioritizedRoles) {
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

    const entry = {
      phase: which,
      series: currentSeries,
      sitIds,
      playIds,
      offense,
      defense,
      recentBefore: recentRoleByPlayer,
      benchMetaBefore,
    };

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

    const newQueue = [...workingQueue.slice(advance), ...workingQueue.slice(0, advance)];

     setState((s) => ({
      ...s,
      roster: updatedRoster,
      queue: newQueue,
      series: currentSeries,
      history: [...s.history, entry],
      recentRoleByPlayer: recentUpdate,
      benchMeta: nextBenchMeta,
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

    const benchMetaRestored = Object.prototype.hasOwnProperty.call(last, "benchMetaBefore")
      ? { ...DEFAULT_BENCH_META, ...(last.benchMetaBefore || {}) }
      : benchMeta;

    setState({
      ...state,
      roster: restored,
      queue: newQueue,
      series: Math.max(0, series - 1),
      history: history.slice(0, -1),
      recentRoleByPlayer: normalizeRecentMap(last.recentBefore || {}),
      benchMeta: benchMetaRestored,
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
  function FormationBoard({ title, layout, mapping, action, sitIds = [], isActive = false }) {
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
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-semibold">{title}</div>
          {action || null}
        </div>
        <div className="space-y-2">
          {layout.map((row, rowIndex) => (
            <div key={rowIndex} className={`grid gap-2 ${columnClass}`}>
              {row.map((slot, slotIndex) => {
                if (!slot) {
                  return (
                    <div
                      key={`empty-${rowIndex}-${slotIndex}`}
                      className="min-h-[72px]"
                      aria-hidden="true"
                    />
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
        {isActive && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 font-semibold">Sitting this series</div>
            <div className="flex flex-wrap gap-2">
              {sitIds.length ? (
                sitIds.map((id) => <PlayerTag key={id} id={id} />)
              ) : (
                <div className="text-sm text-gray-300">(none yet)</div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  const lastEntry = history[history.length - 1];

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
            <FormationBoard
              title="Offense"
              layout={OFFENSE_LAYOUT}
              mapping={lastEntry?.offense || {}}
              sitIds={lastEntry?.sitIds || []}
              isActive={lastEntry?.phase === "Offense"}
              action={(
                <button
                  type="button"
                  className="rounded-xl border border-white/30 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-200 hover:border-white/60"
                  onClick={() => nextSeries('Offense')}
                >
                  Run Offense
                </button>
              )}
            />
            <FormationBoard
              title="Defense"
              layout={DEFENSE_LAYOUT}
              mapping={lastEntry?.defense || {}}
              sitIds={lastEntry?.sitIds || []}
              isActive={lastEntry?.phase === "Defense"}
              action={(
                <button
                  type="button"
                  className="rounded-xl border border-white/30 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-200 hover:border-white/60"
                  onClick={() => nextSeries('Defense')}
                >
                  Run Defense
                </button>
              )}
            />
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
                    <th className="p-2 border-l border-white/10">Sits</th>
                    <th className="p-2 border-l border-white/10 text-center" colSpan={OFFENSE_ROLES.length}>Offense</th>
                    <th className="p-2 border-l border-white/10 text-center" colSpan={DEFENSE_ROLES.length}>Defense</th>
                  </tr>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-300">
                    <th className="p-2"></th>
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
                <li>Bench rotation is randomized with first-offense priorities and no triple-sit (CJ, Niko, Barrett).</li>
                <li>Start New Game clears **all positions & sits**.</li>
              </ul>
          </details>
        </section>
      </main>

      {/* Sticky bottom control bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-gray-900/95 backdrop-blur border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-3 space-y-3">
          <button className="w-full h-10 rounded-xl text-sm border border-white/20 bg-white/5" onClick={undo} disabled={!history.length}>Undo</button>
          <div className="grid grid-cols-3 gap-2 text-xs">
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
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-pressed={!!p.canQB}
                        onClick={() => toggleAbilityFlag(p.id, "canQB")}
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1 font-semibold uppercase tracking-wide transition focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                          p.canQB
                            ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                            : "border-red-400/60 bg-red-500/10 text-red-200"
                        }`}
                      >
                        <span className="text-base leading-none">{p.canQB ? "✓" : "✕"}</span>
                        <span>QB</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={!!p.canCenter}
                        onClick={() => toggleAbilityFlag(p.id, "canCenter")}
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1 font-semibold uppercase tracking-wide transition focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                          p.canCenter
                            ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                            : "border-red-400/60 bg-red-500/10 text-red-200"
                        }`}
                      >
                        <span className="text-base leading-none">{p.canCenter ? "✓" : "✕"}</span>
                        <span>C</span>
                      </button>
                    </div>               
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
