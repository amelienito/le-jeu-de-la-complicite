/* Le Jeu de la Complicité — site non officiel
   - Mode local : un seul téléphone qu'on se passe.
   - Mode en ligne : l'hôte garde la partie, les autres s'y connectent en direct (PeerJS / WebRTC),
     sans compte. Celui qui devine ne reçoit jamais le mot.
   - Options de début de partie : thèmes, chrono, mots perso. */
(() => {
"use strict";

const POINTS_PAR_TOUR = 5;
const PREFIX = "jdlc-v1-";
const MAX_PERSO = 40;            // mots perso par joueur
const CHRONOS = [0, 60, 90, 120]; // secondes, 0 = sans chrono
const CATS = Object.keys(window.WORDS);
const app = document.getElementById("app");
const qs = new URLSearchParams(location.search);

// ---------- petits outils ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = {
  get(k, d){ try{ const v = localStorage.getItem("jdlc-"+k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem("jdlc-"+k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem("jdlc-"+k); }catch(e){} }
};
const uid = () => Math.random().toString(36).slice(2, 10);
const myPid = store.get("pid") || (() => { const p = uid(); store.set("pid", p); return p; })();
function randCode(){ const a = "ABCDEFGHJKLMNPQRSTUVWXYZ"; let s = ""; for(let i=0;i<4;i++) s += a[Math.floor(Math.random()*a.length)]; return s; }
const cleanName = s => String(s || "").replace(/\s+/g, " ").trim().slice(0, 20);
const cleanWord = s => String(s || "").replace(/\s+/g, " ").trim().slice(0, 40);
const andList = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " et " + a[a.length-1];
const TEAM = { A: "Noirs", B: "Blancs" };
const chronoLabel = s => s ? (s % 60 ? `${Math.floor(s/60)} min ${s%60}` : `${s/60} min`) : "Sans";
const fmt = ms => { const t = Math.ceil(ms / 1000); return Math.floor(t/60) + ":" + String(t % 60).padStart(2, "0"); };
const ROUNDS = [1, 2, 3, 0];         // tours par joueur, 0 = sans fin
const roundsLabel = r => r ? String(r) : "∞";
function cleanCfg(c){
  c = c || {};
  const cats = Array.isArray(c.cats) ? c.cats.filter(x => CATS.includes(x)) : CATS.slice();
  return { cats, timer: CHRONOS.includes(c.timer) ? c.timer : 0, rounds: ROUNDS.includes(c.rounds) ? c.rounds : 2 };
}
// Verdict de fin : indice de complicité sur 100
const VERDICTS = [
  [85, "Âmes sœurs", "Vous partagez un cerveau. C'est presque inquiétant."],
  [70, "Potes de toujours", "Vous avez des souvenirs en commun, et ça se voit."],
  [50, "Bons copains", "Ça marche, mais il manque des pages à l'album photo."],
  [30, "Collègues de pause café", "Vous vous connaissez… de vue."],
  [0, "Inconnus dans le métro", "Il va falloir sortir plus souvent ensemble."]
];
const verdictOf = n => VERDICTS.find(v => n >= v[0]);
function cleanList(l){ return Array.isArray(l) ? [...new Set(l.map(cleanWord).filter(Boolean))].slice(0, MAX_PERSO) : []; }

// ---------- moteur de jeu (le même en local et en ligne) ----------
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }
// custom : [{w, by}] mots perso ; by = prénom de celui qui l'a ajouté (ou "")
function buildDeck(cfg, custom){
  const all = [];
  for(const c of cfg.cats) for(const w of window.WORDS[c]) all.push({ c, w });
  for(const m of custom) all.push({ c: m.by ? "Mot perso · " + m.by : "Mot perso", w: m.w, perso: true });
  return shuffle(all);
}
function deckSize(cfg, custom){ return cfg.cats.reduce((n, c) => n + window.WORDS[c].length, 0) + custom.length; }

function newGame(players, teams, cfg, custom){
  return { players, teams, cfg, custom, turn: 0, turnPts: 0, deck: buildDeck(cfg, custom), idx: 0, scores: {}, last: null, prev: null, phase: "handoff", endsAt: null,
    log: [], banned: [], wordStart: null };
}
function fixGame(s){ // parties sauvegardées avant l'ajout du verdict
  s.cfg = cleanCfg(s.cfg); s.custom = s.custom || []; s.log = s.log || []; s.banned = s.banned || [];
  return s;
}
const liveCfg = s => ({ ...s.cfg, cats: s.cfg.cats.filter(c => !s.banned.includes(c)) });
function totalTurns(s){
  if(!s.cfg.rounds) return 0;
  const per = s.teams ? 2 * Math.max(teamOf(s, "A").length, teamOf(s, "B").length) : s.players.length;
  return per * s.cfg.rounds;
}
function nextWord(s){
  s.idx++;
  if(s.idx >= s.deck.length){ s.deck = buildDeck(liveCfg(s), s.custom); s.idx = 0; }
  s.wordStart = Date.now();
  if(!s.deck.length){ s.phase = "end"; s.endsAt = null; }
}
function bilan(s){
  const groups = s.teams
    ? ["A", "B"].map(t => ({ key: t, label: TEAM[t], names: teamOf(s, t).map(p => p.name) }))
    : s.players.map(p => ({ key: p.id, label: p.name, names: [p.name] }));
  const rows = groups.map(g => {
    const es = s.log.filter(e => (s.teams ? e.t : e.g) === g.key && !e.skip);
    const found = es.filter(e => e.ok), missed = es.filter(e => !e.ok);
    const avg = found.length ? found.reduce((n, e) => n + e.ms, 0) / found.length / 1000 : null;
    let indice = 0;
    if(found.length){
      const precision = found.length / es.length;
      const speed = Math.min(1, Math.max(0.2, 1 - (avg - 8) / 80));
      indice = Math.round(100 * (0.6 * precision + 0.4 * speed));
    }
    const fastest = found.slice().sort((a, b) => a.ms - b.ms)[0] || null;
    return { label: g.label, names: g.names, key: g.key, found: found.length, missed: missed.length, avg, indice,
      fastest: fastest ? { w: fastest.w, s: Math.max(1, Math.round(fastest.ms / 1000)) } : null,
      stuck: missed.length ? missed[missed.length - 1].w : null };
  });
  const all = s.log.filter(e => !e.skip), allFound = all.filter(e => e.ok);
  let overall = rows.length ? Math.round(rows.reduce((n, r) => n + r.indice * Math.max(1, r.found + r.missed), 0) / rows.reduce((n, r) => n + Math.max(1, r.found + r.missed), 0)) : 0;
  if(!allFound.length) overall = 0;
  return { rows, overall, banned: s.banned.slice(), found: allFound.length, missed: all.length - allFound.length };
}
const teamOf = (s, t) => s.players.filter(p => p.team === t);
function giverOf(s, turn = s.turn){
  if(s.teams){
    const t = turn % 2 === 0 ? "A" : "B";
    const list = teamOf(s, t);
    if(!list.length) return s.players[0];
    return list[Math.floor(turn / 2) % list.length];
  }
  return s.players[turn % s.players.length];
}
function guessersOf(s){
  const g = giverOf(s);
  return (s.teams ? teamOf(s, g.team) : s.players).filter(p => p.id !== g.id);
}
function canSee(s, pid){
  const g = giverOf(s);
  if(g.id === pid) return true;
  if(!s.teams) return false;
  const p = s.players.find(x => x.id === pid);
  return !!p && p.team !== g.team;
}
function endTurn(s, timeout){
  const g = giverOf(s);
  s.prev = { name: g.name, team: g.team, pts: s.turnPts, timeout: !!timeout };
  s.turnPts = 0; s.turn++; s.phase = "handoff"; s.endsAt = null;
  const total = totalTurns(s);
  if(total && s.turn >= total) s.phase = "end";
}
function applyAction(s, a, idx){
  if(a === "finish"){ if(s.phase === "end") return false; s.phase = "end"; s.endsAt = null; return true; }
  if(a === "start"){
    if(s.phase !== "handoff") return false;
    s.phase = "play";
    s.endsAt = s.cfg.timer ? Date.now() + s.cfg.timer * 1000 : null;
    s.wordStart = Date.now();
    return true;
  }
  if(s.phase !== "play") return false;
  if(a === "timeup"){ endTurn(s, true); return true; }
  if(idx != null && idx !== s.idx) return false; // double appui ou message en retard
  const w = s.deck[s.idx];
  const g = giverOf(s);
  const ms = Math.max(0, Date.now() - (s.wordStart || Date.now()));
  if(a === "found" || a === "pass"){
    const ok = a === "found";
    s.last = { w: w.w, ok };
    s.log.push({ g: g.id, t: g.team, w: w.w, ok, ms });
    if(ok){ const k = s.teams ? g.team : g.id; s.scores[k] = (s.scores[k] || 0) + 1; s.turnPts++; }
    nextWord(s);
    if(s.phase === "play" && s.turnPts >= POINTS_PAR_TOUR) endTurn(s);
    return true;
  }
  if(a === "skiptheme"){
    // « Pas notre truc » : on zappe sans pénalité et le thème ne revient plus de la partie
    s.log.push({ g: g.id, t: g.team, w: w.w, ok: false, ms, skip: true });
    if(!w.perso && !s.banned.includes(w.c)){
      s.banned.push(w.c);
      s.deck = s.deck.slice(0, s.idx + 1).concat(s.deck.slice(s.idx + 1).filter(x => x.perso || x.c !== w.c));
    }
    s.last = { w: w.w, ok: false, skip: true, c: w.perso ? null : w.c };
    nextWord(s);
    return true;
  }
  if(a === "endturn"){ endTurn(s); return true; }
  return false;
}
function viewFor(s, pid, online){
  const g = giverOf(s);
  return {
    players: s.players.map(p => ({ id: p.id, name: p.name, team: p.team, on: online ? online(p.id) : true })),
    teams: s.teams, phase: s.phase, turnPts: s.turnPts, scores: s.scores, last: s.last, prev: s.prev, idx: s.idx,
    timer: s.cfg.timer, ends: s.endsAt, remaining: s.endsAt ? Math.max(0, s.endsAt - Date.now()) : null,
    turn: s.turn, total: totalTurns(s), banned: s.banned,
    bilan: s.phase === "end" ? bilan(s) : null,
    giver: { id: g.id, name: g.name, team: g.team },
    guessers: guessersOf(s).map(p => p.name),
    word: canSee(s, pid) ? s.deck[s.idx] : null,
    me: pid
  };
}
function validTeams(players){
  const a = players.filter(p => p.team === "A").length, b = players.length - a;
  return a >= 2 && b >= 2;
}

// ---------- état de l'interface ----------
let ui = "home";       // home | local-setup | local | connecting | lobby | game
let err = "";
let local = null;
let host = null;
let client = null;
let draftCode = "";
let localDraft = store.get("local-draft", null) || { names: ["", "", "", ""], teams: false, team: ["A","A","B","B"] };
let cfgDraft = cleanCfg(store.get("cfg", null));   // réglages de l'hôte ou du mode local
let myWords = cleanList(store.get("mywords", []));  // mes mots perso (gardés d'une partie à l'autre)
let localWords = cleanList(store.get("localwords", []));

function setErr(m){ err = m; render(); }

// ---------- rendu ----------
function render(){
  // garder le focus et le curseur si l'écran se redessine pendant qu'on tape
  const a = document.activeElement, fid = a && a.id && app.contains(a) ? a.id : null;
  const sel = fid && "selectionStart" in a ? [a.selectionStart, a.selectionEnd] : null;
  const keep = fid ? a.value : null;
  const v = { home, "local-setup": localSetup, local: localGame, connecting, lobby, game: onlineGame }[ui] || home;
  app.innerHTML = (err ? `<p class="err" role="alert">${esc(err)}</p>` : "") + v();
  if(fid){ const el = document.getElementById(fid); if(el){ if(keep != null && el.value === "") el.value = keep; el.focus(); if(sel) try{ el.setSelectionRange(sel[0], sel[1]); }catch(e){} } }
  else { const f = app.querySelector("[autofocus]"); if(f && !f.value) f.focus(); }
  tick();
}

function home(){
  const name = store.get("name", "");
  const code = draftCode || (qs.get("code") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const savedHost = store.get("host", null);
  const savedClient = store.get("client", null);
  const savedLocal = store.get("local", null);
  const resume = [];
  if(savedHost) resume.push(`<button class="o flat" data-act="resume-host">Reprendre ta partie ${esc(savedHost.code)}</button>`);
  if(savedClient && !savedHost) resume.push(`<button class="o flat" data-act="resume-client">Revenir dans la partie ${esc(savedClient.code)}</button>`);
  if(savedLocal) resume.push(`<button class="o flat" data-act="resume-local">Reprendre la partie sur ce téléphone</button>`);
  return `
  <header class="stack">
    <span class="kicker">D'après l'émission Un Bon Moment</span>
    <h1>Le Jeu de la Complicité</h1>
    <p class="lede">Fais deviner un mot à ton pote uniquement avec ce que vous avez vécu ensemble.</p>
  </header>
  <div class="example" aria-label="Exemple">
    <span class="tag">Dalida</span>
    <span class="bubble">« Ta mère est fan. »</span>
  </div>
  ${resume.length ? `<div class="stack">${resume.join("")}</div>` : ""}

  <section class="block" aria-labelledby="t-online">
    <h2 id="t-online">En ligne</h2>
    <p class="muted small">Chacun sur son téléphone, même à distance. Celui qui devine ne voit jamais le mot.</p>
    <div><label class="kicker" for="name">Ton prénom</label><input type="text" id="name" maxlength="20" autocomplete="off" value="${esc(name)}" ${code ? "autofocus" : ""}></div>
    <button data-act="create" class="big">Créer une partie</button>
    <div class="row2" style="align-items:end">
      <div><label class="kicker" for="code">Code reçu</label><input type="text" id="code" class="code" maxlength="4" autocomplete="off" placeholder="ABCD" value="${esc(code)}"></div>
      <button data-act="join" class="o">Rejoindre</button>
    </div>
  </section>

  <section class="block dark" aria-labelledby="t-local">
    <h2 id="t-local">Sur un seul téléphone</h2>
    <p class="muted small">Vous êtes au même endroit : on se passe le téléphone à chaque tour.</p>
    <button data-act="local-setup">Jouer en local</button>
  </section>

  <details>
    <summary>Les règles</summary>
    <ol>
      <li>Celui qui fait deviner voit un mot. Il le fait trouver à son coéquipier <b>uniquement avec des références à votre vie</b> : « ta mère est fan », « ce qu'on a bu au mariage de Julien »…</li>
      <li>Interdit de dire le mot, de le décrire de façon neutre ou de mimer.</li>
      <li>Chaque mot trouvé rapporte 1 point. Bloqué ? On passe, mais ça compte dans le verdict.</li>
      <li>Un thème qui ne vous parle pas (le sport, la télé…) ? Zappez-le : aucune pénalité, et il ne revient plus de la partie.</li>
      <li>Tous les ${POINTS_PAR_TOUR} points, on change de tour. Avec le chrono, le tour s'arrête aussi quand le temps est écoulé.</li>
      <li>À 4 : deux équipes de 2. L'équipe adverse voit aussi le mot et vérifie qu'on triche pas. À 2 : on joue pour le plaisir, chacun son tour.</li>
      <li>Avant la partie, vous pouvez ajouter vos propres mots : un pote commun, une soirée, une expression à vous.</li>
      <li>À la fin, le jeu rend son verdict : un indice de complicité sur 100, selon les mots trouvés, passés et la vitesse.</li>
    </ol>
  </details>`;
}

// --- réglages (thèmes + chrono), éditables par l'hôte ou en local ---
function settingsBlock(cfg, editable, persoCount){
  const chips = CATS.map(c => {
    const on = cfg.cats.includes(c);
    return editable
      ? `<button class="tchip ${on ? "on" : ""}" data-act="cat" data-cat="${esc(c)}" aria-pressed="${on}">${esc(c)}</button>`
      : (on ? `<span class="tchip on">${esc(c)}</span>` : "");
  }).join("");
  const seg = CHRONOS.map(t => editable
    ? `<button class="seg ${cfg.timer === t ? "on" : ""}" data-act="timer" data-t="${t}" aria-pressed="${cfg.timer === t}">${chronoLabel(t)}</button>`
    : "").join("");
  const total = cfg.cats.reduce((n, c) => n + window.WORDS[c].length, 0) + persoCount;
  return `<details class="opts" ${editable ? "open" : ""}>
    <summary>Réglages <span class="muted small">(facultatif)</span></summary>
    <div class="stack" style="margin-top:14px">
      <div class="stack" style="gap:8px">
        <div class="optrow"><span class="kicker">Thèmes</span>${editable ? `<button class="link" data-act="cats-all">${cfg.cats.length === CATS.length ? "Aucun" : "Tous"}</button>` : ""}</div>
        <div class="tchips">${chips || '<span class="muted small">Aucun thème : seulement vos mots perso.</span>'}</div>
      </div>
      <div class="stack" style="gap:8px">
        <span class="kicker">Chrono par tour</span>
        ${editable ? `<div class="segs">${seg}</div>` : `<p class="muted">${cfg.timer ? chronoLabel(cfg.timer) : "Sans chrono"}</p>`}
      </div>
      <div class="stack" style="gap:8px">
        <span class="kicker">Tours chacun avant le verdict</span>
        ${editable ? `<div class="segs">${ROUNDS.map(r => `<button class="seg ${cfg.rounds === r ? "on" : ""}" data-act="rounds" data-r="${r}" aria-pressed="${cfg.rounds === r}">${roundsLabel(r)}</button>`).join("")}</div>`
          : `<p class="muted">${cfg.rounds ? cfg.rounds + " tour" + (cfg.rounds > 1 ? "s" : "") + " chacun" : "Sans fin"}</p>`}
      </div>
      <p class="muted small">${total} mot${total > 1 ? "s" : ""} dans le paquet${persoCount ? `, dont ${persoCount} perso` : ""}.</p>
    </div>
  </details>`;
}
function persoBlock(list, who){
  const items = list.map((w, i) => `<li><span>${esc(w)}</span><button class="x" data-act="wdel" data-i="${i}" aria-label="Enlever ${esc(w)}">×</button></li>`).join("");
  return `<section class="block perso">
    <h3>${esc(who)}</h3>
    <p class="muted small">Un pote commun, une soirée, une expression à vous… Ils sont mélangés au paquet${who.startsWith("Tes") ? " et personne ne les voit avant de tomber dessus" : ""}.</p>
    <div class="share"><input type="text" id="wordin" maxlength="40" autocomplete="off" placeholder="Ex. : le mariage de Julien" ${list.length >= MAX_PERSO ? "disabled" : ""}><button class="flat" data-act="wadd" ${list.length >= MAX_PERSO ? "disabled" : ""}>Ajouter</button></div>
    ${items ? `<ul class="wlist">${items}</ul>` : ""}
  </section>`;
}

function localSetup(){
  const d = localDraft;
  const filled = d.names.filter(n => cleanName(n)).length;
  const rows = d.names.map((n, i) => `
    <div class="row2" style="grid-template-columns:1fr auto;align-items:center">
      <input type="text" id="ln${i}" data-name="${i}" maxlength="20" autocomplete="off" placeholder="Joueur ${i+1}${i >= 2 ? " (facultatif)" : ""}" value="${esc(n)}" aria-label="Joueur ${i+1}">
      ${d.teams ? `<button class="chip ${d.team[i]}" data-act="ltoggle" data-i="${i}">${TEAM[d.team[i]]}</button>` : ""}
    </div>`).join("");
  return `
  <header class="stack">
    <span class="kicker">Sur un seul téléphone</span>
    <h2>Qui joue ?</h2>
  </header>
  <div class="stack">${rows}</div>
  ${d.names.length < 8 ? `<button class="o flat" data-act="ladd">+ Ajouter un joueur</button>` : ""}
  <label class="toggle"><input type="checkbox" id="lteams" ${d.teams ? "checked" : ""} ${filled < 4 ? "disabled" : ""}> Jouer en deux équipes ${filled < 4 ? '<span class="muted small">(à partir de 4)</span>' : ""}</label>
  ${settingsBlock(cfgDraft, true, localWords.length)}
  ${persoBlock(localWords, "Vos mots perso")}
  <button class="big" data-act="lstart">C'est parti</button>
  <button class="link" data-act="home">Retour</button>`;
}

function readLocalDraft(){
  app.querySelectorAll("[data-name]").forEach(el => { localDraft.names[+el.dataset.name] = el.value; });
  const t = app.querySelector("#lteams"); if(t) localDraft.teams = t.checked && !t.disabled;
  while(localDraft.team.length < localDraft.names.length) localDraft.team.push(localDraft.team.length % 2 ? "B" : "A");
  store.set("local-draft", localDraft);
}

// --- écrans de jeu partagés ---
function scoreboard(v){
  if(v.teams){
    const t = k => {
      const names = v.players.filter(p => p.team === k).map(p => p.name);
      return `<div class="team ${v.giver.team === k ? "on" : ""}"><span class="lab">${TEAM[k]}</span><span class="pts">${v.scores[k] || 0}</span><span class="who">${esc(andList(names))}</span></div>`;
    };
    return `<div class="scores">${t("A")}${t("B")}</div>`;
  }
  const total = Object.values(v.scores).reduce((a, b) => a + b, 0);
  const detail = v.players.map(p => `${esc(p.name)} ${v.scores[p.id] || 0}`).join(" · ");
  return `<div class="scores solo"><div class="team"><span class="lab">Mots trouvés ensemble</span><span class="pts">${total}</span><span class="who">${detail}</span></div></div>`;
}
function dots(n){ let s = '<div class="dots" aria-label="' + n + ' sur ' + POINTS_PAR_TOUR + ' points ce tour">'; for(let i=0;i<POINTS_PAR_TOUR;i++) s += `<i class="${i < n ? "f" : ""}"></i>`; return s + "</div>"; }
function lastLine(v){
  if(!v.last) return `<p class="last"></p>`;
  if(v.last.skip) return `<p class="last"><span class="sk">Zappé :</span> <b>${esc(v.last.w)}</b>${v.last.c ? ` · plus de « ${esc(v.last.c)} » cette partie` : ""}</p>`;
  return `<p class="last"><span class="${v.last.ok ? "ok" : "no"}">${v.last.ok ? "Trouvé" : "Passé"} :</span> <b>${esc(v.last.w)}</b></p>`;
}
let lastShownIdx = -1;
function wordCard(v, label){
  const pop = lastShownIdx !== v.idx ? " pop" : ""; lastShownIdx = v.idx;
  return `${label ? `<span class="badge">${esc(label)}</span>` : ""}
  <div class="wordcard${pop}${v.word.perso ? " perso" : ""}"><span class="num">${v.turnPts}/${POINTS_PAR_TOUR}</span><span class="cat">${esc(v.word.c)}</span><span class="word">${esc(v.word.w)}</span></div>
  <div class="row2"><button class="o" data-act="pass" data-idx="${v.idx}">Passer</button><button data-act="found" data-idx="${v.idx}">Trouvé +1</button></div>
  <button class="zap" data-act="skiptheme" data-idx="${v.idx}">${v.word.perso ? "Zapper ce mot" : `Pas notre truc : zapper « ${esc(v.word.c)} »`} <span>sans pénalité</span></button>`;
}
function handoffPanel(v, canStart, localMode){
  let prev = `<p class="muted">Première manche.</p>`;
  if(v.prev) prev = `<p class="muted">${v.prev.timeout ? "Temps écoulé ! " : "Tour terminé : "}${esc(v.prev.name)} a fait trouver ${v.prev.pts} mot${v.prev.pts > 1 ? "s" : ""}.</p>`;
  const teamLine = v.teams ? `<span class="badge">${TEAM[v.giver.team]}</span>` : "";
  const isMe = v.giver.id === v.me;
  return `<section class="block handoff">
    ${prev}
    ${teamLine}
    <span class="kicker">${localMode ? "Passe le téléphone à" : isMe ? "C'est à toi de faire deviner" : "Au tour de"}</span>
    <span class="name">${esc(isMe && !localMode ? "À toi !" : v.giver.name)}</span>
    <p class="muted">${isMe && !localMode ? "Tu" : "Il ou elle"} fait deviner à <b style="color:var(--ink)">${esc(andList(v.guessers))}</b>${v.timer ? `, en ${chronoLabel(v.timer)} max` : ""}.</p>
    ${canStart ? `<button class="big" data-act="start">${localMode ? "J'ai le téléphone, montre le mot" : "Je suis prêt, mot suivant"}</button>` : `<p class="muted small">En attente de ${esc(v.giver.name)}…</p>`}
  </section>`;
}
function turnLine(v, ends){
  const me = v.giver.id === v.me;
  const myName = v.me ? v.players.find(p => p.id === v.me)?.name : null;
  const gs = v.guessers.map(n => n === myName ? "toi" : n);
  const tour = v.total ? `<span class="kicker">Tour ${Math.min(v.turn + 1, v.total)}/${v.total}</span>` : "";
  return `<div class="turn"><p>${tour ? tour + "<br>" : ""}<b>${esc(me ? "Toi" : v.giver.name)}</b> → ${esc(andList(gs))}</p>
    <div class="turnr">${ends ? `<span class="timer" data-ends="${ends}">${fmt(Math.max(0, ends - Date.now()))}</span>` : ""}${dots(v.turnPts)}</div></div>`;
}

function localGame(){
  const v = viewFor(local, giverOf(local).id);
  v.word = local.deck[local.idx]; v.me = null;
  if(local.phase === "end") return bilanView(v, true) + `<button class="link" data-act="quit-local">Retour à l'accueil</button>`;
  const body = local.phase === "handoff"
    ? handoffPanel(v, true, true)
    : `${turnLine(v, local.endsAt)}${wordCard(v)}${lastLine(v)}<button class="link" data-act="endturn">Finir le tour maintenant</button>`;
  return `${scoreboard(v)}${body}<div class="row2"><button class="link" data-act="finish">Terminer et voir le verdict</button><button class="link" data-act="quit-local">Quitter la partie</button></div>`;
}

// --- verdict de fin ---
function bilanText(v){
  const B = v.bilan, [, title] = verdictOf(B.overall);
  const who = v.teams ? B.rows.map(r => `${r.label} (${andList(r.names)}) ${r.found} pts`).join(" · ") : andList(v.players.map(p => p.name));
  return `Le Jeu de la Complicité · ${who}\nIndice de complicité : ${B.overall}/100, « ${title} »\n${B.found} mots trouvés, ${B.missed} passés.\n${location.origin + location.pathname}`;
}
function bilanView(v, canReplay){
  const B = v.bilan;
  const [, title, line] = verdictOf(B.overall);
  let head = "";
  if(v.teams){
    const [a, b] = B.rows;
    head = a.found === b.found ? `<p class="kicker">Égalité ${a.found} partout</p>`
      : `<p class="kicker">Les ${esc((a.found > b.found ? a : b).label)} gagnent ${Math.max(a.found, b.found)} à ${Math.min(a.found, b.found)}</p>`;
  }
  const rows = B.rows.map(r => {
    const [, t] = verdictOf(r.indice);
    const facts = [];
    facts.push(`${r.found} trouvé${r.found > 1 ? "s" : ""}, ${r.missed} passé${r.missed > 1 ? "s" : ""}`);
    if(r.avg != null) facts.push(`${Math.max(1, Math.round(r.avg))} s par mot en moyenne`);
    if(r.fastest) facts.push(`le plus rapide : <b>${esc(r.fastest.w)}</b> en ${r.fastest.s} s`);
    if(r.stuck) facts.push(`a coincé sur <b>${esc(r.stuck)}</b>`);
    return `<li><div class="bl-top"><span class="bl-name">${esc(v.teams ? r.label + " · " + andList(r.names) : r.label + " fait deviner")}</span><span class="bl-n">${r.indice}</span></div>
      <div class="meter"><i style="width:${r.indice}%"></i></div>
      <p class="muted small">${esc(t)} · ${facts.join(" · ")}</p></li>`;
  }).join("");
  return `<section class="verdict">
    ${head}
    <span class="kicker">Indice de complicité</span>
    <div class="score-big">${B.overall}<small>/100</small></div>
    <h2>${esc(title)}</h2>
    <p>${esc(line)}</p>
  </section>
  <ul class="bl">${rows}</ul>
  ${B.banned.length ? `<p class="muted small">Thèmes zappés sans pénalité : ${esc(andList(B.banned))}.</p>` : ""}
  <p class="muted small">L'indice mélange les mots trouvés plutôt que passés et la vitesse pour les trouver. Les thèmes zappés ne comptent pas.</p>
  <div class="row2"><button data-act="share">Partager le verdict</button>${canReplay ? `<button class="o" data-act="replay">Rejouer</button>` : `<span class="muted small" style="align-self:center">L'hôte peut relancer une partie.</span>`}</div>`;
}

function connecting(){
  return `<div class="lost"><span class="spin"></span>${esc(client ? "Connexion à la partie " + client.code + "…" : "Création de la partie…")}</div>
  <button class="link" data-act="leave">Annuler</button>`;
}

function persoCountHost(){ return Object.values(host.words).reduce((n, l) => n + l.length, 0); }
function lobbyData(){
  if(host) return { code: host.code, cfg: host.cfg, persoCount: persoCountHost(),
    players: host.players.map(p => ({ ...p, on: hostOnline(p.id), nw: (host.words[p.id] || []).length })), teams: host.teams, isHost: true };
  return client && client.lobby ? { ...client.lobby, isHost: false } : null;
}
function lobby(){
  const L = lobbyData(); if(!L) return connecting();
  const link = location.origin + location.pathname + "?code=" + L.code;
  const canTeams = L.players.length >= 4;
  const items = L.players.map(p => `<li class="${p.on ? "" : "off"}">
      <span class="nm">${esc(p.name)}${p.id === myPid ? ' <span class="st">toi</span>' : ""}${p.nw ? ` <span class="st">· ${p.nw} mot${p.nw > 1 ? "s" : ""} perso</span>` : ""}</span>
      ${!p.on ? '<span class="st">déconnecté</span>' : ""}
      ${L.teams ? (L.isHost ? `<button class="chip ${p.team}" data-act="team" data-id="${esc(p.id)}">${TEAM[p.team]}</button>` : `<span class="chip ${p.team}">${TEAM[p.team]}</span>`) : ""}
      ${L.isHost && p.id !== myPid && !p.on ? `<button class="chip B" data-act="kick" data-id="${esc(p.id)}" aria-label="Retirer ${esc(p.name)}">Retirer</button>` : ""}
    </li>`).join("");
  let startNote = "";
  if(L.players.length < 2) startNote = "Il faut au moins 2 joueurs.";
  else if(L.teams && !validTeams(L.players)) startNote = "Chaque équipe doit avoir au moins 2 joueurs.";
  else if(deckSize(L.cfg, new Array(L.persoCount)) === 0) startNote = "Choisis au moins un thème ou ajoutez des mots perso.";
  return `
  ${client && client.lost ? `<div class="lost"><span class="spin"></span>Connexion perdue, on réessaie…</div>` : ""}
  <section class="stack center">
    <span class="kicker">Code de la partie</span>
    <div class="bigcode">${esc(L.code)}</div>
    <p class="muted small">Dicte ce code à tes potes ou envoie-leur le lien.</p>
  </section>
  <div class="share"><code id="link">${esc(link)}</code><button class="flat" data-act="copy">Copier</button></div>
  <section class="stack">
    <h3>Joueurs (${L.players.length})</h3>
    <ul class="players">${items}</ul>
  </section>
  ${L.isHost ? `<label class="toggle"><input type="checkbox" id="teams" ${L.teams ? "checked" : ""} ${canTeams ? "" : "disabled"}> Jouer en deux équipes ${canTeams ? "" : '<span class="muted small">(à partir de 4)</span>'}</label>
    ${L.teams ? '<p class="muted small">Touche une équipe pour changer quelqu\'un de camp.</p>' : ""}` : ""}
  ${settingsBlock(L.cfg, L.isHost, L.persoCount)}
  ${persoBlock(myWords, "Tes mots perso")}
  ${L.isHost ? `${startNote ? `<p class="muted">${startNote}</p>` : ""}
    <button class="big" data-act="hstart" ${startNote ? "disabled" : ""}>Lancer la partie</button>`
  : `<p class="muted center">En attente du lancement par l'hôte…</p>`}
  <button class="link" data-act="leave">Quitter</button>`;
}

function currentView(){
  if(host && host.game) return viewFor(host.game, myPid, hostOnline);
  return client ? client.view : null;
}
function onlineGame(){
  const v = currentView(); if(!v) return lobby();
  const isGiver = v.giver.id === v.me;
  const amHost = !!host;
  if(v.phase === "end" && v.bilan){
    return `${client && client.lost ? `<div class="lost"><span class="spin"></span>Connexion perdue, on réessaie…</div>` : ""}${bilanView(v, amHost)}
    <button class="link" data-act="leave">Quitter la partie</button>`;
  }
  let body;
  if(v.phase === "handoff"){
    body = handoffPanel(v, isGiver || amHost, false);
  } else if(v.word){
    const label = isGiver ? "Tu fais deviner" : "Tu vérifies l'équipe adverse";
    body = `${turnLine(v, v.ends)}${wordCard(v, label)}${lastLine(v)}${isGiver || amHost ? `<button class="link" data-act="endturn">Finir le tour maintenant</button>` : ""}`;
  } else {
    const iGuess = v.guessers.includes(v.players.find(p => p.id === v.me)?.name);
    body = `${turnLine(v, v.ends)}<section class="guessbox"><span class="q">?</span>
      <h3>${iGuess ? "Tu devines" : "Tu regardes"}</h3>
      <p class="muted">${esc(v.giver.name)} ${iGuess ? "te fait deviner un mot. Lance des réponses à voix haute." : "fait deviner un mot."}</p></section>${lastLine(v)}`;
  }
  const offline = v.players.filter(p => !p.on && p.id !== v.me).map(p => p.name);
  return `${client && client.lost ? `<div class="lost"><span class="spin"></span>Connexion perdue, on réessaie…</div>` : ""}
  ${scoreboard(v)}${body}
  ${offline.length ? `<p class="muted small center">Déconnecté : ${esc(andList(offline))}</p>` : ""}
  <p class="muted small center">Partie ${esc(host ? host.code : client.code)}${amHost ? " · tu es l'hôte, garde cette page ouverte" : ""}</p>
  <div class="row2">${amHost ? `<button class="link" data-act="finish">Terminer et voir le verdict</button>` : ""}<button class="link" data-act="leave">Quitter la partie</button></div>`;
}

// ---------- chrono ----------
function tick(){
  const now = Date.now();
  document.querySelectorAll("[data-ends]").forEach(el => {
    const r = Math.max(0, +el.dataset.ends - now);
    el.textContent = fmt(r);
    el.classList.toggle("low", r <= 10000);
  });
}
setInterval(() => {
  tick();
  const now = Date.now();
  if(local && ui === "local" && local.phase === "play" && local.endsAt && now >= local.endsAt){
    applyAction(local, "timeup"); store.set("local", local); buzz(); render();
  }
  if(host && host.game && host.game.phase === "play" && host.game.endsAt && now >= host.game.endsAt){
    applyAction(host.game, "timeup"); saveHost(); buzz(); broadcast();
  }
}, 250);
function buzz(){ try{ navigator.vibrate && navigator.vibrate(300); }catch(e){} }

// ---------- réseau ----------
function peerOpts(){
  const h = qs.get("peerhost");
  if(!h) return { debug: 0 };
  return { host: h, port: +(qs.get("peerport") || 9000), path: "/", secure: false, debug: 0 };
}
function needPeer(){
  if(window.Peer) return true;
  setErr("Le mode en ligne n'a pas pu se charger. Vérifie ta connexion et recharge la page.");
  return false;
}
function hostOnline(id){ if(!host) return false; if(id === myPid) return true; const c = host.conns.get(id); return !!(c && c.open); }
function saveHost(){ if(host) store.set("host", { code: host.code, players: host.players, teams: host.teams, cfg: host.cfg, words: host.words, game: host.game }); }

function hostCreate(name, saved, attempt = 0){
  if(!needPeer()) return;
  const code = saved ? saved.code : randCode();
  const peer = new Peer(PREFIX + code.toLowerCase(), peerOpts());
  host = {
    code, peer, conns: new Map(),
    players: saved ? saved.players : [{ id: myPid, name, team: "A" }],
    teams: saved ? saved.teams : false,
    cfg: saved ? cleanCfg(saved.cfg) : cfgDraft,
    words: saved && saved.words ? saved.words : {},
    game: saved ? saved.game : null
  };
  host.words[myPid] = myWords;
  if(host.game){ host.game.players = host.players; fixGame(host.game); }
  const me = host.players.find(p => p.id === myPid); if(me && name) me.name = name;
  ui = "connecting"; err = ""; render();
  peer.on("open", () => { saveHost(); ui = host.game ? "game" : "lobby"; render(); });
  peer.on("connection", conn => {
    conn.on("data", m => onHostMsg(conn, m));
    conn.on("close", () => { if(!host) return; for(const [k, c] of host.conns) if(c === conn) host.conns.delete(k); broadcast(); });
  });
  peer.on("disconnected", () => { if(host && host.peer === peer && !peer.destroyed) setTimeout(() => { try{ peer.reconnect(); }catch(e){} }, 1500); });
  peer.on("error", e => {
    if(!host || host.peer !== peer) return;
    if(e.type === "unavailable-id"){
      peer.destroy();
      if(saved && attempt < 8){ setTimeout(() => hostCreate(name, saved, attempt + 1), 2500); return; } // l'ancien lien met quelques secondes à se libérer
      if(!saved){ hostCreate(name, null); return; }
      host = null; store.del("host"); ui = "home"; setErr("Impossible de reprendre cette partie. Crée-en une nouvelle.");
      return;
    }
    if(e.type === "peer-unavailable") return;
    if(["network","server-error","socket-error","socket-closed"].includes(e.type) && ui !== "connecting") return;
    host = null; ui = "home"; setErr("Connexion au serveur impossible. Vérifie ton réseau et réessaie.");
  });
}
function onHostMsg(conn, m){
  if(!host || !m || typeof m !== "object") return;
  if(m.type === "hello"){
    const pid = String(m.pid || "").slice(0, 20); if(!pid) return;
    const name = cleanName(m.name) || "Joueur";
    const old = host.conns.get(pid); if(old && old !== conn) try{ old.close(); }catch(e){}
    conn.pid = pid; host.conns.set(pid, conn);
    let p = host.players.find(x => x.id === pid);
    if(p) p.name = name;
    else {
      const a = host.players.filter(x => x.team === "A").length;
      host.players.push({ id: pid, name, team: a <= host.players.length - a ? "A" : "B" });
    }
    if(!host.game) host.words[pid] = cleanList(m.words);
    saveHost(); broadcast(); return;
  }
  if(m.type === "words" && conn.pid && !host.game){ host.words[conn.pid] = cleanList(m.list); saveHost(); broadcast(); return; }
  if(m.type === "act" && host.game && conn.pid) hostAct(String(m.a), conn.pid, typeof m.idx === "number" ? m.idx : null);
}
function hostAct(a, pid, idx){
  const s = host.game; if(!s) return;
  const g = giverOf(s);
  let ok = false;
  if(a === "found" || a === "pass" || a === "skiptheme") ok = canSee(s, pid);
  else if(a === "start" || a === "endturn") ok = pid === g.id || pid === myPid;
  else if(a === "finish") ok = pid === myPid;
  if(ok && applyAction(s, a, idx)){ saveHost(); broadcast(); }
}
function lobbyPacket(){
  const L = lobbyData();
  return { type: "lobby", code: L.code, teams: L.teams, cfg: L.cfg, persoCount: L.persoCount, players: L.players };
}
function broadcast(){
  if(!host) return;
  const lp = host.game ? null : lobbyPacket();
  for(const p of host.players){
    if(p.id === myPid) continue;
    const c = host.conns.get(p.id);
    if(!c || !c.open) continue;
    try{ c.send(host.game ? { type: "game", v: viewFor(host.game, p.id, hostOnline) } : lp); }catch(e){}
  }
  if(ui === "lobby" || ui === "game"){ ui = host.game ? "game" : "lobby"; render(); }
}

function clientJoin(name, code){
  if(!needPeer()) return;
  client = { name, code, peer: null, conn: null, view: null, lobby: null, lost: false, timer: null, joined: false };
  store.set("client", { name, code });
  ui = "connecting"; err = ""; render();
  const peer = new Peer(peerOpts()); client.peer = peer;
  peer.on("open", () => connectToHost());
  peer.on("disconnected", () => { if(client && client.peer === peer && !peer.destroyed) setTimeout(() => { try{ peer.reconnect(); }catch(e){} }, 1500); });
  peer.on("error", e => {
    if(!client || client.peer !== peer) return;
    if(e.type === "peer-unavailable"){
      if(client.joined){ client.lost = true; render(); retry(); return; }
      const c = client.code; leaveOnline(); store.del("client"); ui = "home";
      setErr(`Partie ${c} introuvable. Vérifie le code, et que celui qui l'a créée garde la page ouverte.`);
      return;
    }
    if(client.joined){ client.lost = true; render(); retry(); return; }
    leaveOnline(); ui = "home"; setErr("Connexion au serveur impossible. Vérifie ton réseau et réessaie.");
  });
}
function connectToHost(){
  if(!client || !client.peer || client.peer.destroyed) return;
  const conn = client.peer.connect(PREFIX + client.code.toLowerCase(), { reliable: true });
  client.conn = conn;
  const t = setTimeout(() => { if(client && client.conn === conn && !conn.open){ try{ conn.close(); }catch(e){} if(client.joined){ retry(); } else { const c = client.code; leaveOnline(); ui = "home"; setErr(`Pas de réponse de la partie ${c}. Vérifie le code et réessaie.`); } } }, 15000);
  conn.on("open", () => { clearTimeout(t); client.lost = false; client.joined = true; conn.send({ type: "hello", pid: myPid, name: client.name, words: myWords }); render(); });
  conn.on("data", m => {
    if(!client || client.conn !== conn || !m || typeof m !== "object") return;
    if(m.type === "lobby"){
      client.lobby = { code: String(m.code), teams: !!m.teams, cfg: cleanCfg(m.cfg), persoCount: +m.persoCount || 0, players: Array.isArray(m.players) ? m.players : [] };
      client.view = null; ui = "lobby";
    }
    else if(m.type === "game" && m.v){
      const v = m.v; v.ends = typeof v.remaining === "number" ? Date.now() + v.remaining : null; // horloge locale
      client.view = v; ui = "game";
    }
    else if(m.type === "kicked"){ leaveOnline(); store.del("client"); ui = "home"; err = "L'hôte t'a retiré de la partie."; }
    render();
  });
  conn.on("close", () => { if(!client || client.conn !== conn) return; client.lost = true; render(); retry(); });
}
function retry(){
  if(!client || client.timer) return;
  client.timer = setTimeout(() => { if(!client) return; client.timer = null; if(client.lost) connectToHost(); }, 2500);
}
function send(a, idx){
  if(host){ hostAct(a, myPid, idx); return; }
  if(client && client.conn && client.conn.open) client.conn.send({ type: "act", a, idx });
}
function leaveOnline(){
  if(host){ try{ host.peer.destroy(); }catch(e){} host = null; }
  if(client){ clearTimeout(client.timer); try{ client.peer.destroy(); }catch(e){} client = null; }
}

