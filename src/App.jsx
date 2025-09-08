import React, { useEffect, useMemo, useState } from "react";

/**
 * 7v7 Flag Football Coach – Rotations, Positions & Captains (GitHub Pages Ready)
 * ----------------------------------------------------------------------------
 * Core logic:
 * - Bench rotates every series (advance by sitCount; if 0, advance by 1 so roles still rotate)
 * - Universal "no repeat same role in back-to-back series" for ALL roles (O & D)
 * - Per-role fairness: pick from players with the minimum season count for that role (present-only)
 * - Captains planner to target 2 per player over season (default Weeks 2–7: [3,3,3,3,3,2])
 * - Attendance toggles; early exits can be simulated by toggling a player inactive mid-game
 * - Local persistence (localStorage) + Export/Import JSON; also a "Reset to Seeded (Week‑1 only)"
 * - Seeded Week‑1 stats per user: Captains (Niko, Sully, CJ), QB (Logan L, Gunnar, Jeremiah, Atticus),
 *   RB (CJ, Niko, Logan M, Barrett), Blitzer (Sully, Atticus, Gunnar, CJ). All others 0.
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

const OFFENSE_ROLES = ["QB", "RB", "C", "WR1", "WR2", "TE1", "TE2"];
const DEFENSE_ROLES = ["DT", "DE1", "DE2", "CB1", "CB2", "Spy", "Blitzer"];

const LS_KEY = "ffb-rotation-state-v4";

function createEmptyTallies(name) {
  const pos = {};
  [...OFFENSE_ROLES, ...DEFENSE_ROLES].forEach((r) => (pos[r] = 0));
  return { name, active: true, sits: 0, captains: 0, pos, id: crypto.randomUUID() };
}

// Build a fresh seeded roster from DEFAULT_ROSTER and the user's Week‑1 inputs
function buildSeededRoster() {
  const roster = DEFAULT_ROSTER.map((n) => createEmptyTallies(n)).sort((a, b) => a.name.localeCompare(b.name));
  const seedCaptains = new Set(["Niko", "Sully", "CJ"]);
  const seedQB = new Set(["Logan L", "Gunnar", "Jeremiah", "Atticus"]);
  const seedRB = new Set(["CJ", "Niko", "Logan M", "Barrett"]);
  const seedBlitzer = new Set(["Sully", "Atticus", "Gunnar", "CJ"]);
  return roster.map((p) => {
    const pos = { ...p.pos };
    pos["QB"] = seedQB.has(p.name) ? 1 : 0;
    pos["RB"] = seedRB.has(p.name) ? 1 : 0;
    pos["Blitzer"] = seedBlitzer.has(p.name) ? 1 : 0;
    // ensure all roles exist explicitly
    [...OFFENSE_ROLES, ...DEFENSE_ROLES].forEach((r) => {
      if (!(r in pos)) pos[r] = 0;
    });
    const captains = seedCaptains.has(p.name) ? 1 : 0;
    return { ...p, pos, captains, sits: 0 };
  });
}

function loadInitialState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}

  const seeded = buildSeededRoster();
  return {
    roster: seeded,
    queue: seeded.map((p) => p.id),
    series: 0,
    history: [],
    // Settings: universal noRepeatWindow (1 = no same role in consecutive series)
    settings: { teamSize: 7, noRepeatWindow: 1, avoidBackToBackSit: true },
    // Track last role each player played and when (series number)
    recentRoleByPlayer: {}, // { [playerId]: { role: string, series: number } }
    lastQB: null, // kept for reference if you ever want a special rule, but universal rule covers QB
    captainPlan: {
      seasonTargetTotal: seeded.length * 2, // everyone 2x captains
      week1Used: 3,
      weeks2to7: [3, 3, 3, 3, 3, 2],
      recentPicks: [],
    },
    gameNumber: 1,
    seasonHistory: [],
  };
}

export default function App() {
  const [state, setState] = useState(loadInitialState);
  const { roster, queue, series, history, settings, recentRoleByPlayer, captainPlan, gameNumber, seasonHistory } = state;

  // Derived
  const activePlayers = useMemo(() => roster.filter((p) => p.active), [roster]);
  const totalActive = activePlayers.length;
  const sitCount = Math.max(totalActive - settings.teamSize, 0);

  // Persist
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }, [state]);

  // Id map
  const byId = useMemo(() => {
    const m = new Map();
    roster.forEach((p) => m.set(p.id, p));
    return m;
  }, [roster]);

  // Keep queue limited to active players (preserve order among actives)
  useEffect(() => {
    const activeIds = activePlayers.map((p) => p.id);
    const filtered = queue.filter((id) => activeIds.includes(id));
    const missing = activeIds.filter((id) => !filtered.includes(id));
    if (filtered.length !== queue.length || missing.length) {
      setState((s) => ({ ...s, queue: [...filtered, ...missing] }));
    }
  }, [activePlayers, queue]);

  function resetTallies(keepRoster = true) {
    const base = keepRoster
      ? roster.map((p) => ({ ...p, sits: 0, pos: Object.fromEntries(Object.entries(p.pos).map(([k]) => [k, 0])) }))
      : buildSeededRoster();
    const newQueue = base.filter((p) => p.active).map((p) => p.id);
    setState({
      roster: base,
      queue: newQueue,
      series: 0,
      history: [],
      settings: { ...settings },
      recentRoleByPlayer: {},
      lastQB: null,
      captainPlan: { ...captainPlan },
    });
  }

  function resetToSeeded() {
    const seeded = buildSeededRoster();
    const newQueue = seeded.filter((p) => p.active).map((p) => p.id);
    setState({
      roster: seeded,
      queue: newQueue,
      series: 0,
      history: [],
      settings: { teamSize: 7, noRepeatWindow: 1, avoidBackToBackSit: true },
      recentRoleByPlayer: {},
      lastQB: null,
      captainPlan: {
        seasonTargetTotal: seeded.length * 2,
        week1Used: 3,
        weeks2to7: [3, 3, 3, 3, 3, 2],
        recentPicks: [],
      },
      gameNumber: 1,
      seasonHistory: [],
    });
  }

  // Start a brand new game but KEEP season stats (roles & captains)
  function startNewGame() {
    const summary = {
      game: gameNumber || 1,
      endedAt: new Date().toISOString(),
      attendance: roster.filter((p) => p.active).map((p) => p.name),
      seriesPlayed: history.length,
    };

    const base = roster.map((p) => ({ ...p, sits: 0 })); // reset sits only
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
    }));
  }

  function addPlayer() {
    const name = prompt("Player name");
    if (!name) return;
    setState((s) => {
      const exists = s.roster.some((p) => p.name.toLowerCase() === name.toLowerCase());
      const newPlayer = createEmptyTallies(name);
      const roster = exists ? s.roster : [...s.roster, newPlayer].sort((a, b) => a.name.localeCompare(b.name));
      const queue = roster.filter((p) => p.active).map((p) => p.id);
      const captainPlan = { ...s.captainPlan, seasonTargetTotal: roster.length * 2 };
      return { ...s, roster, queue, captainPlan };
    });
  }

  function removePlayer(id) {
    setState((s) => {
      const roster = s.roster.filter((p) => p.id !== id);
      const queue = s.queue.filter((q) => q !== id);
      const captainPlan = { ...s.captainPlan, seasonTargetTotal: roster.length * 2 };
      const recentRoleByPlayer = Object.fromEntries(
        Object.entries(s.recentRoleByPlayer || {}).filter(([pid]) => pid !== id)
      );
      return { ...s, roster, queue, captainPlan, recentRoleByPlayer };
    });
  }

  function toggleActive(id) {
    setState((s) => {
      const roster = s.roster.map((p) => (p.id === id ? { ...p, active: !p.active } : p));
      const queue = roster.filter((p) => p.active).map((p) => p.id);
      return { ...s, roster, queue };
    });
  }

  // ---------- Captain planner helpers ----------
  function totalCaptainUsed() {
    return roster.reduce((sum, p) => sum + (p.captains || 0), 0);
  }
  function setWeekTarget(index, value) {
    const weeks = [...captainPlan.weeks2to7];
    weeks[index] = Math.max(0, Math.floor(value || 0));
    setState((s) => ({ ...s, captainPlan: { ...s.captainPlan, weeks2to7: weeks } }));
  }
  function autoPickCaptainsForToday(targetCount) {
    const present = activePlayers.map((p) => p.id);
    if (!present.length || targetCount <= 0) return [];
    const sorted = present
      .map((id) => byId.get(id))
      .sort((a, b) => {
        const d1 = (a.captains || 0) - (b.captains || 0);
        if (d1 !== 0) return d1;
        const sumA = Object.values(a.pos).reduce((x, y) => x + y, 0);
        const sumB = Object.values(b.pos).reduce((x, y) => x + y, 0);
        if (sumA !== sumB) return sumA - sumB;
        return a.name.localeCompare(b.name);
      });
    const picks = [];
    for (const p of sorted) {
      if (picks.length >= targetCount) break;
      if (!picks.includes(p.id)) picks.push(p.id);
    }
    return picks;
  }
  function applyCaptainPicks(pickIds) {
    if (!pickIds.length) return;
    const updated = roster.map((p) => (pickIds.includes(p.id) ? { ...p, captains: (p.captains || 0) + 1 } : p));
    setState((s) => ({ ...s, roster: updated, captainPlan: { ...s.captainPlan, recentPicks: pickIds } }));
  }

  // ---------- Role assignment engine ----------
  function pickForRole(role, candidates, alreadyAssigned, currentSeries) {
    // Apply already assigned filter
    let pool = candidates.filter((id) => !alreadyAssigned.has(id));
    if (!pool.length) return null;

    // Universal no-repeat: remove players who had THIS role last series (within window)
    if (settings.noRepeatWindow && settings.noRepeatWindow > 0) {
      const lastSeries = currentSeries - 1;
      pool = pool.filter((id) => {
        const rec = recentRoleByPlayer[id];
        if (!rec) return true;
        const within = rec.series >= currentSeries - settings.noRepeatWindow;
        return !(within && rec.role === role);
      });
      // if we filtered everyone out, relax the no-repeat just for this pick
      if (!pool.length) pool = candidates.filter((id) => !alreadyAssigned.has(id));
    }

    // Per-role fairness: pick from players with the minimum count for THIS role
    const counts = pool.map((id) => byId.get(id).pos[role]);
    const minCount = Math.min(...counts);
    let minPool = pool.filter((id) => byId.get(id).pos[role] === minCount);

    // Tie-break: fewer total role assignments overall, then alphabetical
    const chosen = minPool
      .map((id) => byId.get(id))
      .sort((a, b) => {
        const sumA = Object.values(a.pos).reduce((x, y) => x + y, 0);
        const sumB = Object.values(b.pos).reduce((x, y) => x + y, 0);
        if (sumA !== sumB) return sumA - sumB;
        return a.name.localeCompare(b.name);
      })[0];

    return chosen?.id || null;
  }

  function nextSeries(which) {
    const currentSeries = series + 1;
    if (totalActive < settings.teamSize) {
      alert(`Need at least ${settings.teamSize} active players. Currently ${totalActive}.`);
      return;
    }

    // Bench rotation: advance by sitCount (if 0, advance by 1)
    const advance = Math.max(1, sitCount);
    const sitIds = queue.slice(0, sitCount);
    const playIds = queue.slice(sitCount, sitCount + settings.teamSize);

    // Assign roles for this side only
    let offense = null, defense = null;
    const assigned = new Set();

    if (which === "Offense") {
      const mapping = {};
      for (const r of OFFENSE_ROLES) {
        const id = pickForRole(r, playIds, assigned, currentSeries);
        if (id) {
          mapping[r] = id;
          assigned.add(id);
        }
      }
      offense = mapping;
    } else {
      const mapping = {};
      for (const r of DEFENSE_ROLES) {
        const id = pickForRole(r, playIds, assigned, currentSeries);
        if (id) {
          mapping[r] = id;
          assigned.add(id);
        }
      }
      defense = mapping;
    }

    // Build history entry (store recentRoleByPlayer snapshot for undo)
    const entry = {
      phase: which,
      series: currentSeries,
      sitIds,
      playIds,
      offense,
      defense,
      recentBefore: recentRoleByPlayer,
    };

    // Apply tallies & recent-role memory
    const updatedRoster = roster.map((p) => {
      if (sitIds.includes(p.id)) return { ...p, sits: p.sits + 1 };
      if (which === "Offense" && offense) {
        const myRole = Object.entries(offense).find(([, pid]) => pid === p.id)?.[0];
        if (myRole && p.pos[myRole] !== undefined) {
          return { ...p, pos: { ...p.pos, [myRole]: p.pos[myRole] + 1 } };
        }
      }
      if (which === "Defense" && defense) {
        const myRole = Object.entries(defense).find(([, pid]) => pid === p.id)?.[0];
        if (myRole && p.pos[myRole] !== undefined) {
          return { ...p, pos: { ...p.pos, [myRole]: p.pos[myRole] + 1 } };
        }
      }
      return p;
    });

    // Update recent role memory for assigned players this series
    const recentUpdate = { ...recentRoleByPlayer };
    const mappingNow = which === "Offense" ? offense : defense;
    Object.entries(mappingNow || {}).forEach(([role, pid]) => {
      recentUpdate[pid] = { role, series: currentSeries };
    });

    const newQueue = [...queue.slice(advance), ...queue.slice(0, advance)];

    setState({
      roster: updatedRoster,
      queue: newQueue,
      series: currentSeries,
      history: [...history, entry],
      settings,
      recentRoleByPlayer: recentUpdate,
      captainPlan,
    });
  }

  function undo() {
    if (!history.length) return;
    const last = history[history.length - 1];

    const restored = roster.map((p) => {
      if (last.sitIds.includes(p.id)) return { ...p, sits: Math.max(0, p.sits - 1) };
      if (last.phase === "Offense" && last.offense) {
        const myRole = Object.entries(last.offense).find(([, pid]) => pid === p.id)?.[0];
        if (myRole && p.pos[myRole] !== undefined) {
          return { ...p, pos: { ...p.pos, [myRole]: Math.max(0, p.pos[myRole] - 1) } };
        }
      }
      if (last.phase === "Defense" && last.defense) {
        const myRole = Object.entries(last.defense).find(([, pid]) => pid === p.id)?.[0];
        if (myRole && p.pos[myRole] !== undefined) {
          return { ...p, pos: { ...p.pos, [myRole]: Math.max(0, p.pos[myRole] - 1) } };
        }
      }
      return p;
    });

    // Rewind queue by the same step
    const advance = Math.max(1, Math.max(totalActive - settings.teamSize, 0));
    const newQueue = [...queue.slice(-advance), ...queue.slice(0, -advance)];

    setState({
      roster: restored,
      queue: newQueue,
      series: Math.max(0, state.series - 1),
      history: history.slice(0, -1),
      settings,
      recentRoleByPlayer: last.recentBefore || {},
      captainPlan,
    });
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

  // UI helpers
  function PlayerTag({ id }) {
    const p = byId.get(id);
    if (!p) return null;
    return <span className="inline-flex items-center rounded-xl border px-2 py-1 text-sm">{p.name}</span>;
  }
  function AssignmentTable({ title, mapping }) {
    const entries = Object.entries(mapping || {});
    return (
      <div className="rounded-2xl border p-3">
        <div className="mb-2 font-semibold">{title}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {entries.map(([role, id]) => (
            <div key={role} className="flex items-center justify-between rounded-xl bg-black/5 px-3 py-2">
              <span className="font-medium">{role}</span>
              <PlayerTag id={id} />
            </div>
          ))}
          {!entries.length && <div className="text-sm text-gray-500">(none yet)</div>}
        </div>
      </div>
    );
  }

  const lastEntry = history[history.length - 1];
  const captainUsed = totalCaptainUsed();
  const captainNeeded = Math.max(0, (captainPlan.seasonTargetTotal || 0) - captainUsed);

  return (
    <div className="mx-auto max-w-6xl p-4 text-gray-900 dark:text-gray-100">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">7v7 Flag Coach – Rotations, Positions & Captains</h1>
          <p className="text-sm text-gray-500">Game: {gameNumber} • Series: {series} • Active: {totalActive} • Sit per series: {sitCount}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-2xl border px-4 py-2" onClick={() => nextSeries("Offense")}>
            Next Series (Offense)
          </button>
          <button className="rounded-2xl border px-4 py-2" onClick={() => nextSeries("Defense")}>
            Next Series (Defense)
          </button>
          <button className="rounded-2xl border px-4 py-2" onClick={undo} disabled={!history.length}>
            Undo
          </button>
          <button className="rounded-2xl border px-4 py-2" onClick={() => resetTallies(true)}>
            Reset Game
          </button>
          <button className="rounded-2xl border px-4 py-2" onClick={startNewGame}>
            Start New Game
          </button>
          <button className="rounded-2xl border px-4 py-2" onClick={resetToSeeded}>
            Reset to Seeded (Week‑1 only)
          </button>
          <button className="rounded-2xl border px-4 py-2" onClick={addPlayer}>Add Player</button>
          <button className="rounded-2xl border px-4 py-2" onClick={exportState}>Export</button>
          <label className="rounded-2xl border px-4 py-2 cursor-pointer">
            Import
            <input type="file" accept="application/json" className="hidden" onChange={importState} />
          </label>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Roster / Attendance */}
        <div className="rounded-2xl border p-4 md:col-span-1">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Roster & Attendance</h2>
            <div className="text-sm">Team size on field: {settings.teamSize}</div>
          </div>
          <div className="space-y-2">
            {roster.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl bg-black/5 px-3 py-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={p.active} onChange={() => toggleActive(p.id)} />
                  <span>{p.name}</span>
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <span title="Captain count">C: {p.captains || 0}</span>
                  <button className="opacity-70 hover:opacity-100" onClick={() => removePlayer(p.id)}>
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-black/5 p-3">
            <label className="flex items-center gap-2 text-sm">
              No repeat same role (last series)
            </label>
            <div className="text-sm">Window: {settings.noRepeatWindow}</div>
          </div>
        </div>

        {/* Current Series Assignments */}
        <div className="rounded-2xl border p-4 md:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Current Assignments</h2>
            <span className="text-sm text-gray-500">{lastEntry ? `${lastEntry.phase} • Series ${lastEntry.series}` : "(none yet)"}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <AssignmentTable title="Offense" mapping={lastEntry?.offense || {}} />
            <AssignmentTable title="Defense" mapping={lastEntry?.defense || {}} />
          </div>
          <div className="mt-4 rounded-2xl border p-3">
            <div className="mb-2 font-semibold">Sitting this series</div>
            <div className="flex flex-wrap gap-2">
              {(lastEntry?.sitIds || []).map((id) => (
                <PlayerTag key={id} id={id} />
              ))}
              {!(lastEntry?.sitIds || []).length && <div className="text-sm text-gray-500">(none yet)</div>}
            </div>
          </div>
        </div>
      </section>

      {/* Next Bench Preview */}
      <section className="mt-2 rounded-2xl border p-3">
        <div className="mb-1 font-semibold">Next bench (preview)</div>
        <div className="flex flex-wrap gap-2">
          {queue.slice(0, sitCount).map((id) => (
            <PlayerTag key={id} id={id} />
          ))}
          {!sitCount && <div className="text-sm text-gray-500">(no one sits)</div>}
        </div>
      </section>

      {/* Captain Planner */}
      <section className="mt-4 rounded-2xl border p-4">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">Captain Planner</h2>
          <div className="text-sm">
            Used: <b>{captainUsed}</b> / Target: <b>{captainPlan.seasonTargetTotal}</b> • Remaining: <b>{captainNeeded}</b>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-black/5 p-3">
          <label className="flex items-center gap-2 text-sm">
            Week 1 used
            <input
              type="number"
              min={0}
              className="w-16 rounded border bg-transparent px-2 py-1"
              value={captainPlan.week1Used}
              onChange={(e) => setState((s) => ({ ...s, captainPlan: { ...s.captainPlan, week1Used: Math.max(0, Math.floor(+e.target.value || 0)) } }))}
            />
          </label>
          <div className="text-xs text-gray-500">Default plan for Weeks 2–7: [3,3,3,3,3,2]</div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
          {captainPlan.weeks2to7.map((v, i) => (
            <label key={i} className="rounded-xl border p-2 text-sm">
              <div className="mb-1 font-medium">Week {i + 2}</div>
              <input
                type="number"
                min={0}
                className="w-full rounded border bg-transparent px-2 py-1"
                value={v}
                onChange={(e) => setWeekTarget(i, +e.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="rounded-2xl border px-4 py-2"
            onClick={() => {
              const todayTarget = captainPlan.weeks2to7[0] ?? 2; // adjust as needed per week
              const picks = autoPickCaptainsForToday(todayTarget);
              applyCaptainPicks(picks);
            }}
          >
            Pick Captains Now (uses Week 2 target)
          </button>
          {captainPlan.recentPicks?.length ? (
            <div className="text-sm">Picked: {captainPlan.recentPicks.map((id) => byId.get(id)?.name).filter(Boolean).join(", ")}</div>
          ) : (
            <div className="text-sm text-gray-500">(no picks yet)</div>
          )}
        </div>
      </section>

      {/* Tally Board */}
      <section className="mt-4 rounded-2xl border p-4">
        <h2 className="mb-2 text-lg font-semibold">Tally Board</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              {/* Group headers */}
              <tr className="text-left">
                <th className="p-2">Player</th>
                <th className="p-2 border-l">Capt</th>
                <th className="p-2 border-l">Sits</th>
                <th className="p-2 text-center border-l" colSpan={OFFENSE_ROLES.length}>Offense</th>
                <th className="p-2 text-center border-l" colSpan={DEFENSE_ROLES.length}>Defense</th>
              </tr>
              {/* Role headers */}
              <tr className="text-left">
                <th className="p-2"></th>
                <th className="p-2 border-l"></th>
                <th className="p-2 border-l"></th>
                {OFFENSE_ROLES.map((r, idx) => (
                  <th key={r} className={"p-2" + (idx === 0 ? " border-l" : "")}>{r}</th>
                ))}
                {DEFENSE_ROLES.map((r, idx) => (
                  <th key={r} className={"p-2" + (idx === 0 ? " border-l" : "")}>{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => (
                <tr key={p.id} className={!p.active ? "opacity-60" : undefined}>
                  <td className="p-2 whitespace-nowrap">{p.name}</td>
                  <td className="p-2 border-l">{p.captains || 0}</td>
                  <td className="p-2 border-l">{p.sits}</td>
                  {OFFENSE_ROLES.map((r, idx) => (
                    <td key={r} className={"p-2" + (idx === 0 ? " border-l" : "")}>{p.pos[r]}</td>
                  ))}
                  {DEFENSE_ROLES.map((r, idx) => (
                    <td key={r} className={"p-2" + (idx === 0 ? " border-l" : "")}>{p.pos[r]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Notes */}
      <section className="mt-4 rounded-2xl border p-4 text-sm text-gray-600 dark:text-gray-400">
        <details>
          <summary className="cursor-pointer font-medium">Notes & Tips (tap to expand)</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Use <b>Start New Game</b> to clear <i>series & sits only</i>; season stats (roles & captains) persist.</li>
            <li>Universal no-repeat: no player takes the same role in consecutive series.</li>
            <li>Per-role fairness: a player won’t get role “2” until other present players have that role “1”.</li>
            <li>Roster checkboxes = attendance. Toggle off if a player leaves early.</li>
            <li>Bench rotates by sitCount each series; preview shows who’s next to sit.</li>
            <li>Export before/after games for backup; use Reset to Seeded to return to Week‑1 only stats.</li>
          </ul>
        </details>
      </section>
    </div>
  );
}
