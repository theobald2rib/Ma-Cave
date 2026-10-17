/* Ma Cave — frontend (JS vanilla, sans dépendance) */
(function () {
  'use strict';

  // Anti-clickjacking : la page refuse de s'afficher dans un cadre d'un autre site
  // (GitHub Pages ne permet pas d'envoyer l'en-tête frame-ancestors).
  if (window.top !== window.self) {
    document.documentElement.innerHTML = '';
    try { window.top.location = window.self.location.href; } catch (e) {}
    return;
  }

  var CFG = window.CAVE_CONFIG || {};
  var ANNEE = new Date().getFullYear();

  /* =========================================================
   * Utilitaires
   * ======================================================= */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) { var n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; }
  var fmtEurF = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  var fmtEur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  function eur(v, precis) { return v ? (precis ? fmtEur2 : fmtEurF).format(v) : '—'; }
  function dateFr(d) {
    if (!d) return '';
    var p = String(d).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d;
  }
  function today() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function libelle(v) { return [v.domaine, v.nom].filter(Boolean).join(' — ') || 'Sans nom'; }
  function splitList(s) { return String(s || '').split(/[,;]\s*/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  if (!window.demoConfirm) window.demoConfirm = function (m) { return window.confirm(m); };

  function toast(msg, bad) {
    var t = $('#toast');
    t.textContent = msg; t.className = 'on' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = ''; }, bad ? 5000 : 2600);
  }

  function modal(html, onReady) {
    var d = $('#modal');
    $('#modal-body').innerHTML = html;
    if (!d.open) d.showModal();
    if (onReady) onReady($('#modal-body'));
    return d;
  }
  function closeModal() { var d = $('#modal'); if (d.open) d.close(); }
  $('#modal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });

  function busy(btn, on, txt) {
    if (!btn) return;
    if (on) { btn._html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + (txt || ''); }
    else { btn.disabled = false; if (btn._html) btn.innerHTML = btn._html; }
  }

  /* =========================================================
   * API
   * ======================================================= */
  var session = null;
  try { session = JSON.parse(sessionStorage.getItem('cave_session') || 'null'); } catch (e) {}

  function api(action, data) {
    return fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, token: session && session.token, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res.success) return res.data;
      if (res.error && (res.error.code === 'SESSION' || res.error.code === 'NON_AUTORISE') && action !== 'login') {
        deconnexion(res.error.message);
      }
      var e = new Error((res.error && res.error.message) || 'Erreur');
      e.code = res.error && res.error.code;
      throw e;
    });
  }
  function fail(e) { console.error(e); toast(e.message || String(e), true); }

  /* =========================================================
   * Authentification (Google Identity Services)
   * ======================================================= */
  function afficherLogin(msg) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-err').textContent = msg || '';
    (function attendreGsi() {
      if (!window.google || !google.accounts || !google.accounts.id) return setTimeout(attendreGsi, 150);
      google.accounts.id.initialize({ client_id: CFG.CLIENT_ID, callback: onCredential, auto_select: true });
      google.accounts.id.renderButton($('#gsi-btn'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'fr' });
      google.accounts.id.prompt();
    })();
  }

  function onCredential(resp) {
    $('#login-err').textContent = 'Connexion…';
    api('login', { credential: resp.credential }).then(function (s) {
      session = s;
      sessionStorage.setItem('cave_session', JSON.stringify(s));
      demarrer();
    }).catch(function (e) { $('#login-err').textContent = e.message; });
  }

  function deconnexion(msg) {
    var tok = session && session.token;
    session = null;
    sessionStorage.removeItem('cave_session');
    cache = {};
    if (tok && !msg) fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'logout', token: tok }) }).catch(function () {});
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    afficherLogin(msg);
  }
  $('#btn-logout').addEventListener('click', function () { deconnexion(); });

  /* =========================================================
   * Cache de données
   * ======================================================= */
  var cache = {};
  function charger(cle, action, force) {
    if (!force && cache[cle]) return Promise.resolve(cache[cle]);
    return api(action).then(function (d) { cache[cle] = d; return d; });
  }
  function invalider() { delete cache.vins; delete cache.dash; delete cache.valeur; }

  /* =========================================================
   * Référentiels
   * ======================================================= */
  var TYPES = ['Vin', 'Champagne', 'Crémant', 'Spiritueux', 'Liqueur', 'Bière', 'Autre'];
  var COULEURS = ['Rouge', 'Blanc', 'Rosé', 'Effervescent', 'Liquoreux', 'Moelleux', 'Ambré', 'Incolore'];
  var MATURITE = {
    trop_jeune: 'Trop jeune', peut_attendre: 'Peut attendre', a_boire: 'À boire', apogee: 'À l’apogée',
    a_boire_vite: 'À boire vite', passee: 'Passé', inconnue: 'Garde non renseignée'
  };
  var MATURITE_ORDRE = ['passee', 'a_boire_vite', 'apogee', 'a_boire', 'peut_attendre', 'trop_jeune', 'inconnue'];
  var TYPES_MVT = {
    achat: 'Achat', cadeau_recu: 'Cadeau reçu', ajustement: 'Ajustement',
    consommation: 'Bue', offert: 'Offerte', perte: 'Perte / casse', sortie: 'Autre sortie'
  };
  var STATUTS_PROSP = { memo: 'À retenir', repere: 'Repéré', a_acheter: 'À acheter', achete: 'Acheté', abandonne: 'Abandonné' };

  var ORIGINES = {
    restaurant: 'Bue au restaurant', amis: 'Bue chez des amis', degustation: 'Dégustation / salon',
    caviste: 'Vue chez un caviste', recommandation: 'Recommandée', envie: 'Envie de découvrir'
  };