// --- mots perso : qui modifie quelle liste ---
function wordsChanged(){
  if(ui === "local-setup"){ store.set("localwords", localWords); render(); return; }
  store.set("mywords", myWords);
  if(host && !host.game){ host.words[myPid] = myWords; saveHost(); broadcast(); }
  else if(client && client.conn && client.conn.open){ client.conn.send({ type: "words", list: myWords }); render(); }
  else render();
}
function editCfg(fn){
  const cfg = host && !host.game ? host.cfg : cfgDraft;
  fn(cfg);
  store.set("cfg", cfg);
  if(host && !host.game){ saveHost(); broadcast(); }
  else { if(ui === "local-setup") readLocalDraft(); render(); }
}

// ---------- clics ----------
app.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if(!b || b.disabled) return;
  const act = b.dataset.act;
  const idx = b.dataset.idx != null ? +b.dataset.idx : null;
  const readName = () => { const n = cleanName(app.querySelector("#name")?.value); if(n) store.set("name", n); return n; };
  err = "";
  if(ui === "home"){ const c = app.querySelector("#code"); if(c) draftCode = c.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); }
  if(ui === "local-setup") readLocalDraft();
  switch(act){
    case "home": ui = "home"; render(); break;
    case "create": {
      const n = readName(); if(!n) return setErr("Entre ton prénom pour créer la partie.");
      store.del("host"); store.del("client"); hostCreate(n, null); break;
    }
    case "join": {
      const n = readName(); if(!n) return setErr("Entre ton prénom pour rejoindre.");
      const c = (app.querySelector("#code")?.value || "").toUpperCase().replace(/[^A-Z]/g, "");
      if(c.length !== 4) return setErr("Le code fait 4 lettres. Demande-le à celui qui a créé la partie.");
      store.del("host"); clientJoin(n, c); break;
    }
    case "resume-host": { const s = store.get("host", null); if(s) hostCreate(store.get("name", ""), s); break; }
    case "resume-client": { const s = store.get("client", null); if(s) clientJoin(s.name, s.code); break; }
    case "resume-local": { const s = store.get("local", null); if(s){ local = fixGame(s); ui = "local"; render(); } break; }
    case "local-setup": ui = "local-setup"; render(); break;
    case "ladd": localDraft.names.push(""); render(); break;
    case "ltoggle": { const i = +b.dataset.i; localDraft.team[i] = localDraft.team[i] === "A" ? "B" : "A"; store.set("local-draft", localDraft); render(); break; }
    case "lstart": {
      const players = [];
      localDraft.names.forEach((n, i) => { const c = cleanName(n); if(c) players.push({ id: "p" + i, name: c, team: localDraft.team[i] || "A" }); });
      if(players.length < 2) return setErr("Il faut au moins 2 joueurs.");
      if(new Set(players.map(p => p.name.toLowerCase())).size !== players.length) return setErr("Deux joueurs ont le même prénom. Ajoute une initiale pour les distinguer.");
      const teams = localDraft.teams && players.length >= 4;
      if(teams && !validTeams(players)) return setErr("Chaque équipe doit avoir au moins 2 joueurs.");
      const custom = localWords.map(w => ({ w, by: "" }));
      if(deckSize(cfgDraft, custom) === 0) return setErr("Choisis au moins un thème ou ajoute des mots perso.");
      local = newGame(players, teams, { ...cfgDraft, cats: cfgDraft.cats.slice() }, custom); store.set("local", local); ui = "local"; render(); break;
    }
    case "quit-local": local = null; store.del("local"); ui = "home"; render(); break;
    case "rounds": editCfg(cfg => { cfg.rounds = +b.dataset.r; }); break;
    case "replay":
      if(ui === "local" && local){ local = newGame(local.players, local.teams, { ...local.cfg, cats: local.cfg.cats.slice() }, local.custom); store.set("local", local); render(); }
      else if(host && host.game){ host.game = null; saveHost(); ui = "lobby"; broadcast(); render(); }
      break;
    case "share": {
      const v = ui === "local" ? Object.assign(viewFor(local, giverOf(local).id), { me: null }) : currentView();
      if(!v || !v.bilan) break;
      const text = bilanText(v);
      const done = m => { b.textContent = m; setTimeout(() => { b.textContent = "Partager le verdict"; }, 1800); };
      if(navigator.share) navigator.share({ text }).catch(() => {});
      else if(navigator.clipboard) navigator.clipboard.writeText(text).then(() => done("Copié !"), () => done("Copie impossible"));
      break;
    }
    case "start": case "found": case "pass": case "endturn": case "skiptheme": case "finish":
      if(ui === "local"){ if(applyAction(local, act, idx)){ store.set("local", local); render(); } }
      else send(act, idx);
      break;
    case "cat": editCfg(cfg => { const c = b.dataset.cat; cfg.cats = cfg.cats.includes(c) ? cfg.cats.filter(x => x !== c) : CATS.filter(x => x === c || cfg.cats.includes(x)); }); break;
    case "cats-all": editCfg(cfg => { cfg.cats = cfg.cats.length === CATS.length ? [] : CATS.slice(); }); break;
    case "timer": editCfg(cfg => { cfg.timer = +b.dataset.t; }); break;
    case "wadd": {
      const inp = app.querySelector("#wordin"); const w = cleanWord(inp && inp.value); if(!w) return;
      const list = ui === "local-setup" ? localWords : myWords;
      if(!list.some(x => x.toLowerCase() === w.toLowerCase()) && list.length < MAX_PERSO) list.push(w);
      if(inp) inp.value = "";
      wordsChanged(); app.querySelector("#wordin")?.focus(); break;
    }
    case "wdel": { const list = ui === "local-setup" ? localWords : myWords; list.splice(+b.dataset.i, 1); wordsChanged(); break; }
    case "team": if(host && !host.game){ const p = host.players.find(x => x.id === b.dataset.id); if(p){ p.team = p.team === "A" ? "B" : "A"; saveHost(); broadcast(); } } break;
    case "kick": if(host){ const id = b.dataset.id; const c = host.conns.get(id); if(c) try{ c.send({ type: "kicked" }); c.close(); }catch(e){} host.conns.delete(id); delete host.words[id];
      host.players = host.players.filter(p => p.id !== id); if(host.game){ host.game.players = host.players; } saveHost(); broadcast(); } break;
    case "hstart": {
      if(!host) return;
      if(host.players.length < 2) return setErr("Il faut au moins 2 joueurs.");
      const teams = host.teams && host.players.length >= 4;
      if(teams && !validTeams(host.players)) return setErr("Chaque équipe doit avoir au moins 2 joueurs.");
      const custom = [];
      for(const p of host.players) for(const w of (host.words[p.id] || [])) custom.push({ w, by: p.name });
      if(deckSize(host.cfg, custom) === 0) return setErr("Choisis au moins un thème ou ajoutez des mots perso.");
      host.teams = teams; host.game = newGame(host.players, teams, { ...host.cfg, cats: host.cfg.cats.slice() }, custom);
      saveHost(); ui = "game"; broadcast(); render(); break;
    }
    case "copy": {
      const t = app.querySelector("#link")?.textContent || "";
      const done = () => { b.textContent = "Copié"; setTimeout(() => { b.textContent = "Copier"; }, 1500); };
      if(navigator.clipboard) navigator.clipboard.writeText(t).then(done, () => selectLink()); else selectLink();
      break;
    }
    case "leave":
      if(host) store.del("host");
      store.del("client");
      leaveOnline(); ui = "home"; render(); break;
  }
});
function selectLink(){ const el = app.querySelector("#link"); if(!el) return; const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
app.addEventListener("change", e => {
  if(e.target.id === "teams" && host && !host.game){
    host.teams = e.target.checked;
    if(host.teams){ host.players.forEach((p, i) => { p.team = i % 2 === 0 ? "A" : "B"; }); }
    saveHost(); broadcast(); render();
  }
  if(e.target.id === "lteams"){ readLocalDraft(); render(); }
  if(e.target.id === "code"){ e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); }
});
app.addEventListener("input", e => {
  if(e.target.matches("[data-name]") && ui === "local-setup"){
    const before = localDraft.names.filter(n => cleanName(n)).length >= 4;
    readLocalDraft();
    const after = localDraft.names.filter(n => cleanName(n)).length >= 4;
    if(before !== after){ const t = app.querySelector("#lteams"); if(t){ t.disabled = !after; if(!after) t.checked = false; } }
  }
});
app.addEventListener("keydown", e => {
  if(e.key !== "Enter") return;
  if(e.target.id === "code") app.querySelector('[data-act="join"]')?.click();
  if(e.target.id === "wordin"){ e.preventDefault(); app.querySelector('[data-act="wadd"]')?.click(); }
});

render();
})();
