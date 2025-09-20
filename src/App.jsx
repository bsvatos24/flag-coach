import React, { useEffect, useMemo, useState } from "react";

/**
 * 7v7 Flag Football Coach – Mobile-first + Random-Balanced Positions + Captain Queue (v6)
 * --------------------------------------------------------------------------------------
 * What’s new in this version:
 * 1) Positions are **random + balanced** per game:
 *    - Prefer players who have **NOT** played that role yet **this game** (pos[role] === 0).
 *    - If everyone has, pick from the **lowest per-game count** for that role.
 *    - Tie-break by **true random** (no alphabetical fallback).
 *    - Also keeps optional safeguard: **no repeat same role in back-to-back series**.
 * 2) Captains flow = **alphabetical queue** with IOUs:
 *    - Maintains a persistent alphabetical **captainQueue** + pointer (**captainIndex**).
 *    - **Captain IOUs** list to give missed turns priority next time (e.g., Barrett).
 *    - "Pick 2" pulls IOUs first (present players), then continues round-robin in alphabetical order.
 * 3) Between games: **clear everything except captains**.
 *    - "Start New Game" resets series, sits, **and all per-game position counts** to 0.
 *    - Captains tallies + captain queue stay.
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
const OFFENSE_ROLES = ["QB", "RB1", "RB2", "C", "WR", "TE1", "TE2"];
const DEFENSE_ROLES = ["DT", "DE1", "DE2", "CB1", "CB2", "Spy", "Blitzer"];

const LS_KEY = "ffb-rotation-state-v6";

// ---------- Helpers ----------
function createEmptyTallies(name) {
  const pos = {};
  [...OFFENSE_ROLES, ...DEFENSE_ROLES].forEach((r) => (pos[r] = 0));
  return { name, active: true, sits: 0, captains: 0, pos, id: crypto.randomUUID() };
}
function rngPick(arr) {
  if (!arr.length) return undefined;
  const idx = crypto.getRandomValues(new Uint32Array(1))[0] % arr.length;
  return arr[idx];
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
  const seedCaptains = new Set(["Niko", "Sully", "CJ", "Elijah", "Jeremiah"]); // add this week’s captains
  return roster.map((p) => ({ ...p, captains: seedCaptains.has(p.name) ? 1 : 0 }));
}

function loadInitialState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}

  const roster = buildInitialRoster();
  const captainQueue = roster.map((p) => p.id); // alphabetical order by default
  return {
    roster,
    queue: roster.map((p) => p.id),
    series: 0,
    history: [],
    settings: {
      teamSize: 7,
      noRepeatWindow: 1, // block same role in consecutive series
      assignment: 'randBalanced', // random among balanced group
    },
    recentRoleByPlayer: {}, // { [playerId]: { role, series } }
    captainPlan: {
      seasonTargetTotal: roster.length * 2,
      recentPicks: [],
    },
    // Captain queue state
    captainQueue,      // array of ids in alphabetical order
    captainIndex: 0,   // pointer into captainQueue
    captainIOUs: [],   // ids owed a captain turn

    lastQB: null,
    gameNumber: 1,
    seasonHistory: [],
    ui: { showAttendance: false, showSettings: false },
  };
}

export default function App() {
  const [state, setState] = useState(loadInitialState);
  const {
    roster, queue, series, history, settings, recentRoleByPlayer,
    captainPlan, captainQueue, captainIndex, captainIOUs,
    gameNumber, seasonHistory, ui,
  } = state;

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
      const captainPlan = { ...s.captainPlan, seasonTargetTotal: roster.length * 2 };
      // Rebuild captainQueue alphabetically, and reposition pointer by name continuity
      const captainQueue = roster.map((p) => p.id);
      const captainIndex = 0; // simple reset; can be enhanced to preserve pointer
      return { ...s, roster, queue, captainPlan, captainQueue, captainIndex };
    });
  }
  function removePlayer(id) {
    setState((s) => {
      const roster = s.roster.filter((p) => p.id !== id);
      const queue = s.queue.filter((q) => q !== id);
      const captainPlan = { ...s.captainPlan, seasonTargetTotal: roster.length * 2 };
      const recentRoleByPlayer = Object.fromEntries(Object.entries(s.recentRoleByPlayer || {}).filter(([pid]) => pid !== id));
      const captainQueue = roster.map((p) => p.id);
      let captainIndex = s.captainIndex % Math.max(1, captainQueue.length);
      const captainIOUs = (s.captainIOUs || []).filter((pid) => pid !== id);
      return { ...s, roster, queue, captainPlan, recentRoleByPlayer, captainQueue, captainIndex, captainIOUs };
    });
  }
  function toggleActive(id) {
    setState((s) => {
      const roster = s.roster.map((p) => (p.id === id ? { ...p, active: !p.active } : p));
      const queue = roster.filter((p) => p.active).map((p) => p.id);
      return { ...s, roster, queue };
    });
  }

  // ---------- Captains (alphabetical queue + IOUs) ----------
  function toggleCaptainIOU(id) {
    setState((s) => {
      const set = new Set(s.captainIOUs || []);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...s, captainIOUs: Array.from(set) };
    });
  }

  function pickCaptainsAlphabetical(targetCount = 2) {
    const present = new Set(activePlayers.map((p) => p.id));
    const picks = [];

    // Step 1: serve IOUs first, in captainQueue order
    for (const id of captainQueue) {
      if (picks.length >= targetCount) break;
      if (present.has(id) && (captainIOUs || []).includes(id) && !picks.includes(id)) {
        picks.push(id);
      }
    }

    // Remove served IOUs
    const remainingIOUs = (captainIOUs || []).filter((id) => !picks.includes(id));

    // Step 2: continue from captainIndex round-robin in alphabetical order
    let idx = captainIndex || 0;
    let safety = 0;
    while (picks.length < targetCount && safety < captainQueue.length * 2) {
      const id = captainQueue[idx % captainQueue.length];
      if (present.has(id) && !picks.includes(id)) picks.push(id);
      idx++;
      safety++;
    }

    if (!picks.length) return;

    // Apply picks: increment counts, advance index, persist IOUs
    const updated = roster.map((p) => (picks.includes(p.id) ? { ...p, captains: (p.captains || 0) + 1 } : p));
    setState((s) => ({
      ...s,
      roster: updated,
      captainPlan: { ...s.captainPlan, recentPicks: picks },
      captainIndex: idx % (captainQueue.length || 1),
      captainIOUs: remainingIOUs,
    }));
  }

  // ---------- Position assignment engine (random + balanced per game) ----------
  function eligiblePoolForRole(role, candidates, alreadyAssigned, currentSeries) {
    // Start with players available this series
    let pool = candidates.filter((id) => !alreadyAssigned.has(id));
    if (!pool.length) return [];

    // Optional: no-repeat same role in last N series
    if (settings.noRepeatWindow && settings.noRepeatWindow > 0) {
      pool = pool.filter((id) => {
        const rec = recentRoleByPlayer[id];
        if (!rec) return true;
        const within = rec.series >= currentSeries - settings.noRepeatWindow;
        return !(within && rec.role === role);
      });
      if (!pool.length) pool = candidates.filter((id) => !alreadyAssigned.has(id));
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
    Object.entries(mappingNow || {}).forEach(([role, pid]) => { recentUpdate[pid] = { role, series: currentSeries }; });

    const newQueue = [...queue.slice(advance), ...queue.slice(0, advance)];

    setState({
      roster: updatedRoster,
      queue: newQueue,
      series: currentSeries,
      history: [...history, entry],
      settings,
      recentRoleByPlayer: recentUpdate,
      captainPlan,
      captainQueue,
      captainIndex,
      captainIOUs,
      lastQB: null,
      gameNumber,
      seasonHistory,
      ui,
    });
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
      recentRoleByPlayer: last.recentBefore || {},
    });
  }

  // ---------- UI helpers ----------
  function PlayerTag({ id }) {
    const p = byId.get(id);
    if (!p) return null;
    return <span className="inline-flex items-center rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-sm">{p.name}</span>;
  }
  function AssignmentTable({ title, mapping }) {
    const entries = Object.entries(mapping || {});
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="mb-2 font-semibold">{title}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {entries.map(([role, id]) => (
            <div key={role} className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="font-medium">{role}</span>
              <PlayerTag id={id} />
            </div>
          ))}
          {!entries.length && <div className="text-sm text-gray-300">(none yet)</div>}
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
            <AssignmentTable title="Offense" mapping={lastEntry?.offense || {}} />
            <AssignmentTable title="Defense" mapping={lastEntry?.defense || {}} />
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
            <button className="rounded-2xl border border-white/30 hover:border-white/60 bg-white/5 px-4 py-2" onClick={() => pickCaptainsAlphabetical(2)}>Pick 2 (Alphabetical)</button>
            {captainPlan.recentPicks?.length ? (
              <div className="text-sm">Picked: {captainPlan.recentPicks.map((id) => byId.get(id)?.name).filter(Boolean).join(", ")}</div>
            ) : (<div className="text-sm text-gray-300">(no picks yet)</div>)}
          </div>
          <div className="mt-3 text-xs text-gray-300">
            Next up order: {captainQueue.map((id, i) => (i === captainIndex ? `→ ${byId.get(id)?.name}` : byId.get(id)?.name)).join(" · ")}
          </div>
        </section>

        {/* Tally Board (mobile scroll) */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <h2 className="mb-2 text-lg font-semibold">Tally Board</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="text-left">
                  <th className="p-2">Player</th>
                  <th className="p-2 border-l border-white/10">Capt</th>
                  <th className="p-2 border-l border-white/10">Sits</th>
                  <th className="p-2 text-center border-l border-white/10" colSpan={OFFENSE_ROLES.length}>Offense</th>
                  <th className="p-2 text-center border-l border-white/10" colSpan={DEFENSE_ROLES.length}>Defense</th>
                </tr>
                <tr className="text-left">
                  <th className="p-2"></th>
                  <th className="p-2 border-l border-white/10"></th>
                  <th className="p-2 border-l border-white/10"></th>
                  {OFFENSE_ROLES.map((r, idx) => (
                    <th key={r} className={"p-2" + (idx === 0 ? " border-l border-white/10" : "")}>{r}</th>
                  ))}
                  {DEFENSE_ROLES.map((r, idx) => (
                    <th key={r} className={"p-2" + (idx === 0 ? " border-l border-white/10" : "")}>{r}</th>
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
        </section>

        {/* Notes */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-gray-300">
          <details>
            <summary className="cursor-pointer font-medium">Notes (tap)</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Positions are random-balanced per game: prefer 0-count, otherwise minimum count; tie-break random.</li>
              <li>Captains are alphabetical with IOUs. Use IOU toggle if someone misses their turn.</li>
              <li>Start New Game clears **all positions & sits** but keeps captain counts and order.</li>
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
                <div key={p.id} className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
                  <label className="flex items-center gap-3 text-base">
                    <input type="checkbox" className="h-5 w-5" checked={p.active} onChange={() => toggleActive(p.id)} />
                    <span>{p.name}</span>
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <span>C: {p.captains || 0}</span>
                    <button className={`rounded-lg border px-2 py-1 ${ (captainIOUs||[]).includes(p.id) ? 'border-white/60 bg-white/20' : 'border-white/30 bg-white/10' }`} onClick={() => toggleCaptainIOU(p.id)} title="Mark captain IOU">IOU</button>
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