/** Bouteilles qui se gardent ouvertes : spiritueux, liqueurs, vins doux. */
  function entamable(b) {
    return /spiritueux|liqueur|autre/i.test(b.type || '') || b.couleur === 'Liquoreux' || b.couleur === 'Moelleux' || num(b.niveau_entamee) > 0;
  }
  function jauge(niveau, grand) {
    var n = Math.max(0, Math.min(100, num(niveau)));
    return '<span class="jauge' + (grand ? ' jauge-l' : '') + '" role="img" aria-label="Niveau ' + n + ' %"><span style="height:' + n + '%"></span></span>';
  }
  function tagEntamee(b) {
    return num(b.niveau_entamee) > 0 ? '<span class="tag tag-ent">' + jauge(b.niveau_entamee) + ' entamée ' + Math.round(num(b.niveau_entamee)) + ' %</span>' : '';
  }

  function pillMat(m) { return '<span class="pill m-' + esc(m) + '">' + esc(MATURITE[m] || m) + '</span>'; }
  function dot(c) { return c ? '<span class="dot c-' + esc(c) + '" title="' + esc(c) + '"></span>' : ''; }
  function options(list, sel, vide) {
    return (vide !== undefined ? '<option value="">' + esc(vide) + '</option>' : '') +
      list.map(function (o) {
        var v = typeof o === 'string' ? o : o[0], l = typeof o === 'string' ? o : o[1];
        return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('');
  }

  /* =========================================================
   * Routeur
   * ======================================================= */
  var ROUTES = {
    '': vueAccueil, cave: vueCave, bouteille: vueBouteille, ajouter: vueFormulaire, modifier: vueFormulaire,
    accords: vueAccords, apporter: vueApporter, serie: vueSerie, degustations: vueDegustations, offres: vueOffres, prospection: vueProspection, valeur: vueValeur, journal: vueJournal
  };

  function route() {
    if (!session) return;
    var h = location.hash.replace(/^#\/?/, '');
    var q = h.split('?');
    var parts = q[0].split('/');
    var params = {};
    (q[1] || '').split('&').forEach(function (kv) { if (kv) { var p = kv.split('='); params[p[0]] = decodeURIComponent(p[1] || ''); } });
    var nom = parts[0] || '';
    var fn = ROUTES[nom] || vueAccueil;
    $$('#nav a').forEach(function (a) {
      var r = a.getAttribute('data-r');
      a.classList.toggle('active', r === nom || (r === 'cave' && nom === 'bouteille') || (r === 'accords' && nom === 'apporter') || (r === 'ajouter' && nom === 'serie'));
    });
    var v = $('#view');
    v.innerHTML = '<div class="loading"><span class="spin"></span></div>';
    window.scrollTo(0, 0);
    Promise.resolve(fn(v, parts[1], params, nom)).catch(function (e) {
      if (session) v.innerHTML = '<div class="card empty">' + esc(e.message) + '</div>';
    });
  }
  window.addEventListener('hashchange', route);

  function demarrer() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    route();
  }

  /* =========================================================
   * Accueil
   * ======================================================= */
  function vueAccueil(v) {
    return charger('dash', 'dashboard', true).then(function (d) {
      var val = d.valeur, m = d.maturite;
      var pv = val.valeur_achat ? Math.round((val.valeur_estimee / val.valeur_achat - 1) * 100) : null;
      var ligne = function (b) {
        return '<tr><td>' + dot(b.couleur) + ' <a href="#/bouteille/' + esc(b.id) + '">' + esc(b.libelle) + '</a></td>' +
          '<td>' + pillMat(b.maturite) + '</td><td class="n">' + b.stock + '</td></tr>';
      };
      v.innerHTML =
        '<div class="head"><h1>Bonjour' + (session.nom && session.nom !== 'Administrateur' ? ' ' + esc(session.nom.split(' ')[0]) : '') + '</h1>' +
        '<span class="spacer"></span><button class="ghost" data-quick="sortie">🍷 J’ai bu une bouteille</button>' +
        '<button class="ghost" data-quick="memo">✎ Garder en mémoire</button><a class="btn" href="#/ajouter">📷 Ajouter en cave</a></div>' +
        '<div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">' +
          stat(val.nb_bouteilles, 'bouteilles en cave', val.nb_references + ' références') +
          stat(eur(val.valeur_estimee), 'valeur estimée', pv !== null ? '<span class="' + (pv >= 0 ? 'up' : 'down') + '">' + (pv >= 0 ? '+' : '') + pv + ' % vs achat</span>' : '') +
          stat(eur(val.valeur_achat), 'valeur d’achat', val.sans_prix ? val.sans_prix + ' sans prix' : '') +
          stat((m.apogee + m.a_boire_vite + m.passee), 'références à boire', m.apogee + ' à l’apogée') +
        '</div>' +
        '<div class="grid g2" style="margin-top:16px">' +
          '<div class="card"><h2>À boire en priorité</h2>' +
            (d.a_boire_en_priorite.length ? '<table><tbody>' + d.a_boire_en_priorite.map(ligne).join('') + '</tbody></table>'
              : '<p class="muted">Rien d’urgent : aucune bouteille ne dépasse sa fenêtre.</p>') + '</div>' +
          '<div class="card"><h2>À l’apogée</h2>' +
            (d.a_l_apogee.length ? '<table><tbody>' + d.a_l_apogee.map(ligne).join('') + '</tbody></table>'
              : '<p class="muted">Aucune bouteille à son apogée cette année.</p>') + '</div>' +
          '<div class="card"><h2>Maturité de la cave</h2>' + barresMaturite(m) + '</div>' +
          '<div class="card"><h2>Derniers mouvements</h2>' + tableMvts(d.derniers_mouvements, true) +
            '<p class="small"><a href="#/journal">Tout le journal →</a>' +
            (d.prospection_a_acheter ? ' · <a href="#/prospection">' + d.prospection_a_acheter + ' bouteille(s) à acheter</a>' : '') + '</p></div>' +
        '</div>';
    });
  }

  function stat(v, l, d) {
    return '<div class="card stat"><div class="v">' + v + '</div><div class="l">' + l + '</div>' + (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  }

  function barresMaturite(m) {
    var total = MATURITE_ORDRE.reduce(function (s, k) { return s + (m[k] || 0); }, 0) || 1;
    return MATURITE_ORDRE.filter(function (k) { return m[k]; }).map(function (k) {
      return '<div class="hbar"><span>' + pillMat(k) + '</span><div class="track"><div class="fill" style="width:' +
        Math.round(m[k] / total * 100) + '%;background:var(--' + ({ passee: 'bad', a_boire_vite: 'warn', apogee: 'gold', a_boire: 'ok' }[k] || 'info') +
        ')"></div></div><span class="n">' + m[k] + ' réf.</span></div>';
    }).join('') || '<p class="muted">Ajoutez des bouteilles pour voir leur maturité.</p>';
  }

  function tableMvts(list, court) {
    if (!list.length) return '<p class="muted">Aucun mouvement.</p>';
    return '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Bouteille</th><th>Type</th><th class="n">Qté</th>' +
      (court ? '' : '<th class="n">Prix u.</th><th>Détail</th><th></th>') + '</tr></thead><tbody>' +
      list.map(function (m) {
        var q = num(m.quantite);
        return '<tr><td>' + dateFr(m.date) + '</td><td><a href="#/bouteille/' + esc(m.vin_id) + '">' + esc(m.vin_nom || m.vin_id) + '</a></td>' +
          '<td>' + esc(TYPES_MVT[m.type] || m.type) + '</td><td class="n ' + (q > 0 ? 'up' : 'down') + '">' + (q > 0 ? '+' : '') + q + '</td>' +
          (court ? '' : '<td class="n">' + eur(m.prix_unitaire, true) + '</td><td class="small">' +
            esc([m.fournisseur, m.occasion, m.note].filter(Boolean).join(' · ')) + '</td>' +
            '<td><button class="ghost small" data-del-mvt="' + esc(m.id) + '" title="Supprimer">✕</button></td>') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* =========================================================
   * Cave (liste)
   * ======================================================= */
  var filtres = { q: '', type: '', couleur: '', maturite: '', stock: 'en_stock', tri: 'maturite', vue: 'maturite' };
  try { Object.assign(filtres, JSON.parse(localStorage.getItem('cave_filtres') || '{}')); } catch (e) {}

  var VUES = [['maturite', 'Maturité'], ['grille', 'Grille'], ['liste', 'Liste'], ['emplacement', 'Emplacement']];
  // Sections de la vue « Par maturité », de la plus urgente à la moins urgente
  var SECTIONS_MAT = [
    ['urgent', 'À boire vite', ['passee', 'a_boire_vite'], 'Fenêtre qui se referme ou déjà dépassée'],
    ['apogee', 'À l’apogée', ['apogee'], 'Le meilleur moment pour les ouvrir'],
    ['a_boire', 'À boire', ['a_boire'], 'Prêtes, sans urgence'],
    ['peut_attendre', 'Peut attendre', ['peut_attendre'], 'Ouvrables, mais elles gagneront encore'],
    ['trop_jeune', 'Trop jeune', ['trop_jeune'], 'Patience'],
    ['inconnue', 'Garde non renseignée', ['inconnue'], 'Spiritueux ou fiches à compléter']
  ];

  function carteBouteille(b, vign) {
    var img = vign[b.id];
    return '<a class="card bottle' + (b.stock <= 0 ? ' vide' : '') + '" href="#/bouteille/' + esc(b.id) + '">' +
      '<div class="thumb" style="' + (img ? 'background-image:url(' + img + ')' : '') + '">' + (img ? '' : esc((b.domaine || b.nom || '?')[0])) + '</div>' +
      '<div style="min-width:0"><div class="t">' + esc(libelle(b)) + '</div>' +
      '<div class="s">' + dot(b.couleur) + ' ' + esc([b.appellation || b.type, b.millesime].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="row" style="margin-top:6px;gap:6px">' + pillMat(b.maturite) + tagEntamee(b) + '</div>' +
      (fenetre(b) ? '<div class="s" style="margin-top:4px">' + fenetre(b) + '</div>' : '') +
      (b.emplacement ? '<div class="s" style="margin-top:2px">📍 ' + esc(b.emplacement) + '</div>' : '') + '</div>' +
      '<div class="qty">' + b.stock + '<small>btl</small></div></a>';
  }

  /** Édition rapide dans la vue Liste : emplacement et stock (ajustement d'inventaire). */
  function lierEditionListe(vins, rendre) {
    var parId = function (id) { return vins.filter(function (x) { return x.id === id; })[0]; };
    var marquer = function (el, ok) { el.classList.remove('saved', 'failed'); void el.offsetWidth; el.classList.add(ok ? 'saved' : 'failed'); };
    $$('[data-empl]').forEach(function (i) {
      i.onchange = function () {
        var b = parId(i.getAttribute('data-empl')), val = i.value.trim();
        if (val === (b.emplacement || '')) return;
        api('cave.enregistrer', { vin: { id: b.id, emplacement: val } }).then(function () {
          b.emplacement = val; marquer(i, true); toast('Emplacement enregistré');
        }).catch(function (e) { i.value = b.emplacement || ''; marquer(i, false); fail(e); });
      };
      i.onkeydown = function (e) { if (e.key === 'Enter') i.blur(); };
    });
    var corriger = function (b, cible, champ) {
      cible = Math.max(0, Math.round(cible));
      var delta = cible - b.stock;
      if (!delta) { champ.value = b.stock; return; }
      champ.disabled = true;
      api('mvt.ajouter', { vin_id: b.id, type: 'ajustement', quantite: delta, note: 'Correction rapide (liste)' }).then(function () {
        b.stock = cible; champ.value = cible; champ.disabled = false; marquer(champ, true);
        delete cache.dash; delete cache.valeur;
        var boire = $('[data-boire="' + b.id + '"]'); if (boire) boire.disabled = cible <= 0;
        toast('Stock corrigé : ' + cible + ' btl');
      }).catch(function (e) { champ.value = b.stock; champ.disabled = false; marquer(champ, false); fail(e); });
    };
    $$('[data-stock]').forEach(function (i) {
      i.onchange = function () { corriger(parId(i.getAttribute('data-stock')), num(i.value), i); };
      i.onkeydown = function (e) { if (e.key === 'Enter') i.blur(); };
    });
    $$('[data-pas]').forEach(function (btn) {
      btn.onclick = function () {
        var b = parId(btn.getAttribute('data-id'));
        corriger(b, b.stock + num(btn.getAttribute('data-pas')), $('[data-stock="' + b.id + '"]'));
      };
    });
    $$('[data-boire]').forEach(function (btn) {
      btn.onclick = function () { formulaireSortie(parId(btn.getAttribute('data-boire')), 'consommation'); };
    });
  }

  /** Fenêtre de dégustation résumée : « apogée 2028–2040 » ou « avant 2026 ». */
  function fenetre(b) {
    if (b.apogee_debut && b.apogee_fin) return 'apogée ' + b.apogee_debut + '–' + b.apogee_fin;
    if (b.boire_avant) return 'à boire avant ' + b.boire_avant;
    if (b.boire_des) return 'dès ' + b.boire_des;
    return '';
  }

  function vueCave(v) {
    return Promise.all([charger('vins', 'cave.lister', true), charger('vign', 'cave.vignettes')]).then(function (r) {
      var vins = r[0], vign = r[1];
      v.innerHTML =
        '<div class="head"><h1>La cave</h1><span class="muted" id="compte"></span><span class="spacer"></span>' +
        '<button class="ghost small" id="exp">Exporter CSV</button><a class="btn" href="#/ajouter">+ Ajouter</a></div>' +
        '<div class="seg" role="tablist" aria-label="Affichage" id="vues">' + VUES.map(function (x) {
          return '<button role="tab" data-vue="' + x[0] + '" aria-selected="' + (filtres.vue === x[0]) + '">' + x[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="filters">' +
          '<input class="q" id="f-q" type="search" placeholder="Rechercher : domaine, appellation, cépage, millésime…" value="' + esc(filtres.q) + '">' +
          '<select id="f-type">' + options(TYPES, filtres.type, 'Tous types') + '</select>' +
          '<select id="f-couleur">' + options(COULEURS, filtres.couleur, 'Toutes couleurs') + '</select>' +
          '<select id="f-maturite">' + options(MATURITE_ORDRE.map(function (k) { return [k, MATURITE[k]]; }), filtres.maturite, 'Toute maturité') + '</select>' +
          '<select id="f-tri">' + options([['maturite', 'Tri : urgence'], ['nom', 'Tri : nom'], ['millesime', 'Tri : millésime'],
            ['stock', 'Tri : quantité'], ['valeur', 'Tri : valeur'], ['recent', 'Tri : ajout récent']], filtres.tri) + '</select>' +
        '</div>' +
        '<div class="row" style="margin:-6px 0 14px"><label class="row small" style="margin:0;font-weight:500">' +
          '<input type="checkbox" id="f-stock" style="width:auto"' + (filtres.stock === 'tout' ? ' checked' : '') + '> Afficher aussi les bouteilles épuisées</label></div>' +
        '<div id="liste"></div>';

      function rendre() {
        var q = norm(filtres.q);
        var l = vins.filter(function (b) {
          if (filtres.stock !== 'tout' && b.stock <= 0) return false;
          if (filtres.type && b.type !== filtres.type) return false;
          if (filtres.couleur && b.couleur !== filtres.couleur) return false;
          if (filtres.maturite && b.maturite !== filtres.maturite) return false;
          if (q) {
            var hay = norm([b.nom, b.domaine, b.appellation, b.region, b.pays, b.millesime, b.cepages, b.emplacement, b.type, b.couleur].join(' '));
            return q.split(/\s+/).every(function (w) { return hay.indexOf(w) > -1; });
          }
          return true;
        });
        var tri = {
          maturite: function (a, b) { return MATURITE_ORDRE.indexOf(a.maturite) - MATURITE_ORDRE.indexOf(b.maturite) || libelle(a).localeCompare(libelle(b)); },
          nom: function (a, b) { return libelle(a).localeCompare(libelle(b)); },
          millesime: function (a, b) { return num(a.millesime) - num(b.millesime); },
          stock: function (a, b) { return b.stock - a.stock; },
          valeur: function (a, b) { return b.stock * (num(b.cote_unitaire) || b.prix_moyen) - a.stock * (num(a.cote_unitaire) || a.prix_moyen); },
          recent: function (a, b) { return String(b.cree_le).localeCompare(String(a.cree_le)); }
        }[filtres.tri];
        l.sort(tri);
        var nbBtl = function (arr) { return arr.reduce(function (s, b) { return s + Math.max(0, b.stock); }, 0); };
        var nb = nbBtl(l);
        $('#compte').textContent = l.length + ' référence' + (l.length > 1 ? 's' : '') + ' · ' + nb + ' bouteille' + (nb > 1 ? 's' : '');
        $$('#vues button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-vue') === filtres.vue)); });
        var grille = function (arr) { return '<div class="bottles">' + arr.map(function (b) { return carteBouteille(b, vign); }).join('') + '</div>'; };
        var html;

        if (!l.length) {
          html = '<div class="card empty">Aucune bouteille ne correspond.' +
            (vins.length ? '' : '<br><br><a class="btn" href="#/ajouter">Ajouter la première</a>') + '</div>';
        } else if (filtres.vue === 'maturite') {
          var secs = SECTIONS_MAT.map(function (s) {
            return { s: s, arr: l.filter(function (b) { return s[2].indexOf(b.maturite) > -1; }) };
          }).filter(function (x) { return x.arr.length; });
          html = '<div class="mat-nav">' + secs.map(function (x) {
              return '<button class="mat-chip mc-' + x.s[0] + '" data-sec="' + x.s[0] + '"><span>' + x.s[1] + '</span><strong>' + nbBtl(x.arr) + '</strong></button>';
            }).join('') + '</div>' +
            secs.map(function (x) {
              return '<section class="mat-sec" id="sec-' + x.s[0] + '"><div class="mat-head mc-' + x.s[0] + '"><h2>' + x.s[1] + '</h2>' +
                '<span class="muted small">' + x.s[3] + '</span><span class="spacer"></span><span class="small"><strong>' + nbBtl(x.arr) + '</strong> btl · ' + x.arr.length + ' réf.</span></div>' +
                grille(x.arr) + '</section>';
            }).join('');
        } else if (filtres.vue === 'emplacement') {
          var lieux = {};
          l.forEach(function (b) { (lieux[b.emplacement || 'Sans emplacement'] = lieux[b.emplacement || 'Sans emplacement'] || []).push(b); });
          html = Object.keys(lieux).sort().map(function (k) {
            return '<section class="mat-sec"><div class="mat-head"><h2>📍 ' + esc(k) + '</h2><span class="spacer"></span><span class="small"><strong>' +
              nbBtl(lieux[k]) + '</strong> btl · ' + lieux[k].length + ' réf.</span></div>' + grille(lieux[k]) + '</section>';
          }).join('');
        } else if (filtres.vue === 'liste') {
          var lieux = vins.map(function (x) { return x.emplacement; }).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
          html = '<p class="small muted" style="margin:0 0 8px">Modifiez l’emplacement ou le stock directement dans le tableau. Une correction de stock est enregistrée comme ajustement d’inventaire ; pour une bouteille bue ou offerte, utilisez 🍷 (historique et notes).</p>' +
            '<datalist id="dl-empl-liste">' + lieux.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
            '<div class="card" style="padding:0"><div class="table-wrap"><table class="liste"><thead><tr><th>Bouteille</th><th>Millésime</th><th>Maturité</th>' +
            '<th>Fenêtre</th><th>Emplacement</th><th class="n">Stock</th><th class="n">Valeur</th></tr></thead><tbody>' +
            l.map(function (b) {
              return '<tr><td>' + dot(b.couleur) + ' <a href="#/bouteille/' + esc(b.id) + '">' + esc(libelle(b)) + '</a>' +
                '<div class="small muted">' + esc(b.appellation || b.type) + '</div></td><td>' + esc(b.millesime || '—') + '</td><td>' + pillMat(b.maturite) + '</td>' +
                '<td class="small">' + esc(fenetre(b)) + '</td>' +
                '<td><input class="cell-edit" data-empl="' + esc(b.id) + '" list="dl-empl-liste" value="' + esc(b.emplacement) + '" placeholder="—" aria-label="Emplacement de ' + esc(libelle(b)) + '"></td>' +
                '<td class="n"><div class="stepper"><button type="button" class="ghost small" data-pas="-1" data-id="' + esc(b.id) + '" aria-label="Retirer une bouteille">−</button>' +
                  '<input class="cell-edit n" data-stock="' + esc(b.id) + '" type="number" min="0" value="' + b.stock + '" aria-label="Stock de ' + esc(libelle(b)) + '">' +
                  '<button type="button" class="ghost small" data-pas="1" data-id="' + esc(b.id) + '" aria-label="Ajouter une bouteille">+</button>' +
                  '<button type="button" class="ghost small" data-boire="' + esc(b.id) + '" title="Bue, offerte, sortie…"' + (b.stock > 0 ? '' : ' disabled') + '>🍷</button></div>' +
                  (num(b.niveau_entamee) > 0 ? '<div class="small muted">dont 1 entamée (' + Math.round(num(b.niveau_entamee)) + ' %)</div>' : '') + '</td>' +
                '<td class="n">' + eur(b.stock * (num(b.cote_unitaire) || b.prix_moyen)) + '</td></tr>';
            }).join('') + '</tbody></table></div></div>';
        } else {
          html = grille(l);
        }
        $('#liste').innerHTML = html;
        lierEditionListe(vins, rendre);
        $$('.mat-chip').forEach(function (c) {
          c.onclick = function () { var t = $('#sec-' + c.getAttribute('data-sec')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        });
        try { localStorage.setItem('cave_filtres', JSON.stringify(filtres)); } catch (e) {}
      }
      $$('#vues button').forEach(function (b) { b.onclick = function () { filtres.vue = b.getAttribute('data-vue'); rendre(); }; });
      $('#f-q').addEventListener('input', function () { filtres.q = this.value; rendre(); });
      ['type', 'couleur', 'maturite', 'tri'].forEach(function (k) {
        $('#f-' + k).addEventListener('change', function () { filtres[k] = this.value; rendre(); });
      });
      $('#f-stock').addEventListener('change', function () { filtres.stock = this.checked ? 'tout' : 'en_stock'; rendre(); });
      $('#exp') && $('#exp').addEventListener('click', function () { exporterCsv(vins); });
      rendre();
    });
  }

  function exporterCsv(vins) {
    var cols = ['id', 'domaine', 'nom', 'type', 'couleur', 'appellation', 'region', 'pays', 'millesime', 'stock',
      'prix_moyen', 'cote_unitaire', 'emplacement', 'boire_des', 'apogee_debut', 'apogee_fin', 'boire_avant'];
    var csv = '﻿' + cols.join(';') + '\n' + vins.map(function (v) {
      return cols.map(function (c) { return '"' + String(v[c] === undefined ? '' : v[c]).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'ma-cave-' + today() + '.csv';
    a.click();
  }

  /* =========================================================
   * Fiche bouteille
   * ======================================================= */
  function vueBouteille(v, id) {
    return Promise.all([api('cave.lire', { id: id }), charger('vign', 'cave.vignettes')]).then(function (r) {
      var b = r[0], img = r[1][id];
      var pv = num(b.cote_unitaire) && b.prix_moyen ? Math.round((num(b.cote_unitaire) / b.prix_moyen - 1) * 100) : null;
      var kv = function (k, val) { return val ? '<dt>' + k + '</dt><dd>' + val + '</dd>' : ''; };

      v.innerHTML =
        '<p class="small"><a href="#/cave">← La cave</a></p>' +
        '<div class="fiche">' +
          '<div>' +
            '<div class="photo" id="photo" style="' + (img ? 'background-image:url(' + img + ')' : '') + '">' + (img ? '' : 'Pas de photo') + '</div>' +
            '<div class="card" style="margin-top:14px;text-align:center">' +
              '<div class="qty" style="margin:0 auto;text-align:center">' + b.stock + '<small>bouteille' + (b.stock > 1 ? 's' : '') + ' en cave' +
                (num(b.niveau_entamee) > 0 ? ' dont 1 entamée' : '') + '</small></div>' +
              '<div class="row" style="justify-content:center;margin-top:12px">' +
                '<button id="b-boire"' + (b.stock <= 0 ? ' disabled' : '') + '>🍷 J’en bois une</button>' +
                '<button class="ghost" id="b-achat">+ Entrée</button>' +
              '</div>' +
              '<div class="row" style="justify-content:center;margin-top:8px">' +
                '<button class="ghost small" id="b-sortie">Autre sortie</button>' +
                '<button class="ghost small" id="b-ajust">Inventaire</button>' +
              '</div>' +
            '</div>' +
            (entamable(b) && b.stock > 0 ? blocEntamee(b) : '') +
          '</div>' +
          '<div>' +
            '<div class="head" style="margin-bottom:8px"><div><h1>' + esc(libelle(b)) + '</h1>' +
              '<div class="row">' + dot(b.couleur) + '<span class="muted">' + esc([b.type, b.couleur, b.appellation, b.millesime].filter(Boolean).join(' · ')) + '</span>' +
              pillMat(b.maturite) + (b.statut === 'archive' ? '<span class="pill">Archivée</span>' : '') + '</div></div>' +
              '<span class="spacer"></span><a class="btn ghost small" href="#/modifier/' + esc(b.id) + '">Modifier</a>' +
              '<button class="ghost small" id="b-archiver">' + (b.statut === 'archive' ? 'Restaurer' : 'Archiver') + '</button></div>' +

            '<div class="card" style="margin-top:12px"><h3>Quand la boire</h3>' + frise(b) + conseilMaturite(b) + '</div>' +

            '<div class="grid g2" style="margin-top:16px">' +
              '<div class="card"><h3>Dégustation</h3>' +
                (b.description ? '<p>' + esc(b.description) + '</p>' : '') +
                '<dl class="kv">' +
                  kv('Nez', b.aromes_nez ? '<div class="tags">' + splitList(b.aromes_nez).map(function (a) { return '<span class="tag">' + esc(a) + '</span>'; }).join('') + '</div>' : '') +
                  kv('Bouche', esc(b.aromes_bouche)) + kv('Service', esc(b.temp_service)) + kv('Carafage', esc(b.carafage)) +
                '</dl>' +
                (!b.description && !b.aromes_nez ? '<p class="muted">Pas encore de fiche de dégustation.</p>' : '') +
                '<button class="ghost small" id="b-enrichir" style="margin-top:10px">✨ Compléter avec l’IA</button>' +
              '</div>' +
              '<div class="card"><h3>Accords</h3>' +
                (b.accords ? '<div class="tags">' + splitList(b.accords).map(function (a) { return '<span class="tag">' + esc(a) + '</span>'; }).join('') + '</div>' : '<p class="muted">Non renseignés.</p>') +
                '<h3 style="margin-top:18px">Identité</h3><dl class="kv">' +
                  kv('Domaine', esc(b.domaine)) + kv('Appellation', esc(b.appellation)) + kv('Région', esc([b.region, b.pays].filter(Boolean).join(', '))) +
                  kv('Cépages', esc(b.cepages)) + kv('Degré', b.degre ? esc(b.degre) + ' %' : '') + kv('Contenance', b.contenance_cl ? esc(b.contenance_cl) + ' cl' : '') +
                  kv('Emplacement', esc(b.emplacement)) + kv('Référence', '<span class="muted small">' + esc(b.id) + '</span>') +
                '</dl></div>' +
              '<div class="card"><h3>Valeur</h3><dl class="kv">' +
                kv('Prix moyen d’achat', eur(b.prix_moyen, true)) +
                kv('Cote estimée', num(b.cote_unitaire) ? eur(b.cote_unitaire, true) + (pv !== null ? ' <span class="' + (pv >= 0 ? 'up' : 'down') + '">(' + (pv >= 0 ? '+' : '') + pv + ' %)</span>' : '') : '') +
                kv('Valeur du stock', eur(b.stock * (num(b.cote_unitaire) || b.prix_moyen))) +
                kv('Cote', b.cote_date ? dateFr(b.cote_date) + ' · ' + (b.cote_source === 'ia' ? 'estimation IA' : 'saisie manuelle') : '') +
                '</dl>' + (b.cote_commentaire ? '<p class="small muted">' + esc(b.cote_commentaire) + '</p>' : '') +
                '<button class="ghost small" id="b-coter">✨ Réestimer la cote</button></div>' +
              '<div class="card"><h3>Mes notes</h3>' +
                (b.note_perso ? '<p class="stat" style="padding:0"><span class="v">' + esc(b.note_perso) + '</span><span class="muted">/20</span></p>' : '') +
                (b.notes_perso ? '<p style="white-space:pre-wrap">' + esc(b.notes_perso) + '</p>' : '<p class="muted">Aucune note personnelle.</p>') +
                '<p class="small muted">Achetées : ' + b.achetees + ' · Bues/sorties : ' + b.consommees +
                (b.derniere_sortie ? ' · dernière le ' + dateFr(b.derniere_sortie) : '') + '</p></div>' +
            '</div>' +
            '<div class="card" style="margin-top:16px"><h3>Historique</h3><div id="hist">' + tableMvts(b.mouvements.map(function (m) { m.vin_nom = libelle(b); return m; })) + '</div></div>' +
          '</div>' +
        '</div>';

      if (b.photo_id) api('cave.photo', { id: id }).then(function (src) {
        if (src && $('#photo')) { $('#photo').style.backgroundImage = 'url(' + src + ')'; $('#photo').textContent = ''; }
      }).catch(function () {});

      var recharger = function () { invalider(); route(); };
      $('#b-boire').onclick = function () { dialogueSortie(b, 'consommation'); };
      $('#b-achat').onclick = function () { dialogueMvt(b, 'achat', recharger); };
      $('#b-sortie').onclick = function () { dialogueSortie(b, 'offert'); };
      $('#b-ajust').onclick = function () { dialogueInventaire(b, recharger); };
      lierEntamee(b, recharger);
      $('#b-archiver').onclick = function () {
        api('cave.archiver', { id: b.id, restaurer: b.statut === 'archive' }).then(recharger).catch(fail);
      };
      $('#b-coter').onclick = function () {
        var btn = this; busy(btn, true, 'Estimation…');
        api('ia.coter', { id: b.id }).then(function (r) { toast('Cote estimée : ' + eur(r.cote_unitaire, true)); recharger(); })
          .catch(function (e) { busy(btn, false); fail(e); });
      };
      $('#b-enrichir').onclick = function () {
        var btn = this; busy(btn, true, 'Analyse…');
        api('ia.enrichir', { vin: b }).then(function (r) {
          busy(btn, false);
          dialogueFusion(b, r, recharger);
        }).catch(function (e) { busy(btn, false); fail(e); });
      };
      lierSuppressionMvt(v, recharger);
    });
  }

  /** Bloc de la fiche : niveau de la bouteille ouverte, verres servis, fin de bouteille. */
  function blocEntamee(b) {
    var n = num(b.niveau_entamee), cl = num(b.contenance_cl) || (/spiritueux|liqueur/i.test(b.type) ? 70 : 75);
    if (!n) {
      return '<div class="card ent" style="margin-top:14px"><h3>Bouteille entamée</h3><p class="small muted">Aucune bouteille ouverte. Ouvrez-en une pour suivre ce qu’il reste, verre après verre.</p>' +
        '<div class="row"><button class="ghost small" data-niv="100">Ouvrir une bouteille</button>' +
        '<button class="small" id="e-servir">🥃 Ouvrir et servir un verre</button></div>' +
        '<div class="row small" style="margin-top:8px"><label for="e-dose" style="margin:0">Verre de</label><input id="e-dose" type="number" min="1" max="50" value="' + (/spiritueux|liqueur/i.test(b.type) ? 4 : 8) + '" style="width:64px;padding:4px 6px"> cl</div></div>';
    }
    return '<div class="card ent" style="margin-top:14px"><h3>Bouteille entamée</h3>' +
      '<div class="ent-row">' + jauge(n, true) + '<div><div class="ent-pc">' + Math.round(n) + ' %</div>' +
        '<div class="small muted">≈ ' + Math.round(cl * n / 100) + ' cl restants sur ' + cl + ' cl</div>' +
        '<div class="small muted">≈ ' + Math.max(0, Math.floor(cl * n / 100 / (/spiritueux|liqueur/i.test(b.type) ? 4 : 8))) + ' verres</div></div></div>' +
      '<div class="row" style="margin-top:10px;gap:6px"><span class="small muted">Niveau :</span>' +
        [[75, '¾'], [50, '½'], [25, '¼'], [10, 'Fond']].map(function (x) { return '<button class="ghost small" data-niv="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<input id="e-range" type="range" min="1" max="100" value="' + Math.round(n) + '" aria-label="Niveau restant" style="margin-top:8px;padding:0">' +
      '<div class="row" style="margin-top:10px"><button class="small" id="e-servir">🥃 Servir un verre</button>' +
        '<label class="row small" style="margin:0;gap:4px"><input id="e-dose" type="number" min="1" max="50" value="' + (/spiritueux|liqueur/i.test(b.type) ? 4 : 8) + '" style="width:58px;padding:4px 6px"> cl</label>' +
        '<button class="ghost small" id="e-finie">Bouteille terminée</button></div></div>';
  }

  function lierEntamee(b, apres) {
    var envoyer = function (data, msg) {
      data.id = b.id;
      api('cave.niveau', data).then(function (r) {
        toast(r.terminee ? 'Bouteille terminée : stock ' + r.stock : msg || ('Niveau : ' + r.niveau + ' %'));
        apres();
      }).catch(fail);
    };
    $$('[data-niv]').forEach(function (x) { x.onclick = function () { envoyer({ niveau: num(x.getAttribute('data-niv')) }, num(x.getAttribute('data-niv')) === 100 ? 'Bouteille ouverte' : null); }; });
    if ($('#e-range')) $('#e-range').onchange = function () { envoyer({ niveau: num(this.value) }); };
    if ($('#e-servir')) $('#e-servir').onclick = function () { busy(this, true); envoyer({ servir_cl: num($('#e-dose').value) || 4 }, 'Verre servi'); };
    if ($('#e-finie')) $('#e-finie').onclick = function () { envoyer({ finie: true }); };
  }

  /** Frise chronologique de garde. */
  function frise(b) {
    var des = num(b.boire_des), ad = num(b.apogee_debut), af = num(b.apogee_fin), av = num(b.boire_avant), mil = num(b.millesime);
    if (!des && !ad && !af && !av) {
      return '<p class="muted">Fenêtre de garde non renseignée' +
        (/spiritueux|liqueur/i.test(b.type) ? ' — normal pour un spiritueux, qui n’évolue plus une fois en bouteille.' : '. Utilisez « Compléter avec l’IA » ou modifiez la fiche.') + '</p>';
    }
    var debut = Math.min.apply(null, [mil || des || ad, des || ad, ANNEE].filter(Boolean)) - 1;
    var fin = Math.max.apply(null, [av, af, ANNEE].filter(Boolean)) + 1;
    var span = Math.max(1, fin - debut);
    var x = function (y) { return ((y - debut) / span * 100).toFixed(2) + '%'; };
    var w = function (a, z) { return ((z - a) / span * 100).toFixed(2) + '%'; };
    var h = '<div class="garde" role="img" aria-label="Fenêtre de garde">';
    var d0 = mil || debut + 1, d1 = des || ad || d0;
    if (d1 > d0) h += '<div class="bar b-jeune" style="left:' + x(d0) + ';width:' + w(d0, d1) + '" title="Trop jeune"></div>';
    if (ad && d1 < ad) h += '<div class="bar b-boire" style="left:' + x(d1) + ';width:' + w(d1, ad) + '" title="Buvable"></div>';
    if (ad && af) h += '<div class="bar b-apogee" style="left:' + x(ad) + ';width:' + w(ad, af + 1) + '" title="Apogée ' + ad + '–' + af + '"></div>';
    if (av && (af || d1) < av) h += '<div class="bar b-fin" style="left:' + x((af ? af + 1 : d1)) + ';width:' + w(af ? af + 1 : d1, av + 1) + '" title="À boire avant ' + av + '"></div>';
    h += '<div class="now" style="left:' + x(ANNEE + 0.5) + '"><span>' + ANNEE + '</span></div>';
    [mil, des, ad, af, av].filter(Boolean).filter(function (y, i, a) { return a.indexOf(y) === i && y !== ANNEE; }).forEach(function (y) {
      h += '<span class="yr" style="left:' + x(y + (y === af || y === av ? 1 : 0)) + '">' + y + '</span>';
    });
    return h + '</div>' +
      '<div class="row small muted"><span><span class="dot" style="background:rgba(61,90,128,.5)"></span> jeune</span>' +
      '<span><span class="dot" style="background:rgba(63,107,58,.6)"></span> buvable</span>' +
      '<span><span class="dot" style="background:var(--gold)"></span> apogée</span>' +
      '<span><span class="dot" style="background:rgba(181,101,29,.6)"></span> déclin</span></div>';
  }

  function conseilMaturite(b) {
    var t = {
      trop_jeune: 'Patience : elle se refermerait ou paraîtrait dure. À ouvrir à partir de ' + (b.boire_des || b.apogee_debut) + '.',
      peut_attendre: 'Déjà ouvrable, mais elle gagnera encore. Apogée attendue à partir de ' + b.apogee_debut + '.',
      a_boire: 'Prête à boire.',
      apogee: 'C’est le bon moment : elle est à son apogée jusqu’en ' + b.apogee_fin + '.',
      a_boire_vite: 'À ouvrir sans trop tarder' + (b.boire_avant ? ' (avant ' + b.boire_avant + ')' : '') + '.',
      passee: 'Au-delà de la fenêtre conseillée : à ouvrir rapidement, elle peut être sur le déclin.'
    }[b.maturite];
    return t ? '<p style="margin:12px 0 0">' + esc(t) + '</p>' : '';
  }

  function lierSuppressionMvt(root, apres) {
    $$('[data-del-mvt]', root).forEach(function (btn) {
      btn.onclick = function () {
        if (!window.demoConfirm('Supprimer ce mouvement ? Le stock sera recalculé.')) return;
        api('mvt.supprimer', { id: btn.getAttribute('data-del-mvt') }).then(function () { toast('Mouvement supprimé'); apres(); }).catch(fail);
      };
    });
  }

  /* Dialogues de mouvements */
  function dialogueMvt(b, type, apres) {
    var entree = type === 'achat' || type === 'cadeau_recu';
    var types = entree ? [['achat', 'Achat'], ['cadeau_recu', 'Cadeau reçu']]
      : [['consommation', 'Bue'], ['offert', 'Offerte'], ['perte', 'Perte / casse']];
    modal(
      '<h2>' + (entree ? 'Entrée en cave' : 'Sortie de cave') + '</h2><p class="muted">' + esc(libelle(b)) + (b.millesime ? ' ' + esc(b.millesime) : '') + '</p>' +
      '<form class="form" id="f-mvt">' +
        '<div><label>Type</label><select name="type">' + options(types, type) + '</select></div>' +
        '<div><label>Quantité</label><input name="quantite" type="number" min="1" max="' + (entree ? 999 : b.stock) + '" value="1" required></div>' +
        '<div><label>Date</label><input name="date" type="date" value="' + today() + '"></div>' +
        (entree
          ? '<div><label>Prix unitaire (€)</label><input name="prix_unitaire" type="number" step="0.01" min="0" value="' + (b.prix_moyen || '') + '"></div>' +
            '<div class="full"><label>Fournisseur / lieu</label><input name="fournisseur" placeholder="Caviste, domaine, salon…"></div>'
          : '<div class="full"><label>Occasion</label><input name="occasion" placeholder="Dîner, avec qui…"></div>') +
        '<div class="full"><label>Note</label><input name="note"></div>' +
        '<div class="full row"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">Enregistrer</button></div>' +
      '</form>' +
      (!entree ? '<p class="small muted" style="margin-bottom:0">Pensez à noter vos impressions dans « Modifier » → Mes notes.</p>' : ''),
      function (root) {
        $('#m-annuler', root).onclick = closeModal;
        $('#f-mvt', root).onsubmit = function (e) {
          e.preventDefault();
          var d = Object.fromEntries(new FormData(this)); d.vin_id = b.id;
          var btn = $('button[type=submit]', this); busy(btn, true);
          api('mvt.ajouter', d).then(function () { closeModal(); toast(entree ? 'Entrée enregistrée' : 'Santé ! Sortie enregistrée'); apres(); })
            .catch(function (e) { busy(btn, false); fail(e); });
        };
      });
  }

  function dialogueInventaire(b, apres) {
    modal('<h2>Inventaire</h2><p class="muted">Corrige le stock après comptage réel. Un mouvement « ajustement » est créé pour garder la trace.</p>' +
      '<form class="form" id="f-inv"><div><label>Stock théorique</label><input value="' + b.stock + '" disabled></div>' +
      '<div><label>Stock réel compté</label><input name="reel" type="number" min="0" value="' + b.stock + '" required></div>' +
      '<div class="full row"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">Corriger</button></div></form>',
      function (root) {
        $('#m-annuler', root).onclick = closeModal;
        $('#f-inv', root).onsubmit = function (e) {
          e.preventDefault();
          var delta = num(this.reel.value) - b.stock;
          if (!delta) return closeModal();
          api('mvt.ajouter', { vin_id: b.id, type: 'ajustement', quantite: delta, note: 'Inventaire' })
            .then(function () { closeModal(); toast('Stock corrigé'); apres(); }).catch(fail);
        };
      });
  }

  /** Propose les champs IA à fusionner dans une fiche existante. */
  function dialogueFusion(b, r, apres) {
    var champs = ['description', 'aromes_nez', 'aromes_bouche', 'temp_service', 'carafage', 'boire_des', 'apogee_debut',
      'apogee_fin', 'boire_avant', 'accords', 'cepages', 'appellation', 'region', 'pays', 'degre'];
    var lignes = champs.filter(function (c) { return r[c] !== undefined && r[c] !== '' && String(r[c]) !== String(b[c] || ''); });
    if (!lignes.length) return toast('L’IA n’a rien de nouveau à proposer.');
    modal('<h2>Propositions de l’IA</h2><p class="muted small">Cochez ce que vous voulez reprendre. Les cases vides chez vous sont pré-cochées.</p>' +
      '<form id="f-fus"><div style="max-height:55vh;overflow:auto">' + lignes.map(function (c) {
        return '<label class="fus-item"><input type="checkbox" name="' + c + '"' +
          (!b[c] ? ' checked' : '') + '><span><strong>' + esc(LIBELLES[c] || c) + '</strong><br>' + esc(r[c]) +
          (b[c] ? '<br><span class="small muted">Actuel : ' + esc(b[c]) + '</span>' : '') + '</span></label>';
      }).join('') + '</div>' +
      '<div class="row" style="margin-top:14px"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">Appliquer</button></div></form>',
      function (root) {
        $('#m-annuler', root).onclick = closeModal;
        $('#f-fus', root).onsubmit = function (e) {
          e.preventDefault();
          var maj = { id: b.id };
          $$('input:checked', this).forEach(function (i) { maj[i.name] = r[i.name]; });
          api('cave.enregistrer', { vin: maj }).then(function () { closeModal(); toast('Fiche complétée'); apres(); }).catch(fail);
        };
      });
  }

  /* =========================================================
   * Formulaire ajout / modification (avec photo + OCR IA)
   * ======================================================= */
  var LIBELLES = {
    nom: 'Cuvée / nom', domaine: 'Domaine / Maison', type: 'Type', couleur: 'Couleur', appellation: 'Appellation',
    region: 'Région', pays: 'Pays', millesime: 'Millésime', cepages: 'Cépages', degre: 'Degré (%)', contenance_cl: 'Contenance (cl)',
    emplacement: 'Emplacement', description: 'Description', aromes_nez: 'Arômes au nez', aromes_bouche: 'En bouche',
    temp_service: 'Température de service', carafage: 'Carafage', boire_des: 'Buvable dès', apogee_debut: 'Apogée — début',
    apogee_fin: 'Apogée — fin', boire_avant: 'À boire avant', accords: 'Accords mets', cote_unitaire: 'Cote estimée (€/btl)',
    cote_commentaire: 'Commentaire cote', note_perso: 'Ma note (/20)', notes_perso: 'Mes notes de dégustation'
  };
  var SECTIONS = [
    ['Identité', ['domaine', 'nom', 'type', 'couleur', 'appellation', 'region', 'pays', 'millesime', 'cepages', 'degre', 'contenance_cl', 'emplacement']],
    ['Quand la boire', ['boire_des', 'apogee_debut', 'apogee_fin', 'boire_avant']],
    ['Dégustation & service', ['description', 'aromes_nez', 'aromes_bouche', 'temp_service', 'carafage', 'accords']],
    ['Valeur', ['cote_unitaire', 'cote_commentaire']],
    ['Mes notes', ['note_perso', 'notes_perso']]
  ];
  var LONGS = ['description', 'aromes_bouche', 'notes_perso', 'aromes_nez', 'accords', 'cote_commentaire'];
  var ANNEES = ['millesime', 'boire_des', 'apogee_debut', 'apogee_fin', 'boire_avant'];

  function champ(c, val) {
    var lab = '<label for="v-' + c + '">' + esc(LIBELLES[c]) + '</label>';
    var attrs = 'id="v-' + c + '" name="' + c + '"';
    var html;
    if (c === 'type') html = '<select ' + attrs + '>' + options(TYPES, val || 'Vin') + '</select>';
    else if (c === 'couleur') html = '<select ' + attrs + '>' + options(COULEURS, val, '—') + '</select>';
    else if (LONGS.indexOf(c) > -1) html = '<textarea ' + attrs + '>' + esc(val) + '</textarea>';
    else if (ANNEES.indexOf(c) > -1) html = '<input ' + attrs + ' type="number" min="1800" max="2200" value="' + esc(val) + '">';
    else if (['degre', 'contenance_cl', 'cote_unitaire', 'note_perso'].indexOf(c) > -1)
      html = '<input ' + attrs + ' type="number" step="0.1" min="0" value="' + esc(val) + '">';
    else html = '<input ' + attrs + ' value="' + esc(val) + '"' + (c === 'emplacement' ? ' list="dl-empl"' : '') + '>';
    return '<div class="' + (LONGS.indexOf(c) > -1 ? 'full' : '') + '">' + lab + html + '</div>';
  }

  function vueFormulaire(v, id, params, nom) {
    var edition = nom === 'modifier';
    var p = edition ? api('cave.lire', { id: id })
      : params.pro ? charger('prosp', 'prosp.lister', true).then(function (l) {
          var pr = l.filter(function (x) { return x.id === params.pro; })[0] || {};
          return { nom: pr.nom, domaine: pr.domaine, type: pr.type, couleur: pr.couleur, appellation: pr.appellation,
            millesime: pr.millesime, _prix: pr.prix_vu, _fournisseur: pr.lieu, _pro: pr.id };
        })
      : Promise.resolve({});

    return Promise.all([p, charger('vins', 'cave.lister')]).then(function (r) {
      var b = r[0];
      var emplacements = r[1].map(function (x) { return x.emplacement; }).filter(Boolean)
        .filter(function (x, i, a) { return a.indexOf(x) === i; });
      var photo = null, vignette = null;

      v.innerHTML =
        '<p class="small"><a href="' + (edition ? '#/bouteille/' + esc(id) : '#/cave') + '">← Retour</a></p>' +
        '<div class="head"><h1>' + (edition ? 'Modifier la fiche' : 'Ajouter une bouteille') + '</h1>' +
          (edition ? '' : '<span class="spacer"></span><a class="btn ghost" href="#/serie">📚 Beaucoup de bouteilles ? Saisie en série</a>') + '</div>' +
        '<datalist id="dl-empl">' + emplacements.concat(['Cave', 'Cellier', 'Armoire à vin', 'Bar']).filter(function (x, i, a) { return a.indexOf(x) === i; })
          .map(function (e) { return '<option value="' + esc(e) + '">'; }).join('') + '</datalist>' +
        '<div class="grid" style="grid-template-columns:minmax(0,340px) minmax(0,1fr);align-items:start" id="f-grid">' +
          '<div>' +
            '<div class="drop" id="drop" tabindex="0" role="button" aria-label="Prendre ou choisir une photo">' +
              '<div id="drop-in"><div style="font-size:2.4rem">📷</div><strong>Photographier l’étiquette ou la caisse</strong>' +
              '<p class="muted small">ou glisser une image ici. L’IA lit l’étiquette (ou le marquage de la caisse, quantité comprise) et pré-remplit la fiche.</p></div>' +
              '<input type="file" id="file" accept="image/*" capture="environment" hidden>' +
            '</div>' +
            '<div style="margin-top:10px"><label for="indice">Précision pour l’IA (facultatif)</label>' +
              '<input id="indice" placeholder="ex. magnum, cuvée spéciale, millésime au dos…"></div>' +
            '<div class="row" style="margin-top:10px"><button class="ghost" id="b-ocr" disabled>✨ Analyser la photo</button>' +
              '<button class="ghost" id="b-ia" title="Complète la fiche à partir du domaine, de la cuvée et du millésime saisis">✨ Compléter sans photo</button></div>' +
            '<div id="ia-res" style="margin-top:12px"></div>' +
          '</div>' +
          '<form id="f-vin">' +
            (edition ? '' :
              '<fieldset><legend>Entrée en cave</legend><div class="form">' +
                '<div><label>Type d’entrée</label><select name="_type">' + options([['achat', 'Achat'], ['cadeau_recu', 'Cadeau reçu']], 'achat') + '</select></div>' +
                '<div><label>Quantité</label><input name="_quantite" type="number" min="0" value="1"></div>' +
                '<div><label>Prix unitaire (€)</label><input name="_prix" type="number" step="0.01" min="0" value="' + esc(b._prix || '') + '"></div>' +
                '<div><label>Date</label><input name="_date" type="date" value="' + today() + '"></div>' +
                '<div class="full"><label>Fournisseur / lieu</label><input name="_fournisseur" value="' + esc(b._fournisseur || '') + '"></div>' +
              '</div></fieldset>') +
            SECTIONS.map(function (s) {
              return '<fieldset><legend>' + s[0] + '</legend><div class="form">' + s[1].map(function (c) { return champ(c, b[c]); }).join('') + '</div></fieldset>';
            }).join('') +
            '<div class="row"><span class="spacer"></span><a class="btn ghost" href="' + (edition ? '#/bouteille/' + esc(id) : '#/cave') + '">Annuler</a>' +
              '<button type="submit" id="b-save">Enregistrer</button></div>' +
          '</form>' +
        '</div>';

      if (window.matchMedia('(max-width: 820px)').matches) $('#f-grid').style.gridTemplateColumns = '1fr';

      var drop = $('#drop'), file = $('#file');
      drop.onclick = function () { file.click(); };
      drop.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
      drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = function () { drop.classList.remove('over'); };
      drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) prendre(e.dataTransfer.files[0]); };
      file.onchange = function () { if (file.files[0]) prendre(file.files[0]); };

      function prendre(f) {
        Promise.all([reduireImage(f, 1600, 0.85), reduireImage(f, 220, 0.7)]).then(function (imgs) {
          photo = imgs[0]; vignette = imgs[1].dataUrl;
          $('#drop-in').innerHTML = '<img src="' + photo.dataUrl + '" alt="Étiquette"><p class="small muted">Cliquer pour changer</p>';
          $('#b-ocr').disabled = false;
          $('#b-ocr').click();
        }).catch(function () { toast('Image illisible', true); });
      }

      $('#b-ocr').onclick = function () {
        if (!photo) return;
        var btn = this; busy(btn, true, 'Lecture de l’étiquette…');
        api('ia.etiquette', { base64: photo.base64, mime: photo.mime, indice: $('#indice').value })
          .then(function (r) { busy(btn, false); appliquerIA(r); })
          .catch(function (e) { busy(btn, false); fail(e); });
      };
      $('#b-ia').onclick = function () {
        var cur = Object.fromEntries(new FormData($('#f-vin')));
        if (!cur.domaine && !cur.nom) return toast('Saisissez au moins le domaine ou la cuvée', true);
        var btn = this; busy(btn, true, 'Recherche…');
        api('ia.enrichir', { vin: cur }).then(function (r) { busy(btn, false); appliquerIA(r, true); })
          .catch(function (e) { busy(btn, false); fail(e); });
      };

      /** Remplit les champs vides (ou tous si l'utilisateur le demande). */
      function appliquerIA(r, garderSaisie) {
        var remplis = 0;
        Object.keys(LIBELLES).forEach(function (c) {
          var el = $('#v-' + c);
          if (!el || r[c] === undefined || r[c] === null || r[c] === '') return;
          if (garderSaisie && el.value) return;
          if (!garderSaisie && el.value && edition) return;
          el.value = r[c]; remplis++;
          el.style.background = 'rgba(176,138,62,.12)';
        });
        $('#ia-res').innerHTML = '<div class="ia-box"><strong>' + remplis + ' champ(s) pré-rempli(s)</strong>' +
          (r.confiance ? ' · identification : confiance ' + esc(r.confiance) : '') +
          '<br>Les champs surlignés viennent de l’IA : vérifiez-les avant d’enregistrer.' +
          (r.texte_lu ? '<details style="margin-top:6px"><summary>Texte lu sur l’étiquette</summary><p class="small" style="white-space:pre-wrap">' + esc(r.texte_lu) + '</p></details>' : '') +
          (r.cote_commentaire ? '<p class="small" style="margin:6px 0 0">Cote : ' + esc(r.cote_commentaire) + '</p>' : '') + '</div>';
        if (r.cote_unitaire) $('#f-vin').dataset.coteIa = '1';
        var qv = num(r.quantite_visible);
        if (qv > 0 && !edition && $('[name=_quantite]')) {
          $('[name=_quantite]').value = qv;
          $('[name=_quantite]').style.background = 'rgba(176,138,62,.12)';
          $('#ia-res .ia-box').insertAdjacentHTML('beforeend', '<br>Quantité lue ' + (r.support === 'caisse' ? 'sur la caisse' : 'sur la photo') + ' : <strong>' + qv + '</strong>.');
        }
      }

      $('#f-vin').onsubmit = function (e) {
        e.preventDefault();
        var d = Object.fromEntries(new FormData(this));
        var vin = {};
        Object.keys(LIBELLES).forEach(function (c) { if (d[c] !== undefined) vin[c] = d[c]; });
        if (edition) vin.id = id;
        if (!vin.domaine && !vin.nom) return toast('Indiquez au moins un domaine ou une cuvée', true);
        if (num(vin.cote_unitaire) && String(vin.cote_unitaire) !== String(b.cote_unitaire || '')) {
          vin.cote_date = today();
          vin.cote_source = this.dataset.coteIa ? 'ia' : 'manuel';
        }
        var payload = { vin: vin };
        if (photo) { payload.photo = { base64: photo.base64, mime: photo.mime }; payload.vignette = vignette; }
        if (!edition && num(d._quantite) > 0) {
          payload.achat = { type: d._type, quantite: d._quantite, prix_unitaire: d._prix, date: d._date, fournisseur: d._fournisseur };
        }
        var btn = $('#b-save'); busy(btn, true, 'Enregistrement…');
        api('cave.enregistrer', payload).then(function (res) {
          invalider(); if (vignette) delete cache.vign;
          if (b._pro) api('prosp.enregistrer', { id: b._pro, statut: 'achete' }).catch(function () {});
          toast('Bouteille enregistrée');
          location.hash = '#/bouteille/' + res.id;
        }).catch(function (e) { busy(btn, false); fail(e); });
      };
    });
  }

  /** Redimensionne une image côté navigateur (JPEG). Gère l'orientation EXIF des navigateurs récents. */
  function reduireImage(file, max, qualite) {
    return new Promise(function (ok, ko) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL('image/jpeg', qualite);
        ok({ dataUrl: dataUrl, base64: dataUrl.split(',')[1], mime: 'image/jpeg' });
      };
      img.onerror = ko;
      img.src = url;
    });
  }

  /* =========================================================
   * Accords mets-vins
   * ======================================================= */
  function vueAccords(v) {
    return Promise.all([charger('accords', 'accords.lister'), charger('vins', 'cave.lister')]).then(function (r) {
      var accords = r[0], vins = r[1].filter(function (x) { return x.stock > 0; });
      var cats = accords.map(function (a) { return a.categorie; }).filter(function (c, i, a) { return a.indexOf(c) === i; });
      var cat = cats[0];

      v.innerHTML =
        '<div class="head"><h1>Accords mets & vins</h1></div>' +
        '<div class="card" style="margin-bottom:18px"><h2>Que boire ce soir ?</h2>' +
          '<p class="muted">Décrivez le plat : le sommelier IA choisit parmi <strong>vos</strong> bouteilles, en priorité celles à leur apogée.</p>' +
          '<form class="row" id="f-som"><input name="plat" placeholder="ex. magret de canard aux cerises, plateau de fromages de chèvre…" style="flex:1;min-width:220px" required>' +
          '<input name="contexte" placeholder="Occasion (facultatif)" style="max-width:220px">' +
          '<button type="submit">Proposer</button></form><div id="som-res"></div></div>' +
        '<a class="card ap-banner" href="#/apporter"><span class="qi">🎁</span><span><strong>J’apporte une bouteille</strong>' +
          '<span class="small muted" style="display:block">Chez des amis, en famille, pour un anniversaire : choisir dans la cave selon l’occasion, le budget, les convives et le plat.</span></span><span class="spacer"></span><span aria-hidden="true">→</span></a>' +
        '<h2>Guide des accords</h2><div class="cats" id="cats"></div><div class="grid g2" id="acc"></div>';

      function rendreCats() {
        $('#cats').innerHTML = cats.map(function (c) {
          return '<button class="' + (c === cat ? 'on' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>';
        }).join('');
        $$('#cats button').forEach(function (b) { b.onclick = function () { cat = b.getAttribute('data-c'); rendreCats(); rendreAcc(); }; });
      }
      function rendreAcc() {
        $('#acc').innerHTML = accords.filter(function (a) { return a.categorie === cat; }).map(function (a) {
          var mots = splitList(a.mots_cles).map(norm), couleurs = splitList(a.couleurs);
          var dispo = vins.map(function (x) {
            var hay = norm([x.appellation, x.region, x.cepages, x.nom, x.domaine, x.accords].join(' '));
            var score = mots.filter(function (m) { return m && hay.indexOf(m) > -1; }).length * 2 +
              (couleurs.indexOf(x.couleur) > -1 ? 1 : 0) +
              (norm(x.accords).indexOf(norm(a.plat).split(/[ (,]/)[0]) > -1 ? 2 : 0) +
              ({ apogee: 1, a_boire_vite: 1, a_boire: .5 }[x.maturite] || 0);
            return { x: x, s: score, motCle: mots.some(function (m) { return m && hay.indexOf(m) > -1; }) };
          }).filter(function (o) { return o.motCle || (couleurs.indexOf(o.x.couleur) > -1 && o.s >= 2); })
            .sort(function (a, b) { return b.s - a.s; }).slice(0, 4);
          return '<div class="card"><h3>' + esc(a.plat) + '</h3><p style="margin:0 0 6px"><strong>' + esc(a.styles) + '</strong></p>' +
            '<div class="tags">' + splitList(a.mots_cles).slice(0, 6).map(function (m) { return '<span class="tag">' + esc(m) + '</span>'; }).join('') + '</div>' +
            (a.conseil ? '<p class="small muted" style="margin:8px 0 0">' + esc(a.conseil) + '</p>' : '') +
            '<p class="small" style="margin:12px 0 4px;font-weight:600">Dans ma cave :</p>' +
            (dispo.length ? dispo.map(function (o) {
              return '<div class="row small" style="gap:6px;margin:3px 0">' + dot(o.x.couleur) + '<a href="#/bouteille/' + esc(o.x.id) + '">' +
                esc(libelle(o.x)) + (o.x.millesime ? ' ' + esc(o.x.millesime) : '') + '</a>' +
                '<strong class="nb">' + o.x.stock + ' btl</strong>' + pillMat(o.x.maturite) + '</div>';
            }).join('') : '<p class="small muted" style="margin:0">Rien de correspondant — une idée pour la <a href="#/prospection">prospection</a>.</p>') +
            '</div>';
        }).join('');
      }
      rendreCats(); rendreAcc();

      $('#f-som').onsubmit = function (e) {
        e.preventDefault();
        var d = Object.fromEntries(new FormData(this));
        var btn = $('button', this); busy(btn, true, 'Réflexion…');
        api('accords.suggerer', d).then(function (r) {
          busy(btn, false);
          $('#som-res').innerHTML = '<div style="margin-top:14px">' +
            (r.choix.length ? r.choix.map(function (c) {
              return '<div class="card" style="margin-bottom:10px;box-shadow:none"><div class="row"><a href="#/bouteille/' + esc(c.id) + '"><strong>' + esc(c.libelle) + '</strong></a>' +
                pillMat(c.maturite) + '<strong class="nb">' + c.stock + ' btl en cave</strong></div>' +
                '<p style="margin:6px 0 0">' + esc(c.pourquoi) + '</p>' + (c.service ? '<p class="small muted" style="margin:4px 0 0">Service : ' + esc(c.service) + '</p>' : '') + '</div>';
            }).join('') : '<p class="muted">Aucune bouteille de la cave ne convient vraiment.</p>') +
            (r.style_ideal ? '<div class="ia-box">Style idéal : ' + esc(r.style_ideal) +
              (r.a_acheter && r.a_acheter.length ? '<br>À acheter : ' + r.a_acheter.map(esc).join(', ') : '') + '</div>' : '') + '</div>';
        }).catch(function (e) { busy(btn, false); fail(e); });
      };
    });
  }

  /* =========================================================
   * Prospection
   * ======================================================= */
  function vueProspection(v) {
    return Promise.all([charger('prosp', 'prosp.lister', true), charger('vign', 'cave.vignettes', true)]).then(function (r) {
      var list = r[0], vign = r[1];
      v.innerHTML = '<div class="head"><h1>Prospection</h1><span class="muted">Bouteilles bues ailleurs, recommandées, repérées ou à acheter</span>' +
        '<span class="spacer"></span><button class="ghost" id="p-new">+ Repérage</button><button id="p-memo">✎ Garder en mémoire</button></div><div class="kanban">' +
        Object.keys(STATUTS_PROSP).map(function (s) {
          var l = list.filter(function (p) { return (p.statut || 'repere') === s; })
            .sort(function (a, b) { return num(b.priorite) - num(a.priorite); });
          return '<div class="col"><h3><span>' + STATUTS_PROSP[s] + '</span><span class="muted">' + l.length + '</span></h3>' +
            l.map(function (p) {
              var img = vign[p.id];
              return '<div class="card pcard">' + (img ? '<div class="thumb" style="float:right;width:44px;height:60px;margin:0 0 6px 8px;background-image:url(' + img + ')"></div>' : '') +
                '<div class="row" style="gap:6px">' + dot(p.couleur) + '<strong>' + esc(libelle(p)) + '</strong></div>' +
                '<div class="small muted">' + esc([p.appellation, p.millesime].filter(Boolean).join(' · ')) + '</div>' +
                (p.origine ? '<div class="small" style="margin-top:4px"><span class="tag">' + esc(ORIGINES[p.origine] || p.origine) + '</span>' +
                  (p.date_vue ? ' <span class="muted">' + dateFr(p.date_vue) + '</span>' : '') + '</div>' : '') +
                (num(p.note_perso) ? '<div class="small" style="margin-top:4px"><strong>' + esc(p.note_perso) + '/20</strong></div>' : '') +
                '<div class="small" style="margin-top:4px">' + (p.prix_vu ? eur(p.prix_vu, true) + ' · ' : '') + esc(p.lieu || '') +
                (num(p.priorite) && s !== 'memo' ? ' · ' + '★★★'.slice(0, num(p.priorite)) : '') + '</div>' +
                (p.note ? '<p class="small" style="margin:6px 0 0">' + esc(p.note) + '</p>' : '') +
                (p.url ? '<p class="small" style="margin:4px 0 0"><a href="' + esc(/^https?:\/\//.test(p.url) ? p.url : '#') + '" target="_blank" rel="noopener noreferrer">Lien ↗</a></p>' : '') +
                '<div class="row" style="margin-top:8px;gap:6px"><button class="ghost small" data-edit="' + esc(p.id) + '">Modifier</button>' +
                (s !== 'achete' ? '<a class="btn small" href="#/ajouter?pro=' + encodeURIComponent(p.id) + '">Acheté → cave</a>' : '') + '</div></div>';
            }).join('') + '</div>';
        }).join('') + '</div>';

      $('#p-new').onclick = function () { dialogueProsp({}); };
      $('#p-memo').onclick = function () { dialogueMemo(); };
      $$('[data-edit]').forEach(function (b) {
        b.onclick = function () { dialogueProsp(list.filter(function (p) { return p.id === b.getAttribute('data-edit'); })[0]); };
      });
    });
  }

  function dialogueProsp(p) {
    var f = function (n, l, t, attrs) { return '<div><label>' + l + '</label><input name="' + n + '" type="' + (t || 'text') + '" value="' + esc(p[n]) + '"' + (attrs || '') + '></div>'; };
    modal('<h2>' + (p.id ? 'Modifier' : 'Nouveau repérage') + '</h2><form class="form" id="f-p">' +
      f('domaine', 'Domaine / Maison') + f('nom', 'Cuvée') +
      '<div><label>Type</label><select name="type">' + options(TYPES, p.type || 'Vin') + '</select></div>' +
      '<div><label>Couleur</label><select name="couleur">' + options(COULEURS, p.couleur, '—') + '</select></div>' +
      f('appellation', 'Appellation') + f('millesime', 'Millésime', 'number') + f('prix_vu', 'Prix vu (€)', 'number', ' step="0.01"') +
      f('lieu', 'Où (caviste, salon, site…)') +
      '<div><label>Origine</label><select name="origine">' + options(Object.keys(ORIGINES).map(function (k) { return [k, ORIGINES[k]]; }), p.origine, '—') + '</select></div>' +
      f('date_vue', 'Date', 'date') + f('note_perso', 'Ma note (/20)', 'number', ' step="0.5" min="0" max="20"') +
      '<div><label>Priorité</label><select name="priorite">' + options([['1', '★'], ['2', '★★'], ['3', '★★★']], p.priorite || '2') + '</select></div>' +
      '<div><label>Statut</label><select name="statut">' + options(Object.keys(STATUTS_PROSP).map(function (k) { return [k, STATUTS_PROSP[k]]; }), p.statut || 'repere') + '</select></div>' +
      '<div class="full"><label>Lien</label><input name="url" type="url" value="' + esc(p.url) + '" placeholder="https://"></div>' +
      '<div class="full"><label>Note</label><textarea name="note">' + esc(p.note) + '</textarea></div>' +
      '<div class="full row">' + (p.id ? '<button type="button" class="danger" id="p-del">Supprimer</button>' : '') +
      '<span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">Enregistrer</button></div></form>',
      function (root) {
        $('#m-annuler', root).onclick = closeModal;
        if (p.id) $('#p-del', root).onclick = function () {
          if (!window.demoConfirm('Supprimer ce repérage ?')) return;
          api('prosp.supprimer', { id: p.id }).then(function () { closeModal(); route(); }).catch(fail);
        };
        $('#f-p', root).onsubmit = function (e) {
          e.preventDefault();
          var d = Object.fromEntries(new FormData(this)); if (p.id) d.id = p.id;
          if (!d.domaine && !d.nom) return toast('Indiquez un domaine ou une cuvée', true);
          api('prosp.enregistrer', d).then(function () { closeModal(); toast('Repérage enregistré'); route(); }).catch(fail);
        };
      });
  }

  /* =========================================================
   * Valeur
   * ======================================================= */
  function vueValeur(v) {
    return Promise.all([api('valeur.synthese'), api('valeur.historique')]).then(function (r) {
      var s = r[0], h = r[1];
      var pv = s.valeur_achat ? Math.round((s.valeur_estimee / s.valeur_achat - 1) * 100) : null;
      var barres = function (obj) {
        var k = Object.keys(obj).sort(function (a, b) { return obj[b].valeur - obj[a].valeur; });
        var max = k.length ? obj[k[0]].valeur || 1 : 1;
        return k.map(function (c) {
          return '<div class="hbar"><span>' + esc(c) + '</span><div class="track"><div class="fill" style="width:' + Math.round(obj[c].valeur / max * 100) +
            '%"></div></div><span class="n small">' + eur(obj[c].valeur) + '<br><span class="muted">' + obj[c].bouteilles + ' btl</span></span></div>';
        }).join('') || '<p class="muted">—</p>';
      };

      v.innerHTML = '<div class="head"><h1>Valeur de la cave</h1><span class="spacer"></span>' +
        '<button class="ghost small" id="v-snap">Enregistrer un point aujourd’hui</button>' +
        '<button class="ghost small" id="v-cotes">✨ Coter les bouteilles sans cote</button></div>' +
        '<div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">' +
          stat(eur(s.valeur_estimee), 'valeur estimée', pv !== null ? '<span class="' + (pv >= 0 ? 'up' : 'down') + '">' + (pv >= 0 ? '+' : '') + pv + ' % vs achat</span>' : '') +
          stat(eur(s.valeur_achat), 'valeur d’achat') +
          stat(s.nb_bouteilles ? eur(s.valeur_estimee / s.nb_bouteilles) : '—', 'valeur moyenne / bouteille') +
          stat(s.sans_cote, 'références sans cote', 'valorisées au prix d’achat') +
        '</div>' +
        '<div class="card chart" style="margin-top:16px"><h2>Évolution</h2>' + courbe(h) +
          '<p class="small muted">Un point est enregistré automatiquement le 1er de chaque mois.</p></div>' +
        '<div class="grid g2" style="margin-top:16px"><div class="card"><h2>Par type</h2>' + barres(s.par_type) + '</div>' +
          '<div class="card"><h2>Par région</h2>' + barres(s.par_region) + '</div></div>' +
        '<div class="card" style="margin-top:16px"><h2>Détail par référence</h2><div class="table-wrap"><table><thead><tr><th>Bouteille</th><th class="n">Stock</th>' +
          '<th class="n">Achat moyen</th><th class="n">Cote</th><th class="n">Évol.</th><th class="n">Valeur</th><th>Cote du</th></tr></thead><tbody>' +
          s.top.map(function (t) {
            return '<tr><td><a href="#/bouteille/' + esc(t.id) + '">' + esc(t.libelle) + '</a></td><td class="n">' + t.stock + '</td>' +
              '<td class="n">' + eur(t.prix_moyen, true) + '</td><td class="n">' + eur(t.cote, true) + '</td>' +
              '<td class="n ' + (t.plus_value > 0 ? 'up' : t.plus_value < 0 ? 'down' : '') + '">' + (t.plus_value === null ? '—' : (t.plus_value > 0 ? '+' : '') + t.plus_value + ' %') + '</td>' +
              '<td class="n"><strong>' + eur(t.valeur) + '</strong></td><td class="small muted">' + (t.cote_date ? dateFr(t.cote_date) + (t.cote_source === 'ia' ? ' · IA' : '') : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<p class="small muted">Les cotes IA sont des estimations indicatives, à recouper avant toute revente ou déclaration d’assurance.</p></div>';

      $('#v-snap').onclick = function () {
        var b = this; busy(b, true);
        api('valeur.instantane').then(function () { toast('Point enregistré'); route(); }).catch(function (e) { busy(b, false); fail(e); });
      };
      $('#v-cotes').onclick = function () {
        var ids = s.top.filter(function (t) { return !t.cote; }).map(function (t) { return t.id; });
        if (!ids.length) return toast('Toutes les bouteilles ont déjà une cote.');
        var b = this, i = 0; busy(b, true, '0/' + ids.length);
        (function suivant() {
          if (i >= ids.length) { toast(ids.length + ' cote(s) estimée(s)'); invalider(); return route(); }
          b.innerHTML = '<span class="spin"></span> ' + (i + 1) + '/' + ids.length;
          api('ia.coter', { id: ids[i++] }).catch(function () {}).then(suivant);
        })();
      };
    });
  }

  /** Courbe SVG simple (valeur estimée vs achat). */
  function courbe(h) {
    if (h.length < 2) return '<p class="muted">L’historique apparaîtra après au moins deux points.</p>';
    var W = 800, H = 220, P = 44;
    var vals = h.map(function (p) { return Math.max(num(p.valeur_estimee), num(p.valeur_achat)); });
    var max = Math.max.apply(null, vals) * 1.1 || 1;
    var x = function (i) { return P + i * (W - P - 10) / (h.length - 1); };
    var y = function (v) { return H - 26 - num(v) / max * (H - 40); };
    var path = function (k) { return h.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[k]).toFixed(1); }).join(' '); };
    var ticks = [0, .5, 1].map(function (f) {
      return '<line x1="' + P + '" x2="' + W + '" y1="' + y(max * f) + '" y2="' + y(max * f) + '" stroke="var(--line)"/>' +
        '<text x="' + (P - 6) + '" y="' + (y(max * f) + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + fmtEurF.format(max * f) + '</text>';
    }).join('');
    var labels = h.map(function (p, i) {
      return (h.length <= 12 || i % Math.ceil(h.length / 12) === 0)
        ? '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + String(p.date).slice(5, 7) + '/' + String(p.date).slice(2, 4) + '</text>' : '';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Évolution de la valeur">' + ticks + labels +
      '<path d="' + path('valeur_achat') + '" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="5 4"/>' +
      '<path d="' + path('valeur_estimee') + '" fill="none" stroke="var(--wine)" stroke-width="2.5"/>' +
      h.map(function (p, i) { return '<circle cx="' + x(i) + '" cy="' + y(p.valeur_estimee) + '" r="3.5" fill="var(--wine)"><title>' + dateFr(p.date) + ' : ' + fmtEurF.format(num(p.valeur_estimee)) + '</title></circle>'; }).join('') +
      '</svg><div class="row small muted"><span style="color:var(--wine)">━ valeur estimée</span><span>┅ valeur d’achat</span></div>';
  }

  /* =========================================================
   * Journal des mouvements
   * ======================================================= */
  function vueJournal(v) {
    return api('mvt.lister', { limite: 500 }).then(function (list) {
      var achats = list.filter(function (m) { return m.type === 'achat'; });
      var depense = achats.reduce(function (s, m) { return s + num(m.quantite) * num(m.prix_unitaire); }, 0);
      var bues = list.filter(function (m) { return m.type === 'consommation'; }).reduce(function (s, m) { return s - num(m.quantite); }, 0);
      v.innerHTML = '<div class="head"><h1>Journal</h1><span class="muted">Achats, dégustations et sorties</span></div>' +
        '<div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:16px">' +
          stat(eur(depense), 'dépensé (achats listés)') + stat(bues, 'bouteilles bues') + stat(list.length, 'mouvements') +
        '</div><div class="card">' + tableMvts(list) + '</div>';
      lierSuppressionMvt(v, function () { invalider(); route(); });
    });
  }

  /* =========================================================
   * Actions rapides : sortie de cave, mémo, ajout
   * ======================================================= */
  function menuRapide() {
    modal('<h2>Que voulez-vous faire ?</h2><div class="quick-menu">' +
      '<button data-quick="sortie"><span class="qi">🍷</span><span><strong>J’ai bu ou sorti une bouteille</strong><span class="small muted">La choisir dans la cave ou la prendre en photo</span></span></button>' +
      '<button data-quick="apporter"><span class="qi">🎁</span><span><strong>Quelle bouteille apporter ?</strong><span class="small muted">Chez des amis, en famille, pour une occasion</span></span></button>' +
      '<button data-quick="memo"><span class="qi">✎</span><span><strong>Garder une bouteille en mémoire</strong><span class="small muted">Bue au restaurant, recommandée, envie…</span></span></button>' +
      '<button data-quick="serie"><span class="qi">📚</span><span><strong>Saisie en série</strong><span class="small muted">Beaucoup de bouteilles d’un coup : photos à la chaîne ou liste collée</span></span></button>' +
      '<button data-quick="ajout"><span class="qi">📷</span><span><strong>Ajouter en cave</strong><span class="small muted">Achat ou cadeau, par photo de l’étiquette ou de la caisse</span></span></button>' +
      '</div>');
  }

  // Délégation : tout élément [data-quick] ouvre l'action correspondante
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-quick]');
    if (!b || !session) return;
    e.preventDefault();
    var q = b.getAttribute('data-quick');
    if (q === 'menu') return menuRapide();
    if (q === 'sortie') return dialogueSortie();
    if (q === 'memo') return dialogueMemo();
    if (q === 'ajout') { closeModal(); location.hash = '#/ajouter'; }
    if (q === 'apporter') { closeModal(); location.hash = '#/apporter'; }
    if (q === 'serie') { closeModal(); location.hash = '#/serie'; }
  });

  /** Sortie rapide. Sans bouteille : recherche ou photo d'abord. */
  function dialogueSortie(vin, typeInitial) {
    if (vin) return formulaireSortie(vin, typeInitial || 'consommation');
    Promise.all([charger('vins', 'cave.lister'), charger('vign', 'cave.vignettes')]).then(function (r) {
      var vins = r[0].filter(function (x) { return x.stock > 0; }), vign = r[1];
      modal('<h2>Quelle bouteille ?</h2>' +
        '<div class="row" style="flex-wrap:nowrap"><input id="s-q" type="search" placeholder="Domaine, cuvée, millésime…" autocomplete="off" style="flex:1">' +
        '<button type="button" class="ghost" id="s-photo" title="Reconnaître par photo">📷 Photo</button>' +
        '<input type="file" id="s-file" accept="image/*" capture="environment" hidden></div>' +
        '<div id="s-res" class="pick-list"></div>' +
        '<div class="row" style="margin-top:12px"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button></div>',
        function (root) {
          $('#m-annuler', root).onclick = closeModal;
          var ligne = function (b, extra) {
            var img = vign[b.id];
            return '<button type="button" class="pick" data-id="' + esc(b.id) + '"><span class="thumb" style="width:36px;height:48px;' + (img ? 'background-image:url(' + img + ')' : '') + '"></span>' +
              '<span style="min-width:0;flex:1;text-align:left"><strong>' + esc(libelle(b)) + '</strong>' + (b.millesime ? ' ' + esc(b.millesime) : '') +
              '<span class="small muted" style="display:block">' + esc([b.appellation, b.emplacement].filter(Boolean).join(' · ')) + (extra || '') + '</span></span>' +
              '<span class="nb">' + b.stock + ' btl</span></button>';
          };
          var lier = function () {
            $$('.pick', root).forEach(function (p) {
              p.onclick = function () { formulaireSortie(vins.filter(function (x) { return x.id === p.getAttribute('data-id'); })[0], 'consommation'); };
            });
          };
          var chercher = function () {
            var q = norm($('#s-q', root).value);
            var l = vins.filter(function (b) {
              var h = norm([b.domaine, b.nom, b.appellation, b.millesime, b.emplacement].join(' '));
              return !q || q.split(/\s+/).every(function (w) { return h.indexOf(w) > -1; });
            }).sort(function (a, b) { return MATURITE_ORDRE.indexOf(a.maturite) - MATURITE_ORDRE.indexOf(b.maturite); }).slice(0, 8);
            $('#s-res', root).innerHTML = l.length ? l.map(function (b) { return ligne(b); }).join('') : '<p class="muted">Aucune bouteille en stock ne correspond.</p>';
            lier();
          };
          $('#s-q', root).oninput = chercher;
          $('#s-photo', root).onclick = function () { $('#s-file', root).click(); };
          $('#s-file', root).onchange = function () {
            var f = this.files[0]; if (!f) return;
            $('#s-res', root).innerHTML = '<p class="muted"><span class="spin"></span> Reconnaissance de la bouteille…</p>';
            reduireImage(f, 1400, 0.85).then(function (img) {
              return api('ia.reconnaitre', { base64: img.base64, mime: img.mime });
            }).then(function (res) {
              var c = res.correspondances || [];
              $('#s-res', root).innerHTML = '<p class="small muted" style="margin:6px 0">Lu : ' + esc(res.lu || '—') + '</p>' +
                (c.length ? c.map(function (x) {
                  var b = vins.filter(function (v) { return v.id === x.id; })[0];
                  return b ? ligne(b, ' · certitude ' + esc(x.certitude || '?')) : '';
                }).join('') : '<p>Cette bouteille n’est pas dans votre cave. <button type="button" class="ghost small" data-quick="memo">La garder en mémoire</button></p>');
              lier();
            }).catch(function (e) { $('#s-res', root).innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
          };
          chercher();
          setTimeout(function () { var i = $('#s-q', root); if (i && window.matchMedia('(hover: hover)').matches) i.focus(); }, 50);
        });
    }).catch(fail);
  }

  function formulaireSortie(b, type, pre) {
    pre = pre || {};
    var actions = (entamable(b) ? [['servir', '🥃 Servir un verre']] : []).concat([['consommation', entamable(b) ? '🍾 Bouteille finie' : '🍷 Bue'], ['offert', '🎁 Offerte'], ['sortie', '↗ Autre sortie'], ['perte', '✕ Perte / casse'], ['deplacer', '📍 Changer de place']]);
    if (type === 'consommation' && entamable(b) && !pre.quantite) type = 'servir';
    charger('vins', 'cave.lister').then(function (vins) {
      var lieux = vins.map(function (x) { return x.emplacement; }).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; });
      modal('<h2>' + esc(libelle(b)) + (b.millesime ? ' ' + esc(b.millesime) : '') + '</h2>' +
        '<p class="muted" style="margin-top:-6px">' + b.stock + ' bouteille' + (b.stock > 1 ? 's' : '') + ' en cave' + (num(b.niveau_entamee) > 0 ? ' dont 1 entamée à ' + Math.round(num(b.niveau_entamee)) + ' %' : '') + (b.emplacement ? ' · 📍 ' + esc(b.emplacement) : '') + '</p>' +
        '<form id="f-sortie"><div class="seg seg-wrap" role="radiogroup" aria-label="Action">' + actions.map(function (a) {
          return '<label class="seg-opt"><input type="radio" name="type" value="' + a[0] + '"' + (a[0] === type ? ' checked' : '') + '><span>' + a[1] + '</span></label>';
        }).join('') + '</div>' +
        '<div class="form" style="margin-top:12px">' +
          '<div class="f-serv" hidden><label for="so-cl">Verre de (cl)</label><input id="so-cl" name="servir_cl" type="number" min="1" max="50" value="' + (/spiritueux|liqueur/i.test(b.type) ? 4 : 8) + '"></div>' +
          '<div class="f-serv full small muted" hidden>' + (num(b.niveau_entamee) > 0 ? 'Le niveau de la bouteille entamée baisse ; à la fin, elle sort du stock.' : 'Une bouteille est ouverte puis le verre est retiré de son niveau.') + '</div>' +
          '<div class="f-q"><label for="so-q">Quantité</label><input id="so-q" name="quantite" type="number" min="1" max="' + b.stock + '" value="' + (num(pre.quantite) || 1) + '"></div>' +
          '<div class="f-q"><label for="so-d">Date</label><input id="so-d" name="date" type="date" value="' + today() + '"></div>' +
          '<div class="full f-occ"><label for="so-o">Occasion</label><input id="so-o" name="occasion" placeholder="Dîner, avec qui…" value="' + esc(pre.occasion || '') + '"></div>' +
          '<div class="f-bu"><label for="so-n">Ma note (/20)</label><input id="so-n" name="note_perso" type="number" min="0" max="20" step="0.5"></div>' +
          '<div class="full f-bu"><label for="so-i">Impressions</label><textarea id="so-i" name="impressions" placeholder="Ajoutées aux notes de la fiche"></textarea></div>' +
          '<div class="full f-dep" hidden><label for="so-e">Nouvel emplacement</label><input id="so-e" name="emplacement" list="dl-lieux" value="' + esc(b.emplacement) + '">' +
            '<datalist id="dl-lieux">' + lieux.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist></div>' +
        '</div>' +
        '<div class="row" style="margin-top:14px"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">Enregistrer</button></div></form>',
        function (root) {
          var f = $('#f-sortie', root);
          var maj = function () {
            var t = f.type.value;
            $$('.f-bu', root).forEach(function (x) { x.hidden = t !== 'consommation'; });
            $$('.f-occ', root).forEach(function (x) { x.hidden = !(t === 'consommation' || t === 'offert' || t === 'sortie'); });
            $$('.f-q', root).forEach(function (x) { x.hidden = t === 'deplacer' || t === 'servir'; });
            $$('.f-serv', root).forEach(function (x) { x.hidden = t !== 'servir'; });
            $$('.f-dep', root).forEach(function (x) { x.hidden = t !== 'deplacer'; });
            $('#so-o', root).placeholder = t === 'offert' ? 'Offerte à…' : t === 'sortie' ? 'Vendue, apportée chez…' : 'Dîner, avec qui…';
          };
          $$('input[name=type]', root).forEach(function (r) { r.onchange = maj; });
          maj();
          $('#m-annuler', root).onclick = closeModal;
          f.onsubmit = function (e) {
            e.preventDefault();
            var d = Object.fromEntries(new FormData(f));
            var btn = $('button[type=submit]', f); busy(btn, true);
            var p = d.type === 'servir'
              ? api('cave.niveau', { id: b.id, servir_cl: d.servir_cl, date: d.date })
              : d.type === 'deplacer'
              ? api('cave.enregistrer', { vin: { id: b.id, emplacement: d.emplacement } })
              : api('mvt.ajouter', { vin_id: b.id, type: d.type, quantite: d.quantite, date: d.date, occasion: d.occasion,
                  note_perso: d.note_perso, impressions: d.impressions });
            p.then(function () {
              closeModal(); invalider();
              toast(d.type === 'servir' ? 'Verre servi, niveau mis à jour' : d.type === 'consommation' ? 'Santé ! Bouteille sortie de la cave' : d.type === 'deplacer' ? 'Emplacement mis à jour' : 'Sortie enregistrée');
              route();
            }).catch(function (e) { busy(btn, false); fail(e); });
          };
        });
    });
  }

  /** Mémo rapide : une bouteille à retenir, avec ou sans photo. */
  function dialogueMemo() {
    var photo = null, vignette = null;
    modal('<h2>Garder en mémoire</h2>' +
      '<form id="f-memo" class="form">' +
        '<div class="full"><button type="button" class="ghost" id="me-photo" style="width:100%;justify-content:center">📷 Photographier l’étiquette (facultatif)</button>' +
          '<input type="file" id="me-file" accept="image/*" capture="environment" hidden><div id="me-ia" class="small muted" style="margin-top:6px"></div></div>' +
        '<div><label for="me-dom">Domaine / Maison</label><input id="me-dom" name="domaine"></div>' +
        '<div><label for="me-nom">Cuvée</label><input id="me-nom" name="nom"></div>' +
        '<div><label for="me-app">Appellation</label><input id="me-app" name="appellation"></div>' +
        '<div><label for="me-mil">Millésime</label><input id="me-mil" name="millesime" type="number" min="1800" max="2200"></div>' +
        '<div><label for="me-cou">Couleur</label><select id="me-cou" name="couleur">' + options(COULEURS, '', '—') + '</select></div>' +
        '<div><label for="me-typ">Type</label><select id="me-typ" name="type">' + options(TYPES, 'Vin') + '</select></div>' +
        '<div><label for="me-ori">Pourquoi</label><select id="me-ori" name="origine">' + options(Object.keys(ORIGINES).map(function (k) { return [k, ORIGINES[k]]; }), 'restaurant') + '</select></div>' +
        '<div><label for="me-lieu">Où</label><input id="me-lieu" name="lieu" placeholder="Restaurant, ami, salon…"></div>' +
        '<div><label for="me-date">Date</label><input id="me-date" name="date_vue" type="date" value="' + today() + '"></div>' +
        '<div><label for="me-prix">Prix vu (€)</label><input id="me-prix" name="prix_vu" type="number" step="0.01" min="0"></div>' +
        '<div><label for="me-note">Ma note (/20)</label><input id="me-note" name="note_perso" type="number" step="0.5" min="0" max="20"></div>' +
        '<div><label for="me-st">Suite</label><select id="me-st" name="statut">' + options([['memo', 'Juste à retenir'], ['repere', 'À surveiller'], ['a_acheter', 'À acheter']], 'memo') + '</select></div>' +
        '<div class="full"><label for="me-com">Commentaire</label><textarea id="me-com" name="note" placeholder="Ce qui m’a plu, avec quoi, conseil du sommelier…"></textarea></div>' +
        '<div class="full row"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">Enregistrer</button></div>' +
      '</form>',
      function (root) {
        var f = $('#f-memo', root);
        $('#m-annuler', root).onclick = closeModal;
        $('#me-photo', root).onclick = function () { $('#me-file', root).click(); };
        $('#me-file', root).onchange = function () {
          var file = this.files[0]; if (!file) return;
          var btn = $('#me-photo', root); busy(btn, true, 'Lecture de l’étiquette…');
          Promise.all([reduireImage(file, 1600, 0.85), reduireImage(file, 220, 0.7)]).then(function (imgs) {
            photo = imgs[0]; vignette = imgs[1].dataUrl;
            return api('ia.etiquette', { base64: photo.base64, mime: photo.mime });
          }).then(function (r) {
            busy(btn, false); btn.innerHTML = '📷 Changer la photo';
            ['domaine', 'nom', 'appellation', 'millesime', 'couleur', 'type'].forEach(function (k) {
              if (r[k] && f[k]) { f[k].value = r[k]; f[k].style.background = 'rgba(176,138,62,.12)'; }
            });
            $('#me-ia', root).innerHTML = 'Étiquette lue' + (r.confiance ? ' (confiance ' + esc(r.confiance) + ')' : '') + '. Vérifiez les champs surlignés.' +
              (r.cote_unitaire ? ' Prix caviste estimé : ' + eur(r.cote_unitaire) + '.' : '');
          }).catch(function (e) { busy(btn, false); fail(e); });
        };
        f.onsubmit = function (e) {
          e.preventDefault();
          var d = Object.fromEntries(new FormData(f));
          if (!d.domaine && !d.nom) return toast('Indiquez au moins un domaine ou une cuvée', true);
          d.priorite = d.statut === 'a_acheter' ? 3 : 2;
          if (photo) { d.photo = { base64: photo.base64, mime: photo.mime }; d.vignette = vignette; }
          var btn = $('button[type=submit]', f); busy(btn, true);
          api('prosp.enregistrer', d).then(function () {
            closeModal(); delete cache.prosp; delete cache.vign;
            toast('Bouteille gardée en mémoire (Prospection)');
            if (/^#\/(prospection|degustations)/.test(location.hash)) route();
          }).catch(function (e) { busy(btn, false); fail(e); });
        };
      });
  }

  /* =========================================================
   * J'apporte une bouteille : choix selon l'occasion et des critères
   * ======================================================= */
  var OCCASIONS = [
    ['amis', 'Dîner chez des amis'], ['famille', 'Repas de famille'], ['anniversaire', 'Anniversaire'],
    ['fete', 'Fête / apéritif'], ['connaisseurs', 'Dîner avec des amateurs de vin'], ['cadeau', 'Cadeau (à garder par l’hôte)']
  ];
  var FAMILLES = [['Rouge', 'Rouge'], ['Blanc', 'Blanc'], ['Rosé', 'Rosé'], ['Effervescent', 'Bulles'], ['Liquoreux', 'Liquoreux / moelleux'], ['Spiritueux', 'Spiritueux']];
  function famille(v) {
    if (/spiritueux|liqueur/i.test(v.type)) return 'Spiritueux';
    if (v.couleur === 'Effervescent' || /champagne|crémant/i.test(v.type)) return 'Effervescent';
    if (v.couleur === 'Moelleux' || v.couleur === 'Liquoreux') return 'Liquoreux';
    return v.couleur || '';
  }

  var critApport = { occasion: 'amis', hote: '', convives: 6, plat: '', budget_min: '', budget_max: '', familles: [], annee: '', pretes: true, uniques: true };
  try { Object.assign(critApport, JSON.parse(localStorage.getItem('cave_apport') || '{}')); } catch (e) {}

  /** Note une bouteille pour l'occasion ; null si elle est exclue par les critères. */
  function noterApport(v, c, ctx) {
    if (v.stock <= 0) return null;
    var fam = famille(v), valeur = num(v.cote_unitaire) || num(v.prix_moyen);
    var cadeau = c.occasion === 'cadeau', urgent = v.maturite === 'a_boire_vite' || v.maturite === 'passee';
    if (c.familles.length && c.familles.indexOf(fam) === -1) return null;
    if (num(c.budget_max) && valeur > num(c.budget_max)) return null;
    if (num(c.budget_min) && valeur && valeur < num(c.budget_min)) return null;
    if (c.pretes && !cadeau && v.maturite === 'trop_jeune') return null;
    if (c.uniques && v.stock === 1 && !urgent && !cadeau) return null;

    var s = 0, pour = [], contre = [];
    var pts = cadeau
      ? { apogee: 3, a_boire: 3, peut_attendre: 4, trop_jeune: 2, a_boire_vite: -2, passee: -6, inconnue: 2 }
      : { apogee: 5, a_boire_vite: 5, a_boire: 3, peut_attendre: -3, trop_jeune: -5, passee: 0, inconnue: 1 };
    s += pts[v.maturite] || 0;
    if (!cadeau && v.maturite === 'apogee') pour.push('À l’apogée');
    if (!cadeau && v.maturite === 'a_boire_vite') pour.push('Bonne occasion de l’ouvrir avant qu’elle ne décline');
    if (!cadeau && v.maturite === 'passee') contre.push('Au-delà de sa fenêtre : risque de déception');
    if (!cadeau && v.maturite === 'peut_attendre') contre.push('Gagnerait encore à attendre');
    if (cadeau && (v.maturite === 'peut_attendre' || v.maturite === 'trop_jeune')) pour.push('Se gardera encore plusieurs années chez l’hôte');
    if (cadeau && urgent) contre.push('À boire vite : cadeau délicat à garder');

    if (c.occasion === 'fete' && fam === 'Effervescent') { s += 4; pour.push('Des bulles pour la fête'); }
    if (c.occasion === 'fete' && fam === 'Rosé') s += 1;
    if (c.occasion === 'anniversaire' && num(c.annee) && num(v.millesime) === num(c.annee)) { s += 9; pour.push('Millésime ' + c.annee + ' : celui de l’anniversaire'); }
    if (c.occasion === 'connaisseurs') {
      var age = num(v.millesime) ? ANNEE - num(v.millesime) : 0;
      s += Math.min(3, Math.floor(age / 8));
      if (age >= 15) pour.push(age + ' ans de garde : de quoi en parler');
    }
    if (c.occasion === 'famille' && valeur && valeur <= 40 && (v.maturite === 'a_boire' || v.maturite === 'apogee')) { s += 1; pour.push('Facile et prête à boire'); }
    if ((c.occasion === 'cadeau' || c.occasion === 'connaisseurs') && num(c.budget_max) && valeur) s += 3 * valeur / num(c.budget_max);
    if (fam === 'Spiritueux' && c.occasion !== 'cadeau' && !c.familles.length) s -= 3;

    if (ctx.regles.length) {
      var hay = norm([v.appellation, v.region, v.cepages, v.accords, v.nom].join(' '));
      var meilleur = null, best = 0;
      ctx.regles.forEach(function (a) {
        var p = (splitList(a.couleurs).indexOf(v.couleur) > -1 ? 2 : 0) +
          Math.min(4, splitList(a.mots_cles).filter(function (k) { return k && hay.indexOf(norm(k)) > -1; }).length * 2);
        if (p > best) { best = p; meilleur = a; }
      });
      if (ctx.motsPlat.some(function (m) { return norm(v.accords).indexOf(m.slice(0, 5)) > -1; })) best += 2;
      if (best >= 2) { s += Math.min(5, best); pour.push('Accord avec « ' + c.plat + ' »' + (meilleur && best >= 4 ? ' (' + meilleur.styles.toLowerCase() + ')' : '')); }
      else s -= 1;
    }

    var besoin = fam === 'Spiritueux' ? 1 : Math.max(1, Math.ceil(num(c.convives || 6) / 6));
    var cl = num(v.contenance_cl) || 75;
    if (cl >= 150 && num(c.convives) >= 6) { s += 2; pour.push('Grand format : idéal à ' + c.convives); besoin = Math.ceil(besoin * 75 / cl); }
    if (v.stock < besoin) { s -= 1; contre.push('Il en faudrait ' + besoin + ', vous en avez ' + v.stock); }

    var hote = norm(c.hote).trim();
    if (hote.length > 1) {
      var deja = ctx.mvts.filter(function (m) { return m.vin_id === v.id && num(m.quantite) < 0 && norm(m.occasion).indexOf(hote) > -1; })[0];
      if (deja) { s -= 7; contre.push('Déjà apportée chez ' + c.hote + ' le ' + dateFr(deja.date)); }
    }
    if (v.derniere_sortie && (Date.now() - new Date(v.derniere_sortie).getTime()) < 30 * 864e5) { s -= 1; contre.push('Déjà ouverte il y a moins d’un mois'); }
    if (v.stock === 1) contre.push('Dernière bouteille de cette référence');
    if (valeur) pour.push(eur(valeur) + ' la bouteille');
    return { v: v, s: s, pour: pour, contre: contre, besoin: Math.min(besoin, v.stock), valeur: valeur };
  }

  function vueApporter(v) {
    return Promise.all([charger('vins', 'cave.lister', true), charger('accords', 'accords.lister'), api('mvt.lister', { limite: 2000 }), charger('vign', 'cave.vignettes')]).then(function (r) {
      var vins = r[0], accords = r[1], mvts = r[2], vign = r[3];
      var c = critApport;
      v.innerHTML = '<p class="small"><a href="#/accords">← Accords</a></p>' +
        '<div class="head"><h1>Quelle bouteille apporter ?</h1><span class="muted">Chez des amis, en famille ou pour une occasion : le choix se fait dans votre cave.</span></div>' +
        '<div class="grid" style="grid-template-columns:minmax(0,340px) minmax(0,1fr);align-items:start" id="ap-grid">' +
          '<form class="card" id="f-ap">' +
            '<div class="form" style="grid-template-columns:1fr 1fr">' +
              '<div class="full"><label for="ap-occ">Occasion</label><select id="ap-occ" name="occasion">' + options(OCCASIONS, c.occasion) + '</select></div>' +
              '<div class="full ap-an"><label for="ap-an">Année à fêter (millésime recherché)</label><input id="ap-an" name="annee" type="number" min="1900" max="' + ANNEE + '" value="' + esc(c.annee) + '" placeholder="ex. 1986"></div>' +
              '<div><label for="ap-hote">Chez qui</label><input id="ap-hote" name="hote" value="' + esc(c.hote) + '" placeholder="ex. Marc"></div>' +
              '<div><label for="ap-conv">Convives</label><input id="ap-conv" name="convives" type="number" min="1" max="60" value="' + esc(c.convives) + '"></div>' +
              '<div class="full"><label for="ap-plat">Plat prévu (si vous le savez)</label><input id="ap-plat" name="plat" value="' + esc(c.plat) + '" placeholder="ex. gigot d’agneau, raclette, poisson…"></div>' +
              '<div><label for="ap-min">Budget min (€/btl)</label><input id="ap-min" name="budget_min" type="number" min="0" value="' + esc(c.budget_min) + '"></div>' +
              '<div><label for="ap-max">Budget max (€/btl)</label><input id="ap-max" name="budget_max" type="number" min="0" value="' + esc(c.budget_max) + '"></div>' +
              '<div class="full"><label>Style (aucun = tous)</label><div class="chips" id="ap-fam">' + FAMILLES.map(function (f) {
                return '<label class="chip"><input type="checkbox" value="' + f[0] + '"' + (c.familles.indexOf(f[0]) > -1 ? ' checked' : '') + '><span>' + f[1] + '</span></label>';
              }).join('') + '</div></div>' +
              '<label class="full row small" style="font-weight:500;color:var(--ink);margin:0"><input type="checkbox" name="pretes" style="width:auto"' + (c.pretes ? ' checked' : '') + '> Seulement des bouteilles prêtes à boire</label>' +
              '<label class="full row small" style="font-weight:500;color:var(--ink);margin:0"><input type="checkbox" name="uniques" style="width:auto"' + (c.uniques ? ' checked' : '') + '> Garder mes bouteilles uniques (sauf si urgentes)</label>' +
            '</div>' +
          '</form>' +
          '<div id="ap-res"></div>' +
        '</div>';
      if (window.matchMedia('(max-width: 820px)').matches) $('#ap-grid').style.gridTemplateColumns = '1fr';

      var f = $('#f-ap');
      var libOcc = function () { return (OCCASIONS.filter(function (o) { return o[0] === c.occasion; })[0] || ['', ''])[1]; };
      function lire() {
        c.occasion = f.occasion.value; c.annee = f.annee.value; c.hote = f.hote.value; c.convives = f.convives.value;
        c.plat = f.plat.value; c.budget_min = f.budget_min.value; c.budget_max = f.budget_max.value;
        c.familles = $$('#ap-fam input:checked').map(function (i) { return i.value; });
        c.pretes = f.pretes.checked; c.uniques = f.uniques.checked;
        try { localStorage.setItem('cave_apport', JSON.stringify(c)); } catch (e) {}
      }
      function rendre() {
        lire();
        $$('.ap-an').forEach(function (x) { x.hidden = c.occasion !== 'anniversaire'; });
        var motsPlat = norm(c.plat).split(/[^a-z]+/).filter(function (m) { return m.length > 3; });
        var regles = motsPlat.length ? accords.filter(function (a) {
          var h = norm(a.plat + ' ' + a.categorie);
          return motsPlat.some(function (m) { return h.indexOf(m.slice(0, 5)) > -1; });
        }) : [];
        var ctx = { regles: regles, motsPlat: motsPlat, mvts: mvts };
        var res = vins.map(function (x) { return noterApport(x, c, ctx); }).filter(Boolean).sort(function (a, b) { return b.s - a.s; });
        var top = res.slice(0, 3), autres = res.slice(3, 8);
        var carte = function (o, rang) {
          var b = o.v, img = vign[b.id];
          return '<div class="card ap-card' + (rang === 0 ? ' ap-top' : '') + '">' +
            '<div class="thumb" style="' + (img ? 'background-image:url(' + img + ')' : '') + '">' + (img ? '' : esc((b.domaine || '?')[0])) + '</div>' +
            '<div style="min-width:0;flex:1">' + (rang === 0 ? '<div class="eyebrow">Notre choix</div>' : '') +
              '<a href="#/bouteille/' + esc(b.id) + '" class="t">' + esc(libelle(b)) + (b.millesime ? ' ' + esc(b.millesime) : '') + '</a>' +
              '<div class="small muted">' + dot(b.couleur) + ' ' + esc([b.appellation || b.type, b.emplacement ? '📍 ' + b.emplacement : ''].filter(Boolean).join(' · ')) + '</div>' +
              '<div class="row" style="gap:6px;margin-top:6px">' + pillMat(b.maturite) + '<strong class="nb">' + b.stock + ' btl en cave</strong>' +
                (o.besoin > 1 ? '<span class="tag">en prendre ' + o.besoin + '</span>' : '') + '</div>' +
              '<ul class="why">' + o.pour.map(function (x) { return '<li class="ok">' + esc(x) + '</li>'; }).join('') +
                o.contre.map(function (x) { return '<li class="ko">' + esc(x) + '</li>'; }).join('') + '</ul>' +
              (b.temp_service || b.carafage ? '<p class="small muted" style="margin:4px 0 0">Service : ' + esc([b.temp_service, b.carafage ? 'carafage ' + b.carafage : ''].filter(Boolean).join(', ')) + '</p>' : '') +
              '<div class="row" style="margin-top:10px"><button class="small" data-prendre="' + esc(b.id) + '" data-q="' + o.besoin + '">🎁 Je l’apporte</button></div>' +
            '</div></div>';
        };
        $('#ap-res').innerHTML = res.length
          ? '<div class="ap-list">' + top.map(carte).join('') + '</div>' +
            (autres.length ? '<h3 style="margin-top:18px">Autres idées</h3><div class="pick-list" style="max-height:none">' + autres.map(function (o) {
              var b = o.v;
              return '<button type="button" class="pick" data-prendre="' + esc(b.id) + '" data-q="' + o.besoin + '"><span style="min-width:0;flex:1;text-align:left">' + dot(b.couleur) + ' <strong>' + esc(libelle(b)) + '</strong>' +
                (b.millesime ? ' ' + esc(b.millesime) : '') + '<span class="small muted" style="display:block">' + esc((o.pour[0] || '') + (o.contre[0] ? ' · ' + o.contre[0] : '')) + '</span></span>' +
                pillMat(b.maturite) + '<span class="nb">' + b.stock + ' btl</span></button>';
            }).join('') + '</div>' : '') +
            '<div class="card" style="margin-top:16px"><div class="row"><span class="small muted" style="flex:1;min-width:200px">Envie d’un second avis ? Le sommelier IA reprend ces critères.</span>' +
              '<button class="ghost small" id="ap-ia">✨ Demander au sommelier</button></div><div id="ap-ia-res"></div></div>'
          : '<div class="card empty">Aucune bouteille ne correspond à ces critères. Élargissez le budget, les styles, ou décochez « Garder mes bouteilles uniques ».</div>';

        $$('[data-prendre]').forEach(function (btn) {
          btn.onclick = function () {
            var b = vins.filter(function (x) { return x.id === btn.getAttribute('data-prendre'); })[0];
            formulaireSortie(b, 'offert', { occasion: (c.hote ? 'Apportée chez ' + c.hote : 'Apportée') + ' — ' + libOcc().toLowerCase(), quantite: btn.getAttribute('data-q') });
          };
        });
        if ($('#ap-ia')) $('#ap-ia').onclick = function () {
          var btn = this; busy(btn, true, 'Réflexion…');
          var ctxTxt = 'J’apporte une bouteille : ' + libOcc() + (c.hote ? ' chez ' + c.hote : '') + ', ' + c.convives + ' convives' +
            (num(c.budget_max) ? ', budget maximum ' + c.budget_max + ' € la bouteille' : '') + (num(c.budget_min) ? ', minimum ' + c.budget_min + ' €' : '') +
            (c.familles.length ? ', styles souhaités : ' + c.familles.join(', ') : '') + (c.occasion === 'anniversaire' && c.annee ? ', millésime ' + c.annee + ' idéal' : '') +
            (c.occasion === 'cadeau' ? '. C’est un cadeau que l’hôte gardera : une bouteille de garde convient' : '. Elle sera bue ce soir-là');
          api('accords.suggerer', { plat: c.plat || libOcc(), contexte: ctxTxt }).then(function (r) {
            busy(btn, false);
            $('#ap-ia-res').innerHTML = (r.choix || []).map(function (x) {
              return '<div style="margin-top:10px"><a href="#/bouteille/' + esc(x.id) + '"><strong>' + esc(x.libelle) + '</strong></a> <strong class="nb">' + x.stock + ' btl</strong> ' + pillMat(x.maturite) +
                '<div class="small">' + esc(x.pourquoi) + '</div></div>';
            }).join('') + (r.style_ideal ? '<div class="ia-box" style="margin-top:10px">' + esc(r.style_ideal) + '</div>' : '');
          }).catch(function (e) { busy(btn, false); fail(e); });
        };
      }
      f.addEventListener('input', rendre);
      f.onsubmit = function (e) { e.preventDefault(); };
      rendre();
    });
  }

  /* =========================================================
   * Saisie en série : photos multiples ou liste collée
   * ======================================================= */
  var serie = { brouillons: [], seq: 0, enCours: 0, onglet: 'photos',
    reglages: { emplacement: '', entree: 'initial', date: '', fournisseur: '' } };
  try { Object.assign(serie.reglages, JSON.parse(localStorage.getItem('cave_serie') || '{}')); } catch (e) {}
  var STATUTS_SERIE = { attente: 'En attente', analyse: 'Analyse…', pret: 'Prête', erreur: 'Erreur', enregistre: 'Enregistrée' };

  function vueSerie(v) {
    return charger('vins', 'cave.lister', true).then(function (vins) {
      var R = serie.reglages;
      var lieux = vins.map(function (x) { return x.emplacement; }).filter(Boolean).concat(['Cave', 'Cellier', 'Armoire à vin', 'Bar'])
        .filter(function (x, i, a) { return a.indexOf(x) === i; });
      v.innerHTML = '<p class="small"><a href="#/ajouter">← Ajout simple</a></p>' +
        '<div class="head"><h1>Saisie en série</h1><span class="muted">Pour rentrer beaucoup de bouteilles d’un coup : une photo par référence, ou une liste collée.</span></div>' +
        '<datalist id="dl-serie">' + lieux.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
        '<div class="card" style="margin-bottom:14px"><div class="form">' +
          '<div><label for="se-emp">Emplacement par défaut</label><input id="se-emp" list="dl-serie" value="' + esc(R.emplacement) + '" placeholder="ex. Cave — casier A1"></div>' +
          '<div><label for="se-ent">Entrée</label><select id="se-ent">' + options([['initial', 'Stock initial (déjà en cave)'], ['achat', 'Achat'], ['cadeau_recu', 'Cadeau reçu']], R.entree) + '</select></div>' +
          '<div class="se-achat"><label for="se-date">Date d’achat</label><input id="se-date" type="date" value="' + esc(R.date || today()) + '"></div>' +
          '<div class="se-achat"><label for="se-four">Fournisseur</label><input id="se-four" value="' + esc(R.fournisseur) + '"></div>' +
        '</div><p class="small muted" style="margin:8px 0 0">Rangez casier par casier : changez l’emplacement par défaut avant chaque casier, chaque bouteille le reprend.</p></div>' +
        '<div class="seg" role="tablist" id="se-tabs"><button role="tab" data-t="photos">📷 Photos</button><button role="tab" data-t="liste">📋 Coller une liste</button></div>' +
        '<div id="se-photos" class="card" style="margin-bottom:14px">' +
          '<div class="row"><button id="se-cam">📷 Prendre une photo</button><button class="ghost" id="se-multi">🖼 Choisir plusieurs photos</button>' +
          '<input type="file" id="se-f1" accept="image/*" capture="environment" hidden><input type="file" id="se-fn" accept="image/*" multiple hidden></div>' +
          '<p class="small muted" style="margin:8px 0 0">Une photo par référence (étiquette de face, ou la caisse). L’analyse se fait pendant que vous continuez à photographier. Indiquez ensuite la quantité.</p></div>' +
        '<div id="se-liste" class="card" style="margin-bottom:14px" hidden>' +
          '<label for="se-txt">Une bouteille par ligne (copiée d’Excel, d’un carnet, d’un mail…)</label>' +
          '<textarea id="se-txt" style="min-height:160px" placeholder="6 x Château Talbot 2015&#10;Bollinger Special Cuvée — 3 btl — cave haute&#10;Armagnac Darroze 20 ans, 1, 95 €"></textarea>' +
          '<div class="row" style="margin-top:8px"><span class="small muted" style="flex:1">Jusqu’à environ 80 lignes par envoi. Quantité, emplacement et prix sont repris s’ils figurent sur la ligne.</span><button id="se-go">✨ Analyser la liste</button></div></div>' +
        '<div id="se-list" class="se-list"></div>' +
        '<div class="se-bar" id="se-bar" hidden></div>';

      var R2 = function () {
        R.emplacement = $('#se-emp').value; R.entree = $('#se-ent').value; R.date = $('#se-date').value; R.fournisseur = $('#se-four').value;
        $$('.se-achat').forEach(function (x) { x.hidden = R.entree === 'initial'; });
        try { localStorage.setItem('cave_serie', JSON.stringify(R)); } catch (e) {}
      };
      ['se-emp', 'se-ent', 'se-date', 'se-four'].forEach(function (id) { $('#' + id).addEventListener('input', R2); $('#' + id).addEventListener('change', R2); });
      R2();
      var onglet = function (t) {
        serie.onglet = t;
        $$('#se-tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-t') === t)); });
        $('#se-photos').hidden = t !== 'photos'; $('#se-liste').hidden = t !== 'liste';
      };
      $$('#se-tabs button').forEach(function (b) { b.onclick = function () { onglet(b.getAttribute('data-t')); }; });
      onglet(serie.onglet);

      /* --- Doublons : la même référence existe-t-elle déjà ? --- */
      // Rapprochement tolérant : « Ch. Talbot » = « Château Talbot », cuvée dans le domaine ou à part, même millésime
      var cle = function (x) {
        return norm([x.domaine, x.nom].join(' ')).replace(/\b(chateau|ch|domaine|dom|maison|clos)\b\.?/g, ' ')
          .replace(/[^a-z0-9]+/g, ' ').trim();
      };
      function chercherExistant(f) {
        var k = cle(f), m = String(f.millesime || '');
        if (k.length < 3) return null;
        return vins.filter(function (x) {
          var kx = cle(x);
          return String(x.millesime || '') === m && kx.length >= 3 && (kx === k || kx.indexOf(k) === 0 || k.indexOf(kx) === 0);
        })[0] || null;
      }

      function nouveau(src) {
        var b = { k: ++serie.seq, statut: 'attente', fiche: {}, quantite: 1, emplacement: R.emplacement, prix: '', ajout: true };
        Object.assign(b, src || {});
        serie.brouillons.push(b);
        return b;
      }

      /* --- Photos : file d'analyse, 2 en parallèle --- */
      function ajouterPhotos(files) {
        Array.prototype.forEach.call(files, function (file) {
          var b = nouveau({ fichier: file });
          Promise.all([reduireImage(file, 1280, 0.82), reduireImage(file, 220, 0.7)]).then(function (imgs) {
            b.photo = imgs[0]; b.vignette = imgs[1].dataUrl; delete b.fichier;
            rendre(); pomper();
          }).catch(function () { b.statut = 'erreur'; b.erreur = 'Image illisible'; rendre(); });
        });
        rendre();
      }
      function pomper() {
        while (serie.enCours < 2) {
          var b = serie.brouillons.filter(function (x) { return x.statut === 'attente' && x.photo; })[0];
          if (!b) return;
          analyser(b);
        }
      }
      function analyser(b) {
        b.statut = 'analyse'; serie.enCours++; rendre();
        api('ia.etiquette', { base64: b.photo.base64, mime: b.photo.mime }).then(function (r) {
          b.fiche = r; b.quantite = num(r.quantite_visible) || b.quantite || 1;
          b.statut = 'pret';
        }).catch(function (e) { b.statut = 'erreur'; b.erreur = e.message; })
          .then(function () { serie.enCours--; b.existant = chercherExistant(b.fiche); rendre(); pomper(); });
      }
      $('#se-cam').onclick = function () { $('#se-f1').click(); };
      $('#se-multi').onclick = function () { $('#se-fn').click(); };
      $('#se-f1').onchange = function () { ajouterPhotos(this.files); this.value = ''; };
      $('#se-fn').onchange = function () { ajouterPhotos(this.files); this.value = ''; };

      /* --- Liste collée --- */
      $('#se-go').onclick = function () {
        var txt = $('#se-txt').value.trim(); if (!txt) return toast('Collez au moins une ligne', true);
        var btn = this; busy(btn, true, 'Analyse…');
        api('ia.liste', { texte: txt }).then(function (r) {
          busy(btn, false);
          (r.bouteilles || []).forEach(function (f) {
            var b = nouveau({ fiche: f, statut: 'pret', quantite: num(f.quantite) || 1, emplacement: f.emplacement || R.emplacement, prix: f.prix_unitaire || '' });
            b.existant = chercherExistant(f);
          });
          $('#se-txt').value = '';
          toast((r.bouteilles || []).length + ' bouteille(s) reconnue(s) : vérifiez puis enregistrez');
          rendre();
        }).catch(function (e) { busy(btn, false); fail(e); });
      };

      /* --- Enregistrement --- */
      function enregistrer(b) {
        if (b.statut !== 'pret') return Promise.resolve();
        var f = b.fiche, q = Math.max(1, Math.round(num(b.quantite)));
        var type = R.entree === 'initial' ? 'ajustement' : R.entree;
        var mvt = { type: type, quantite: q, prix_unitaire: b.prix, date: R.entree === 'initial' ? today() : R.date,
          fournisseur: R.entree === 'initial' ? '' : R.fournisseur, note: R.entree === 'initial' ? 'Stock initial (saisie en série)' : 'Saisie en série' };
        b.statut = 'envoi'; rendre();
        var p;
        if (b.existant && b.ajout) {
          mvt.vin_id = b.existant.id;
          p = api('mvt.ajouter', mvt).then(function () { return { id: b.existant.id }; });
        } else {
          var vin = {};
          Object.keys(LIBELLES).forEach(function (c) { if (f[c] !== undefined && f[c] !== null && f[c] !== '') vin[c] = f[c]; });
          vin.emplacement = b.emplacement;
          if (num(f.cote_unitaire)) { vin.cote_date = today(); vin.cote_source = 'ia'; }
          var payload = { vin: vin, achat: mvt };
          if (b.photo) { payload.photo = { base64: b.photo.base64, mime: b.photo.mime }; payload.vignette = b.vignette; }
          p = api('cave.enregistrer', payload);
        }
        return p.then(function (res) {
          b.statut = 'enregistre'; b.id = res.id; delete b.photo;
          if (!b.existant) vins.push({ id: res.id, domaine: f.domaine, nom: f.nom, millesime: f.millesime, stock: q });
        }).catch(function (e) { b.statut = 'pret'; b.erreurEnvoi = e.message; fail(e); }).then(function () { invalider(); delete cache.vign; rendre(); });
      }
      function toutEnregistrer(btn) {
        var l = serie.brouillons.filter(function (x) { return x.statut === 'pret'; });
        busy(btn, true, '0/' + l.length);
        var i = 0;
        (function suivant() {
          if (i >= l.length) { busy(btn, false); toast(l.length + ' référence(s) enregistrée(s)'); return; }
          btn.innerHTML = '<span class="spin"></span> ' + (i + 1) + '/' + l.length;
          enregistrer(l[i++]).then(suivant);
        })();
      }

      /* --- Rendu des brouillons --- */
      function rendre() {
        var l = serie.brouillons, root = $('#se-list');
        if (!root) return;
        root.innerHTML = l.slice().reverse().map(function (b) {
          var f = b.fiche || {}, fini = b.statut === 'enregistre';
          var champ = function (k, lab, attrs) {
            return '<div><label>' + lab + '</label><input data-k="' + b.k + '" data-c="' + k + '" value="' + esc(f[k] === undefined || f[k] === null ? '' : f[k]) + '"' + (attrs || '') + (fini ? ' disabled' : '') + '></div>';
          };
          return '<div class="card se-item se-' + b.statut + '">' +
            '<div class="thumb" style="' + (b.vignette ? 'background-image:url(' + b.vignette + ')' : '') + '">' + (b.vignette ? '' : '📋') + '</div>' +
            '<div style="min-width:0;flex:1">' +
              '<div class="row" style="gap:8px"><span class="pill se-st">' + esc(STATUTS_SERIE[b.statut] || 'Envoi…') + '</span>' +
                (f.confiance ? '<span class="small muted">confiance ' + esc(f.confiance) + '</span>' : '') +
                (f.ligne ? '<span class="small muted" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">« ' + esc(f.ligne) + ' »</span>' : '') +
                '<span class="spacer"></span>' +
                (b.statut === 'erreur' && b.photo ? '<button class="ghost small" data-re="' + b.k + '">Réessayer</button>' : '') +
                (!fini ? '<button class="ghost small" data-del="' + b.k + '" aria-label="Retirer">✕</button>' : '<a class="small" href="#/bouteille/' + esc(b.id) + '">Voir la fiche →</a>') + '</div>' +
              (b.statut === 'erreur' ? '<p class="err small" style="margin:6px 0 0">' + esc(b.erreur || '') + '</p>' : '') +
              (b.statut === 'analyse' || b.statut === 'attente' ? '<p class="small muted" style="margin:8px 0 0"><span class="spin"></span> Lecture de l’étiquette…</p>' :
              b.statut === 'erreur' ? '' :
              '<div class="form se-form">' +
                champ('domaine', 'Domaine') + champ('nom', 'Cuvée') + champ('millesime', 'Millésime', ' type="number" min="1800" max="2200"') +
                '<div><label>Couleur</label><select data-k="' + b.k + '" data-c="couleur"' + (fini ? ' disabled' : '') + '>' + options(COULEURS, f.couleur, '—') + '</select></div>' +
                champ('appellation', 'Appellation') +
                '<div><label>Quantité</label><input data-k="' + b.k + '" data-q="quantite" type="number" min="1" value="' + esc(b.quantite) + '"' + (fini ? ' disabled' : '') + '></div>' +
                '<div><label>Emplacement</label><input data-k="' + b.k + '" data-q="emplacement" list="dl-serie" value="' + esc(b.emplacement) + '"' + (fini ? ' disabled' : '') + '></div>' +
                '<div class="se-prix"' + (R.entree === 'achat' ? '' : '') + '><label>Prix unitaire (€)</label><input data-k="' + b.k + '" data-q="prix" type="number" step="0.01" min="0" value="' + esc(b.prix) + '"' + (fini ? ' disabled' : '') + '></div>' +
              '</div>' +
              (b.existant ? '<label class="row small se-dup"><input type="checkbox" data-dup="' + b.k + '" style="width:auto"' + (b.ajout ? ' checked' : '') + (fini ? ' disabled' : '') + '> Déjà en cave (' +
                esc(libelle(b.existant)) + ', ' + b.existant.stock + ' btl) : ajouter au stock existant plutôt que créer une fiche</label>' : '') +
              (b.erreurEnvoi && !fini ? '<p class="err small">' + esc(b.erreurEnvoi) + '</p>' : '') +
              (b.statut === 'pret' ? '<div class="row" style="margin-top:8px"><span class="spacer"></span><button class="small" data-save="' + b.k + '">Enregistrer</button></div>' : '')) +
            '</div></div>';
        }).join('');

        var pretes = l.filter(function (x) { return x.statut === 'pret'; });
        var bar = $('#se-bar');
        bar.hidden = !l.length;
        var nbBtl = pretes.reduce(function (s, x) { return s + Math.max(1, num(x.quantite)); }, 0);
        var faits = l.filter(function (x) { return x.statut === 'enregistre'; }).length;
        var analyse = l.filter(function (x) { return x.statut === 'analyse' || x.statut === 'attente'; }).length;
        bar.innerHTML = '<div class="se-bar-in"><span><strong>' + pretes.length + '</strong> prête' + (pretes.length > 1 ? 's' : '') + ' (' + nbBtl + ' btl)' +
          (analyse ? ' · ' + analyse + ' en analyse' : '') + (faits ? ' · <span class="up">' + faits + ' enregistrée' + (faits > 1 ? 's' : '') + '</span>' : '') + '</span>' +
          '<span class="spacer"></span>' + (faits ? '<button class="ghost small" id="se-clean">Vider les enregistrées</button>' : '') +
          '<button id="se-all"' + (pretes.length ? '' : ' disabled') + '>Tout enregistrer</button></div>';

        var trouver = function (k) { return l.filter(function (x) { return String(x.k) === String(k); })[0]; };
        $$('[data-c]', root).forEach(function (i) {
          i.onchange = function () {
            var b = trouver(i.getAttribute('data-k'));
            b.fiche[i.getAttribute('data-c')] = i.value;
            var ex = chercherExistant(b.fiche);
            if ((ex && ex.id) !== (b.existant && b.existant.id)) { b.existant = ex; rendre(); }
          };
        });
        $$('[data-q]', root).forEach(function (i) { i.oninput = function () { trouver(i.getAttribute('data-k'))[i.getAttribute('data-q')] = i.value; }; i.onchange = function () { rendre(); }; });
        $$('[data-dup]', root).forEach(function (i) { i.onchange = function () { trouver(i.getAttribute('data-dup')).ajout = i.checked; }; });
        $$('[data-del]', root).forEach(function (x) { x.onclick = function () { serie.brouillons = serie.brouillons.filter(function (y) { return String(y.k) !== x.getAttribute('data-del'); }); rendre(); }; });
        $$('[data-re]', root).forEach(function (x) { x.onclick = function () { var b = trouver(x.getAttribute('data-re')); b.statut = 'attente'; rendre(); pomper(); }; });
        $$('[data-save]', root).forEach(function (x) { x.onclick = function () { enregistrer(trouver(x.getAttribute('data-save'))); }; });
        if ($('#se-all')) $('#se-all').onclick = function () { toutEnregistrer(this); };
        if ($('#se-clean')) $('#se-clean').onclick = function () { serie.brouillons = serie.brouillons.filter(function (y) { return y.statut !== 'enregistre'; }); rendre(); };
      }
      rendre(); pomper();
    });
  }

  /* =========================================================
   * Dégustations : tout ce qui a été bu, de ma cave ou ailleurs
   * ======================================================= */
  var ORIGINES_BUES = ['restaurant', 'amis', 'degustation'];
  var filtreDeg = { source: '', periode: '', q: '' };

  function vueDegustations(v) {
    return Promise.all([api('mvt.lister', { limite: 5000 }), charger('prosp', 'prosp.lister', true), charger('vins', 'cave.lister', true), charger('vign', 'cave.vignettes')]).then(function (r) {
      var mvts = r[0], memos = r[1], vins = r[2], vign = r[3];
      var parId = {}; vins.forEach(function (x) { parId[x.id] = x; });

      // Une ligne commune pour les deux sources
      var lignes = mvts.filter(function (m) { return m.type === 'consommation'; }).map(function (m) {
        var b = parId[m.vin_id] || {};
        return { source: 'cave', date: String(m.date).slice(0, 10), titre: libelle(b) + (b.millesime ? ' ' + b.millesime : ''),
          sous: b.appellation || b.type || '', couleur: b.couleur, ou: m.occasion || '', note: num(m.note_degustation),
          texte: m.impressions || '', qte: -num(m.quantite), lien: '#/bouteille/' + m.vin_id, img: vign[m.vin_id] };
      }).concat(memos.filter(function (p) { return ORIGINES_BUES.indexOf(p.origine) > -1; }).map(function (p) {
        return { source: p.origine, date: String(p.date_vue || p.cree_le).slice(0, 10), titre: libelle(p) + (p.millesime ? ' ' + p.millesime : ''),
          sous: p.appellation || p.type || '', couleur: p.couleur, ou: p.lieu || '', note: num(p.note_perso), texte: p.note || '',
          qte: 1, prix: num(p.prix_vu), lien: '#/prospection', img: vign[p.id], statut: p.statut };
      })).sort(function (a, b) { return b.date.localeCompare(a.date); });

      var SOURCES = { cave: ['De ma cave', '🏠'], restaurant: ['Au restaurant', '🍽'], amis: ['Chez des amis', '🥂'], degustation: ['Dégustation / salon', '🍷'] };

      v.innerHTML = '<div class="head"><h1>Dégustations</h1><span class="muted">Tout ce que vous avez bu : vos bouteilles et celles d’ailleurs.</span><span class="spacer"></span>' +
        '<button class="ghost" data-quick="sortie">🏠 J’ai bu une bouteille de ma cave</button><button data-quick="memo">🍽 J’ai bu une bouteille ailleurs</button></div>' +
        '<div class="grid g3" id="dg-stats" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px"></div>' +
        '<div class="row" style="margin-bottom:12px;gap:8px">' +
          '<div class="seg" style="margin:0" id="dg-src">' + [['', 'Tout'], ['cave', '🏠 De ma cave'], ['ailleurs', '🍽 Ailleurs']].map(function (x) {
            return '<button data-s="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
          '<select id="dg-per" style="width:auto">' + options([['', 'Toutes les dates'], ['30', '30 derniers jours'], ['365', '12 derniers mois'], ['an', 'Cette année']], filtreDeg.periode) + '</select>' +
          '<input id="dg-q" type="search" placeholder="Rechercher : vin, lieu, convives…" value="' + esc(filtreDeg.q) + '" style="flex:1;min-width:180px">' +
        '</div><div id="dg-list"></div>';

      function rendre() {
        var lim = filtreDeg.periode === 'an' ? ANNEE + '-01-01' : filtreDeg.periode ? new Date(Date.now() - num(filtreDeg.periode) * 864e5).toISOString().slice(0, 10) : '';
        var q = norm(filtreDeg.q);
        var l = lignes.filter(function (x) {
          if (filtreDeg.source === 'cave' && x.source !== 'cave') return false;
          if (filtreDeg.source === 'ailleurs' && x.source === 'cave') return false;
          if (lim && x.date < lim) return false;
          var hay = norm([x.titre, x.sous, x.ou, x.texte].join(' '));
          return !q || q.split(/\s+/).every(function (w) { return hay.indexOf(w) > -1; });
        });
        $$('#dg-src button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-s') === filtreDeg.source)); });
        var notes = l.filter(function (x) { return x.note; });
        var cave = l.filter(function (x) { return x.source === 'cave'; }).reduce(function (s, x) { return s + x.qte; }, 0);
        var ailleurs = l.filter(function (x) { return x.source !== 'cave'; }).length;
        var top = notes.slice().sort(function (a, b) { return b.note - a.note; })[0];
        $('#dg-stats').innerHTML = stat(cave, 'bouteilles de ma cave') + stat(ailleurs, 'bues ailleurs') +
          stat(notes.length ? (notes.reduce(function (s, x) { return s + x.note; }, 0) / notes.length).toFixed(1) + '<small style="font-size:1rem">/20</small>' : '—', 'note moyenne', notes.length + ' notée' + (notes.length > 1 ? 's' : '')) +
          stat(top ? top.note + '<small style="font-size:1rem">/20</small>' : '—', 'meilleure note', top ? esc(top.titre) : '');

        var mois = '', html = '';
        l.forEach(function (x) {
          var m = x.date.slice(0, 7);
          if (m !== mois) {
            mois = m;
            var d = new Date(m + '-01T12:00:00');
            html += '<h3 class="dg-mois">' + d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) + '</h3>';
          }
          var s = SOURCES[x.source] || ['Ailleurs', '🍽'];
          html += '<a class="card dg-item dg-' + (x.source === 'cave' ? 'cave' : 'ext') + '" href="' + x.lien + '">' +
            '<div class="thumb" style="' + (x.img ? 'background-image:url(' + x.img + ')' : '') + '">' + (x.img ? '' : s[1]) + '</div>' +
            '<div style="min-width:0;flex:1"><div class="row" style="gap:6px"><span class="pill dg-src">' + s[1] + ' ' + s[0] + '</span><span class="small muted">' + dateFr(x.date) + '</span>' +
              (x.qte > 1 ? '<span class="tag">' + x.qte + ' btl</span>' : '') + '</div>' +
              '<div class="t" style="margin-top:4px">' + dot(x.couleur) + ' ' + esc(x.titre) + '</div>' +
              '<div class="small muted">' + esc([x.sous, x.ou].filter(Boolean).join(' · ')) + (x.prix ? ' · ' + eur(x.prix) : '') + '</div>' +
              (x.texte ? '<p class="small" style="margin:6px 0 0">' + esc(x.texte) + '</p>' : '') +
              (x.statut === 'a_acheter' ? '<span class="tag" style="margin-top:6px;display:inline-block">à acheter</span>' : '') + '</div>' +
            (x.note ? '<div class="qty">' + x.note + '<small>/20</small></div>' : '') + '</a>';
        });
        $('#dg-list').innerHTML = html || '<div class="card empty">Aucune dégustation pour ces critères.<br><br>Quand vous sortez une bouteille de la cave avec « Bue », ou quand vous gardez en mémoire une bouteille bue au restaurant ou chez des amis, elle apparaît ici.</div>';
      }
      $$('#dg-src button').forEach(function (b) { b.onclick = function () { filtreDeg.source = b.getAttribute('data-s'); rendre(); }; });
      $('#dg-per').onchange = function () { filtreDeg.periode = this.value; rendre(); };
      $('#dg-q').oninput = function () { filtreDeg.q = this.value; rendre(); };
      rendre();
    });
  }

  /* =========================================================
   * Thème : automatique, clair ou sombre
   * ======================================================= */
  var ICO = {
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    clair: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g></svg>',
    sombre: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor"/></svg>'
  };
  var THEMES = [['auto', 'Auto', 'Thème automatique (selon l’appareil)'], ['clair', 'Clair', 'Thème clair'], ['sombre', 'Sombre', 'Thème sombre']];
  var themeHote = document.documentElement.getAttribute('data-theme');
  function appliquerTheme(t) {
    var root = document.documentElement;
    if (t === 'clair') root.setAttribute('data-theme', 'light');
    else if (t === 'sombre') root.setAttribute('data-theme', 'dark');
    else if (themeHote) root.setAttribute('data-theme', themeHote);
    else root.removeAttribute('data-theme');
    var cur = THEMES.filter(function (x) { return x[0] === t; })[0] || THEMES[0];
    var b = $('#btn-theme');
    if (b) { b.innerHTML = ICO[cur[0]] + '<span class="th-l">' + cur[1] + '</span>'; b.title = cur[2] + ' — cliquer pour changer'; b.setAttribute('aria-label', cur[2]); }
  }
  var theme = 'auto';
  try { theme = localStorage.getItem('cave_theme') || 'auto'; } catch (e) {}
  appliquerTheme(theme);
  $('#btn-theme').addEventListener('click', function () {
    var i = THEMES.map(function (x) { return x[0]; }).indexOf(theme);
    theme = THEMES[(i + 1) % THEMES.length][0];
    try { localStorage.setItem('cave_theme', theme); } catch (e) {}
    appliquerTheme(theme);
    toast(THEMES.filter(function (x) { return x[0] === theme; })[0][2]);
  });

  /* =========================================================
   * Offres reçues par mail
   * ======================================================= */
  var VERDICTS = {
    tres_bonne_affaire: 'Très bonne affaire', bonne_affaire: 'Bonne affaire', prix_correct: 'Prix correct',
    cher: 'Cher', a_eviter: 'À éviter', inconnu: 'Non évalué'
  };
  var VERDICT_ORDRE = ['tres_bonne_affaire', 'bonne_affaire', 'prix_correct', 'cher', 'a_eviter', 'inconnu'];
  function pillVerdict(v) { return '<span class="pill v-' + esc(v || 'inconnu') + '">' + esc(VERDICTS[v] || VERDICTS.inconnu) + '</span>'; }

  /** Frais de port selon la grille du vendeur ; au-delà de la dernière tranche, plusieurs colis. */
  function calculGrille(grille, n) {
    if (!n) return 0;
    if (!grille || !grille.length) return null;
    var g = grille.slice().sort(function (a, b) { return num(a.max) - num(b.max); });
    var der = g[g.length - 1];
    if (n > num(der.max)) return num(der.prix) * Math.floor(n / num(der.max)) + calculGrille(g, n % num(der.max));
    var t = g.filter(function (x) { return n >= num(x.min) && n <= num(x.max); })[0] || g.filter(function (x) { return n <= num(x.max); })[0];
    return t ? num(t.prix) : null;
  }

  function vueOffres(v, id) {
    if (id) return vueOffre(v, id);
    return charger('offres', 'offres.lister', true).then(function (list) {
      v.innerHTML = '<div class="head"><h1>Offres reçues</h1><span class="muted">Listes de vendeurs reçues par mail, analysées ligne par ligne</span></div>' +
        '<div class="grid" style="grid-template-columns:minmax(0,3fr) minmax(0,2fr);align-items:start" id="o-grid">' +
          '<form class="card" id="f-off"><h2>Analyser une offre</h2>' +
            '<p class="muted small">Dans Outlook, ouvrez le mail, sélectionnez tout le texte (Ctrl+A), copiez, puis collez-le ici. Gardez la partie frais de port : elle est prise en compte.</p>' +
            '<div class="form"><div><label for="o-vendeur">Vendeur</label><input id="o-vendeur" name="vendeur" placeholder="ex. Pierre, caviste…"></div>' +
            '<div><label for="o-objet">Objet du mail</label><input id="o-objet" name="objet"></div>' +
            '<div class="full"><label for="o-texte">Texte du mail</label><textarea id="o-texte" name="texte" style="min-height:220px" required placeholder="1 Ch. Meyney Saint-Estèphe 1988 = 25 euros&#10;…&#10;Frais de port : 1 bouteille = 8 euros…"></textarea></div>' +
            '<div class="full row"><span class="small muted">Comptez 20 à 60 secondes pour une longue liste.</span><span class="spacer"></span><button type="submit">✨ Analyser l’offre</button></div></div>' +
          '</form>' +
          '<div class="card"><h2>Offres analysées</h2>' + (list.length ? '<table><tbody>' + list.map(function (o) {
            return '<tr><td><a href="#/offres/' + esc(o.id) + '"><strong>' + esc(o.vendeur || 'Vendeur') + '</strong></a><div class="small muted">' + esc(o.objet) + '</div></td>' +
              '<td class="small">' + dateFr(o.cree_le) + '</td><td class="n small"><span class="up">' + (o.nb_affaires || 0) + '</span> / ' + o.nb_articles + '</td></tr>';
          }).join('') + '</tbody></table><p class="small muted">affaires / articles</p>' : '<p class="muted">Aucune offre analysée pour l’instant.</p>') + '</div>' +
        '</div>';
      if (window.matchMedia('(max-width: 820px)').matches) $('#o-grid').style.gridTemplateColumns = '1fr';
      $('#f-off').onsubmit = function (e) {
        e.preventDefault();
        var d = Object.fromEntries(new FormData(this));
        var btn = $('button[type=submit]', this); busy(btn, true, 'Analyse en cours…');
        api('offres.analyser', d).then(function (o) { delete cache.offres; location.hash = '#/offres/' + o.id; })
          .catch(function (e) { busy(btn, false); fail(e); });
      };
    });
  }

  function vueOffre(v, id) {
    return Promise.all([api('offres.lire', { id: id }), charger('vins', 'cave.lister')]).then(function (r) {
      var o = r[0], a = o.analyse, vins = r[1].filter(function (x) { return x.stock > 0; });
      var arts = a.articles || [];
      var cle = 'cave_panier_' + id, panier = {};
      try { panier = JSON.parse(localStorage.getItem(cle) || '{}'); } catch (e) {}
      var filtre = '', assurance = false;
      var enCave = function (art) {
        var d = norm(art.domaine || '').replace(/^(chateau|ch\.?|domaine|dom\.?)\s+/, '');
        return d.length > 3 && vins.some(function (x) { return norm(x.domaine).indexOf(d) > -1; });
      };
      var compte = {};
      arts.forEach(function (x) { compte[x.verdict] = (compte[x.verdict] || 0) + 1; });

      v.innerHTML = '<p class="small"><a href="#/offres">← Offres</a></p>' +
        '<div class="head"><div><h1>' + esc(o.vendeur || 'Offre') + '</h1><div class="muted">' + esc(o.objet) + ' · analysée le ' + dateFr(o.cree_le) + '</div></div>' +
        '<span class="spacer"></span><button class="danger small" id="o-del">Supprimer</button></div>' +
        (a.synthese ? '<div class="ia-box" style="margin-bottom:12px">' + esc(a.synthese) + '</div>' : '') +
        ((a.alertes || []).length ? '<div class="card" style="margin-bottom:12px;border-color:var(--warn)"><strong>Points d’attention</strong><ul style="margin:6px 0 0;padding-left:20px">' +
          a.alertes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<div class="cats" id="o-filtres"></div>' +
        '<div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start" id="o-main">' +
          '<div class="card" style="padding:0"><div class="table-wrap"><table id="o-table"></table></div></div>' +
          '<div class="card" id="o-panier" style="position:sticky;top:calc(env(safe-area-inset-top, 0px) + 70px)"></div>' +
        '</div>' +
        '<p class="small muted">Prix de marché : estimations de l’IA, à recouper pour les achats importants. « Prix rendu » = prix + part du port pour le panier en cours.</p>';
      if (window.matchMedia('(max-width: 900px)').matches) { $('#o-main').style.gridTemplateColumns = '1fr'; $('#o-panier').style.position = 'static'; }

      function totaux() {
        var t = { lignes: 0, btl: 0, equiv: 0, sous: 0, marche: 0, marcheConnu: true };
        arts.forEach(function (x) {
          var q = num(panier[x.n]); if (!q) return;
          t.lignes++; t.btl += q; t.sous += q * x.prix_unitaire;
          if (!x.port_inclus) t.equiv += q * x.equiv_bouteilles;
          if (x.prix_marche) t.marche += q * x.prix_marche; else t.marcheConnu = false;
        });
        t.equiv = Math.ceil(t.equiv);
        t.port = calculGrille(a.frais_port, t.equiv);
        t.assur = assurance ? (calculGrille(a.assurance, t.equiv) || 0) : 0;
        t.total = t.sous + (t.port || 0) + t.assur;
        return t;
      }

      function rendreFiltres() {
        $('#o-filtres').innerHTML = '<button class="' + (!filtre ? 'on' : '') + '" data-f="">Tout (' + arts.length + ')</button>' +
          VERDICT_ORDRE.filter(function (k) { return compte[k]; }).map(function (k) {
            return '<button class="' + (filtre === k ? 'on' : '') + '" data-f="' + k + '">' + VERDICTS[k] + ' (' + compte[k] + ')</button>';
          }).join('') + '<button class="' + (filtre === 'panier' ? 'on' : '') + '" data-f="panier">Mon panier</button>';
        $$('#o-filtres button').forEach(function (b) { b.onclick = function () { filtre = b.getAttribute('data-f'); rendreFiltres(); rendreTable(); }; });
      }

      function rendreTable() {
        var t = totaux();
        var portParEquiv = t.equiv && t.port ? t.port / t.equiv : calculGrille(a.frais_port, 1) || 0;
        var l = arts.filter(function (x) { return !filtre || (filtre === 'panier' ? num(panier[x.n]) > 0 : x.verdict === filtre); })
          .sort(function (x, y) { return filtre ? 0 : VERDICT_ORDRE.indexOf(x.verdict) - VERDICT_ORDRE.indexOf(y.verdict) || (x.ecart || 0) - (y.ecart || 0); });
        $('#o-table').innerHTML = '<thead><tr><th>Panier</th><th>Article</th><th>Verdict</th><th class="n">Prix u.</th><th class="n">Marché</th><th class="n">Écart</th><th class="n">Prix rendu</th></tr></thead><tbody>' +
          (l.length ? l.map(function (x) {
            var rendu = x.prix_unitaire + (x.port_inclus ? 0 : portParEquiv * x.equiv_bouteilles);
            return '<tr><td><input type="number" min="0" max="' + x.quantite_dispo + '" value="' + (num(panier[x.n]) || 0) + '" data-n="' + x.n + '" aria-label="Quantité" style="width:64px;padding:5px 6px">' +
                '<div class="small muted" style="margin-top:2px">dispo ' + x.quantite_dispo + '</div></td>' +
              '<td style="min-width:220px">' + dot(x.couleur) + ' <strong>' + esc(x.designation) + '</strong>' +
                (x.format_cl && x.format_cl !== 75 ? ' <span class="tag">' + esc(x.format_cl) + ' cl</span>' : '') +
                (x.port_inclus ? ' <span class="tag">port inclus</span>' : '') +
                (enCave(x) ? ' <span class="tag">déjà en cave</span>' : '') +
                '<div class="small muted">' + esc([x.etat, x.commentaire].filter(Boolean).join(' · ')) + '</div></td>' +
              '<td>' + pillVerdict(x.verdict) + (x.a_boire ? '<div class="small muted" style="margin-top:4px">' + esc(x.a_boire) + '</div>' : '') + '</td>' +
              '<td class="n">' + eur(x.prix_unitaire, true) + '</td><td class="n">' + (x.prix_marche ? eur(x.prix_marche) : '—') + '</td>' +
              '<td class="n ' + (x.ecart < 0 ? 'up' : x.ecart > 0 ? 'down' : '') + '">' + (x.ecart === null ? '—' : (x.ecart > 0 ? '+' : '') + x.ecart + ' %') + '</td>' +
              '<td class="n">' + eur(rendu, true) + '</td></tr>';
          }).join('') : '<tr><td colspan="7" class="empty">' + (filtre === 'panier' ? 'Panier vide : indiquez une quantité sur les lignes qui vous intéressent.' : 'Aucun article.') + '</td></tr>') + '</tbody>';
        $$('#o-table input[data-n]').forEach(function (i) {
          i.onchange = function () {
            var n = i.getAttribute('data-n'), q = Math.max(0, Math.min(num(i.max), Math.round(num(i.value))));
            i.value = q; if (q) panier[n] = q; else delete panier[n];
            try { localStorage.setItem(cle, JSON.stringify(panier)); } catch (e) {}
            rendreTable();
          };
        });
        rendrePanier(t);
      }

      function rendrePanier(t) {
        var eco = t.marche && t.marcheConnu ? t.marche - t.sous - (t.port || 0) - t.assur : null;
        var ligne = function (l, val, fort) { return '<div class="row" style="justify-content:space-between;margin:4px 0' + (fort ? ';font-weight:700;font-size:1.1rem' : '') + '"><span>' + l + '</span><span class="n">' + val + '</span></div>'; };
        $('#o-panier').innerHTML = '<h2>Panier</h2>' + (t.lignes ?
          ligne(t.btl + ' article' + (t.btl > 1 ? 's' : '') + ' · ' + t.equiv + ' éq. btl', '') +
          ligne('Sous-total', eur(t.sous, true)) +
          ligne('Port', t.port === null ? '<span class="muted">grille absente</span>' : eur(t.port, true)) +
          ((a.assurance || []).length ? '<label class="row small" style="font-weight:500;color:var(--ink);margin:4px 0"><input type="checkbox" id="o-assur" style="width:auto"' + (assurance ? ' checked' : '') + '> Assurance ' + (assurance ? eur(t.assur, true) : '') + '</label>' : '') +
          '<hr style="border:0;border-top:1px solid var(--line)">' + ligne('Total', eur(t.total, true), true) +
          ligne('Moyenne par article', eur(t.total / t.btl, true)) +
          (eco !== null ? ligne('Économie vs marché', '<span class="' + (eco >= 0 ? 'up' : 'down') + '">' + eur(Math.abs(eco)) + (eco < 0 ? ' de plus' : '') + '</span>') : '') +
          (t.port !== null && a.frais_port && a.frais_port.length ? '<p class="small muted">' + conseilPort(a.frais_port, t.equiv) + '</p>' : '') +
          '<div class="row" style="margin-top:10px"><button id="o-copier">Copier la commande</button><button class="ghost" id="o-suivi">Ajouter à la prospection</button></div>' +
          '<textarea id="o-cmd" readonly hidden style="margin-top:8px;min-height:150px"></textarea>'
          : '<p class="muted">Indiquez des quantités dans le tableau pour calculer le coût avec le port.</p>');
        if (!t.lignes) return;
        if ($('#o-assur')) $('#o-assur').onchange = function () { assurance = this.checked; rendreTable(); };
        $('#o-copier').onclick = function () {
          var txt = 'Bonjour' + (o.vendeur ? ' ' + o.vendeur : '') + ',\n\nJe serais intéressé par :\n' +
            arts.filter(function (x) { return num(panier[x.n]); }).map(function (x) {
              return '- ' + panier[x.n] + ' × ' + x.designation + ' (' + eur(x.prix_unitaire, true) + ')';
            }).join('\n') + '\n\nSoit ' + eur(t.sous, true) + (t.port ? ' + ' + eur(t.port, true) + ' de port' : '') + (t.assur ? ' + ' + eur(t.assur, true) + ' d’assurance' : '') +
            ' = ' + eur(t.total, true) + '.\n\nMerci de me confirmer la disponibilité.\n\nCordialement';
          var ta = $('#o-cmd'); ta.value = txt; ta.hidden = false;
          var ok = function () { toast('Commande copiée : collez-la dans votre réponse'); };
          try { navigator.clipboard.writeText(txt).then(ok, function () { ta.select(); toast('Texte sélectionné : Ctrl+C pour copier'); }); }
          catch (e) { ta.select(); }
        };
        $('#o-suivi').onclick = function () {
          var b = this; busy(b, true);
          var choix = arts.filter(function (x) { return num(panier[x.n]); });
          Promise.all(choix.map(function (x) {
            return api('prosp.enregistrer', { domaine: x.domaine || x.designation, nom: x.domaine ? x.designation : '', type: x.type, couleur: x.couleur,
              appellation: x.appellation, millesime: x.millesime, prix_vu: x.prix_unitaire, lieu: o.vendeur || 'Offre par mail',
              priorite: x.verdict === 'tres_bonne_affaire' ? 3 : 2, statut: 'a_acheter',
              note: panier[x.n] + ' btl · ' + (VERDICTS[x.verdict] || '') + (x.prix_marche ? ' (marché ~' + x.prix_marche + ' €)' : '') + (x.commentaire ? ' · ' + x.commentaire : '') });
          })).then(function () { busy(b, false); toast(choix.length + ' ligne(s) ajoutée(s) à la prospection'); }).catch(function (e) { busy(b, false); fail(e); });
        };
      }

      /** Indique combien d'équivalents bouteille on peut ajouter sans changer de tranche. */
      function conseilPort(grille, n) {
        var g = grille.slice().sort(function (x, y) { return num(x.max) - num(y.max); });
        var t = g.filter(function (x) { return n >= num(x.min) && n <= num(x.max); })[0];
        if (!t) return '';
        var reste = num(t.max) - n;
        return reste > 0 ? 'Vous pouvez ajouter ' + reste + ' bouteille' + (reste > 1 ? 's' : '') + ' sans payer plus de port.' : 'Tranche de port pleine : au-delà, le port augmente.';
      }

      $('#o-del').onclick = function () {
        if (!window.demoConfirm('Supprimer cette analyse ?')) return;
        api('offres.supprimer', { id: id }).then(function () { delete cache.offres; location.hash = '#/offres'; }).catch(fail);
      };
      rendreFiltres(); rendreTable();
    });
  }

  /* =========================================================
   * Démarrage
   * ======================================================= */
  if (!CFG.API_URL || /REMPLACER/.test(CFG.API_URL)) {
    document.body.innerHTML = '<div class="card empty" style="margin:40px auto;max-width:520px">Configurer <code>config.js</code> (API_URL et CLIENT_ID).</div>';
    return;
  }
  if (session && session.expire_le && new Date(session.expire_le) > new Date()) demarrer();
  else afficherLogin();
})();
