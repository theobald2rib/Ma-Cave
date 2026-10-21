/* Ma Cave : frontend (JS vanilla, sans dépendance) */
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
  function eur(v, precis) { return v ? (precis ? fmtEur2 : fmtEurF).format(v) : '-'; }
  function dateFr(d) {
    if (!d) return '';
    var p = String(d).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d;
  }
  function today() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function libelle(v) { return [v.domaine, v.nom].filter(Boolean).join(' · ') || 'Sans nom'; }
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
      if (res.success) {
        if (res.data && typeof res.data === 'object' && res.data.ia_restant !== undefined) majIaRestant(res.data.ia_restant);
        return res.data;
      }
      if (res.error && (res.error.code === 'SESSION' || res.error.code === 'NON_AUTORISE') && action !== 'login') {
        deconnexion(res.error.message);
      }
      var e = new Error((res.error && res.error.message) || 'Erreur');
      e.code = res.error && res.error.code;
      throw e;
    });
  }
  function fail(e) { console.error(e); toast(e.message || String(e), true); }

  /* Rôle : l'affichage s'adapte, mais c'est le serveur qui vérifie chaque action (voir autoriser_ dans Code.gs). */
  function estAdmin() { return !!session && session.role === 'admin'; }
  function voitPrix() { return estAdmin() || !!(session && session.voir_prix); }
  function iaVisiteur() { return !estAdmin() && !!(session && session.quota_ia > 0); }
  function appliquerRole() {
    document.body.classList.toggle('visiteur', !estAdmin());
    document.body.classList.toggle('sans-prix', !voitPrix());
    document.body.classList.toggle('avec-ia', estAdmin() || iaVisiteur());
  }
  function texteIaRestant() {
    if (!iaVisiteur()) return '';
    var n = num(session.ia_restant);
    return n > 0 ? '✨ ' + n + ' analyse' + (n > 1 ? 's' : '') + ' IA restante' + (n > 1 ? 's' : '') + ' aujourd’hui' : '✨ Analyses IA du jour utilisées, rendez-vous demain';
  }
  function majIaRestant(n) {
    if (!session) return;
    session.ia_restant = n;
    try { sessionStorage.setItem('cave_session', JSON.stringify(session)); } catch (e) {}
    $$('.ia-restant').forEach(function (el) { el.textContent = texteIaRestant(); });
  }

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

  var CATEGORIES_SPIRITUEUX = ['Whisky', 'Rhum', 'Cognac', 'Armagnac', 'Calvados', 'Eau-de-vie de fruits', 'Marc / Grappa', 'Gin', 'Vodka',
    'Tequila / Mezcal', 'Liqueur de plantes', 'Crème / liqueur de fruits', 'Gentiane / amer', 'Anisé', 'Porto / vin muté', 'Autre'];
  // Classement sans IA d'après le nom, le domaine et l'appellation
  var REGLES_CATEGORIE = [
    [/whisk|scotch|bourbon|single malt|blended|islay|speyside|nikka|yamazaki|hibiki|taketsuru|talisker|macallan|lagavulin|laphroaig|glen/, 'Whisky'],
    [/\brhums?\b|\brum\b|ron |cachaça|cachaca|rhum agricole|clairin|grogue/, 'Rhum'],
    [/cognac|fine champagne|grande champagne/, 'Cognac'],
    [/armagnac|folle blanche|baco/, 'Armagnac'],
    [/calvados|pommeau|pays d.auge|domfrontais/, 'Calvados'],
    [/\bmarc\b|grappa/, 'Marc / Grappa'],
    [/poire williams|williamine|framboise|mirabelle|kirsch|quetsche|prune|eau.de.vie/, 'Eau-de-vie de fruits'],
    [/\bgin\b/, 'Gin'], [/vodka/, 'Vodka'], [/tequila|mezcal/, 'Tequila / Mezcal'],
    [/chartreuse|benedictine|génépi|genepi|verveine|izarra|jägermeister|jagermeister|amaro/, 'Liqueur de plantes'],
    [/gentiane|suze|salers|avèze|aveze|amer /, 'Gentiane / amer'],
    [/pastis|absinthe|anis|ouzo|raki/, 'Anisé'],
    [/porto|\bport\b|banyuls|maury|rivesaltes|pineau|madère|madere|xérès|xeres|sherry|marsala|byrrh/, 'Porto / vin muté'],
    [/crème de|creme de|cassis|curaçao|curacao|cointreau|grand marnier|limoncello|amaretto|liqueur/, 'Crème / liqueur de fruits']
  ];
  function estSpiritueux(v) { return /spiritueux|liqueur/i.test(v.type || ''); }
  function devinerCategorie(v) {
    var h = norm([v.nom, v.domaine, v.appellation, v.cepages, v.description].join(' '));
    for (var i = 0; i < REGLES_CATEGORIE.length; i++) if (REGLES_CATEGORIE[i][0].test(h)) return REGLES_CATEGORIE[i][1];
    return '';
  }
  function categorieDe(v) { return estSpiritueux(v) ? (v.categorie || devinerCategorie(v)) : ''; }
  /** Sous-titre court : appellation, sinon catégorie du spiritueux, sinon type. */
  function sousTitre(v) { return v.appellation || categorieDe(v) || v.type || ''; }

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
    accords: vueAccords, apporter: vueApporter, serie: vueSerie, degustations: vueDegustations, inventaire: vueInventaire, offres: vueOffres, prospection: vueProspection, valeur: vueValeur, journal: vueJournal, acces: vueAcces, echanges: vueEchanges, analyser: vueAnalyser
  };
  var ROUTES_ADMIN = ['ajouter', 'modifier', 'serie', 'apporter', 'inventaire', 'prospection', 'journal', 'acces'];

  function route() {
    if (!session) return;
    var h = location.hash.replace(/^#\/?/, '');
    var q = h.split('?');
    var parts = q[0].split('/');
    var params = {};
    (q[1] || '').split('&').forEach(function (kv) { if (kv) { var p = kv.split('='); params[p[0]] = decodeURIComponent(p[1] || ''); } });
    var nom = parts[0] || '';
    if (!estAdmin() && (ROUTES_ADMIN.indexOf(nom) > -1 || (nom === 'valeur' && !voitPrix()) || (nom === 'analyser' && !iaVisiteur()))) { location.hash = '#/'; return; }
    var fn = ROUTES[nom] || vueAccueil;
    $$('#nav a').forEach(function (a) {
      var r = a.getAttribute('data-r');
      a.classList.toggle('active', r === nom || (r === 'cave' && nom === 'bouteille') || (r === 'accords' && nom === 'apporter') || (r === 'ajouter' && nom === 'serie') || (r === 'cave' && nom === 'inventaire'));
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
    if (session.role && session.quota_ia !== undefined) { appliquerRole(); return route(); }
    // Session ouverte avant l'arrivée des rôles : on demande le rôle au serveur
    api('moi').then(function (m) {
      if (!m.role) {
        // Ancien backend : il ne connaît pas encore les rôles. On ne devine rien (refus par défaut), on prévient.
        toast('Le serveur Apps Script n’est pas à jour : remplacez les fichiers .gs, lancez setupApplication, puis Déployer → Nouvelle version.', true);
      }
      session.role = m.role; session.voir_prix = m.voir_prix; session.proprietaire = m.proprietaire;
      session.quota_ia = m.quota_ia; session.ia_restant = m.ia_restant;
      try { sessionStorage.setItem('cave_session', JSON.stringify(session)); } catch (e) {}
      appliquerRole(); route();
    }).catch(fail);
  }

  /* =========================================================
   * Accueil
   * ======================================================= */
  function vueAccueil(v) {
    return Promise.all([charger('dash', 'dashboard', true), charger('vins', 'cave.lister', true), charger('vign', 'cave.vignettes')]).then(function (rr) {
      var d = rr[0], vinsJour = rr[1], vignJour = rr[2];
      var val = d.valeur, m = d.maturite;
      var pv = val.valeur_achat ? Math.round((val.valeur_estimee / val.valeur_achat - 1) * 100) : null;
      var ligne = function (b) {
        return '<tr><td>' + dot(b.couleur) + ' <a href="#/bouteille/' + esc(b.id) + '">' + esc(b.libelle) + '</a></td>' +
          '<td>' + pillMat(b.maturite) + '</td><td class="n">' + b.stock + '</td></tr>';
      };
      v.innerHTML =
        '<div class="head"><h1>Bonjour' + (session.nom && session.nom !== 'Administrateur' ? ' ' + esc(session.nom.split(' ')[0]) : '') + '</h1>' +
        '<span class="spacer"></span><button class="ghost" data-quick="sortie">🍷 J’ai bu une bouteille</button>' +
        '<button class="ghost" data-quick="memo">✎ Garder en mémoire</button><a class="btn" href="#/ajouter">📷 Ajouter en cave</a>' +
        '<a class="btn ghost ia-visiteur-only" href="#/analyser">🔎 Analyser une bouteille</a>' +
        '<a class="btn ghost visiteur-only" href="#/echanges?ecrire=1">💡 Recommander une bouteille</a></div>' +
        (d.echanges_nouveaux ? '<a class="card ap-banner" href="#/echanges" style="margin-bottom:16px"><span class="qi">💬</span><span><strong>' + d.echanges_nouveaux +
          ' nouveau' + (d.echanges_nouveaux > 1 ? 'x' : '') + ' message' + (d.echanges_nouveaux > 1 ? 's' : '') + '</strong><span class="small muted" style="display:block">' +
          (estAdmin() ? 'Avis, envies de goûter ou recommandations de vos invités.' : 'Des bouteilles recommandées par ' + esc(proprio()) + '.') + '</span></span><span class="spacer"></span><span>›</span></a>' : '') +
        blocPropositionDuJour(vinsJour, vignJour) +
        '<div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">' +
          stat(val.nb_bouteilles, 'bouteilles en cave', val.nb_references + ' références') +
          (voitPrix() ? stat(eur(val.valeur_estimee), 'valeur estimée', pv !== null ? '<span class="' + (pv >= 0 ? 'up' : 'down') + '">' + (pv >= 0 ? '+' : '') + pv + ' % vs achat</span>' : '') +
            stat(eur(val.valeur_achat), 'valeur d’achat', val.sans_prix ? val.sans_prix + ' sans prix' : '') : '') +
          stat((m.apogee + m.a_boire_vite + m.passee), 'références à boire', m.apogee + ' à l’apogée') +
        '</div>' +
        '<div class="grid g2" style="margin-top:16px">' +
          '<div class="card"><h2><a class="h-link" href="#/cave?mat=urgent">À boire en priorité ›</a></h2>' +
            (d.a_boire_en_priorite.length ? '<table><tbody>' + d.a_boire_en_priorite.map(ligne).join('') + '</tbody></table>'
              : '<p class="muted">Rien d’urgent : aucune bouteille ne dépasse sa fenêtre.</p>') + '</div>' +
          '<div class="card"><h2><a class="h-link" href="#/cave?mat=apogee">À l’apogée ›</a></h2>' +
            (d.a_l_apogee.length ? '<table><tbody>' + d.a_l_apogee.map(ligne).join('') + '</tbody></table>'
              : '<p class="muted">Aucune bouteille à son apogée cette année.</p>') + '</div>' +
          '<div class="card"><h2><a class="h-link" href="#/cave?vue=maturite">Maturité de la cave ›</a></h2>' + barresMaturite(m) + '</div>' +
          '<div class="card"><h2>Derniers mouvements</h2>' + tableMvts(d.derniers_mouvements, true) +
            '<p class="small"><a href="#/journal">Tout le journal →</a>' +
            (d.prospection_a_acheter ? ' · <a href="#/prospection">' + d.prospection_a_acheter + ' bouteille(s) à acheter</a>' : '') + '</p></div>' +
        '</div>';
      lierPropositionDuJour(vinsJour);
      majBadgeEch(d.echanges_nouveaux);
    });
  }

  function stat(v, l, d) {
    return '<div class="card stat"><div class="v">' + v + '</div><div class="l">' + l + '</div>' + (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  }

  function barresMaturite(m) {
    var total = MATURITE_ORDRE.reduce(function (s, k) { return s + (m[k] || 0); }, 0) || 1;
    return MATURITE_ORDRE.filter(function (k) { return m[k]; }).map(function (k) {
      return '<a class="hbar hbar-link" href="#/cave?mat=' + k + '" title="Voir ces bouteilles"><span>' + pillMat(k) + '</span><div class="track"><div class="fill" style="width:' +
        Math.round(m[k] / total * 100) + '%;background:var(--' + ({ passee: 'bad', a_boire_vite: 'warn', apogee: 'gold', a_boire: 'ok' }[k] || 'info') +
        ')"></div></div><span class="n">' + m[k] + ' réf. ›</span></a>';
    }).join('') || '<p class="muted">Ajoutez des bouteilles pour voir leur maturité.</p>';
  }

  function tableMvts(list, court) {
    if (!list.length) return '<p class="muted">Aucun mouvement.</p>';
    return '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Bouteille</th><th>Type</th><th class="n">Qté</th>' +
      (court ? '' : (voitPrix() ? '<th class="n">Prix u.</th>' : '') + '<th>Détail</th><th></th>') + '</tr></thead><tbody>' +
      list.map(function (m) {
        var q = num(m.quantite);
        return '<tr><td>' + dateFr(m.date) + '</td><td><a href="#/bouteille/' + esc(m.vin_id) + '">' + esc(m.vin_nom || m.vin_id) + '</a></td>' +
          '<td>' + esc(TYPES_MVT[m.type] || m.type) + '</td><td class="n ' + (q > 0 ? 'up' : 'down') + '">' + (q > 0 ? '+' : '') + q + '</td>' +
          (court ? '' : (voitPrix() ? '<td class="n">' + eur(m.prix_unitaire, true) + '</td>' : '') + '<td class="small">' +
            esc([m.fournisseur, m.occasion, m.note].filter(Boolean).join(' · ')) + '</td>' +
            '<td><button class="ghost small" data-del-mvt="' + esc(m.id) + '" title="Supprimer">✕</button></td>') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* =========================================================
   * Cave (liste)
   * ======================================================= */
  var filtres = { q: '', type: '', couleur: '', maturite: '', stock: 'en_stock', tri: 'maturite', vue: 'maturite' };
  try { Object.assign(filtres, JSON.parse(localStorage.getItem('cave_filtres') || '{}')); } catch (e) {}

  var VUES = [['maturite', 'Maturité'], ['type', 'Par type'], ['grille', 'Grille'], ['liste', 'Liste'], ['emplacement', 'Emplacement']];
  /** Groupe d'affichage : couleur pour les vins, catégorie pour les spiritueux. */
  function groupeType(v) {
    if (estSpiritueux(v)) return categorieDe(v) || 'Spiritueux à classer';
    if (/bière/i.test(v.type || '')) return 'Bières';
    return { Rouge: 'Vins rouges', Blanc: 'Vins blancs', Rosé: 'Vins rosés', Effervescent: 'Champagnes et bulles',
      Liquoreux: 'Liquoreux et moelleux', Moelleux: 'Liquoreux et moelleux' }[v.couleur] ||
      (/champagne|crémant/i.test(v.type || '') ? 'Champagnes et bulles' : 'Autres');
  }
  var ORDRE_GROUPES = ['Vins rouges', 'Vins blancs', 'Vins rosés', 'Champagnes et bulles', 'Liquoreux et moelleux']
    .concat(CATEGORIES_SPIRITUEUX.filter(function (c) { return c !== 'Autre'; })).concat(['Autre', 'Spiritueux à classer', 'Bières', 'Autres']);
  function optionsTypes(sel) {
    var simples = TYPES.filter(function (t) { return !/spiritueux|liqueur/i.test(t); });
    return '<option value="">Tous types</option>' + options(simples, sel) +
      '<optgroup label="Spiritueux et liqueurs"><option value="spirits"' + (sel === 'spirits' ? ' selected' : '') + '>Tous les spiritueux</option>' +
      CATEGORIES_SPIRITUEUX.map(function (c) { return '<option value="cat:' + esc(c) + '"' + (sel === 'cat:' + c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '</optgroup>';
  }
  // Sections de la vue « Par maturité », de la plus urgente à la moins urgente
  var SECTIONS_MAT = [
    ['urgent', 'À boire vite', ['passee', 'a_boire_vite'], 'Fenêtre qui se referme ou déjà dépassée'],
    ['apogee', 'À l’apogée', ['apogee'], 'Le meilleur moment pour les ouvrir'],
    ['a_boire', 'À boire', ['a_boire'], 'Prêtes, sans urgence'],
    ['peut_attendre', 'Peut attendre', ['peut_attendre'], 'Ouvrables, mais elles gagneront encore'],
    ['trop_jeune', 'Trop jeune', ['trop_jeune'], 'Patience'],
    ['inconnue', 'Garde non renseignée', ['inconnue'], 'Spiritueux ou fiches à compléter']
  ];


  /* =========================================================
   * Sélection multiple dans la cave : nouvelle analyse IA en lot, emplacement en lot
   * ======================================================= */
  var selCave = { actif: false, ids: {} };
  function nbSel() { return Object.keys(selCave.ids).length; }

  var LIB_CHAMPS = {
    categorie: 'Catégorie', description: 'Description', aromes_nez: 'Nez', aromes_bouche: 'Bouche', temp_service: 'Service',
    carafage: 'Carafage', accords: 'Accords', cepages: 'Cépages', boire_des: 'Buvable dès', apogee_debut: 'Apogée début',
    apogee_fin: 'Apogée fin', boire_avant: 'À boire avant', cote_unitaire: 'Cote (€)', cote_commentaire: 'Commentaire cote'
  };

  /** Dialogue : que faut-il revoir, et comment. */
  function dialogueAnalyseLot(vins, apres) {
    var ids = Object.keys(selCave.ids), n = ids.length;
    modal('<h2>Nouvelle analyse IA</h2><p class="muted" style="margin-top:-4px">' + n + ' bouteille' + (n > 1 ? 's' : '') + ' sélectionnée' + (n > 1 ? 's' : '') +
      ' · ' + Math.ceil(n / 15) + ' requête' + (n > 15 ? 's' : '') + ' IA (15 bouteilles par requête)</p>' +
      '<form id="f-al"><fieldset><legend>À revoir</legend>' +
        '<label class="row" style="font-weight:500;color:var(--ink);margin:4px 0"><input type="checkbox" name="fiche" checked style="width:auto"> Dégustation, service, accords, cépages, catégorie</label>' +
        '<label class="row" style="font-weight:500;color:var(--ink);margin:4px 0"><input type="checkbox" name="garde" checked style="width:auto"> Garde (buvable dès, apogée, à boire avant)</label>' +
        '<label class="row" style="font-weight:500;color:var(--ink);margin:4px 0"><input type="checkbox" name="cote" style="width:auto"> Cote (prix de marché)</label>' +
      '</fieldset><fieldset><legend>Mode</legend>' +
        '<label class="row" style="font-weight:500;color:var(--ink);margin:4px 0"><input type="radio" name="mode" value="vides" checked style="width:auto"> Compléter seulement les champs vides</label>' +
        '<label class="row" style="font-weight:500;color:var(--ink);margin:4px 0"><input type="radio" name="mode" value="remplacer" style="width:auto"> Proposer de remplacer les valeurs actuelles</label>' +
        '<p class="small muted" style="margin:6px 0 0">Rien n’est modifié sans votre accord : vous verrez chaque changement avant de l’appliquer.</p>' +
      '</fieldset><div class="row"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">✨ Lancer l’analyse</button></div></form>',
      function (root) {
        $('#m-annuler', root).onclick = closeModal;
        $('#f-al', root).onsubmit = function (e) {
          e.preventDefault();
          var portees = ['fiche', 'garde', 'cote'].filter(function (p) { return this[p].checked; }, this);
          if (!portees.length) return toast('Cochez au moins un élément à revoir', true);
          var mode = this.mode.value, btn = $('button[type=submit]', this), props = [], i = 0;
          busy(btn, true, '0/' + n);
          (function suivant() {
            if (i >= n) return revueAnalyseLot(vins, props, mode, apres);
            var lot = ids.slice(i, i + 15);
            btn.innerHTML = '<span class="spin"></span> ' + Math.min(i + lot.length, n) + '/' + n;
            api('ia.analyserLot', { ids: lot, portees: portees }).then(function (r) {
              props = props.concat(r.propositions || []); i += lot.length; suivant();
            }).catch(function (err) {
              if (err.code === 'IA_QUOTA' || err.code === 'IA_SATURE') {
                btn.innerHTML = '<span class="spin"></span> pause (' + (err.code === 'IA_QUOTA' ? 'quota' : 'Gemini surchargé') + ')…';
                return setTimeout(suivant, 30000);
              }
              busy(btn, false); fail(err);
            });
          })();
        };
      });
  }

  /** Revue des changements proposés, bouteille par bouteille, puis application groupée. */
  function revueAnalyseLot(vins, props, mode, apres) {
    var parId = {}; vins.forEach(function (v) { parId[v.id] = v; });
    var vide = function (x) { return x === '' || x === undefined || x === null; };
    var pareil = function (a, b) { return String(a === undefined || a === null ? '' : a).trim().toLowerCase() === String(b === undefined || b === null ? '' : b).trim().toLowerCase(); };
    var court = function (x) { x = String(x === undefined || x === null ? '' : x); return x.length > 70 ? x.slice(0, 68) + '…' : x; };
    var lignes = props.map(function (p) {
      var v = parId[p.id]; if (!v) return null;
      var ch = {};
      Object.keys(p.champs).forEach(function (c) {
        var nv = p.champs[c];
        if (vide(nv) || pareil(nv, v[c])) return;
        if (c === 'categorie' && !estSpiritueux(v)) return;
        if (mode === 'vides' && !vide(v[c])) return;
        ch[c] = nv;
      });
      return Object.keys(ch).length ? { v: v, ch: ch } : null;
    }).filter(Boolean);
    if (!lignes.length) { closeModal(); return toast('L’IA ne propose aucun changement pour cette sélection.'); }
    modal('<h2>Changements proposés</h2><p class="muted" style="margin-top:-4px">' + lignes.length + ' bouteille' + (lignes.length > 1 ? 's' : '') +
      ' concernée' + (lignes.length > 1 ? 's' : '') + '. Décochez celles à ne pas modifier.</p>' +
      '<div class="rev-list">' + lignes.map(function (l, k) {
        return '<div class="rev-item"><label class="row" style="font-weight:600;color:var(--ink);margin:0;flex-wrap:nowrap"><input type="checkbox" data-rev="' + k + '" checked style="width:auto">' +
          '<span>' + esc(libelle(l.v)) + (l.v.millesime ? ' ' + esc(l.v.millesime) : '') + '</span></label>' +
          '<ul class="rev-ch">' + Object.keys(l.ch).map(function (c) {
            return '<li><strong>' + esc(LIB_CHAMPS[c] || c) + ' :</strong> ' + (vide(l.v[c]) ? '<span class="muted">vide</span>' : '<s class="muted">' + esc(court(l.v[c])) + '</s>') +
              ' → ' + esc(court(l.ch[c])) + '</li>';
          }).join('') + '</ul></div>';
      }).join('') + '</div>' +
      '<div class="row" style="margin-top:12px"><button type="button" class="ghost small" id="rev-tout">Tout cocher / décocher</button><span class="spacer"></span>' +
      '<button type="button" class="ghost" id="m-annuler">Annuler</button><button id="rev-ok">Appliquer</button></div>',
      function (root) {
        $('#m-annuler', root).onclick = closeModal;
        $('#rev-tout', root).onclick = function () {
          var cases = $$('[data-rev]', root), tous = cases.every(function (c) { return c.checked; });
          cases.forEach(function (c) { c.checked = !tous; });
        };
        $('#rev-ok', root).onclick = function () {
          var maj = $$('[data-rev]', root).filter(function (c) { return c.checked; }).map(function (c) {
            var l = lignes[num(c.getAttribute('data-rev'))], m = Object.assign({ id: l.v.id }, l.ch);
            if (l.ch.cote_unitaire) { m.cote_date = today(); m.cote_source = 'ia'; }
            return m;
          });
          if (!maj.length) return closeModal();
          var bt = this; busy(bt, true);
          api('cave.majLot', { maj: maj }).then(function (r) {
            closeModal(); toast(r.maj + ' fiche' + (r.maj > 1 ? 's' : '') + ' mise' + (r.maj > 1 ? 's' : '') + ' à jour');
            selCave.ids = {}; invalider(); apres();
          }).catch(function (e) { busy(bt, false); fail(e); });
        };
      });
  }

  function dialogueEmplacementLot(vins, apres) {
    var ids = Object.keys(selCave.ids);
    var lieux = vins.map(function (x) { return x.emplacement; }).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; });
    modal('<h2>Changer l’emplacement</h2><p class="muted" style="margin-top:-4px">' + ids.length + ' référence(s) sélectionnée(s)</p>' +
      '<form id="f-el"><label for="el-v">Nouvel emplacement</label><input id="el-v" list="dl-el" required>' +
      '<datalist id="dl-el">' + lieux.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
      '<div class="row" style="margin-top:12px"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">Déplacer</button></div></form>',
      function (root) {
        $('#m-annuler', root).onclick = closeModal;
        $('#f-el', root).onsubmit = function (e) {
          e.preventDefault();
          var val = $('#el-v', root).value.trim(), bt = $('button[type=submit]', this); busy(bt, true);
          api('cave.majLot', { maj: ids.map(function (id) { return { id: id, emplacement: val }; }) }).then(function (r) {
            closeModal(); toast(r.maj + ' référence(s) déplacée(s) : ' + val); selCave.ids = {}; invalider(); apres();
          }).catch(function (e2) { busy(bt, false); fail(e2); });
        };
      });
  }

  /* =========================================================
   * Accès au site (administrateurs) : qui peut se connecter, avec quels droits
   * ======================================================= */
  var ROLES_ACCES = [['visiteur', 'Visiteur (consultation)'], ['admin', 'Administrateur (tout)']];
  var dernierAjout = '';

  function texteInvitation(u) {
    var site = location.origin + location.pathname.replace(/index\.html$/, '');
    return 'Bonjour' + (u.nom ? ' ' + u.nom : '') + ',\n\n' +
      'Je t’ai ouvert un accès ' + (u.role === 'admin' ? 'complet' : 'en consultation') + ' à ma cave : ' + site + '\n\n' +
      'Pour te connecter, clique sur « Se connecter avec Google » et choisis l’adresse ' + u.email + '.\n\n' +
      'Pas de compte Google avec cette adresse ? Tu peux en créer un gratuitement, sans ouvrir de boîte Gmail : ' +
      'https://accounts.google.com/signup puis « Utiliser mon adresse e-mail actuelle » (un code de vérification est envoyé sur ta boîte).\n\n' +
      'À bientôt !';
  }
  function lienInvitation(u) {
    return 'mailto:' + u.email + '?subject=' + encodeURIComponent('Accès à ma cave') + '&body=' + encodeURIComponent(texteInvitation(u));
  }

  function vueAcces(v) {
    return api('users.lister').then(function (users) {
      var parEmail = {}; users.forEach(function (u) { parEmail[u.email] = u; });
      var quand = function (d) {
        if (!d) return '<span class="muted">jamais</span>';
        d = String(d); return dateFr(d) + (d.length > 15 ? ' ' + d.slice(11, 16).replace(':', 'h') : '');
      };
      var nouveau = parEmail[dernierAjout];
      v.innerHTML =
        '<div class="head"><h1>Accès au site</h1><span class="muted">' + users.filter(function (u) { return u.actif; }).length + ' accès actif(s)</span></div>' +
        (nouveau ? '<div class="dup-box" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:220px"><strong>' +
          esc(nouveau.nom || nouveau.email) + '</strong> peut maintenant se connecter. Envoyez-lui le lien du site :</span>' +
          '<a class="btn small" href="' + esc(lienInvitation(nouveau)) + '">✉ Préparer l’e-mail</a>' +
          '<button class="ghost small" data-copier="' + esc(nouveau.email) + '">Copier le message (SMS, WhatsApp…)</button></div>' : '') +
        '<div class="grid g2">' +
          '<div class="card"><h2>Ajouter une personne</h2>' +
            '<form id="f-user"><div class="grid g2" style="gap:10px">' +
              '<div><label for="u-email">Adresse e-mail</label><input id="u-email" type="email" required autocomplete="off" placeholder="prenom.nom@exemple.fr"></div>' +
              '<div><label for="u-nom">Prénom ou nom</label><input id="u-nom" autocomplete="off" placeholder="ex. Marie"></div></div>' +
              '<label for="u-role">Rôle</label><select id="u-role">' + options(ROLES_ACCES, 'visiteur') + '</select>' +
              '<label class="row" style="font-weight:500;color:var(--ink);margin:10px 0 0"><input type="checkbox" id="u-prix" style="width:auto"> Voir les prix, cotes et la valeur de la cave</label>' +
              '<div class="row" style="margin-top:10px;gap:8px"><label for="u-ia" style="margin:0;font-weight:500;color:var(--ink)">Analyses IA par jour</label>' +
                '<input id="u-ia" type="number" min="0" max="50" value="0" style="width:80px"><span class="small muted">0 = pas d’IA</span></div>' +
              '<p class="small muted" style="margin:8px 0 0">Un visiteur consulte la cave, les fiches, la maturité, les accords et les dégustations, sans rien pouvoir modifier. ' +
                'Il peut donner son avis sur une bouteille, dire qu’il aimerait la goûter et vous recommander des bouteilles (page Échanges). ' +
                'Avec des analyses IA, il peut aussi analyser une bouteille (photo ou nom) et demander au sommelier quoi boire avec un plat : ' +
                'chaque analyse consomme une requête de votre quota Gemini, dans la limite d’un plafond commun à tous les invités (onglet CONFIG, ia_visiteurs_max_jour).</p>' +
              '<div class="row" style="margin-top:12px"><span class="spacer"></span><button type="submit">Ajouter</button></div></form></div>' +
          '<div class="card"><h2>Comment se connecter ?</h2>' +
            '<p>Chaque personne clique sur <strong>« Se connecter avec Google »</strong> et choisit l’adresse inscrite ici.</p>' +
            '<p><strong>Pas d’adresse Gmail ?</strong> Pas besoin d’en créer une : un compte Google peut utiliser n’importe quelle adresse (Hotmail, Orange, Free, adresse pro…). ' +
              'Sur <a href="https://accounts.google.com/signup" target="_blank" rel="noopener noreferrer">accounts.google.com/signup</a>, choisir <em>« Utiliser mon adresse e-mail actuelle »</em>, puis saisir le code reçu par e-mail. ' +
              'Le message d’invitation (✉) l’explique.</p>' +
            '<p class="small muted">Si l’écran de consentement OAuth de votre projet Google Cloud est en mode « Test », ajoutez aussi l’adresse dans ses utilisateurs test, ou publiez l’application (seuls les scopes de base sont demandés, sans validation par Google).</p></div>' +
        '</div>' +
        '<div class="card" style="margin-top:16px;padding:0"><div class="table-wrap"><table class="acces"><thead><tr><th>Personne</th><th>Rôle</th><th>Prix</th><th>IA / jour</th><th>Actif</th><th>Dernière connexion</th><th></th></tr></thead><tbody>' +
          users.map(function (u) {
            var verrou = u.moi || u.proprietaire;
            return '<tr data-u="' + esc(u.email) + '"' + (u.actif ? '' : ' class="inactif"') + '><td><strong>' + esc(u.nom || u.email.split('@')[0]) + '</strong>' +
              (u.moi ? ' <span class="pill">vous</span>' : u.proprietaire ? ' <span class="pill">propriétaire</span>' : '') +
              '<div class="small muted">' + esc(u.email) + '</div></td>' +
              '<td><select data-champ="role"' + (verrou ? ' disabled' : '') + ' aria-label="Rôle de ' + esc(u.email) + '">' + options(ROLES_ACCES, u.role) + '</select></td>' +
              '<td><input type="checkbox" data-champ="voir_prix"' + (u.voir_prix ? ' checked' : '') + (u.role === 'admin' ? ' disabled' : '') + ' aria-label="Voir les prix" style="width:auto"></td>' +
              '<td>' + (u.role === 'admin' ? '<span class="small muted">illimitée</span>' : '<input type="number" min="0" max="50" data-champ="quota_ia" value="' + num(u.quota_ia) + '" aria-label="Analyses IA par jour" style="width:64px;padding:4px 6px">' +
                (u.ia_jour ? '<div class="small muted">' + u.ia_jour + ' aujourd’hui</div>' : '')) + '</td>' +
              '<td><input type="checkbox" data-champ="actif"' + (u.actif ? ' checked' : '') + (verrou ? ' disabled' : '') + ' aria-label="Accès actif" style="width:auto"></td>' +
              '<td class="small">' + quand(u.derniere_connexion) + (u.sessions ? '<div class="muted">' + u.sessions + ' session' + (u.sessions > 1 ? 's' : '') + ' ouverte' + (u.sessions > 1 ? 's' : '') + '</div>' : '') + '</td>' +
              '<td class="n"><div class="row" style="gap:4px;justify-content:flex-end;flex-wrap:nowrap">' +
                (u.moi ? '' : '<a class="btn ghost small" href="' + esc(lienInvitation(u)) + '" title="Préparer un e-mail d’invitation">✉</a>' +
                  '<button class="ghost small" data-copier="' + esc(u.email) + '" title="Copier le message d’invitation">⧉</button>') +
                (!u.moi && u.sessions ? '<button class="ghost small" data-act="deco" title="Fermer ses sessions ouvertes">⏻</button>' : '') +
                (verrou ? '' : '<button class="ghost small" data-act="suppr" title="Supprimer cet accès">🗑</button>') +
              '</div></td></tr>';
          }).join('') + '</tbody></table></div></div>' +
        '<p class="small muted" style="margin-top:10px">Un changement de rôle, de prix ou la désactivation ferme aussitôt les sessions ouvertes de la personne : elle se reconnecte avec ses nouveaux droits. ' +
          'Les droits sont vérifiés par le serveur à chaque action, pas seulement à l’affichage.</p>';

      var reafficher = function () { route(); };
      $('#f-user').onsubmit = function (e) {
        e.preventDefault();
        var bt = $('button[type=submit]', this), email = $('#u-email').value.trim().toLowerCase();
        busy(bt, true);
        api('users.enregistrer', { nouveau: true, email: email, nom: $('#u-nom').value.trim(), role: $('#u-role').value, voir_prix: $('#u-prix').checked, quota_ia: $('#u-ia').value })
          .then(function () { dernierAjout = email; toast('Accès ajouté'); reafficher(); })
          .catch(function (err) { busy(bt, false); fail(err); });
      };
      var majPrix = function () { var adm = $('#u-role').value === 'admin'; $('#u-prix').disabled = adm; $('#u-ia').disabled = adm; if (adm) $('#u-prix').checked = true; };
      $('#u-role').onchange = majPrix;
      $$('[data-u] [data-champ]').forEach(function (el) {
        el.onchange = function () {
          var u = parEmail[el.closest('[data-u]').getAttribute('data-u')];
          var maj = { email: u.email, nom: u.nom, role: u.role, voir_prix: u.voir_prix, actif: u.actif, quota_ia: u.quota_ia };
          maj[el.getAttribute('data-champ')] = el.type === 'checkbox' ? el.checked : el.value;
          api('users.enregistrer', maj).then(function (r) {
            toast('Accès mis à jour' + (r.sessions_fermees ? ' (' + r.sessions_fermees + ' session' + (r.sessions_fermees > 1 ? 's' : '') + ' fermée' + (r.sessions_fermees > 1 ? 's' : '') + ')' : ''));
            reafficher();
          }).catch(function (err) { fail(err); reafficher(); });
        };
      });
      $$('[data-copier]').forEach(function (b) {
        b.onclick = function () {
          var txt = texteInvitation(parEmail[b.getAttribute('data-copier')]);
          var ok = function () { toast('Message copié : collez-le dans un SMS ou un e-mail'); };
          try { navigator.clipboard.writeText(txt).then(ok, function () { window.prompt('Copiez le message :', txt); }); }
          catch (err) { window.prompt('Copiez le message :', txt); }
        };
      });
      $$('[data-act]').forEach(function (b) {
        b.onclick = function () {
          var u = parEmail[b.closest('[data-u]').getAttribute('data-u')], act = b.getAttribute('data-act');
          if (act === 'suppr' && !window.demoConfirm('Supprimer l’accès de ' + (u.nom || u.email) + ' ? Ses sessions ouvertes seront fermées.')) return;
          busy(b, true);
          api(act === 'suppr' ? 'users.supprimer' : 'users.deconnecter', { email: u.email }).then(function (r) {
            if (dernierAjout === u.email) dernierAjout = '';
            toast(act === 'suppr' ? 'Accès supprimé' : r.sessions_fermees + ' session(s) fermée(s)');
            reafficher();
          }).catch(function (err) { busy(b, false); fail(err); });
        };
      });
    });
  }

  /* =========================================================
   * Échanges : avis et envies des visiteurs, recommandations dans les deux sens
   * ======================================================= */
  var TYPES_ECH = { avis: ['✍', 'Avis de dégustation'], envie: ['🙋', 'Aimerait la goûter'], reco: ['💡', 'Recommandation'], selection: ['🛒', 'Sélection sur une offre'] };
  function proprio() { return (session && session.proprietaire) || 'le propriétaire'; }
  function majBadgeEch(n) {
    var b = $('#nb-ech'); if (!b) return;
    b.textContent = n > 9 ? '9+' : String(n || '');
    b.hidden = !n;
  }
  function libEch(x) { return [x.domaine, x.nom].filter(Boolean).join(' · ') + (x.millesime ? ' ' + x.millesime : '') || 'Bouteille'; }

  /** Bloc de la fiche : avis des visiteurs, envies, et boutons selon le rôle. */
  function blocAvis(b) {
    var avis = (b.avis || []).filter(function (a) { return a.type === 'avis'; });
    var envies = (b.avis || []).filter(function (a) { return a.type === 'envie'; });
    var moy = avis.filter(function (a) { return a.note !== '' && a.note !== undefined; });
    var suppr = function (a) { return estAdmin() || a.moi ? ' <button class="ghost small lien-suppr" data-suppr-ech="' + esc(a.id) + '" title="Supprimer">✕</button>' : ''; };
    var dejaEnvie = envies.some(function (a) { return a.moi; });
    return '<div class="card"><h3>Avis des invités' + (moy.length ? ' <span class="small muted">· ' +
        (moy.reduce(function (s, a) { return s + num(a.note); }, 0) / moy.length).toFixed(1).replace('.0', '') + '/20 (' + moy.length + ')</span>' : '') + '</h3>' +
      (avis.length ? '<ul class="avis">' + avis.map(function (a) {
        return '<li><div class="row" style="gap:6px"><strong>' + esc(a.de_nom) + '</strong>' + (a.note !== '' && a.note !== undefined ? '<span class="pill">' + esc(a.note) + '/20</span>' : '') +
          '<span class="small muted">' + dateFr(a.cree_le) + '</span>' + suppr(a) + '</div>' + (a.message ? '<p>' + esc(a.message) + '</p>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="muted">Aucun avis pour l’instant.</p>') +
      (envies.length ? '<p class="small" style="margin:8px 0 0">🙋 ' + envies.map(function (a) { return esc(a.moi ? 'Vous' : a.de_nom) + suppr(a); }).join(', ') +
        (envies.length > 1 ? ' aimeraient' : envies[0].moi ? ' aimeriez' : ' aimerait') + ' la goûter.</p>' : '') +
      '<div class="row" style="margin-top:10px">' +
        (estAdmin() ? '<button class="ghost small" id="ech-reco">💌 Recommander à…</button>'
          : (dejaEnvie ? '' : '<button class="ghost small" id="ech-envie">🙋 J’aimerais la goûter</button>') +
            '<button class="small" id="ech-avis">✍ Je l’ai goûtée : mon avis</button>') +
      '</div></div>';
  }

  function lierAvis(b, apres) {
    if ($('#ech-avis')) $('#ech-avis').onclick = function () { dialogueAvis(b, apres); };
    if ($('#ech-envie')) $('#ech-envie').onclick = function () { dialogueEnvie(b, apres); };
    if ($('#ech-reco')) $('#ech-reco').onclick = function () { dialogueRecoVin(b, apres); };
    $$('[data-suppr-ech]').forEach(function (x) {
      x.onclick = function () {
        if (!window.demoConfirm('Supprimer ce message ?')) return;
        api('echanges.supprimer', { id: x.getAttribute('data-suppr-ech') }).then(function () { toast('Supprimé'); apres(); }).catch(fail);
      };
    });
  }

  function envoyerEch(btn, data, msg, apres) {
    busy(btn, true);
    return api('echanges.envoyer', data).then(function (r) {
      closeModal(); toast(r.deja ? 'C’était déjà noté' : msg); if (apres) apres();
    }).catch(function (e) { busy(btn, false); fail(e); });
  }

  function dialogueAvis(b, apres) {
    modal('<h2>Mon avis</h2><p class="muted" style="margin-top:-4px">' + esc(libelle(b)) + (b.millesime ? ' ' + esc(b.millesime) : '') + '</p>' +
      '<form id="f-avis"><label for="av-note">Note sur 20 (facultative)</label><input id="av-note" type="number" min="0" max="20" step="0.5" inputmode="decimal" style="max-width:120px">' +
      '<label for="av-msg">Impressions</label><textarea id="av-msg" maxlength="1000" placeholder="ex. Superbe sur le gigot, encore un peu jeune, beaucoup de fruit…"></textarea>' +
      '<p class="small muted">Visible par ' + esc(proprio()) + ' et sur la fiche de la bouteille.</p>' +
      '<div class="row"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">Envoyer</button></div></form>',
      function (root) {
        $('#m-annuler', root).onclick = closeModal;
        $('#f-avis', root).onsubmit = function (e) {
          e.preventDefault();
          var note = $('#av-note', root).value.trim(), msg = $('#av-msg', root).value.trim();
          if (!note && !msg) return toast('Donnez une note ou quelques mots', true);
          envoyerEch($('button[type=submit]', this), { type: 'avis', vin_id: b.id, note: note, message: msg }, 'Merci pour votre avis !', apres);
        };
      });
  }

  function dialogueEnvie(b, apres) {
    modal('<h2>J’aimerais la goûter</h2><p class="muted" style="margin-top:-4px">' + esc(libelle(b)) + (b.millesime ? ' ' + esc(b.millesime) : '') + '</p>' +
      '<form id="f-envie"><label for="en-msg">Un mot pour ' + esc(proprio()) + ' (facultatif)</label>' +
      '<textarea id="en-msg" maxlength="1000" placeholder="ex. Pour notre prochain dîner ensemble ?"></textarea>' +
      '<div class="row"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">🙋 Envoyer</button></div></form>',
      function (root) {
        $('#m-annuler', root).onclick = closeModal;
        $('#f-envie', root).onsubmit = function (e) {
          e.preventDefault();
          envoyerEch($('button[type=submit]', this), { type: 'envie', vin_id: b.id, message: $('#en-msg', root).value.trim() }, 'C’est noté : ' + proprio() + ' le verra', apres);
        };
      });
  }

  /** Administrateur : recommander une bouteille de la cave à un ou plusieurs visiteurs. */
  function dialogueRecoVin(b, apres) {
    api('users.lister').then(function (users) {
      var dest = users.filter(function (u) { return u.actif && !u.moi; });
      if (!dest.length) return toast('Ajoutez d’abord des personnes dans « Accès »', true);
      modal('<h2>Recommander cette bouteille</h2><p class="muted" style="margin-top:-4px">' + esc(libelle(b)) + (b.millesime ? ' ' + esc(b.millesime) : '') + '</p>' +
        '<form id="f-rv"><fieldset><legend>À qui ?</legend>' + choixDestinataires(dest) + '</fieldset>' +
        '<label for="rv-msg">Message</label><textarea id="rv-msg" maxlength="1000" placeholder="ex. À ouvrir sur une belle pièce de bœuf, carafée une heure."></textarea>' +
        '<div class="row"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">💌 Envoyer</button></div></form>',
        function (root) {
          $('#m-annuler', root).onclick = closeModal;
          $('#f-rv', root).onsubmit = function (e) {
            e.preventDefault();
            var pour = $$('[name=pour]:checked', root).map(function (c) { return c.value; });
            if (!pour.length) return toast('Choisissez au moins une personne', true);
            envoyerEch($('button[type=submit]', this), { type: 'reco', vin_id: b.id, pour: pour, message: $('#rv-msg', root).value.trim() },
              'Recommandation envoyée à ' + pour.length + ' personne' + (pour.length > 1 ? 's' : ''), apres);
          };
        });
    }).catch(fail);
  }
  function choixDestinataires(dest) {
    return '<div class="dest">' + dest.map(function (u) {
      return '<label class="row"><input type="checkbox" name="pour" value="' + esc(u.email) + '" style="width:auto"> ' + esc(u.nom || u.email) +
        (u.role === 'admin' ? ' <span class="small muted">(administrateur)</span>' : '') + '</label>';
    }).join('') + '</div>';
  }

  function vueEchanges(v, _id, params) {
    return Promise.all([api('echanges.lister'), estAdmin() ? charger('vins', 'cave.lister') : Promise.resolve([])]).then(function (rr) {
      var r = rr[0], vins = rr[1], items = r.items || [];
      if (session) session.proprietaire = r.proprietaire;
      var recus = items.filter(function (x) { return x.recu; });
      var envoyes = items.filter(function (x) { return x.envoye; });
      var nouveaux = recus.filter(function (x) { return x.statut === 'nouveau'; }).map(function (x) { return x.id; });
      // Envois groupés (une recommandation à plusieurs personnes) : une seule carte
      var groupes = [], vu = {};
      envoyes.forEach(function (x) {
        var k = x.groupe || x.id;
        if (vu[k]) return vu[k].dest.push(x);
        vu[k] = { x: x, dest: [x] }; groupes.push(vu[k]);
      });
      var bouteille = function (x) {
        var t = esc(libEch(x)) + (x.appellation && x.nom !== x.appellation ? ' <span class="muted">· ' + esc(x.appellation) + '</span>' : '');
        if (x.offre_id) return '<a href="#/offres/' + esc(x.offre_id) + '">' + esc([x.domaine, x.nom].filter(Boolean).join(' · ')) + '</a>' + (x.prix ? ' <span class="pill">' + eur(x.prix, true) + '</span>' : '');
        return x.vin_id ? '<a href="#/bouteille/' + esc(x.vin_id) + '">' + t + '</a>' : t;
      };
      var carte = function (x, dest) {
        var ty = TYPES_ECH[x.type] || ['•', x.type];
        var qui = x.recu ? 'De <strong>' + esc(x.de_nom) + '</strong>'
          : 'À ' + (dest || [x]).map(function (d) { return '<strong>' + esc(d.pour === 'admin' ? r.proprietaire : d.pour_nom) + '</strong>' +
              (d.statut === 'nouveau' ? ' <span class="small muted">(pas encore lu)</span>' : ''); }).join(', ');
        return '<div class="card ech' + (nouveaux.indexOf(x.id) > -1 ? ' ech-new' : '') + '">' +
          '<div class="row" style="gap:8px"><span class="qi">' + ty[0] + '</span><div style="flex:1;min-width:0"><div class="small muted">' + ty[1] + ' · ' + qui + ' · ' + dateFr(x.cree_le) + '</div>' +
          '<div class="t">' + bouteille(x) + (x.type === 'avis' && x.note !== '' ? ' <span class="pill">' + esc(x.note) + '/20</span>' : '') + '</div></div></div>' +
          (x.message ? '<p style="margin:8px 0 0;white-space:pre-wrap">' + esc(x.message) + '</p>' : '') +
          (!x.offre_id && (x.lieu || x.prix) ? '<p class="small muted" style="margin:6px 0 0">' + [x.lieu ? 'Où : ' + esc(x.lieu) : '', x.prix ? 'Prix : ' + eur(x.prix) : ''].filter(Boolean).join(' · ') + '</p>' : '') +
          '<div class="row" style="margin-top:8px;justify-content:flex-end">' +
            (x.recu && x.type === 'reco' && !x.vin_id && estAdmin() ? (x.statut === 'traite' ? '<span class="small muted">Ajoutée à la prospection</span>'
              : '<button class="ghost small" data-prosp="' + esc(x.id) + '">→ Prospection</button>') : '') +
            (x.envoye || estAdmin() ? '<button class="ghost small" data-suppr-ech="' + esc(x.id) + '"' + (dest && dest.length > 1 ? ' data-groupe="' + esc(dest.map(function (d) { return d.id; }).join(',')) + '"' : '') + '>Supprimer</button>' : '') +
          '</div></div>';
      };
      var form = estAdmin()
        ? '<form id="f-reco" class="card"><h2>Recommander une bouteille</h2>' +
            (r.visiteurs && r.visiteurs.length ? '<fieldset><legend>À qui ?</legend>' + choixDestinataires(r.visiteurs) + '</fieldset>' : '<p class="muted">Ajoutez d’abord des personnes dans <a href="#/acces">Accès</a>.</p>') +
            '<label for="rc-vin">Bouteille</label><select id="rc-vin"><option value="">Autre bouteille (hors cave)</option>' +
              vins.filter(function (x) { return x.stock > 0; }).sort(function (a, b) { return libelle(a).localeCompare(libelle(b)); }).map(function (x) {
                return '<option value="' + esc(x.id) + '">' + esc(libelle(x) + (x.millesime ? ' ' + x.millesime : '')) + '</option>'; }).join('') + '</select>'
        : '<form id="f-reco" class="card"><h2>Recommander une bouteille à ' + esc(r.proprietaire) + '</h2>' +
            '<p class="small muted" style="margin-top:-4px">Pour donner votre avis sur une bouteille de la cave, ou dire que vous aimeriez la goûter, ouvrez sa fiche depuis <a href="#/cave">la cave</a>.</p>';
      form += '<div id="rc-libre"><div class="grid g2" style="gap:10px">' +
          '<div><label for="rc-dom">Domaine / producteur</label><input id="rc-dom" maxlength="120" placeholder="ex. Domaine Gauby"></div>' +
          '<div><label for="rc-nom">Cuvée</label><input id="rc-nom" maxlength="120" placeholder="ex. Vieilles Vignes"></div>' +
          '<div><label for="rc-mil">Millésime</label><input id="rc-mil" maxlength="10" inputmode="numeric" placeholder="ex. 2021"></div>' +
          '<div><label for="rc-cou">Couleur</label><select id="rc-cou">' + options(COULEURS, '', '-') + '</select></div>' +
          '<div><label for="rc-lieu">Où la trouver</label><input id="rc-lieu" maxlength="120" placeholder="ex. Caviste de la place, salon…"></div>' +
          '<div><label for="rc-prix">Prix approximatif (€)</label><input id="rc-prix" type="number" min="0" step="0.5" inputmode="decimal"></div></div></div>' +
        '<label for="rc-msg">Pourquoi ?</label><textarea id="rc-msg" maxlength="1000" placeholder="ex. Bue chez des amis, superbe sur un poisson, très bon rapport qualité-prix."></textarea>' +
        '<div class="row" style="margin-top:10px"><span class="spacer"></span><button type="submit">💡 Envoyer</button></div></form>';

      v.innerHTML = '<div class="head"><h1>Échanges</h1><span class="muted">' + (estAdmin() ? 'avis, envies et recommandations de vos invités' : 'avec ' + esc(r.proprietaire)) + '</span></div>' +
        '<div class="grid g2 ech-grid"><div>' +
          '<h2>Reçus' + (nouveaux.length ? ' <span class="nav-badge">' + nouveaux.length + '</span>' : '') + '</h2>' +
          (recus.length ? recus.map(function (x) { return carte(x); }).join('') : '<div class="card empty">' + (estAdmin()
            ? 'Rien pour l’instant. Vos invités peuvent donner leur avis ou dire qu’ils aimeraient goûter une bouteille depuis sa fiche, et vous recommander des bouteilles ici.'
            : 'Les bouteilles que ' + esc(r.proprietaire) + ' vous recommande apparaîtront ici.') + '</div>') +
          (groupes.length ? '<h2 style="margin-top:22px">Envoyés</h2>' + groupes.map(function (g) { return carte(g.x, g.dest); }).join('') : '') +
        '</div><div>' + form + '</div></div>';

      var recharger = function () { route(); };
      var majLibre = function () { if ($('#rc-vin')) $('#rc-libre').hidden = !!$('#rc-vin').value; };
      if ($('#rc-vin')) { $('#rc-vin').onchange = majLibre; majLibre(); }
      $('#f-reco').onsubmit = function (e) {
        e.preventDefault();
        var d = { type: 'reco', message: $('#rc-msg').value.trim() };
        if ($('#rc-vin') && $('#rc-vin').value) d.vin_id = $('#rc-vin').value;
        else {
          d.domaine = $('#rc-dom').value.trim(); d.nom = $('#rc-nom').value.trim(); d.millesime = $('#rc-mil').value.trim();
          d.couleur = $('#rc-cou').value; d.lieu = $('#rc-lieu').value.trim(); d.prix = $('#rc-prix').value;
          if (!d.domaine && !d.nom) return toast('Indiquez au moins le domaine ou la cuvée', true);
        }
        if (estAdmin()) {
          d.pour = $$('#f-reco [name=pour]:checked').map(function (c) { return c.value; });
          if (!d.pour.length) return toast('Choisissez au moins une personne', true);
        }
        envoyerEch($('#f-reco button[type=submit]'), d, estAdmin() ? 'Recommandation envoyée' : 'Merci, ' + r.proprietaire + ' la verra dans ses échanges', recharger);
      };
      $$('[data-prosp]').forEach(function (bt) {
        bt.onclick = function () {
          var x = items.filter(function (i) { return i.id === bt.getAttribute('data-prosp'); })[0];
          busy(bt, true);
          api('prosp.enregistrer', { domaine: x.domaine, nom: x.nom, millesime: x.millesime, couleur: x.couleur, appellation: x.appellation,
            type: 'Vin', prix_vu: x.prix, lieu: x.lieu, origine: 'recommandation', statut: 'repere', date_vue: today(),
            note: 'Recommandée par ' + x.de_nom + (x.message ? ' : ' + x.message : '') })
            .then(function () { return api('echanges.marquer', { ids: [x.id], statut: 'traite' }); })
            .then(function () { toast('Ajoutée à la prospection'); recharger(); })
            .catch(function (e) { busy(bt, false); fail(e); });
        };
      });
      $$('[data-suppr-ech]').forEach(function (x) {
        x.onclick = function () {
          if (!window.demoConfirm('Supprimer ce message ?')) return;
          var ids = (x.getAttribute('data-groupe') || x.getAttribute('data-suppr-ech')).split(',');
          Promise.all(ids.map(function (id) { return api('echanges.supprimer', { id: id }); }))
            .then(function () { toast('Supprimé'); recharger(); }).catch(fail);
        };
      });
      if (params && params.ecrire) setTimeout(function () { $('#f-reco').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#rc-dom') && $('#rc-dom').focus({ preventScroll: true }); }, 50);
      // Ouvrir la page vaut lecture : les nouveautés reçues passent en « lu »
      if (nouveaux.length) api('echanges.marquer', { ids: nouveaux }).then(function () { majBadgeEch(0); }).catch(function () {});
      else majBadgeEch(0);
    });
  }

  /* =========================================================
   * Analyser une bouteille (visiteur à qui l'IA est ouverte) : fiche complète, rien n'est enregistré
   * ======================================================= */
  function maturiteLocale(v) {   // même règle que maturite_ côté serveur
    var an = ANNEE, des = num(v.boire_des), ad = num(v.apogee_debut), af = num(v.apogee_fin), av = num(v.boire_avant);
    if (!des && !ad && !af && !av) return 'inconnue';
    if (av && an > av) return 'passee';
    if (ad && af && an >= ad && an <= af) return 'apogee';
    if (af && an > af) return 'a_boire_vite';
    if (av && an >= av - 1) return 'a_boire_vite';
    if (des && an < des) return 'trop_jeune';
    if (ad && an < ad) return 'peut_attendre';
    return 'a_boire';
  }

  function vueAnalyser(v) {
    return charger('vins', 'cave.lister').then(function (vins) {
      var photo = null, mode = 'photo';
      v.innerHTML = '<div class="head"><h1>Analyser une bouteille</h1><span class="muted ia-restant">' + texteIaRestant() + '</span></div>' +
        '<p class="muted" style="margin-top:-6px">Au restaurant, chez un caviste ou chez des amis : photographiez l’étiquette ou donnez le nom de la bouteille. ' +
          'L’IA décrit le vin, sa garde et ses accords. Rien n’est enregistré.</p>' +
        '<div class="card"><div class="seg" role="tablist" id="an-mode"><button data-m="photo" aria-selected="true">📷 Photo</button><button data-m="nom" aria-selected="false">✎ Nom</button></div>' +
          '<div id="an-photo"><div class="drop" id="an-drop" tabindex="0" role="button" aria-label="Prendre ou choisir une photo"><div id="an-drop-in">📷<br>Prendre ou choisir une photo de l’étiquette</div></div>' +
            '<input type="file" id="an-file" accept="image/*" capture="environment" hidden>' +
            '<label for="an-indice">Précision (facultatif)</label><input id="an-indice" maxlength="200" placeholder="ex. magnum, millésime sur la contre-étiquette…"></div>' +
          '<div id="an-nom" hidden><div class="grid g2" style="gap:10px">' +
            '<div><label for="an-dom">Domaine / producteur</label><input id="an-dom" maxlength="120" placeholder="ex. Château Talbot"></div>' +
            '<div><label for="an-cuv">Cuvée</label><input id="an-cuv" maxlength="120"></div>' +
            '<div><label for="an-mil">Millésime</label><input id="an-mil" maxlength="10" inputmode="numeric"></div>' +
            '<div><label for="an-app">Appellation</label><input id="an-app" maxlength="120"></div></div></div>' +
          '<div class="row" style="margin-top:12px"><span class="spacer"></span><button id="an-go">✨ Analyser</button></div></div>' +
        '<div id="an-res"></div>';

      $$('#an-mode button').forEach(function (b) {
        b.onclick = function () {
          mode = b.getAttribute('data-m');
          $$('#an-mode button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
          $('#an-photo').hidden = mode !== 'photo'; $('#an-nom').hidden = mode !== 'nom';
        };
      });
      $('#an-drop').onclick = function () { $('#an-file').click(); };
      $('#an-drop').onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#an-file').click(); } };
      $('#an-file').onchange = function () {
        var f = this.files[0]; if (!f) return;
        reduireImage(f, 1600, 0.85).then(function (p) {
          photo = p; $('#an-drop-in').innerHTML = '<img src="' + p.dataUrl + '" alt="Étiquette"><p class="small muted">Toucher pour changer de photo</p>';
        }).catch(fail);
      };
      $('#an-go').onclick = function () {
        var bt = this, req;
        if (mode === 'photo') {
          if (!photo) return toast('Ajoutez d’abord une photo de l’étiquette', true);
          req = api('ia.etiquette', { base64: photo.base64, mime: photo.mime, indice: $('#an-indice').value.trim() });
        } else {
          var vin = { domaine: $('#an-dom').value.trim(), nom: $('#an-cuv').value.trim(), millesime: $('#an-mil').value.trim(), appellation: $('#an-app').value.trim() };
          if (!vin.domaine && !vin.nom) return toast('Indiquez au moins le domaine ou la cuvée', true);
          req = api('ia.enrichir', { vin: vin });
        }
        busy(bt, true, 'Analyse…');
        req.then(function (r) { busy(bt, false); afficher(r); }).catch(function (e) { busy(bt, false); fail(e); });
      };

      function afficher(r) {
        var kv = function (k, val) { return val ? '<dt>' + k + '</dt><dd>' + val + '</dd>' : ''; };
        var tags = function (s) { return '<div class="tags">' + splitList(s).map(function (a) { return '<span class="tag">' + esc(a) + '</span>'; }).join('') + '</div>'; };
        r.maturite = maturiteLocale(r);
        var d = trouverDoublons(r, vins), enCave = d.exact.concat(d.proches).filter(function (x) { return x.stock > 0; });
        var garde = num(r.boire_des) || num(r.apogee_debut) || num(r.apogee_fin) || num(r.boire_avant);
        $('#an-res').innerHTML = '<div class="card" style="margin-top:16px">' +
          '<div class="row" style="gap:8px;align-items:flex-start"><div style="flex:1;min-width:0"><h2 style="margin:0">' + esc(libelle(r)) + (r.millesime ? ' ' + esc(r.millesime) : '') + '</h2>' +
            '<p class="muted" style="margin:4px 0 0">' + esc([r.type, r.categorie, r.couleur, r.appellation, r.region, r.pays].filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(' · ')) + '</p></div>' +
            (garde ? pillMat(r.maturite) : '') + '</div>' +
          (r.confiance === 'faible' ? '<div class="dup-box dup-exact" style="margin-top:10px">Identification incertaine : vérifiez le nom et le millésime (essayez une photo plus nette ou l’onglet « Nom »).</div>' : '') +
          (enCave.length ? '<div class="dup-box" style="margin-top:10px">🍷 ' + (estAdmin() ? 'Dans votre cave' : 'Dans la cave de ' + esc(proprio())) + ' : ' +
            enCave.slice(0, 4).map(function (x) { return '<a href="#/bouteille/' + esc(x.id) + '">' + descDoublon(x) + '</a>'; }).join(' ; ') + '</div>' : '') +
          (r.description ? '<p>' + esc(r.description) + '</p>' : '') +
          (garde ? '<h3>Quand la boire</h3>' + frise(r) + conseilMaturite(r) : '') +
          '<div class="grid g2" style="margin-top:14px">' +
            '<div><h3>Dégustation</h3><dl class="kv">' + kv('Nez', r.aromes_nez ? tags(r.aromes_nez) : '') + kv('Bouche', esc(r.aromes_bouche)) +
              kv('Service', esc(r.temp_service)) + kv('Carafage', esc(r.carafage)) + kv('Cépages', esc(r.cepages)) + kv('Degré', r.degre ? esc(r.degre) + ' %' : '') + '</dl></div>' +
            '<div><h3>Accords</h3>' + (r.accords ? tags(r.accords) : '<p class="muted">Non renseignés.</p>') +
              (num(r.cote_unitaire) ? '<h3 style="margin-top:14px">Prix de marché estimé</h3><p style="margin:0">' + eur(r.cote_unitaire) + '</p>' +
                (r.cote_commentaire ? '<p class="small muted" style="margin:4px 0 0">' + esc(r.cote_commentaire) + '</p>' : '') : '') + '</div>' +
          '</div>' +
          '<p class="small muted" style="margin:12px 0 0">Proposition de l’IA, à prendre avec recul : les années de garde et les prix sont des estimations.</p>' +
          (estAdmin() ? '' : '<div class="row" style="margin-top:12px"><span class="spacer"></span><button id="an-reco">💡 Recommander à ' + esc(proprio()) + '</button></div>') +
        '</div>';
        $('#an-res').scrollIntoView({ behavior: 'smooth', block: 'start' });
        if ($('#an-reco')) $('#an-reco').onclick = function () { dialogueRecoAnalyse(r); };
      }
    });
  }

  /** Visiteur : recommander au propriétaire la bouteille qui vient d'être analysée. */
  function dialogueRecoAnalyse(r) {
    modal('<h2>Recommander à ' + esc(proprio()) + '</h2><p class="muted" style="margin-top:-4px">' + esc(libelle(r)) + (r.millesime ? ' ' + esc(r.millesime) : '') + '</p>' +
      '<form id="f-ra"><div class="grid g2" style="gap:10px"><div><label for="ra-lieu">Où la trouver</label><input id="ra-lieu" maxlength="120" placeholder="ex. Caviste, restaurant…"></div>' +
      '<div><label for="ra-prix">Prix (€)</label><input id="ra-prix" type="number" min="0" step="0.5" inputmode="decimal"></div></div>' +
      '<label for="ra-msg">Pourquoi ?</label><textarea id="ra-msg" maxlength="1000" placeholder="ex. Bue au restaurant sur un poisson, superbe."></textarea>' +
      '<div class="row"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">💡 Envoyer</button></div></form>',
      function (root) {
        $('#m-annuler', root).onclick = closeModal;
        $('#f-ra', root).onsubmit = function (e) {
          e.preventDefault();
          envoyerEch($('button[type=submit]', this), { type: 'reco', domaine: r.domaine, nom: r.nom, millesime: r.millesime, appellation: r.appellation, couleur: r.couleur,
            lieu: $('#ra-lieu', root).value.trim(), prix: $('#ra-prix', root).value, message: $('#ra-msg', root).value.trim() }, 'Merci, ' + proprio() + ' la verra dans ses échanges');
        };
      });
  }

  function carteBouteille(b, vign) {
    var img = vign[b.id];
    return '<a class="card bottle' + (b.stock <= 0 ? ' vide' : '') + (selCave.ids[b.id] ? ' choisie' : '') + '" data-id="' + esc(b.id) + '" href="#/bouteille/' + esc(b.id) + '">' +
      '<span class="sel-box" aria-hidden="true"></span>' +
      '<div class="thumb" style="' + (img ? 'background-image:url(' + img + ')' : '') + '">' + (img ? '' : esc((b.domaine || b.nom || '?')[0])) + '</div>' +
      '<div style="min-width:0"><div class="t">' + esc(libelle(b)) + '</div>' +
      '<div class="s">' + dot(b.couleur) + ' ' + (estSpiritueux(b) && !b.appellation && !b.categorie && devinerCategorie(b) ? '<em>' + esc(devinerCategorie(b)) + '</em>' + (b.millesime ? ' · ' + esc(b.millesime) : '')
        : esc([sousTitre(b), b.millesime].filter(Boolean).join(' · '))) + '</div>' +
      '<div class="row" style="margin-top:6px;gap:6px">' + pillMat(b.maturite) + tagEntamee(b) + '</div>' +
      (fenetre(b) ? '<div class="s" style="margin-top:4px">' + fenetre(b) + '</div>' : '') +
      (b.emplacement ? '<div class="s" style="margin-top:2px">📍 ' + esc(b.emplacement) + '</div>' : '') + '</div>' +
      '<div class="qty">' + b.stock + '<small>btl</small></div></a>';
  }

  /** Édition rapide dans la vue Liste : emplacement et stock (ajustement d'inventaire). */
  function lierEditionListe(vins, rendre) {
    var parId = function (id) { return vins.filter(function (x) { return x.id === id; })[0]; };
    var marquer = function (el, ok) { el.classList.remove('saved', 'failed'); void el.offsetWidth; el.classList.add(ok ? 'saved' : 'failed'); };
    if (!estAdmin()) { $$('.cell-edit').forEach(function (i) { i.readOnly = true; i.tabIndex = -1; }); return; }
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

  function vueCave(v, _id, params) {
    params = params || {};
    if (params.mat) { filtres.maturite = params.mat; filtres.stock = 'en_stock'; filtres.q = ''; }
    if (params.vue) { filtres.vue = params.vue; filtres.maturite = ''; }
    if (params.mat || params.vue) { try { history.replaceState(null, '', '#/cave'); } catch (e) {} }
    return Promise.all([charger('vins', 'cave.lister', true), charger('vign', 'cave.vignettes')]).then(function (r) {
      var vins = r[0], vign = r[1];
      v.innerHTML =
        '<div class="head"><h1>La cave</h1><span class="muted" id="compte"></span><span class="spacer"></span>' +
        (function () { var n = vins.filter(function (x) { return x.stock > 0 && ficheIncomplete(x); }).length;
          return n ? '<button class="ghost small" id="cave-compl" title="Arômes, garde, accords et cote : 1 requête IA pour 15 fiches">✨ Compléter ' + n + ' fiche' + (n > 1 ? 's' : '') + '</button>' : ''; })() +
        '<button class="ghost small" id="sel-on">☑ Sélectionner</button>' +
        '<button class="ghost small" id="exp">⤓ Exporter</button><a class="btn" href="#/ajouter">+ Ajouter</a></div>' +
        '<div class="seg" role="tablist" aria-label="Affichage" id="vues">' + VUES.map(function (x) {
          return '<button role="tab" data-vue="' + x[0] + '" aria-selected="' + (filtres.vue === x[0]) + '">' + x[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="filters">' +
          '<input class="q" id="f-q" type="search" placeholder="Rechercher : domaine, appellation, cépage, millésime…" value="' + esc(filtres.q) + '">' +
          '<select id="f-type">' + optionsTypes(filtres.type) + '</select>' +
          '<select id="f-couleur">' + options(COULEURS, filtres.couleur, 'Toutes couleurs') + '</select>' +
          '<select id="f-maturite">' + options([['urgent', 'À boire vite + passé']].concat(MATURITE_ORDRE.map(function (k) { return [k, MATURITE[k]]; })), filtres.maturite, 'Toute maturité') + '</select>' +
          '<select id="f-tri">' + options([['maturite', 'Tri : urgence'], ['nom', 'Tri : nom'], ['millesime', 'Tri : millésime'],
            ['stock', 'Tri : quantité']].concat(voitPrix() ? [['valeur', 'Tri : valeur']] : []).concat([['recent', 'Tri : ajout récent']]), filtres.tri) + '</select>' +
        '</div>' +
        '<div class="row" style="margin:-6px 0 14px"><label class="row small" style="margin:0;font-weight:500">' +
          '<input type="checkbox" id="f-stock" style="width:auto"' + (filtres.stock === 'tout' ? ' checked' : '') + '> Afficher aussi les bouteilles épuisées</label></div>' +
        '<div id="filtres-actifs" class="row" style="gap:6px;margin:-4px 0 12px"></div>' +
        '<div id="liste"></div><div class="se-bar" id="sel-bar" hidden></div>';

      function rendre() {
        var q = norm(filtres.q);
        var l = vins.filter(function (b) {
          if (filtres.stock !== 'tout' && b.stock <= 0) return false;
          if (filtres.type === 'spirits' && !estSpiritueux(b)) return false;
          if (/^cat:/.test(filtres.type) && categorieDe(b) !== filtres.type.slice(4)) return false;
          if (filtres.type && filtres.type !== 'spirits' && !/^cat:/.test(filtres.type) && b.type !== filtres.type) return false;
          if (filtres.couleur && b.couleur !== filtres.couleur) return false;
          if (filtres.maturite === 'urgent' ? ['passee', 'a_boire_vite'].indexOf(b.maturite) < 0 : filtres.maturite && b.maturite !== filtres.maturite) return false;
          if (q) {
            var hay = norm([b.nom, b.domaine, b.appellation, b.region, b.pays, b.millesime, b.cepages, b.emplacement, b.type, b.couleur, categorieDe(b)].join(' '));
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
        var actifs = [];
        if (filtres.maturite) actifs.push(['maturite', filtres.maturite === 'urgent' ? 'À boire vite + passé' : MATURITE[filtres.maturite]]);
        if (filtres.type) actifs.push(['type', filtres.type === 'spirits' ? 'Tous les spiritueux' : filtres.type.replace(/^cat:/, '')]);
        if (filtres.couleur) actifs.push(['couleur', filtres.couleur]);
        if (filtres.q) actifs.push(['q', '« ' + filtres.q + ' »']);
        $('#filtres-actifs').innerHTML = actifs.length ? actifs.map(function (a) {
          return '<button class="chip-on" data-raz="' + a[0] + '">' + esc(a[1]) + ' ✕</button>'; }).join('') +
          (actifs.length > 1 ? '<button class="ghost small" data-raz="tout">Tout effacer</button>' : '') : '';
        $$('#filtres-actifs [data-raz]').forEach(function (x) {
          x.onclick = function () {
            var k = x.getAttribute('data-raz');
            (k === 'tout' ? ['maturite', 'type', 'couleur', 'q'] : [k]).forEach(function (c) { filtres[c] = ''; var el = $('#f-' + c); if (el) el.value = ''; });
            rendre();
          };
        });
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
        } else if (filtres.vue === 'type') {
          var groupes = {};
          l.forEach(function (b) { var g = groupeType(b); (groupes[g] = groupes[g] || []).push(b); });
          var aClasser = vins.filter(function (b) { return b.stock > 0 && estSpiritueux(b) && !b.categorie && devinerCategorie(b); });
          var inconnus = vins.filter(function (b) { return b.stock > 0 && estSpiritueux(b) && !b.categorie && !devinerCategorie(b); });
          html = (aClasser.length || inconnus.length ? '<div class="dup-box" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:220px">' +
              (aClasser.length ? '<strong>' + aClasser.length + ' spiritueux</strong> classés d’après leur nom, sans IA (en italique ci-dessous). ' : '') +
              (inconnus.length ? inconnus.length + ' à classer : choisissez leur catégorie dans « Modifier », ou « ✨ Compléter » les fiches.' : '') + '</span>' +
              (aClasser.length ? '<button class="small" id="cat-save">Enregistrer ce classement</button>' : '') + '</div>' : '') +
            Object.keys(groupes).sort(function (a, b) { return ORDRE_GROUPES.indexOf(a) - ORDRE_GROUPES.indexOf(b); }).map(function (k) {
              return '<section class="mat-sec"><div class="mat-head"><h2>' + esc(k) + '</h2><span class="spacer"></span><span class="small"><strong>' +
                nbBtl(groupes[k]) + '</strong> btl · ' + groupes[k].length + ' réf.</span></div>' + grille(groupes[k]) + '</section>';
            }).join('');
          setTimeout(function () {
            if ($('#cat-save')) $('#cat-save').onclick = function () {
              var bt = this; busy(bt, true);
              api('cave.majLot', { maj: aClasser.map(function (b) { return { id: b.id, categorie: devinerCategorie(b) }; }) }).then(function (r) {
                aClasser.forEach(function (b) { b.categorie = devinerCategorie(b); });
                toast(r.maj + ' spiritueux classés'); invalider(); rendre();
              }).catch(function (e) { busy(bt, false); fail(e); });
            };
          }, 0);
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
            '<div class="card" style="padding:0"><div class="table-wrap"><table class="liste"><thead><tr><th class="sel-td"></th><th>Bouteille</th><th>Millésime</th><th>Maturité</th>' +
            '<th>Fenêtre</th><th>Emplacement</th><th class="n">Stock</th>' + (voitPrix() ? '<th class="n">Valeur</th>' : '') + '</tr></thead><tbody>' +
            l.map(function (b) {
              return '<tr><td class="sel-td"><input type="checkbox" data-selid="' + esc(b.id) + '"' + (selCave.ids[b.id] ? ' checked' : '') + ' aria-label="Sélectionner" style="width:auto"></td>' +
                '<td>' + dot(b.couleur) + ' <a href="#/bouteille/' + esc(b.id) + '">' + esc(libelle(b)) + '</a>' +
                '<div class="small muted">' + esc(b.appellation || b.type) + '</div></td><td>' + esc(b.millesime || '-') + '</td><td>' + pillMat(b.maturite) + '</td>' +
                '<td class="small">' + esc(fenetre(b)) + '</td>' +
                '<td><input class="cell-edit" data-empl="' + esc(b.id) + '" list="dl-empl-liste" value="' + esc(b.emplacement) + '" placeholder="-" aria-label="Emplacement de ' + esc(libelle(b)) + '"></td>' +
                '<td class="n"><div class="stepper"><button type="button" class="ghost small" data-pas="-1" data-id="' + esc(b.id) + '" aria-label="Retirer une bouteille">−</button>' +
                  '<input class="cell-edit n" data-stock="' + esc(b.id) + '" type="number" min="0" value="' + b.stock + '" aria-label="Stock de ' + esc(libelle(b)) + '">' +
                  '<button type="button" class="ghost small" data-pas="1" data-id="' + esc(b.id) + '" aria-label="Ajouter une bouteille">+</button>' +
                  '<button type="button" class="ghost small" data-boire="' + esc(b.id) + '" title="Bue, offerte, sortie…"' + (b.stock > 0 ? '' : ' disabled') + '>🍷</button></div>' +
                  (num(b.niveau_entamee) > 0 ? '<div class="small muted">dont 1 entamée (' + Math.round(num(b.niveau_entamee)) + ' %)</div>' : '') + '</td>' +
                (voitPrix() ? '<td class="n">' + eur(b.stock * (num(b.cote_unitaire) || b.prix_moyen)) + '</td>' : '') + '</tr>';
            }).join('') + '</tbody></table></div></div>';
        } else {
          html = grille(l);
        }
        $('#liste').innerHTML = html;
        $('#liste').classList.toggle('mode-sel', selCave.actif);
        affiches = l;
        majBarreSel();
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
      /* --- Sélection multiple --- */
      var affiches = [];
      function majBarreSel() {
        var bar = $('#sel-bar'); if (!bar) return;
        bar.hidden = !selCave.actif;
        $('#sel-on').textContent = selCave.actif ? '✕ Fin de sélection' : '☑ Sélectionner';
        if (!selCave.actif) return;
        var n = nbSel();
        bar.innerHTML = '<div class="se-bar-in"><span><strong>' + n + '</strong> sélectionnée' + (n > 1 ? 's' : '') + '</span>' +
          '<button class="ghost small" id="sel-tout">Tout (' + affiches.length + ' affichées)</button><button class="ghost small" id="sel-rien"' + (n ? '' : ' disabled') + '>Aucune</button>' +
          '<span class="spacer"></span><button class="ghost small" id="sel-empl"' + (n ? '' : ' disabled') + '>📍 Emplacement</button>' +
          '<button id="sel-ia"' + (n ? '' : ' disabled') + '>✨ Nouvelle analyse IA</button></div>';
        $('#sel-tout').onclick = function () { affiches.forEach(function (b) { selCave.ids[b.id] = true; }); rendre(); };
        $('#sel-rien').onclick = function () { selCave.ids = {}; rendre(); };
        $('#sel-ia').onclick = function () { dialogueAnalyseLot(vins, function () { route(); }); };
        $('#sel-empl').onclick = function () { dialogueEmplacementLot(vins, function () { route(); }); };
      }
      $('#sel-on').onclick = function () { selCave.actif = !selCave.actif; if (!selCave.actif) selCave.ids = {}; rendre(); };
      // En mode sélection, toucher une carte la coche au lieu d'ouvrir la fiche
      $('#liste').addEventListener('click', function (e) {
        if (!selCave.actif) return;
        var carte = e.target.closest('.bottle');
        if (!carte) return;
        e.preventDefault();
        var id = carte.getAttribute('data-id');
        if (selCave.ids[id]) delete selCave.ids[id]; else selCave.ids[id] = true;
        carte.classList.toggle('choisie', !!selCave.ids[id]);
        majBarreSel();
      });
      $('#liste').addEventListener('change', function (e) {
        var id = e.target.getAttribute && e.target.getAttribute('data-selid');
        if (!id) return;
        if (e.target.checked) selCave.ids[id] = true; else delete selCave.ids[id];
        majBarreSel();
      });

      $('#f-stock').addEventListener('change', function () { filtres.stock = this.checked ? 'tout' : 'en_stock'; rendre(); });
      $('#exp') && $('#exp').addEventListener('click', dialogueExport);
      if ($('#cave-compl')) $('#cave-compl').onclick = function () {
        completerFiches(vins.filter(function (x) { return x.stock > 0 && ficheIncomplete(x); }).map(function (x) { return x.id; }), this).then(function () { route(); });
      };
      rendre();
    });
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
            '<div class="galerie" id="galerie"></div>' +
            '<div class="row photo-actions" style="justify-content:center;margin-top:8px">' +
              '<button class="ghost small" id="ph-change">📷 ' + (b.photo_id ? 'Changer la photo' : 'Ajouter une photo') + '</button>' +
              (b.photo_id ? '<button class="ghost small" id="ph-add">+ Autre photo</button>' : '') +
              '<input type="file" id="ph-file" accept="image/*" capture="environment" hidden></div>' +
            '<div class="row" id="ph-sel" style="justify-content:center;margin-top:6px" hidden></div>' +
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
            (entamable(b) && b.stock > 0 && (estAdmin() || num(b.niveau_entamee) > 0) ? blocEntamee(b) : '') +
          '</div>' +
          '<div>' +
            '<div class="head" style="margin-bottom:8px"><div><h1>' + esc(libelle(b)) + '</h1>' +
              '<div class="row">' + dot(b.couleur) + '<span class="muted">' + esc([b.type, b.couleur, b.appellation, b.millesime].filter(Boolean).join(' · ')) + '</span>' +
              '<a href="#/cave?mat=' + esc(b.maturite) + '" title="Toutes les bouteilles dans ce cas">' + pillMat(b.maturite) + '</a>' + (b.statut === 'archive' ? '<span class="pill">Archivée</span>' : '') + '</div></div>' +
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
                  kv('Domaine', esc(b.domaine)) + kv('Catégorie', esc(categorieDe(b)) + (estSpiritueux(b) && !b.categorie && categorieDe(b) ? ' <span class="small muted">(devinée)</span>' : '')) + kv('Appellation', esc(b.appellation)) + kv('Région', esc([b.region, b.pays].filter(Boolean).join(', '))) +
                  kv('Cépages', esc(b.cepages)) + kv('Degré', b.degre ? esc(b.degre) + ' %' : '') + kv('Contenance', b.contenance_cl ? esc(b.contenance_cl) + ' cl' : '') +
                  kv('Emplacement', esc(b.emplacement)) + kv('Référence', '<span class="muted small">' + esc(b.id) + '</span>') +
                '</dl></div>' +
              (!voitPrix() ? '' : '<div class="card"><h3>Valeur</h3><dl class="kv">' +
                kv('Prix moyen d’achat', eur(b.prix_moyen, true)) +
                kv('Cote estimée', num(b.cote_unitaire) ? eur(b.cote_unitaire, true) + (pv !== null ? ' <span class="' + (pv >= 0 ? 'up' : 'down') + '">(' + (pv >= 0 ? '+' : '') + pv + ' %)</span>' : '') : '') +
                kv('Valeur du stock', eur(b.stock * (num(b.cote_unitaire) || b.prix_moyen))) +
                kv('Cote', b.cote_date ? dateFr(b.cote_date) + ' · ' + (b.cote_source === 'ia' ? 'estimation IA' : 'saisie manuelle') : '') +
                '</dl>' + (b.cote_commentaire ? '<p class="small muted">' + esc(b.cote_commentaire) + '</p>' : '') +
                '<button class="ghost small" id="b-coter">✨ Réestimer la cote</button></div>') +
              blocAvis(b) +
              '<div class="card"><h3>' + (estAdmin() ? 'Mes notes' : 'Notes de ' + esc(proprio())) + '</h3>' +
                (b.note_perso ? '<p class="stat" style="padding:0"><span class="v">' + esc(b.note_perso) + '</span><span class="muted">/20</span></p>' : '') +
                (b.notes_perso ? '<p style="white-space:pre-wrap">' + esc(b.notes_perso) + '</p>' : '<p class="muted">Aucune note personnelle.</p>') +
                '<p class="small muted">Achetées : ' + b.achetees + ' · Bues/sorties : ' + b.consommees +
                (b.derniere_sortie ? ' · dernière le ' + dateFr(b.derniere_sortie) : '') + '</p></div>' +
            '</div>' +
            '<div class="card" style="margin-top:16px"><h3>Historique</h3><div id="hist">' + tableMvts(b.mouvements.map(function (m) { m.vin_nom = libelle(b); return m; })) + '</div></div>' +
          '</div>' +
        '</div>';

      galeriePhotos(b, function () { delete cache.vign; route(); });

      var recharger = function () { invalider(); route(); };
      $('#b-boire').onclick = function () { dialogueSortie(b, 'consommation'); };
      $('#b-achat').onclick = function () { dialogueMvt(b, 'achat', recharger); };
      $('#b-sortie').onclick = function () { dialogueSortie(b, 'offert'); };
      $('#b-ajust').onclick = function () { dialogueInventaire(b, recharger); };
      lierEntamee(b, recharger);
      $('#b-archiver').onclick = function () {
        api('cave.archiver', { id: b.id, restaurer: b.statut === 'archive' }).then(recharger).catch(fail);
      };
      if ($('#b-coter')) $('#b-coter').onclick = function () {
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
      lierAvis(b, function () { route(); });
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

  /** Galerie de la fiche : photo principale + autres photos ; changer, ajouter, définir comme principale, retirer. */
  function galeriePhotos(b, apres) {
    var imgs = {}, choisie = null, mode = 'principale';
    var afficher = function (pid) {
      choisie = pid;
      if (imgs[pid] && $('#photo')) { $('#photo').style.backgroundImage = 'url(' + imgs[pid] + ')'; $('#photo').textContent = ''; }
      $$('#galerie .gal-th').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-pid') === pid); });
      var sel = $('#ph-sel'); if (!sel) return;
      var principale = pid === b.photo_id;
      sel.hidden = !pid;
      sel.innerHTML = (principale ? '<span class="small muted">Photo principale</span>' : '<button class="ghost small" id="ph-main">⭐ Mettre en principale</button>') +
        '<button class="ghost small" id="ph-del">🗑 Retirer cette photo</button>';
      if ($('#ph-main')) $('#ph-main').onclick = function () {
        var bt = this; busy(bt, true);
        reduireSource(imgs[pid], 220, 0.7).then(function (v) {
          return api('cave.photoPrincipale', { id: b.id, photo_id: pid, vignette: v.dataUrl });
        }).then(function () { toast('Photo principale changée'); apres(); }).catch(function (e) { busy(bt, false); fail(e); });
      };
      $('#ph-del').onclick = function () {
        if (!window.demoConfirm('Retirer cette photo ? Elle sera mise à la corbeille de Google Drive.')) return;
        var bt = this; busy(bt, true);
        var suivante = principale ? ordre.filter(function (x) { return x !== pid; })[0] : null;
        (suivante && imgs[suivante] ? reduireSource(imgs[suivante], 220, 0.7) : Promise.resolve(null)).then(function (v) {
          return api('cave.retirerPhoto', { id: b.id, photo_id: pid, vignette: v ? v.dataUrl : '' });
        }).then(function () { toast('Photo retirée'); apres(); }).catch(function (e) { busy(bt, false); fail(e); });
      };
    };
    var ordre = [];
    api('cave.photos', { id: b.id }).then(function (p) {
      ordre = [p.principale].concat(p.autres).filter(Boolean);
      if (!ordre.length) return;
      $('#galerie').innerHTML = ordre.length > 1 ? ordre.map(function (pid) {
        return '<button class="gal-th" data-pid="' + esc(pid) + '" aria-label="Voir cette photo"><span class="spin"></span></button>'; }).join('') : '';
      // Chargement une par une (chaque photo est lue depuis Google Drive)
      return ordre.reduce(function (pr, pid) {
        return pr.then(function () {
          return api('cave.photo', { id: b.id, photo_id: pid }).then(function (src) {
            imgs[pid] = src;
            var th = $('#galerie [data-pid="' + pid + '"]');
            if (th) { th.style.backgroundImage = 'url(' + src + ')'; th.innerHTML = ''; th.onclick = function () { afficher(pid); }; }
            if (pid === b.photo_id && !choisie) afficher(pid);
          }).catch(function () {});
        });
      }, Promise.resolve());
    }).catch(function () {});

    var file = $('#ph-file');
    $('#ph-change').onclick = function () { mode = 'principale'; file.click(); };
    if ($('#ph-add')) $('#ph-add').onclick = function () { mode = 'autre'; file.click(); };
    file.onchange = function () {
      var f = file.files[0]; if (!f) return;
      var bt = mode === 'principale' ? $('#ph-change') : $('#ph-add'); busy(bt, true, 'Envoi…');
      Promise.all([reduireImage(f, 1600, 0.85), reduireImage(f, 220, 0.7)]).then(function (im) {
        return api('cave.ajouterPhoto', { id: b.id, photo: { base64: im[0].base64, mime: im[0].mime }, vignette: im[1].dataUrl, principale: mode === 'principale' });
      }).then(function () { toast(mode === 'principale' ? 'Photo principale changée (l’ancienne reste dans la galerie)' : 'Photo ajoutée'); apres(); })
        .catch(function (e) { busy(bt, false); fail(e); });
    };
  }

  /** Frise chronologique de garde. */
  function frise(b) {
    var des = num(b.boire_des), ad = num(b.apogee_debut), af = num(b.apogee_fin), av = num(b.boire_avant), mil = num(b.millesime);
    if (!des && !ad && !af && !av) {
      return '<p class="muted">Fenêtre de garde non renseignée' +
        (/spiritueux|liqueur/i.test(b.type) ? ' : normal pour un spiritueux, qui n’évolue plus une fois en bouteille.' : '. Utilisez « Compléter avec l’IA » ou modifiez la fiche.') + '</p>';
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
    temp_service: 'Température de service', carafage: 'Carafage', boire_des: 'Buvable dès', apogee_debut: 'Apogée (début)',
    apogee_fin: 'Apogée (fin)', boire_avant: 'À boire avant', accords: 'Accords mets', cote_unitaire: 'Cote estimée (€/btl)',
    cote_commentaire: 'Commentaire cote', note_perso: 'Ma note (/20)', notes_perso: 'Mes notes de dégustation',
    categorie: 'Catégorie (spiritueux)'
  };
  var SECTIONS = [
    ['Identité', ['domaine', 'nom', 'type', 'categorie', 'couleur', 'appellation', 'region', 'pays', 'millesime', 'cepages', 'degre', 'contenance_cl', 'emplacement']],
    ['Quand la boire', ['boire_des', 'apogee_debut', 'apogee_fin', 'boire_avant']],
    ['Dégustation et service', ['description', 'aromes_nez', 'aromes_bouche', 'temp_service', 'carafage', 'accords']],
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
    else if (c === 'categorie') html = '<select ' + attrs + '>' + options(CATEGORIES_SPIRITUEUX, val, '-') + '</select>';
    else if (c === 'couleur') html = '<select ' + attrs + '>' + options(COULEURS, val, '-') + '</select>';
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
      : params.off ? api('offres.lire', { id: params.off }).then(function (o) {
          var x = (o.analyse.articles || []).filter(function (y) { return String(y.n) === String(params.n); })[0] || {};
          var q = 0;
          try { q = num(JSON.parse(localStorage.getItem('cave_panier_' + params.off) || '{}')[x.n]); } catch (e) {}
          var deg = num(String(x.degre || '').replace(',', '.').replace(/[^\d.]/g, ''));
          return { domaine: x.domaine, nom: x.domaine && x.appellation && x.domaine !== x.appellation ? '' : x.designation,
            type: x.type, couleur: x.couleur, appellation: x.appellation, millesime: x.millesime,
            contenance_cl: x.format_cl, degre: deg || '', temp_service: x.temperature, description: x.degustation,
            accords: (x.accords || []).join(', '), boire_des: x.boire_des, apogee_debut: x.apogee_debut, apogee_fin: x.apogee_fin, boire_avant: x.boire_avant,
            cote_unitaire: x.prix_marche || '', notes_perso: [x.distinctions, x.garde_vendeur ? 'Garde annoncée : ' + x.garde_vendeur : '', x.sucre ? 'Sucre : ' + x.sucre : ''].filter(Boolean).join('\n'),
            _prix: x.prix_unitaire, _fournisseur: o.vendeur, _quantite: q ? q * Math.max(1, num(x.vendu_par) || 1) : Math.max(1, num(x.vendu_par) || 1) };
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
              '<div id="drop-in">' + (edition
                ? ((cache.vign || {})[id] ? '<img src="' + (cache.vign || {})[id] + '" alt="Photo actuelle" style="max-height:140px">' : '<div style="font-size:2.4rem">📷</div>') +
                  '<strong style="display:block">' + (b.photo_id ? 'Changer la photo principale' : 'Ajouter une photo') + '</strong>' +
                  '<p class="muted small">' + (b.photo_id ? 'L’ancienne photo reste dans la galerie de la fiche. ' : '') + 'Aucune analyse IA automatique : utilisez « Analyser la photo » si besoin.</p>'
                : '<div style="font-size:2.4rem">📷</div><strong>Photographier l’étiquette ou la caisse</strong>' +
                  '<p class="muted small">ou glisser une image ici. L’IA lit l’étiquette (ou le marquage de la caisse, quantité comprise) et pré-remplit la fiche.</p>') + '</div>' +
              '<input type="file" id="file" accept="image/*" capture="environment" hidden>' +
            '</div>' +
            '<div style="margin-top:10px"><label for="indice">Précision pour l’IA (facultatif)</label>' +
              '<input id="indice" placeholder="ex. magnum, cuvée spéciale, millésime au dos…"></div>' +
            '<div class="row" style="margin-top:10px"><button class="ghost" id="b-ocr" disabled>✨ Analyser la photo</button>' +
              '<button class="ghost" id="b-ia" title="Complète la fiche à partir du domaine, de la cuvée et du millésime saisis">✨ Compléter sans photo</button>' +
              '<button class="ghost" id="b-ean" type="button" title="Une bouteille déjà connue est reconnue sans IA">▥ Code-barres</button></div>' +
            '<input type="hidden" form="f-vin" name="ean" id="v-ean" value="' + esc(b.ean || '') + '">' +
            (b.ean ? '<p class="small muted" id="ean-info">Code-barres : ' + esc(b.ean) + '</p>' : '<p class="small muted" id="ean-info"></p>') +
            '<div id="ia-res" style="margin-top:12px"></div>' +
          '</div>' +
          '<form id="f-vin">' +
            (edition ? '' : '<div id="dup-hint"></div>') +
            (edition ? '' :
              '<fieldset><legend>Entrée en cave</legend><div class="form">' +
                '<div><label>Type d’entrée</label><select name="_type">' + options([['achat', 'Achat'], ['cadeau_recu', 'Cadeau reçu']], 'achat') + '</select></div>' +
                '<div><label>Quantité</label><input name="_quantite" type="number" min="0" value="' + (num(b._quantite) || 1) + '"></div>' +
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
      var majCategorie = function () {
        var spirit = /spiritueux|liqueur/i.test($('#v-type').value);
        $('#v-categorie').parentNode.hidden = !spirit;
        if (spirit && !$('#v-categorie').value) {
          var g = devinerCategorie({ nom: $('#v-nom').value, domaine: $('#v-domaine').value, appellation: $('#v-appellation').value });
          if (g) $('#v-categorie').value = g;
        }
      };
      $('#v-type').addEventListener('change', majCategorie);
      ['v-nom', 'v-domaine'].forEach(function (i) { $('#' + i).addEventListener('change', majCategorie); });
      majCategorie();

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
          $('#drop-in').innerHTML = '<img src="' + photo.dataUrl + '" alt="Étiquette"><p class="small muted">' +
            (edition ? 'Nouvelle photo principale : enregistrez la fiche pour la garder.' : 'Cliquer pour changer') + '</p>';
          $('#b-ocr').disabled = false;
          if (!edition) $('#b-ocr').click();   // en modification, pas d'appel IA automatique
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
      var tousVins = r[1];
      function majDoublons() {
        if (edition || !$('#dup-hint')) return null;
        var f = { domaine: $('#v-domaine').value, nom: $('#v-nom').value, millesime: $('#v-millesime').value, contenance_cl: $('#v-contenance_cl').value };
        var d = trouverDoublons(f, tousVins);
        var html = htmlDoublons(d) +
          (!d.exact.length && d.proches.length ? '<div class="row" style="margin:-6px 0 14px"><button type="button" class="ghost small" id="dup-reprendre">↺ Reprendre la fiche du ' +
            esc(d.proches[d.proches.length - 1].millesime || 'vin existant') + ' (sans IA)</button></div>' : '');
        if ($('#dup-hint').dataset.html !== html) { $('#dup-hint').innerHTML = html; $('#dup-hint').dataset.html = html; }
        if ($('#dup-reprendre')) $('#dup-reprendre').onclick = function () {
          remplirDepuis(copierFiche(d.proches[d.proches.length - 1], $('#v-millesime').value));
          toast('Fiche reprise : arômes, accords et garde (décalée) remplis sans IA');
        };
        return d;
      }
      ['v-domaine', 'v-nom', 'v-millesime', 'v-contenance_cl'].forEach(function (idc) {
        var el = $('#' + idc); if (el) el.addEventListener('change', majDoublons);
      });
      majDoublons();

      $$('#f-vin select').forEach(function (s) { s.addEventListener('change', function () { s.dataset.touche = '1'; }); });
      var libre = function (el) { return el.tagName === 'SELECT' ? !el.dataset.touche : !el.value; };
      /** Remplit les champs vides du formulaire (surlignés), sans IA. */
      function remplirDepuis(f) {
        var n = 0;
        Object.keys(f).forEach(function (c) {
          var el = $('#v-' + c);
          if (!el || !libre(el) || f[c] === '' || f[c] === undefined || f[c] === null) return;
          el.value = f[c]; el.style.background = 'rgba(176,138,62,.12)'; n++;
        });
        return n;
      }

      $('#b-ean').onclick = function () {
        scannerCodeBarres().then(function (code) {
          if (!code) return;
          $('#v-ean').value = code;
          var connus = vinsParEan(code, tousVins);
          if (connus.length) {
            var src = connus[0];
            if (!$('#v-domaine').value) $('#v-domaine').value = src.domaine || '';
            if (!$('#v-nom').value) $('#v-nom').value = src.nom || '';
            remplirDepuis(copierFiche(src, $('#v-millesime').value));
            $('#ean-info').innerHTML = '▥ ' + esc(code) + ' : <strong>bouteille connue</strong> (' + connus.map(function (x) { return esc(libelle(x)) + (x.millesime ? ' ' + esc(x.millesime) : '') + ', ' + x.stock + ' btl'; }).join(' ; ') +
              '). Fiche reprise sans IA : indiquez le millésime ; si c’est le même, le site proposera d’ajouter au stock.';
            majDoublons();
            return;
          }
          $('#ean-info').innerHTML = '▥ ' + esc(code) + ' : recherche dans Open Food Facts…';
          chercherOFF(code).then(function (p) {
            if (!p) { $('#ean-info').innerHTML = '▥ ' + esc(code) + ' : inconnu. Il sera mémorisé avec cette fiche : la prochaine fois, la bouteille sera reconnue sans IA.'; return; }
            ['domaine', 'nom', 'contenance_cl', 'type', 'couleur'].forEach(function (c) {
              var el = $('#v-' + c); if (el && libre(el) && p[c]) { el.value = p[c]; el.style.background = 'rgba(176,138,62,.12)'; }
            });
            $('#ean-info').innerHTML = '▥ ' + esc(code) + ' : trouvé sur Open Food Facts (' + esc([p.domaine, p.nom].filter(Boolean).join(' · ')) + '), sans IA. Vérifiez, puis « Compléter sans photo » si vous voulez la fiche détaillée.';
            majDoublons();
          });
        });
      };

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
        majCategorie();
        majDoublons();
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
        if (d.ean) vin.ean = d.ean;
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
        var btn = $('#b-save');
        var creer = function () {
          busy(btn, true, 'Enregistrement…');
          api('cave.enregistrer', payload).then(fini).catch(function (e) { busy(btn, false); fail(e); });
        };
        var fini = function (res) {
          invalider(); if (vignette) delete cache.vign;
          if (b._pro) api('prosp.enregistrer', { id: b._pro, statut: 'achete' }).catch(function () {});
          toast(res.ajout ? 'Stock mis à jour : +' + res.ajout + ' btl' : 'Bouteille enregistrée');
          location.hash = '#/bouteille/' + res.id;
        };
        var d = edition ? { exact: [], proches: [] } : trouverDoublons(vin, tousVins);
        if (!d.exact.length) return creer();

        // Doublon : choix explicite
        var q = payload.achat ? Math.max(0, Math.round(num(payload.achat.quantite))) : 0;
        modal('<h2>Déjà dans votre cave</h2>' +
          '<p class="muted" style="margin-top:-4px">Cette bouteille correspond à ' + (d.exact.length > 1 ? 'des fiches existantes' : 'une fiche existante') + ' :</p>' +
          '<div class="pick-list" style="max-height:none">' + d.exact.map(function (x) {
            return '<div class="dup-choice"><div style="min-width:0;flex:1">' + dot(x.couleur) + ' ' + descDoublon(x) +
              (x.prix_moyen ? '<div class="small muted">Prix moyen d’achat : ' + eur(x.prix_moyen, true) + '</div>' : '') + '</div>' +
              (q ? '<button data-ajout="' + esc(x.id) + '">+ ' + q + ' btl au stock</button>' : '<a class="btn ghost small" href="#/bouteille/' + esc(x.id) + '">Ouvrir la fiche</a>') + '</div>';
          }).join('') + '</div>' +
          (d.proches.length ? '<p class="small muted">Autres millésimes ou formats en cave : ' + d.proches.slice(0, 5).map(descDoublon).join(' ; ') + '</p>' : '') +
          '<p class="small muted">Ajouter au stock garde une seule fiche, l’historique et le prix moyen d’achat. Les informations manquantes de la fiche existante sont complétées avec celles saisies ici.</p>' +
          '<div class="row" style="margin-top:12px"><button class="ghost" id="dup-new">Créer une nouvelle fiche quand même</button><span class="spacer"></span><button class="ghost" id="m-annuler">Annuler</button></div>',
          function (root) {
            $('#m-annuler', root).onclick = closeModal;
            $('#dup-new', root).onclick = function () { closeModal(); creer(); };
            $$('[data-ajout]', root).forEach(function (bt) {
              bt.onclick = function () {
                var cible = d.exact.filter(function (x) { return x.id === bt.getAttribute('data-ajout'); })[0];
                busy(bt, true);
                // Compléter les champs vides de la fiche existante, et lui donner la photo si elle n'en a pas
                var maj = { id: cible.id }, nb = 0;
                Object.keys(vin).forEach(function (c) {
                  if (c !== 'id' && vin[c] !== '' && vin[c] !== undefined && (cible[c] === '' || cible[c] === undefined || cible[c] === null)) { maj[c] = vin[c]; nb++; }
                });
                var p2 = { vin: maj };
                if (photo && !cible.photo_id) { p2.photo = payload.photo; p2.vignette = vignette; nb++; }
                var a = payload.achat;
                api('mvt.ajouter', { vin_id: cible.id, type: a.type, quantite: a.quantite, prix_unitaire: a.prix_unitaire, date: a.date, fournisseur: a.fournisseur })
                  .then(function () { return nb ? api('cave.enregistrer', p2) : null; })
                  .then(function () { closeModal(); fini({ id: cible.id, ajout: q }); })
                  .catch(function (e) { busy(bt, false); fail(e); });
              };
            });
          });
      };
    });
  }

  /* =========================================================
   * Économie d'IA : code-barres, Open Food Facts, reprise d'une fiche existante, complétion en lot
   * ======================================================= */

  /** Scan du code-barres à la caméra (Chrome Android) ; saisie manuelle sinon.
   *  options.continu : la fenêtre reste ouverte et appelle options.surCode à chaque nouveau code. */
  function scannerCodeBarres(options) {
    options = options || {};
    return new Promise(function (ok) {
      var flux = null, minuterie = null, fini = false, dernier = '', dernierT = 0, lus = 0;
      var arreter = function () {
        clearInterval(minuterie);
        if (flux) flux.getTracks().forEach(function (t) { t.stop(); });
        flux = null;
      };
      var terminer = function (code) {
        if (fini) return; fini = true; arreter();
        $('#modal').removeEventListener('close', surFermeture);
        closeModal(); ok(code || null);
      };
      var surFermeture = function () { if (!fini) { fini = true; arreter(); ok(null); } };
      var accepter = function (code) {
        code = String(code || '').replace(/\D/g, '');
        if (code.length < 8) return toast('Code-barres incomplet', true);
        if (!options.continu) return terminer(code);
        if (code === dernier && Date.now() - dernierT < 2500) return;   // même code lu plusieurs fois de suite
        dernier = code; dernierT = Date.now(); lus++;
        if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
        var st = $('#sc-etat'); if (st) st.textContent = lus + ' code' + (lus > 1 ? 's' : '') + ' lu' + (lus > 1 ? 's' : '') + ' · dernier : ' + code;
        options.surCode(code);
      };
      modal('<h2>' + esc(options.titre || 'Scanner le code-barres') + '</h2>' +
        '<div class="scan-zone"><video id="sc-video" playsinline muted></video><div class="scan-viseur"></div></div>' +
        '<p class="small muted" id="sc-etat" style="margin:8px 0">' + (options.continu ? 'Présentez les codes-barres un par un (contre-étiquette). Le même code scanné plusieurs fois augmente la quantité.' : 'Présentez le code-barres de la contre-étiquette.') + '</p>' +
        '<div class="row"><input id="sc-saisie" inputmode="numeric" placeholder="ou tapez les chiffres" style="flex:1;min-width:150px"><button class="ghost" id="sc-ok">Valider</button></div>' +
        '<div class="row" style="margin-top:12px"><span class="spacer"></span><button id="sc-fin">' + (options.continu ? 'Terminer' : 'Annuler') + '</button></div>',
        function (root) {
          $('#modal').addEventListener('close', surFermeture);
          $('#sc-fin', root).onclick = function () { terminer(null); };
          $('#sc-ok', root).onclick = function () { accepter($('#sc-saisie', root).value); $('#sc-saisie', root).value = ''; };
          $('#sc-saisie', root).onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#sc-ok', root).click(); } };
          if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            $('.scan-zone', root).hidden = true;
            $('#sc-etat', root).textContent = 'Ce navigateur ne lit pas les codes-barres à la caméra (Chrome sur Android le permet). Tapez les chiffres sous le code-barres.';
            return;
          }
          BarcodeDetector.getSupportedFormats().then(function (formats) {
            var voulus = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(function (f) { return formats.indexOf(f) > -1; });
            var detecteur = new BarcodeDetector({ formats: voulus.length ? voulus : undefined });
            return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
              if (fini) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
              flux = s;
              var video = $('#sc-video', root);
              video.srcObject = s; video.play().catch(function () {});
              minuterie = setInterval(function () {
                if (video.readyState < 2) return;
                detecteur.detect(video).then(function (codes) { if (codes && codes[0]) accepter(codes[0].rawValue); }).catch(function () {});
              }, 250);
            });
          }).catch(function () {
            $('.scan-zone', root).hidden = true;
            $('#sc-etat', root).textContent = 'Caméra indisponible (autorisation refusée ?). Tapez les chiffres sous le code-barres.';
          });
        });
    });
  }

  function memeEan(a, b) {
    var n = function (x) { return String(x || '').replace(/\D/g, '').replace(/^0+/, ''); };
    return n(a) && n(a) === n(b);
  }
  function vinsParEan(ean, vins) {
    return vins.filter(function (v) { return memeEan(v.ean, ean); })
      .sort(function (a, b) { return (b.stock || 0) - (a.stock || 0) || num(b.millesime) - num(a.millesime); });
  }

  /** Base collaborative gratuite Open Food Facts : nom, marque, contenance (sans clé, sans quota Gemini). */
  function chercherOFF(ean) {
    return fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(ean) +
      '.json?fields=product_name,product_name_fr,brands,quantity,categories_tags')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.status !== 1 || !j.product) return null;
        var p = j.product, cats = (p.categories_tags || []).join(' ');
        var marque = String(p.brands || '').split(',')[0].trim();
        var nom = String(p.product_name_fr || p.product_name || '').trim();
        if (marque && norm(nom).indexOf(norm(marque)) === 0) nom = nom.slice(marque.length).replace(/^[\s,–-]+/, '');
        var q = String(p.quantity || '').toLowerCase().replace(',', '.'), cl = '';
        var m = q.match(/([\d.]+)\s*(cl|ml|l)\b/);
        if (m) cl = Math.round(num(m[1]) * (m[2] === 'l' ? 100 : m[2] === 'ml' ? 0.1 : 1));
        var type = '', couleur = '';
        if (/champagne/.test(cats)) { type = 'Champagne'; couleur = 'Effervescent'; }
        else if (/cremant|sparkling/.test(cats)) { type = 'Crémant'; couleur = 'Effervescent'; }
        else if (/whisk|rum|cognac|armagnac|brand|calvados|spirit|vodka|gin|liqueur/.test(cats)) { type = /liqueur/.test(cats) ? 'Liqueur' : 'Spiritueux'; couleur = /vodka|gin/.test(cats) ? 'Incolore' : 'Ambré'; }
        else if (/beer|biere/.test(cats)) { type = 'Bière'; }
        else if (/wine|vin/.test(cats)) {
          type = 'Vin';
          couleur = /red-wine|vins-rouges/.test(cats) ? 'Rouge' : /white-wine|vins-blancs/.test(cats) ? 'Blanc' : /rose-wine|vins-roses/.test(cats) ? 'Rosé' : /sweet|liquoreux|moelleux/.test(cats) ? 'Liquoreux' : '';
        }
        if (!marque && !nom) return null;
        return { domaine: marque || nom, nom: marque ? nom : '', contenance_cl: cl, type: type, couleur: couleur };
      }).catch(function () { return null; });
  }

  /** Reprend une fiche existante pour un autre millésime : tout sauf la cote et les notes ; garde décalée. */
  var CHAMPS_REPRISE = ['type', 'couleur', 'appellation', 'region', 'pays', 'cepages', 'degre', 'contenance_cl', 'description',
    'aromes_nez', 'aromes_bouche', 'temp_service', 'carafage', 'accords'];
  function copierFiche(src, millesimeCible) {
    var f = {};
    CHAMPS_REPRISE.forEach(function (c) { if (src[c] !== '' && src[c] !== undefined && src[c] !== null) f[c] = src[c]; });
    var delta = num(millesimeCible) && num(src.millesime) ? num(millesimeCible) - num(src.millesime) : (num(millesimeCible) ? null : 0);
    if (delta !== null) {
      ['boire_des', 'apogee_debut', 'apogee_fin', 'boire_avant'].forEach(function (c) { if (num(src[c])) f[c] = num(src[c]) + delta; });
    }
    return f;
  }

  /** Fiche à compléter : pas d'accords, pas d'arômes, ou pas de garde pour un vin. */
  function ficheIncomplete(v) {
    var spirit = /spiritueux|liqueur|bière/i.test(v.type || '');
    return !v.accords || !v.aromes_nez || (!spirit && !num(v.boire_avant) && !num(v.apogee_fin)) ||
      (estSpiritueux(v) && !v.categorie && !devinerCategorie(v));
  }

  /** Complète des fiches en lot : 15 par requête, champs vides uniquement. */
  function completerFiches(ids, btn) {
    ids = ids.slice();
    var total = ids.length, faites = 0, i = 0;
    busy(btn, true, '0/' + total);
    return new Promise(function (fin) {
      (function suivant() {
        if (i >= total) { busy(btn, false); toast(faites + ' fiche(s) complétée(s) en ' + Math.ceil(total / 15) + ' requête(s)'); invalider(); return fin(faites); }
        var lot = ids.slice(i, i + 15); i += lot.length;
        btn.innerHTML = '<span class="spin"></span> ' + i + '/' + total;
        api('ia.completerLot', { ids: lot }).then(function (r) { faites += r.completees; })
          .catch(function (e) {
            if (e.code === 'IA_QUOTA' || e.code === 'IA_SATURE') { i -= lot.length; toast(e.message, true); return new Promise(function (r) { setTimeout(r, 30000); }); }
            fail(e);
          }).then(suivant);
      })();
    });
  }

  /* ---------- Doublons ---------- */
  /** Clé de rapprochement : « Ch. Talbot » = « Château Talbot », ponctuation et accents ignorés. */
  function cleVin(x) {
    return norm([x.domaine, x.nom].join(' ')).replace(/\b(chateau|ch|domaine|dom|maison|clos)\b\.?/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  /**
   * exact   : même vin, même millésime, même format → ajouter au stock plutôt que créer une fiche
   * proches : même vin, autre millésime ou autre format → simple information
   */
  function trouverDoublons(f, vins) {
    var k = cleVin(f), m = String(f.millesime || ''), cl = num(f.contenance_cl);
    var res = { exact: [], proches: [] };
    if (k.length < 3) return res;
    vins.forEach(function (x) {
      if (x.statut === 'archive') return;
      var kx = cleVin(x);
      if (kx.length < 3 || !(kx === k || kx.indexOf(k) === 0 || k.indexOf(kx) === 0)) return;
      var memeFormat = !cl || !num(x.contenance_cl) || num(x.contenance_cl) === cl;
      (String(x.millesime || '') === m && memeFormat ? res.exact : res.proches).push(x);
    });
    var tri = function (a, b) { return (b.stock || 0) - (a.stock || 0); };
    res.exact.sort(tri); res.proches.sort(function (a, b) { return num(a.millesime) - num(b.millesime); });
    return res;
  }
  function descDoublon(x) {
    return esc(libelle(x)) + (x.millesime ? ' ' + esc(x.millesime) : '') +
      (num(x.contenance_cl) && num(x.contenance_cl) !== 75 ? ' (' + esc(x.contenance_cl) + ' cl)' : '') +
      ' : <strong>' + (x.stock || 0) + ' btl</strong>' + (x.emplacement ? ' · 📍 ' + esc(x.emplacement) : '');
  }
  function htmlDoublons(d) {
    if (!d.exact.length && !d.proches.length) return '';
    return '<div class="dup-box' + (d.exact.length ? ' dup-exact' : '') + '">' +
      (d.exact.length ? '<strong>⚠ Déjà dans votre cave :</strong> ' + d.exact.map(function (x) {
        return '<a href="#/bouteille/' + esc(x.id) + '">' + descDoublon(x) + '</a>'; }).join(' ; ') +
        '<div class="small">À l’enregistrement, vous pourrez ajouter au stock existant plutôt que créer une seconde fiche.</div>' : '') +
      (d.proches.length ? '<div' + (d.exact.length ? ' class="small" style="margin-top:4px"' : '') + '>' + (d.exact.length ? 'Autres millésimes ou formats : ' : 'ℹ Même vin en cave, autre millésime ou format : ') +
        d.proches.slice(0, 6).map(function (x) { return '<a href="#/bouteille/' + esc(x.id) + '">' + descDoublon(x) + '</a>'; }).join(' ; ') + '</div>' : '') +
      '</div>';
  }

  /** Redimensionne une image côté navigateur (JPEG). Gère l'orientation EXIF des navigateurs récents. */
  function reduireImage(file, max, qualite) { return reduireSource(file, max, qualite); }
  function reduireSource(source, max, qualite) {
    return new Promise(function (ok, ko) {
      var estFichier = typeof source !== 'string';
      var url = estFichier ? URL.createObjectURL(source) : source;
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        if (estFichier) URL.revokeObjectURL(url);
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
        '<div class="head"><h1>Accords mets et vins</h1></div>' +
        '<div class="card ia-only" style="margin-bottom:18px"><h2>Que boire ce soir ?</h2>' +
          '<p class="muted">Décrivez le plat : le sommelier IA choisit parmi <strong>vos</strong> bouteilles, en priorité celles à leur apogée.</p>' +
          '<form class="row" id="f-som"><input name="plat" placeholder="ex. magret de canard aux cerises, plateau de fromages de chèvre…" style="flex:1;min-width:220px" required>' +
          '<input name="contexte" placeholder="Occasion (facultatif)" style="max-width:220px">' +
          '<button type="submit">Proposer</button></form><p class="small muted ia-restant" style="margin:6px 0 0">' + texteIaRestant() + '</p><div id="som-res"></div></div>' +
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
            var hay = norm([x.appellation, x.region, x.cepages, x.nom, x.domaine, x.accords, categorieDe(x)].join(' '));
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
            }).join('') : '<p class="small muted" style="margin:0">Rien de correspondant : une idée pour la <a href="#/prospection">prospection</a>.</p>') +
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
      '<div><label>Couleur</label><select name="couleur">' + options(COULEURS, p.couleur, '-') + '</select></div>' +
      f('appellation', 'Appellation') + f('millesime', 'Millésime', 'number') + f('prix_vu', 'Prix vu (€)', 'number', ' step="0.01"') +
      f('lieu', 'Où (caviste, salon, site…)') +
      '<div><label>Origine</label><select name="origine">' + options(Object.keys(ORIGINES).map(function (k) { return [k, ORIGINES[k]]; }), p.origine, '-') + '</select></div>' +
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
        }).join('') || '<p class="muted">-</p>';
      };

      v.innerHTML = '<div class="head"><h1>Valeur de la cave</h1><span class="spacer"></span>' +
        '<button class="ghost small" id="v-snap">Enregistrer un point aujourd’hui</button>' +
        '<button class="ghost small" id="v-cotes">✨ Coter les bouteilles sans cote</button>' +
        '<a class="btn ghost small" href="#/inventaire">🖨 Inventaire / PDF</a></div>' +
        '<div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">' +
          stat(eur(s.valeur_estimee), 'valeur estimée', pv !== null ? '<span class="' + (pv >= 0 ? 'up' : 'down') + '">' + (pv >= 0 ? '+' : '') + pv + ' % vs achat</span>' : '') +
          stat(eur(s.valeur_achat), 'valeur d’achat') +
          stat(s.nb_bouteilles ? eur(s.valeur_estimee / s.nb_bouteilles) : '-', 'valeur moyenne / bouteille') +
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
              '<td class="n ' + (t.plus_value > 0 ? 'up' : t.plus_value < 0 ? 'down' : '') + '">' + (t.plus_value === null ? '-' : (t.plus_value > 0 ? '+' : '') + t.plus_value + ' %') + '</td>' +
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
        // 20 bouteilles par requête : 100 bouteilles = 5 appels à l'IA au lieu de 100
        var b = this, i = 0, faites = 0; busy(b, true, '0/' + ids.length);
        (function suivant() {
          if (i >= ids.length) { toast(faites + ' cote(s) estimée(s)'); invalider(); return route(); }
          var lot = ids.slice(i, i + 20); i += lot.length;
          b.innerHTML = '<span class="spin"></span> ' + Math.min(i, ids.length) + '/' + ids.length;
          api('ia.coterLot', { ids: lot }).then(function (r) { faites += r.cotees; })
            .catch(function (e) { fail(e); i = ids.length; }).then(suivant);
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
      v.innerHTML = '<div class="head"><h1>Journal</h1><span class="muted">Achats, dégustations et sorties</span><span class="spacer"></span><button class="ghost small" id="j-exp">⤓ Exporter</button></div>' +
        '<div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:16px">' +
          stat(eur(depense), 'dépensé (achats listés)') + stat(bues, 'bouteilles bues') + stat(list.length, 'mouvements') +
        '</div><div class="card">' + tableMvts(list) + '</div>';
      lierSuppressionMvt(v, function () { invalider(); route(); });
      $('#j-exp').onclick = dialogueExport;
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
        '<button type="button" class="ghost" id="s-ean" title="Reconnaître par le code-barres, sans IA">▥</button>' +
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
          $('#s-ean', root).onclick = function () {
            scannerCodeBarres().then(function (code) {
              if (!code) return dialogueSortie();
              var l = vinsParEan(code, vins);
              if (l.length === 1) return formulaireSortie(l[0], 'consommation');
              dialogueSortie();
              setTimeout(function () {
                var res = $('#s-res'); if (!res) return;
                res.innerHTML = l.length ? '<p class="small muted" style="margin:6px 0">Code-barres ' + esc(code) + ' : plusieurs millésimes en cave</p>' + l.map(function (b) { return ligne(b); }).join('')
                  : '<p>Code-barres ' + esc(code) + ' inconnu dans la cave. Cherchez la bouteille par son nom ou prenez une photo ; son code-barres sera mémorisé si vous l’ajoutez.</p>';
                lier();
              }, 120);
            });
          };
          $('#s-file', root).onchange = function () {
            var f = this.files[0]; if (!f) return;
            $('#s-res', root).innerHTML = '<p class="muted"><span class="spin"></span> Reconnaissance de la bouteille…</p>';
            reduireImage(f, 1400, 0.85).then(function (img) {
              return api('ia.reconnaitre', { base64: img.base64, mime: img.mime });
            }).then(function (res) {
              var c = res.correspondances || [];
              $('#s-res', root).innerHTML = '<p class="small muted" style="margin:6px 0">Lu : ' + esc(res.lu || '-') + '</p>' +
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
        '<div><label for="me-cou">Couleur</label><select id="me-cou" name="couleur">' + options(COULEURS, '', '-') + '</select></div>' +
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
              '<div class="small muted">' + dot(b.couleur) + ' ' + esc([sousTitre(b), b.emplacement ? '📍 ' + b.emplacement : ''].filter(Boolean).join(' · ')) + '</div>' +
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
            formulaireSortie(b, 'offert', { occasion: (c.hote ? 'Apportée chez ' + c.hote : 'Apportée') + ', ' + libOcc().toLowerCase(), quantite: btn.getAttribute('data-q') });
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
   * Import d'un tableau sans IA (sortie de ChatGPT / Claude, copie d'Excel, CSV, JSON)
   * ======================================================= */
  var COLONNES_IMPORT = ['domaine', 'cuvee', 'type', 'categorie', 'couleur', 'appellation', 'region', 'pays', 'millesime', 'cepages', 'degre',
    'contenance_cl', 'quantite', 'emplacement', 'prix_achat', 'boire_des', 'apogee_debut', 'apogee_fin', 'boire_avant',
    'temp_service', 'carafage', 'accords', 'aromes_nez', 'aromes_bouche', 'description', 'cote_estimee'];
  // Variantes d'en-têtes acceptées → champ de la fiche
  var ALIAS_IMPORT = {
    domaine: 'domaine', producteur: 'domaine', chateau: 'domaine', maison: 'domaine',
    cuvee: 'nom', nom: 'nom', vin: 'nom', type: 'type', categorie: 'categorie', soustype: 'categorie', famille: 'categorie', couleur: 'couleur', appellation: 'appellation', aoc: 'appellation',
    region: 'region', pays: 'pays', millesime: 'millesime', annee: 'millesime', vintage: 'millesime', cepages: 'cepages', cepage: 'cepages',
    degre: 'degre', alcool: 'degre', contenancecl: 'contenance_cl', contenance: 'contenance_cl', format: 'contenance_cl', cl: 'contenance_cl',
    quantite: '_quantite', qte: '_quantite', nombre: '_quantite', nb: '_quantite', bouteilles: '_quantite', stock: '_quantite',
    emplacement: '_emplacement', casier: '_emplacement', rangement: '_emplacement',
    prixachat: '_prix', prix: '_prix', prixunitaire: '_prix',
    boiredes: 'boire_des', apogeedebut: 'apogee_debut', apogeefin: 'apogee_fin', boireavant: 'boire_avant',
    tempservice: 'temp_service', temperature: 'temp_service', carafage: 'carafage', accords: 'accords',
    aromesnez: 'aromes_nez', aromes: 'aromes_nez', nez: 'aromes_nez', aromesbouche: 'aromes_bouche', bouche: 'aromes_bouche',
    description: 'description', coteestimee: 'cote_unitaire', cote: 'cote_unitaire', valeur: 'cote_unitaire', prixmarche: 'cote_unitaire'
  };
  var PROMPT_IMPORT =
    'Voici des photos de bouteilles de ma cave (vins, champagnes, spiritueux). Lis chaque étiquette et identifie chaque bouteille distincte ; ' +
    'regroupe les bouteilles identiques et indique leur nombre. Complète avec tes connaissances (garde, service, accords, prix de marché).\n\n' +
    'Réponds UNIQUEMENT par un tableau CSV séparé par des points-virgules, dans un bloc de code, avec exactement cette ligne d’en-tête :\n' +
    COLONNES_IMPORT.join(';') + '\n\n' +
    'Règles :\n' +
    '- type parmi : Vin, Champagne, Crémant, Spiritueux, Liqueur, Bière, Autre\n' +
    '- categorie (seulement pour un spiritueux ou une liqueur) parmi : ' + CATEGORIES_SPIRITUEUX.join(', ') + '\n' +
    '- couleur parmi : Rouge, Blanc, Rosé, Effervescent, Liquoreux, Moelleux, Ambré, Incolore\n' +
    '- millesime et années de garde sur 4 chiffres ; garde vide pour un spiritueux\n' +
    '- quantite = nombre de bouteilles identiques ; contenance_cl = 75 par défaut (70 pour un spiritueux)\n' +
    '- prix_achat et emplacement vides si tu ne les connais pas ; cote_estimee = prix de marché actuel en euros, nombre seul\n' +
    '- jamais de point-virgule dans un texte (utilise des virgules) ; laisse vide ce que tu ne sais pas plutôt que d’inventer';

  function normEntete(h) { return norm(h).replace(/[^a-z]/g, ''); }

  /** Découpe une ligne CSV en respectant les guillemets. */
  function decouperLigne(l, sep) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < l.length; i++) {
      var ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === sep && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); });
  }

  /** Tableau collé → liste d'objets { champ: valeur }. Accepte CSV (; , tab), tableau Markdown ou JSON. */
  function parserTableau(txt) {
    txt = String(txt || '').replace(/```[a-z]*\n?/gi, '').trim();
    var lignes, objets;
    if (/^[\[{]/.test(txt)) {
      var j = JSON.parse(txt);
      objets = Array.isArray(j) ? j : (j.bouteilles || j.vins || []);
      return objets.map(function (o) {
        var r = {}; Object.keys(o).forEach(function (k) { var c = ALIAS_IMPORT[normEntete(k)]; if (c) r[c] = o[k]; }); return r;
      });
    }
    lignes = txt.split(/\r?\n/).filter(function (l) { return l.trim() && !/^\s*\|?\s*:?-{3,}/.test(l); });
    // Ignorer le texte d'introduction éventuel (« Voici le tableau : ») : l'en-tête est la 1re ligne
    // contenant au moins deux colonnes reconnues
    var debut = lignes.findIndex(function (l) {
      return l.split(/[;,\t|]/).filter(function (h) { return ALIAS_IMPORT[normEntete(h)]; }).length >= 2;
    });
    if (debut > 0) lignes = lignes.slice(debut);
    if (lignes.length < 2) throw new Error('Il faut une ligne d’en-tête puis au moins une bouteille.');
    var markdown = /^\s*\|/.test(lignes[0]);
    var sep = markdown ? '|' : lignes[0].indexOf('\t') > -1 ? '\t' : lignes[0].indexOf(';') > -1 ? ';' : ',';
    var couper = function (l) {
      var c = decouperLigne(markdown ? l.trim().replace(/^\|/, '').replace(/\|$/, '') : l, sep);
      return c;
    };
    var entetes = couper(lignes[0]).map(function (h) { return ALIAS_IMPORT[normEntete(h)] || null; });
    if (!entetes.some(function (h) { return h === 'domaine' || h === 'nom'; })) {
      throw new Error('En-tête non reconnu : la première ligne doit contenir au moins « domaine » ou « cuvee ».');
    }
    return lignes.slice(1).map(function (l) {
      var c = couper(l), r = {};
      entetes.forEach(function (h, i) { if (h && c[i] !== undefined && c[i] !== '') r[h] = c[i]; });
      return r;
    }).filter(function (r) { return r.domaine || r.nom; });
  }

  /* =========================================================
   * Saisie en série : photos multiples ou liste collée
   * ======================================================= */
  var serie = { brouillons: [], seq: 0, enCours: 0, onglet: 'photos',
    reglages: { emplacement: '', entree: 'initial', date: '', fournisseur: '' } };
  try { Object.assign(serie.reglages, JSON.parse(localStorage.getItem('cave_serie') || '{}')); } catch (e) {}
  var STATUTS_SERIE = { attente: 'En file', analyse: 'Analyse…', pret: 'Prête', erreur: 'Erreur', enregistre: 'Enregistrée' };

  function vueSerie(v) {
    return charger('vins', 'cave.lister', true).then(function (vins) {
      var R = serie.reglages;
      var lieux = vins.map(function (x) { return x.emplacement; }).filter(Boolean).concat(['Cave', 'Cellier', 'Armoire à vin', 'Bar'])
        .filter(function (x, i, a) { return a.indexOf(x) === i; });
      v.innerHTML = '<p class="small"><a href="#/ajouter">← Ajout simple</a></p>' +
        '<div class="head"><h1>Saisie en série</h1><span class="muted">Pour rentrer beaucoup de bouteilles d’un coup : une photo par référence, ou une liste collée.</span></div>' +
        '<datalist id="dl-serie">' + lieux.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
        '<div class="card" style="margin-bottom:14px"><div class="form">' +
          '<div><label for="se-emp">Emplacement par défaut</label><input id="se-emp" list="dl-serie" value="' + esc(R.emplacement) + '" placeholder="ex. Cave, casier A1"></div>' +
          '<div><label for="se-ent">Entrée</label><select id="se-ent">' + options([['initial', 'Stock initial (déjà en cave)'], ['achat', 'Achat'], ['cadeau_recu', 'Cadeau reçu']], R.entree) + '</select></div>' +
          '<div><label for="se-ana">Analyse des photos</label><select id="se-ana">' + options([['rapide', 'Rapide : identification, détails complétés en lot'], ['complete', 'Complète : fiche détaillée pour chaque photo']], R.analyse || 'rapide') + '</select></div>' +
          '<div class="se-achat"><label for="se-date">Date d’achat</label><input id="se-date" type="date" value="' + esc(R.date || today()) + '"></div>' +
          '<div class="se-achat"><label for="se-four">Fournisseur</label><input id="se-four" value="' + esc(R.fournisseur) + '"></div>' +
        '</div><p class="small muted" style="margin:8px 0 0">Rangez casier par casier : changez l’emplacement par défaut avant chaque casier, chaque bouteille le reprend.</p></div>' +
        '<div class="seg" role="tablist" id="se-tabs"><button role="tab" data-t="photos">📷 Photos</button><button role="tab" data-t="tableau">📑 Tableau (ChatGPT, Claude, Excel)</button><button role="tab" data-t="liste">📋 Liste libre</button></div>' +
        '<div id="se-photos" class="card" style="margin-bottom:14px">' +
          '<div class="row"><button id="se-cam">📷 Prendre une photo</button><button class="ghost" id="se-multi">🖼 Choisir plusieurs photos</button>' +
          '<button class="ghost" id="se-scan" title="Bouteilles déjà connues ou présentes dans Open Food Facts : sans IA">▥ Scanner les codes-barres</button>' +
          '<input type="file" id="se-f1" accept="image/*" capture="environment" hidden><input type="file" id="se-fn" accept="image/*" multiple hidden></div>' +
          '<label class="row small" style="margin:10px 0 0;font-weight:500;color:var(--ink)"><input type="checkbox" id="se-multi-btl" style="width:auto"' + (R.multi ? ' checked' : '') + '> Plusieurs bouteilles différentes sur chaque photo (une rangée, une étagère) : une seule analyse pour toute la photo</label>' +
          '<p class="small muted" style="margin:8px 0 0">Sans cette case : une photo par référence (étiquette de face, ou la caisse). Avec : photographiez 4 à 8 bouteilles côte à côte, étiquettes bien visibles. L’analyse se fait pendant que vous continuez.</p>' +
          '<p class="small muted" style="margin:6px 0 0" id="se-usage"></p></div>' +
        '<div id="se-tableau" class="card" style="margin-bottom:14px" hidden>' +
          '<p style="margin:0 0 8px"><strong>Sans quota Gemini :</strong> faites analyser vos photos par ChatGPT ou Claude (votre abonnement habituel), puis collez ici le tableau obtenu. Une copie d’un tableau Excel fonctionne aussi.</p>' +
          '<ol class="small" style="margin:0 0 10px;padding-left:20px"><li>Copiez la consigne ci-dessous.</li><li>Dans ChatGPT ou Claude, joignez plusieurs photos (une rangée par photo) et collez la consigne.</li><li>Copiez le tableau de la réponse et collez-le ici. Répétez par lots.</li></ol>' +
          '<details class="prompt-box"><summary>Consigne à copier</summary><pre id="se-prompt">' + esc(PROMPT_IMPORT) + '</pre></details>' +
          '<div class="row" style="margin:8px 0 12px"><button class="ghost small" id="se-copy">Copier la consigne</button></div>' +
          '<label for="se-tab">Tableau à importer (CSV, tableau Markdown, copie d’Excel ou JSON)</label>' +
          '<textarea id="se-tab" style="min-height:160px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem" placeholder="domaine;cuvee;type;couleur;appellation;…"></textarea>' +
          '<div class="row" style="margin-top:8px"><span class="small muted" style="flex:1">Import immédiat, sans appel à l’IA. Les fiches restent modifiables avant enregistrement.</span><button id="se-imp">Importer le tableau</button></div></div>' +
        '<div id="se-liste" class="card" style="margin-bottom:14px" hidden>' +
          '<label for="se-txt">Une bouteille par ligne (copiée d’Excel, d’un carnet, d’un mail…)</label>' +
          '<textarea id="se-txt" style="min-height:160px" placeholder="6 x Château Talbot 2015&#10;Bollinger Special Cuvée, 3 btl, cave haute&#10;Armagnac Darroze 20 ans, 1, 95 €"></textarea>' +
          '<div class="row" style="margin-top:8px"><span class="small muted" style="flex:1">Jusqu’à environ 80 lignes par envoi. Quantité, emplacement et prix sont repris s’ils figurent sur la ligne.</span><button id="se-go">✨ Analyser la liste</button></div></div>' +
        '<div id="se-list" class="se-list"></div>' +
        '<div class="se-bar" id="se-bar" hidden></div>';

      var R2 = function () {
        R.emplacement = $('#se-emp').value; R.entree = $('#se-ent').value; R.date = $('#se-date').value; R.fournisseur = $('#se-four').value;
        R.multi = $('#se-multi-btl') ? $('#se-multi-btl').checked : R.multi;
        R.analyse = $('#se-ana').value;
        $$('.se-achat').forEach(function (x) { x.hidden = R.entree === 'initial'; });
        try { localStorage.setItem('cave_serie', JSON.stringify(R)); } catch (e) {}
      };
      ['se-emp', 'se-ent', 'se-date', 'se-four', 'se-multi-btl', 'se-ana'].forEach(function (id) { $('#' + id).addEventListener('input', R2); $('#' + id).addEventListener('change', R2); });
      R2();
      var onglet = function (t) {
        serie.onglet = t;
        $$('#se-tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-t') === t)); });
        $('#se-photos').hidden = t !== 'photos'; $('#se-liste').hidden = t !== 'liste'; $('#se-tableau').hidden = t !== 'tableau';
      };
      $$('#se-tabs button').forEach(function (b) { b.onclick = function () { onglet(b.getAttribute('data-t')); }; });
      onglet(serie.onglet);

      /* --- Doublons : la même référence existe-t-elle déjà ? --- */
      function chercherExistant(f) { return trouverDoublons(f, vins).exact[0] || null; }

      function nouveau(src) {
        var b = { k: ++serie.seq, statut: 'attente', fiche: {}, quantite: 1, emplacement: R.emplacement, prix: '', ajout: true };
        Object.assign(b, src || {});
        serie.brouillons.push(b);
        return b;
      }

      /* --- Photos : file d'analyse, 2 en parallèle --- */
      function ajouterPhotos(files) {
        Array.prototype.forEach.call(files, function (file) {
          var b = nouveau({ fichier: file, multi: !!R.multi, analyse: R.analyse || 'rapide' });
          Promise.all([reduireImage(file, 1280, 0.82), reduireImage(file, 220, 0.7)]).then(function (imgs) {
            b.photo = imgs[0]; b.vignette = imgs[1].dataUrl; delete b.fichier;
            rendre(); pomper();
          }).catch(function () { b.statut = 'erreur'; b.erreur = 'Image illisible'; rendre(); });
        });
        rendre();
      }
      /* File d'analyse au rythme de l'offre gratuite Gemini : une photo à la fois, espacées,
         avec pause et reprise automatiques si Gemini est saturé ou si le quota est atteint. */
      var INTERVALLE_MS = 4500, ESSAIS_MAX = 6;
      function pomper() {
        if (serie.enCours >= 1) return;
        var attente = Math.max(serie.pauseJusqua || 0, serie.prochain || 0) - Date.now();
        if (attente > 0) {
          clearTimeout(serie.minuterie);
          serie.minuterie = setTimeout(pomper, attente + 50);
          return;
        }
        var b = serie.brouillons.filter(function (x) { return x.statut === 'attente' && x.photo; })[0];
        if (b) analyser(b);
      }
      function analyser(b) {
        b.statut = 'analyse'; serie.enCours++; rendre();
        var rapide = (b.analyse || R.analyse || 'rapide') === 'rapide';
        api(b.multi ? 'ia.etiquettes' : rapide ? 'ia.identifier' : 'ia.etiquette', { base64: b.photo.base64, mime: b.photo.mime, rapide: rapide }).then(function (r) {
          if (b.multi) {
            var liste = r.bouteilles || [];
            if (!liste.length) throw new Error('Aucune étiquette lisible sur cette photo.');
            // La 1re bouteille garde la photo (envoyée dans Drive), les autres partagent la vignette
            liste.forEach(function (f, i) {
              var cible = i === 0 ? b : nouveau({ vignette: b.vignette, emplacement: b.emplacement });
              cible.fiche = f; cible.quantite = num(f.quantite) || 1; cible.statut = 'pret'; cible.erreur = '';
              cible.existant = chercherExistant(f);
            });
          } else {
            b.fiche = r; b.quantite = num(r.quantite_visible) || b.quantite || 1;
            b.statut = 'pret'; b.erreur = '';
          }
        }).catch(function (e) {
          b.essais = (b.essais || 0) + 1;
          if ((e.code === 'IA_QUOTA' || e.code === 'IA_SATURE') && b.essais < ESSAIS_MAX) {
            b.statut = 'attente';
            var delai = e.code === 'IA_QUOTA' ? Math.min(120, 30 * b.essais) : Math.min(60, 10 * b.essais);
            serie.pauseJusqua = Date.now() + delai * 1000;
            serie.raisonPause = e.code === 'IA_QUOTA' ? 'quota Gemini atteint' : 'Gemini surchargé';
          } else {
            b.statut = 'erreur'; b.erreur = e.message;
          }
        }).then(function () {
          serie.enCours--; serie.prochain = Date.now() + INTERVALLE_MS;
          serie.brouillons.forEach(function (x) { if (x.statut === 'pret' && !x.repris) reprendreConnue(x); });
          b.existant = chercherExistant(b.fiche || {}); rendre(); pomper();
          if (++serie.nbAnalyses % 5 === 0) majUsage();
        });
      }
      // Compte à rebours affiché pendant une pause
      clearInterval(serie.horloge);
      serie.horloge = setInterval(function () {
        var el = $('#se-pause'); if (!el) return;
        var s = Math.ceil(((serie.pauseJusqua || 0) - Date.now()) / 1000);
        if (s > 0) el.textContent = '⏸ ' + serie.raisonPause + ' : reprise automatique dans ' + s + ' s';
        else el.textContent = '';
      }, 1000);
      /* Même vin déjà en cave, autre millésime : on recopie sa fiche (sans IA) dans les champs vides */
      function reprendreConnue(b) {
        b.repris = true;
        var d = trouverDoublons(b.fiche || {}, vins);
        var src = d.exact[0] || d.proches[d.proches.length - 1];
        if (!src || !src.id || src.accords === undefined) return;
        var f = copierFiche(src, b.fiche.millesime), n = 0;
        Object.keys(f).forEach(function (c) { if (b.fiche[c] === undefined || b.fiche[c] === '' || b.fiche[c] === null) { b.fiche[c] = f[c]; n++; } });
        if (n) b.reprisDe = libelle(src) + (src.millesime ? ' ' + src.millesime : '');
      }
      serie.nbAnalyses = serie.nbAnalyses || 0;
      function majUsage() {
        api('ia.usage').then(function (u) {
          var el = $('#se-usage'); if (!el) return;
          el.textContent = 'Requêtes IA aujourd’hui : ' + u.total + (Object.keys(u.parModele).length > 1 ? ' (' + Object.keys(u.parModele).map(function (k) { return k.replace('gemini-', '') + ' : ' + u.parModele[k]; }).join(', ') + ')' : '');
        }).catch(function () {});
      }
      majUsage();

      /* Scan des codes-barres en continu : bouteille connue → ajout au stock ; sinon Open Food Facts ; sans IA */
      $('#se-scan').onclick = function () {
        scannerCodeBarres({ continu: true, titre: 'Scanner les bouteilles', surCode: function (code) {
          var deja = serie.brouillons.filter(function (x) { return x.statut !== 'enregistre' && memeEan(x.fiche && x.fiche.ean, code); })[0];
          if (deja) { deja.quantite = num(deja.quantite) + 1; rendre(); return; }
          var connus = vinsParEan(code, vins);
          if (connus.length) {
            var src = connus[0];
            var f = Object.assign({ domaine: src.domaine, nom: src.nom, millesime: src.millesime, ean: code }, copierFiche(src, src.millesime));
            var b = nouveau({ fiche: f, statut: 'pret', vignette: (cache.vign || {})[src.id], reprisDe: 'code-barres connu', repris: true });
            b.existant = chercherExistant(f);
            b.avertir = connus.length > 1 ? 'Plusieurs millésimes partagent ce code-barres : vérifiez le millésime.' : 'Vérifiez le millésime : le code-barres est souvent identique d’une année à l’autre.';
            rendre(); return;
          }
          var b2 = nouveau({ fiche: { ean: code, ligne: 'Code-barres ' + code }, statut: 'analyse' });
          rendre();
          chercherOFF(code).then(function (p) {
            if (p) { Object.assign(b2.fiche, p); b2.fiche.ligne = 'Open Food Facts · ' + code; }
            else b2.avertir = 'Code-barres inconnu : complétez le domaine et la cuvée, ou photographiez l’étiquette.';
            b2.statut = 'pret'; b2.existant = chercherExistant(b2.fiche); rendre();
          });
        } });
      };

      $('#se-cam').onclick = function () { $('#se-f1').click(); };
      $('#se-multi').onclick = function () { $('#se-fn').click(); };
      $('#se-f1').onchange = function () { ajouterPhotos(this.files); this.value = ''; };
      $('#se-fn').onchange = function () { ajouterPhotos(this.files); this.value = ''; };

      /* --- Tableau sans IA --- */
      $('#se-copy').onclick = function () {
        var ok = function () { toast('Consigne copiée : collez-la dans ChatGPT ou Claude avec vos photos'); };
        try { navigator.clipboard.writeText(PROMPT_IMPORT).then(ok, function () { $('.prompt-box').open = true; toast('Sélectionnez la consigne et copiez-la', true); }); }
        catch (e) { $('.prompt-box').open = true; }
      };
      $('#se-imp').onclick = function () {
        var lignes;
        try { lignes = parserTableau($('#se-tab').value); } catch (e) { return toast(e.message || 'Tableau illisible', true); }
        if (!lignes.length) return toast('Aucune bouteille trouvée dans le tableau', true);
        lignes.forEach(function (r) {
          var f = {};
          Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') f[k] = r[k]; });
          f.ligne = [r.domaine, r.nom, r.millesime].filter(Boolean).join(' ');
          var b = nouveau({ fiche: f, statut: 'pret', quantite: num(r._quantite) || 1,
            emplacement: r._emplacement || R.emplacement, prix: r._prix ? String(r._prix).replace(',', '.').replace(/[^\d.]/g, '') : '' });
          b.existant = chercherExistant(f);
          reprendreConnue(b);
        });
        $('#se-tab').value = '';
        toast(lignes.length + ' bouteille(s) importée(s) : vérifiez puis enregistrez');
        rendre();
      };

      /* --- Liste collée --- */
      $('#se-go').onclick = function () {
        var txt = $('#se-txt').value.trim(); if (!txt) return toast('Collez au moins une ligne', true);
        var btn = this; busy(btn, true, 'Analyse…');
        api('ia.liste', { texte: txt }).then(function (r) {
          busy(btn, false);
          (r.bouteilles || []).forEach(function (f) {
            var b = nouveau({ fiche: f, statut: 'pret', quantite: num(f.quantite) || 1, emplacement: f.emplacement || R.emplacement, prix: f.prix_unitaire || '' });
            b.existant = chercherExistant(f);
            reprendreConnue(b);
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
          p = api('mvt.ajouter', mvt).then(function () {
            return f.ean && !b.existant.ean ? api('cave.enregistrer', { vin: { id: b.existant.id, ean: f.ean } }) : null;
          }).then(function () { return { id: b.existant.id }; });
        } else {
          var vin = {};
          Object.keys(LIBELLES).forEach(function (c) { if (f[c] !== undefined && f[c] !== null && f[c] !== '') vin[c] = f[c]; });
          vin.emplacement = b.emplacement;
          if (f.ean) vin.ean = f.ean;
          if (num(f.cote_unitaire)) { vin.cote_date = today(); vin.cote_source = 'ia'; }
          var payload = { vin: vin, achat: mvt };
          if (b.photo) { payload.photo = { base64: b.photo.base64, mime: b.photo.mime }; payload.vignette = b.vignette; }
          p = api('cave.enregistrer', payload);
        }
        return p.then(function (res) {
          b.statut = 'enregistre'; b.id = res.id; delete b.photo;
          b.aCompleter = !(b.existant && b.ajout) && ficheIncomplete(f);
          if (!b.existant) vins.push(Object.assign({}, f, { id: res.id, stock: q }));
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
                '<div><label>Couleur</label><select data-k="' + b.k + '" data-c="couleur"' + (fini ? ' disabled' : '') + '>' + options(COULEURS, f.couleur, '-') + '</select></div>' +
                champ('appellation', 'Appellation') +
                '<div><label>Quantité</label><input data-k="' + b.k + '" data-q="quantite" type="number" min="1" value="' + esc(b.quantite) + '"' + (fini ? ' disabled' : '') + '></div>' +
                '<div><label>Emplacement</label><input data-k="' + b.k + '" data-q="emplacement" list="dl-serie" value="' + esc(b.emplacement) + '"' + (fini ? ' disabled' : '') + '></div>' +
                '<div class="se-prix"' + (R.entree === 'achat' ? '' : '') + '><label>Prix unitaire (€)</label><input data-k="' + b.k + '" data-q="prix" type="number" step="0.01" min="0" value="' + esc(b.prix) + '"' + (fini ? ' disabled' : '') + '></div>' +
              '</div>' +
              (function () { var p = trouverDoublons(f, vins).proches; return !b.existant && p.length ? '<div class="small muted" style="margin-top:6px">ℹ Même vin en cave, autre millésime ou format : ' + p.slice(0, 4).map(descDoublon).join(' ; ') + '</div>' : ''; })() +
              (b.existant ? '<label class="row small se-dup"><input type="checkbox" data-dup="' + b.k + '" style="width:auto"' + (b.ajout ? ' checked' : '') + (fini ? ' disabled' : '') + '> Déjà en cave (' +
                esc(libelle(b.existant)) + ', ' + b.existant.stock + ' btl) : ajouter au stock existant plutôt que créer une fiche</label>' : '') +
              (b.reprisDe ? '<p class="small" style="margin:6px 0 0;color:var(--ok)">↺ Détails repris sans IA (' + esc(b.reprisDe) + ')</p>' : '') +
              (b.avertir && !fini ? '<p class="small" style="margin:6px 0 0;color:var(--warn)">' + esc(b.avertir) + '</p>' : '') +
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
        var erreurs = l.filter(function (x) { return x.statut === 'erreur' && x.photo; }).length;
        var aCompl = l.filter(function (x) { return x.statut === 'enregistre' && x.aCompleter; });
        bar.innerHTML = '<div class="se-bar-in"><span><strong>' + pretes.length + '</strong> prête' + (pretes.length > 1 ? 's' : '') + ' (' + nbBtl + ' btl)' +
          (analyse ? ' · ' + analyse + ' à analyser' : '') + (erreurs ? ' · <span class="down">' + erreurs + ' en erreur</span>' : '') +
          (faits ? ' · <span class="up">' + faits + ' enregistrée' + (faits > 1 ? 's' : '') + '</span>' : '') +
          '<span id="se-pause" class="small" style="display:block;color:var(--warn)"></span></span>' +
          '<span class="spacer"></span>' + (erreurs ? '<button class="ghost small" id="se-retry">Tout réessayer</button>' : '') +
          (aCompl.length ? '<button class="ghost small" id="se-compl" title="Arômes, garde, accords et cote : 1 requête pour 15 fiches">✨ Compléter ' + aCompl.length + ' fiche' + (aCompl.length > 1 ? 's' : '') + '</button>' : '') +
          (faits ? '<button class="ghost small" id="se-clean">Vider les enregistrées</button>' : '') +
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
        $$('[data-re]', root).forEach(function (x) { x.onclick = function () { var b = trouver(x.getAttribute('data-re')); b.statut = 'attente'; b.essais = 0; serie.pauseJusqua = 0; rendre(); pomper(); }; });
        $$('[data-save]', root).forEach(function (x) { x.onclick = function () { enregistrer(trouver(x.getAttribute('data-save'))); }; });
        if ($('#se-all')) $('#se-all').onclick = function () { toutEnregistrer(this); };
        if ($('#se-compl')) $('#se-compl').onclick = function () {
          completerFiches(aCompl.map(function (x) { return x.id; }), this).then(function () {
            aCompl.forEach(function (x) { x.aCompleter = false; }); rendre(); majUsage();
          });
        };
        if ($('#se-retry')) $('#se-retry').onclick = function () {
          l.forEach(function (x) { if (x.statut === 'erreur' && x.photo) { x.statut = 'attente'; x.essais = 0; } });
          serie.pauseJusqua = 0; rendre(); pomper();
        };
        if ($('#se-clean')) $('#se-clean').onclick = function () { serie.brouillons = serie.brouillons.filter(function (y) { return y.statut !== 'enregistre'; }); rendre(); };
      }
      rendre(); pomper();
    });
  }

  /* =========================================================
   * Dégustations : tout ce qui a été bu, de ma cave ou ailleurs
   * ======================================================= */
  var ORIGINES_BUES = ['restaurant', 'amis', 'degustation'];
  /** Lignes communes « de ma cave » (sorties Bue) et « ailleurs » (mémos bus au restaurant, chez des amis…). */
  function construireDegustations(mvts, memos, vins, vign) {
    var parId = {}; vins.forEach(function (x) { parId[x.id] = x; });
    return mvts.filter(function (m) { return m.type === 'consommation'; }).map(function (m) {
      var b = parId[m.vin_id] || {};
      return { source: 'cave', date: String(m.date).slice(0, 10), titre: libelle(b) + (b.millesime ? ' ' + b.millesime : ''),
        sous: b.appellation || b.type || '', couleur: b.couleur, ou: m.occasion || '', note: num(m.note_degustation),
        texte: m.impressions || '', qte: -num(m.quantite), lien: '#/bouteille/' + m.vin_id, img: vign[m.vin_id] };
    }).concat(memos.filter(function (p) { return ORIGINES_BUES.indexOf(p.origine) > -1; }).map(function (p) {
      return { source: p.origine, date: String(p.date_vue || p.cree_le).slice(0, 10), titre: libelle(p) + (p.millesime ? ' ' + p.millesime : ''),
        sous: p.appellation || p.type || '', couleur: p.couleur, ou: p.lieu || '', note: num(p.note_perso), texte: p.note || '',
        qte: 1, prix: num(p.prix_vu), lien: '#/prospection', img: vign[p.id], statut: p.statut };
    })).sort(function (a, b) { return b.date.localeCompare(a.date); });
  }
  var filtreDeg = { source: '', periode: '', q: '' };

  function vueDegustations(v) {
    return Promise.all([api('mvt.lister', { limite: 5000 }), charger('prosp', 'prosp.lister', true), charger('vins', 'cave.lister', true), charger('vign', 'cave.vignettes')]).then(function (r) {
      var mvts = r[0], memos = r[1], vins = r[2], vign = r[3];
      var parId = {}; vins.forEach(function (x) { parId[x.id] = x; });

      var lignes = construireDegustations(mvts, memos, vins, vign);

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
          stat(notes.length ? (notes.reduce(function (s, x) { return s + x.note; }, 0) / notes.length).toFixed(1) + '<small style="font-size:1rem">/20</small>' : '-', 'note moyenne', notes.length + ' notée' + (notes.length > 1 ? 's' : '')) +
          stat(top ? top.note + '<small style="font-size:1rem">/20</small>' : '-', 'meilleure note', top ? esc(top.titre) : '');

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
   * Proposition du jour : 3 références, sans IA (aucun quota consommé)
   * ======================================================= */
  // Générateur pseudo-aléatoire stable : même proposition toute la journée, nouvelle le lendemain
  function graine(txt) { var h = 2166136261; for (var i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function alea(seed) { return function () { seed = (seed + 0x6D2B79F5) >>> 0; var t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  var MOMENTS_JOUR = [
    { id: 'aperitif', titre: 'Pour l’apéritif', icone: '🥂', familles: ['Effervescent', 'Blanc', 'Rosé'] },
    { id: 'repas', titre: 'Pour le repas', icone: '🍽', familles: ['Rouge', 'Blanc'] },
    { id: 'fin', titre: 'Pour finir', icone: '🥃', familles: ['Spiritueux', 'Liquoreux'] }
  ];

  function propositionDuJour(vins, decalage) {
    var rnd = alea(graine(today() + '#' + (decalage || 0)));
    var mois = new Date().getMonth() + 1, weekend = [0, 5, 6].indexOf(new Date().getDay()) > -1;
    var dispo = vins.filter(function (v) { return v.stock > 0 && v.statut !== 'archive' && v.maturite !== 'trop_jeune'; });
    var noter = function (v) {
      var s = { a_boire_vite: 6, passee: 4, apogee: 5, a_boire: 3, inconnue: 2, peut_attendre: 0 }[v.maturite] || 0;
      var fam = famille(v);
      if (mois >= 6 && mois <= 8 && (fam === 'Rosé' || fam === 'Blanc' || fam === 'Effervescent')) s += 1;
      if ((mois >= 11 || mois <= 2) && fam === 'Rouge') s += 1;
      if (mois === 12 && (fam === 'Effervescent' || fam === 'Liquoreux')) s += 1;
      if (weekend && (num(v.cote_unitaire) || num(v.prix_moyen)) > 40) s += 1;      // un peu plus beau le week-end
      if (num(v.niveau_entamee) > 0) s += 2;                                          // finir ce qui est ouvert
      if (v.derniere_sortie && Date.now() - new Date(v.derniere_sortie).getTime() < 14 * 864e5) s -= 3;
      if (v.stock === 1 && v.maturite !== 'a_boire_vite' && v.maturite !== 'passee') s -= 1;
      return s + rnd() * 3.5;                                                          // variété au fil des jours
    };
    var notes = dispo.map(function (v) { return { v: v, s: noter(v) }; }).sort(function (a, b) { return b.s - a.s; });
    var pris = {};
    var res = MOMENTS_JOUR.map(function (m) {
      var o = notes.filter(function (x) { return !pris[x.v.id] && m.familles.indexOf(famille(x.v)) > -1; })[0];
      if (o) pris[o.v.id] = true;
      return { moment: m, o: o };
    });
    // Moment sans candidat : compléter avec la meilleure bouteille restante
    res.forEach(function (r) {
      if (r.o) return;
      var o = notes.filter(function (x) { return !pris[x.v.id]; })[0];
      if (o) { pris[o.v.id] = true; r.o = o; }
    });
    return res.filter(function (r) { return r.o; });
  }

  function raisonJour(v) {
    if (num(v.niveau_entamee) > 0) return 'Déjà ouverte (' + Math.round(num(v.niveau_entamee)) + ' %)';
    return { a_boire_vite: 'À boire sans tarder', passee: 'Au-delà de sa fenêtre : à ouvrir', apogee: 'À son apogée',
      a_boire: 'Prête à boire', inconnue: 'Prête à servir', peut_attendre: 'Ouvrable, peut encore attendre' }[v.maturite] || '';
  }

  function blocPropositionDuJour(vins, vign) {
    var cle = 'cave_jour_' + today(), decalage = 0;
    try { decalage = num(sessionStorage.getItem(cle)); } catch (e) {}
    var props = propositionDuJour(vins, decalage);
    if (!props.length) return '';
    return '<section class="card jour" id="jour"><div class="row" style="align-items:baseline"><h2 style="margin:0">Proposition du jour</h2>' +
      '<span class="small muted">' + new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + '</span>' +
      '<span class="spacer"></span><button class="ghost small" id="jour-autre">↻ Autre proposition</button></div>' +
      '<div class="jour-grid">' + props.map(function (p) {
        var b = p.o.v, img = vign[b.id];
        return '<div class="jour-item"><div class="eyebrow">' + p.moment.icone + ' ' + p.moment.titre + '</div>' +
          '<div class="row" style="gap:10px;flex-wrap:nowrap;align-items:flex-start">' +
            '<div class="thumb" style="width:46px;height:64px;' + (img ? 'background-image:url(' + img + ')' : '') + '">' + (img ? '' : esc((b.domaine || '?')[0])) + '</div>' +
            '<div style="min-width:0"><a class="t" href="#/bouteille/' + esc(b.id) + '">' + esc(libelle(b)) + (b.millesime ? ' ' + esc(b.millesime) : '') + '</a>' +
            '<div class="small muted">' + dot(b.couleur) + ' ' + esc([sousTitre(b), b.emplacement ? '📍 ' + b.emplacement : ''].filter(Boolean).join(' · ')) + '</div>' +
            '<div class="small" style="margin-top:4px">' + esc(raisonJour(b)) + ' · <strong>' + b.stock + ' btl</strong></div>' +
            (b.temp_service ? '<div class="small muted">Service ' + esc(b.temp_service) + (b.carafage && b.carafage !== 'inutile' ? ', carafe ' + esc(b.carafage) : '') + '</div>' : '') +
          '</div></div>' +
          '<button class="ghost small" style="margin-top:8px" data-ouvrir="' + esc(b.id) + '">' + (entamable(b) ? '🥃 J’en sers' : '🍷 Je l’ouvre') + '</button></div>';
      }).join('') + '</div></section>';
  }

  function lierPropositionDuJour(vins) {
    if (!$('#jour')) return;
    $('#jour-autre').onclick = function () {
      var cle = 'cave_jour_' + today(), d = 0;
      try { d = num(sessionStorage.getItem(cle)) + 1; sessionStorage.setItem(cle, d); } catch (e) {}
      route();
    };
    $$('[data-ouvrir]').forEach(function (b) {
      b.onclick = function () { formulaireSortie(vins.filter(function (x) { return x.id === b.getAttribute('data-ouvrir'); })[0], 'consommation'); };
    });
  }

  /* =========================================================
   * Exports : CSV (Excel), inventaire imprimable / PDF, classeur Google Sheets
   * ======================================================= */
  function versCsv(cols, lignes) {
    var cell = function (x) { return '"' + String(x === undefined || x === null ? '' : x).replace(/"/g, '""') + '"'; };
    return '﻿' + cols.map(function (c) { return cell(c[1]); }).join(';') + '\r\n' +
      lignes.map(function (l) { return cols.map(function (c) { return cell(typeof c[0] === 'function' ? c[0](l) : l[c[0]]); }).join(';'); }).join('\r\n');
  }
  function telecharger(nom, contenu, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenu], { type: type || 'text/csv;charset=utf-8' }));
    a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  var COLS_CAVE = [['id', 'Référence'], ['domaine', 'Domaine'], ['nom', 'Cuvée'], ['type', 'Type'], [function (v) { return categorieDe(v); }, 'Catégorie'], ['couleur', 'Couleur'],
    ['appellation', 'Appellation'], ['region', 'Région'], ['pays', 'Pays'], ['millesime', 'Millésime'], ['cepages', 'Cépages'],
    ['degre', 'Degré'], ['contenance_cl', 'Contenance (cl)'], ['stock', 'Stock'], ['niveau_entamee', 'Entamée (%)'], ['emplacement', 'Emplacement'],
    ['prix_moyen', 'Prix moyen d’achat (€)'], ['cote_unitaire', 'Cote (€)'], ['cote_date', 'Date de cote'],
    [function (v) { return Math.round((v.stock_effectif !== undefined ? v.stock_effectif : v.stock) * (num(v.cote_unitaire) || num(v.prix_moyen)) * 100) / 100; }, 'Valeur du stock (€)'],
    [function (v) { return MATURITE[v.maturite] || ''; }, 'Maturité'], ['boire_des', 'Buvable dès'], ['apogee_debut', 'Apogée début'],
    ['apogee_fin', 'Apogée fin'], ['boire_avant', 'À boire avant'], ['temp_service', 'Service'], ['carafage', 'Carafage'],
    ['accords', 'Accords'], ['aromes_nez', 'Nez'], ['aromes_bouche', 'Bouche'], ['description', 'Description'],
    ['note_perso', 'Ma note'], ['notes_perso', 'Mes notes'], ['achetees', 'Achetées'], ['consommees', 'Sorties'], ['dernier_achat', 'Dernier achat']];

  function dialogueExport() {
    modal('<h2>Exporter</h2><div class="quick-menu">' +
      '<button data-exp="cave"><span class="qi">📊</span><span><strong>Toute la cave (Excel / CSV)</strong><span class="small muted">Une ligne par référence : stock, emplacement, valeur, garde, notes</span></span></button>' +
      '<button data-exp="inventaire"><span class="qi">🖨</span><span><strong>Inventaire imprimable / PDF</strong><span class="small muted">Par emplacement, avec totaux : pour l’assurance ou la cave</span></span></button>' +
      '<button data-exp="journal"><span class="qi">📒</span><span><strong>Journal des mouvements (CSV)</strong><span class="small muted">Achats, sorties, ajustements, avec prix</span></span></button>' +
      '<button data-exp="degust"><span class="qi">🍷</span><span><strong>Dégustations (CSV)</strong><span class="small muted">De ma cave et d’ailleurs, notes et impressions</span></span></button>' +
      '<button data-exp="classeur"><span class="qi">🗂</span><span><strong>Ouvrir le classeur Google Sheets</strong><span class="small muted">Toutes les données brutes, en direct</span></span></button>' +
      '</div><p class="small muted">Les fichiers CSV s’ouvrent dans Excel (séparateur point-virgule, accents conservés).</p>',
      function (root) {
        $$('[data-exp]', root).forEach(function (b) {
          b.onclick = function () {
            var t = b.getAttribute('data-exp'); busy(b, true);
            var fin = function () { busy(b, false); };
            if (t === 'cave') {
              charger('vins', 'cave.lister', true).then(function (vins) {
                telecharger('cave-' + today() + '.csv', versCsv(COLS_CAVE, vins.filter(function (v) { return v.stock > 0; }))); fin(); toast('Export de la cave téléchargé');
              }).catch(function (e) { fin(); fail(e); });
            } else if (t === 'inventaire') { closeModal(); location.hash = '#/inventaire'; }
            else if (t === 'journal') {
              api('mvt.lister', { limite: 100000 }).then(function (l) {
                telecharger('journal-' + today() + '.csv', versCsv([['date', 'Date'], ['vin_nom', 'Bouteille'], [function (m) { return TYPES_MVT[m.type] || m.type; }, 'Type'],
                  ['quantite', 'Quantité'], ['prix_unitaire', 'Prix unitaire (€)'], ['fournisseur', 'Fournisseur'], ['occasion', 'Occasion'],
                  ['note_degustation', 'Note /20'], ['impressions', 'Impressions'], ['note', 'Remarque'], ['vin_id', 'Référence']], l)); fin(); toast('Journal téléchargé');
              }).catch(function (e) { fin(); fail(e); });
            } else if (t === 'degust') {
              Promise.all([api('mvt.lister', { limite: 100000 }), charger('prosp', 'prosp.lister', true), charger('vins', 'cave.lister', true)]).then(function (r) {
                var lignes = construireDegustations(r[0], r[1], r[2], {});
                telecharger('degustations-' + today() + '.csv', versCsv([['date', 'Date'], [function (x) { return x.source === 'cave' ? 'De ma cave' : (ORIGINES[x.source] || 'Ailleurs'); }, 'Source'],
                  ['titre', 'Bouteille'], ['sous', 'Appellation'], ['ou', 'Lieu / occasion'], ['qte', 'Bouteilles'], ['note', 'Note /20'], ['texte', 'Impressions'], ['prix', 'Prix vu (€)']], lignes));
                fin(); toast('Dégustations téléchargées');
              }).catch(function (e) { fin(); fail(e); });
            } else if (t === 'classeur') {
              api('export.classeur').then(function (r) {
                fin(); closeModal();
                window.open(r.url, '_blank', 'noopener');
              }).catch(function (e) { fin(); fail(e); });
            }
          };
        });
      });
  }

  /** Inventaire imprimable (Imprimer → Enregistrer en PDF). */
  function vueInventaire(v) {
    return charger('vins', 'cave.lister', true).then(function (vins) {
      var l = vins.filter(function (x) { return x.stock > 0; });
      var lieux = {};
      l.forEach(function (x) { (lieux[x.emplacement || 'Sans emplacement'] = lieux[x.emplacement || 'Sans emplacement'] || []).push(x); });
      var valeur = function (x) { return (x.stock_effectif !== undefined ? x.stock_effectif : x.stock) * (num(x.cote_unitaire) || num(x.prix_moyen)); };
      var totB = 0, totV = 0, totA = 0;
      var html = Object.keys(lieux).sort().map(function (k) {
        var arr = lieux[k].sort(function (a, b) { return libelle(a).localeCompare(libelle(b)) || num(a.millesime) - num(b.millesime); });
        var sb = 0, sv = 0;
        var rows = arr.map(function (x) {
          sb += x.stock; sv += valeur(x); totA += x.stock * num(x.prix_moyen);
          return '<tr><td>' + esc(libelle(x)) + '</td><td>' + esc(x.appellation || x.type || '') + '</td><td>' + esc(x.millesime || '') + '</td>' +
            '<td>' + esc(x.couleur || '') + '</td><td class="n">' + (num(x.contenance_cl) || '') + '</td><td class="n">' + x.stock +
            (num(x.niveau_entamee) > 0 ? ' <span class="small">(1 ent. ' + Math.round(num(x.niveau_entamee)) + ' %)</span>' : '') + '</td>' +
            '<td class="n">' + eur(num(x.prix_moyen), true) + '</td><td class="n">' + eur(num(x.cote_unitaire), true) + '</td><td class="n">' + eur(valeur(x)) + '</td></tr>';
        }).join('');
        totB += sb; totV += sv;
        return '<h3>📍 ' + esc(k) + ' <span class="small muted">· ' + sb + ' btl · ' + eur(sv) + '</span></h3>' +
          '<div class="table-wrap"><table class="inv"><thead><tr><th>Bouteille</th><th>Appellation</th><th>Mill.</th><th>Couleur</th><th class="n">cl</th><th class="n">Qté</th>' +
          '<th class="n">Achat</th><th class="n">Cote</th><th class="n">Valeur</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }).join('');
      v.innerHTML = '<div class="no-print"><p class="small"><a href="#/cave">← La cave</a></p></div>' +
        '<div class="head"><h1>Inventaire de la cave</h1><span class="spacer"></span>' +
        '<button class="no-print" id="inv-print">🖨 Imprimer / Enregistrer en PDF</button></div>' +
        '<p>Établi le ' + new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) +
        ' · <strong>' + totB + ' bouteilles</strong>, ' + l.length + ' références · valeur estimée <strong>' + eur(totV) + '</strong>' +
        (totA ? ' (prix d’achat ' + eur(totA) + ')' : '') + '</p>' +
        '<p class="small muted">Valeur = quantité × cote estimée, ou prix d’achat à défaut ; une bouteille entamée est comptée au prorata. Cotes indicatives.</p>' +
        '<div class="card inv-card">' + (html || '<p class="muted">Cave vide.</p>') + '</div>';
      $('#inv-print').onclick = function () { window.print(); };
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
    if (b) { b.innerHTML = ICO[cur[0]] + '<span class="th-l">' + cur[1] + '</span>'; b.title = cur[2] + ' (cliquer pour changer)'; b.setAttribute('aria-label', cur[2]); }
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

  function lireTexteFichier(f) {
    var lire = function (enc) {
      return new Promise(function (ok, ko) {
        var r = new FileReader();
        r.onload = function () { ok(String(r.result)); };
        r.onerror = function () { ko(new Error('Lecture du fichier impossible')); };
        r.readAsText(f, enc);
      });
    };
    return lire('UTF-8').then(function (t) { return t.indexOf('\uFFFD') > -1 ? lire('windows-1252') : t; });
  }

  function libPartage(p) {
    if (!p || p.mode === 'personne') return 'Non partagée';
    if (p.mode === 'tous') return 'Partagée avec tous les visiteurs';
    return 'Partagée avec ' + p.emails.length + ' personne' + (p.emails.length > 1 ? 's' : '');
  }

  function vueOffres(v, id) {
    if (id) return vueOffre(v, id);
    return charger('offres', 'offres.lister', true).then(function (list) {
      if (!estAdmin()) {
        v.innerHTML = '<div class="head"><h1>Offres</h1><span class="muted">Offres partagées par ' + esc(proprio()) + ' : composez votre sélection et envoyez-la</span></div>' +
          '<div class="card">' + (list.length ? '<table><tbody>' + list.map(function (o) {
            return '<tr><td><a href="#/offres/' + esc(o.id) + '"><strong>' + esc(o.vendeur || 'Vendeur') + '</strong></a><div class="small muted">' + esc(o.objet) + '</div></td>' +
              '<td class="small">' + dateFr(o.cree_le) + '</td><td class="n small">' + o.nb_articles + ' articles</td></tr>';
          }).join('') + '</tbody></table>' : '<p class="muted">Aucune offre partagée pour l’instant.</p>') + '</div>';
        return;
      }
      v.innerHTML = '<div class="head"><h1>Offres reçues</h1><span class="muted">Listes de vendeurs reçues par mail, analysées ligne par ligne</span></div>' +
        '<div class="grid" style="grid-template-columns:minmax(0,3fr) minmax(0,2fr);align-items:start" id="o-grid">' +
          '<form class="card" id="f-off"><h2>Analyser une offre</h2>' +
            '<p class="muted small">Dans Outlook, ouvrez le mail, sélectionnez tout le texte (Ctrl+A), copiez, puis collez-le ici. Gardez la partie frais de port : elle est prise en compte.</p>' +
            '<div class="form"><div><label for="o-vendeur">Vendeur</label><input id="o-vendeur" name="vendeur" placeholder="ex. Pierre, caviste…"></div>' +
            '<div><label for="o-objet">Objet du mail</label><input id="o-objet" name="objet"></div>' +
            '<div class="full"><label for="o-texte">Texte du mail</label><textarea id="o-texte" name="texte" style="min-height:220px" required placeholder="1 Ch. Meyney Saint-Estèphe 1988 = 25 euros&#10;…&#10;Frais de port : 1 bouteille = 8 euros…"></textarea></div>' +
            '<div class="full row"><span class="small muted">Comptez 20 à 60 secondes pour une longue liste.</span><span class="spacer"></span><button type="submit">✨ Analyser l’offre</button></div></div>' +
          '</form>' +
          '<form class="card" id="f-imp"><h2>Importer un catalogue</h2>' +
            '<p class="muted small">Pour les gros catalogues déjà structurés (tableur, extraction faite par Claude) : un fichier CSV au format d’import Ma Cave ' +
              '(séparateur point-virgule, colonne « Prix unitaire (€) » obligatoire) ou un JSON d’analyse. Les prix de marché déjà présents sont repris tels quels ; ' +
              'seuls les articles sans prix partent ensuite à l’IA, par lots de 30.</p>' +
            '<div class="form"><div class="full"><label for="i-fic">Fichier</label><input id="i-fic" type="file" accept=".csv,.json,.txt,text/csv,application/json" required></div>' +
            '<div><label for="i-vendeur">Vendeur</label><input id="i-vendeur" placeholder="ex. ViniPro"></div>' +
            '<div><label for="i-objet">Objet</label><input id="i-objet" placeholder="ex. Catalogue de fin d’année"></div>' +
            '<div class="full"><label for="i-carton">Unité de vente, pour les lignes qui ne la précisent pas</label><select id="i-carton">' +
              options([['0', 'Selon le fichier, sinon à la bouteille'], ['6', 'Selon le fichier, sinon carton de 6'], ['12', 'Selon le fichier, sinon carton de 12'], ['3', 'Selon le fichier, sinon carton de 3']], '0') + '</select></div>' +
            '<div><label for="i-min">Minimum par défaut</label><input id="i-min" type="number" min="1" max="99" value="1"></div>' +
            '<p class="full small muted" style="margin:0">L’unité se lit ligne par ligne : colonne « Vendu par (btl) » du fichier, sinon mentions du catalogue (« vendu par carton de 12 », « 1 carton acheté = 1 offert »), sinon ce réglage. ' +
              'Chaque ligne se corrige ensuite sur l’offre (clic sur son unité).</p>' +
            '<div class="full row"><label class="row" style="margin:0;font-weight:500;color:var(--ink)"><input type="checkbox" id="i-port" style="width:auto"> Port inclus (si le fichier ne le précise pas)</label>' +
              '<span class="spacer"></span><button type="submit">⤒ Importer</button></div></div>' +
          '</form>' +
          '<div class="card"><h2>Offres analysées</h2>' + (list.length ? '<table><tbody>' + list.map(function (o) {
            return '<tr><td><a href="#/offres/' + esc(o.id) + '"><strong>' + esc(o.vendeur || 'Vendeur') + '</strong></a>' +
              (o.partage && o.partage.mode !== 'personne' ? ' <span class="tag">' + libPartage(o.partage) + '</span>' : '') + '<div class="small muted">' + esc(o.objet) + '</div></td>' +
              '<td class="small">' + dateFr(o.cree_le) + '</td><td class="n small"><span class="up">' + (o.nb_affaires || 0) + '</span> / ' + o.nb_articles + '</td></tr>';
          }).join('') + '</tbody></table><p class="small muted">affaires / articles</p>' : '<p class="muted">Aucune offre analysée pour l’instant.</p>') + '</div>' +
        '</div>';
      if (window.matchMedia('(max-width: 820px)').matches) $('#o-grid').style.gridTemplateColumns = '1fr';
      // Le formulaire d'import rejoint la colonne de gauche, sous l'analyse de mail
      var gauche = document.createElement('div'); gauche.style.display = 'grid'; gauche.style.gap = '16px'; gauche.style.minWidth = '0';
      $('#o-grid').insertBefore(gauche, $('#f-off')); gauche.appendChild($('#f-off')); gauche.appendChild($('#f-imp'));
      $('#f-imp').onsubmit = function (e) {
        e.preventDefault();
        var f = $('#i-fic').files[0], btn = $('button[type=submit]', this);
        if (!f) return;
        if (f.size > 3000000) return toast('Fichier trop volumineux : découpez-le en plusieurs imports', true);
        busy(btn, true, 'Import…');
        lireTexteFichier(f).then(function (texte) {
          return api('offres.importer', { texte: texte, vendeur: $('#i-vendeur').value.trim(), objet: $('#i-objet').value.trim(), port_inclus: $('#i-port').checked,
            carton: $('#i-carton').value, lot_min: $('#i-min').value });
        }).then(function (r) {
          delete cache.offres;
          var un = r.unites || {};
          toast(r.nb_articles + ' articles importés' + (r.a_estimer ? ', ' + r.a_estimer + ' sans prix de marché' : '') +
            '. Unité de vente : ' + (un.fichier || 0) + ' lue(s) dans le fichier, ' + (un.remarque || 0) + ' déduite(s) des mentions, ' + (un.defaut || 0) + ' par défaut.');
          location.hash = '#/offres/' + r.id;
        }).catch(function (err) { busy(btn, false); fail(err); });
      };
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
      var partage = o.partage || { mode: 'personne', emails: [] };
      var fx = { q: '', cat: '', type: '', garde: '', accord: '', tri: 'verdict' };
      var aEstimer = arts.filter(function (x) { return x.estime === false; }).length;
      var faibles = arts.filter(function (x) { return x.confiance === 'faible' && x.source_estimation === 'préanalyse'; }).length;
      // Garde : même règle que sansGarde_ côté serveur
      var sansGarde = arts.filter(function (x) {
        return !x.garde_estimee && !num(x.boire_des) && !num(x.boire_avant) && !/spiritueux|liqueur|bi[eè]re/i.test(x.type || '') && !/coffret/i.test(x.designation || '');
      }).length;
      var aGarde = function (x) { return num(x.boire_des) || num(x.apogee_debut) || num(x.apogee_fin) || num(x.boire_avant); };
      var matArt = function (x) {
        if (!aGarde(x)) return x.a_boire === 'garde' ? 'peut_attendre' : x.a_boire === 'maintenant' ? 'a_boire' : '';
        var m = maturiteLocale(x);
        // Vin annoncé « de garde » sans date de début : il gagne encore à attendre
        if (x.a_boire === 'garde' && !num(x.boire_des) && /^a_boire/.test(m) && num(x.boire_avant) - ANNEE >= 4) return 'peut_attendre';
        return m;
      };
      var accordsDispo = [];
      arts.forEach(function (x) { (x.accords || []).forEach(function (c) { if (accordsDispo.indexOf(c) < 0) accordsDispo.push(c); }); });
      var GARDES = { maintenant: ['a_boire', 'apogee', 'a_boire_vite'], garder: ['trop_jeune', 'peut_attendre'], passe: ['passee'] };
      var cats = arts.map(function (x) { return x.categorie; }).filter(Boolean).filter(function (x, i, t) { return t.indexOf(x) === i; });
      var types = arts.map(function (x) { return x.type; }).filter(Boolean).filter(function (x, i, t) { return t.indexOf(x) === i; });
      var CONF = { haute: 'confiance haute', moyenne: 'confiance moyenne', faible: 'confiance faible' };
      var enCave = function (art) {
        var d = norm(art.domaine || '').replace(/^(chateau|ch\.?|domaine|dom\.?)\s+/, '');
        return d.length > 3 && vins.some(function (x) { return norm(x.domaine).indexOf(d) > -1; });
      };
      var compte = {};
      arts.forEach(function (x) { compte[x.verdict] = (compte[x.verdict] || 0) + 1; });

      v.innerHTML = '<p class="small"><a href="#/offres">← Offres</a></p>' +
        '<div class="head"><div><h1>' + esc(o.vendeur || 'Offre') + '</h1><div class="muted">' + esc(o.objet) + ' · ' + (a.importee ? 'importée' : 'analysée') + ' le ' + dateFr(o.cree_le) + '</div></div>' +
        '<span class="spacer"></span>' + (estAdmin() ? '<button class="ghost small" id="o-partage" title="Qui voit cette offre et peut vous envoyer sa sélection">👥 ' + libPartage(partage) + '</button>' +
          '<button class="danger small" id="o-del">Supprimer</button>' : '') + '</div>' +
        (a.synthese ? '<div class="ia-box" style="margin-bottom:12px">' + esc(a.synthese) + '</div>' : '') +
        ((a.alertes || []).length ? '<div class="card" style="margin-bottom:12px;border-color:var(--warn)"><strong>Points d’attention</strong><ul style="margin:6px 0 0;padding-left:20px">' +
          a.alertes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
        (estAdmin() && (aEstimer || faibles) ? '<div class="card" id="o-est" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
          '<span style="flex:1;min-width:220px">' + (aEstimer ? '<strong>' + aEstimer + ' article' + (aEstimer > 1 ? 's' : '') + ' sans prix de marché.</strong> ' : 'Tous les articles ont un prix de marché. ') +
            '<span class="small muted">L’IA les estime par lots de 30 (une requête Gemini par lot).</span></span>' +
          (faibles ? '<label class="row small" style="margin:0;font-weight:500;color:var(--ink);flex-wrap:nowrap"><input type="checkbox" id="o-faible" style="width:auto"' + (aEstimer ? '' : ' checked') + '> revoir aussi les ' + faibles + ' préestimations de confiance faible</label>' : '') +
          '<button id="o-estimer">✨ Estimer avec l’IA</button></div>' : '') +
        (estAdmin() && sansGarde ? '<div class="card" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
          '<span style="flex:1;min-width:220px"><strong>' + sansGarde + ' vin' + (sansGarde > 1 ? 's' : '') + ' sans indication de garde.</strong> ' +
            '<span class="small muted">L’IA donne pour chacun la fenêtre « buvable dès, apogée, à boire avant », par lots de 40 sur le modèle léger (environ ' + Math.ceil(sansGarde / 40) + ' requête' + (sansGarde > 40 ? 's' : '') + ').</span></span>' +
          '<button id="o-garde">⏳ Estimer la garde</button></div>' : '') +
        (estAdmin() && a.importee ? '<div class="row small" style="margin:0 0 12px;gap:8px"><span class="muted">Vente par défaut (articles sans mention dans le catalogue) :</span>' +
          '<select id="o-carton" style="width:auto;padding:4px 8px">' + options([['0', 'à la bouteille'], ['6', 'carton de 6'], ['12', 'carton de 12'], ['3', 'carton de 3']], String(num(a.carton_defaut))) + '</select>' +
          '<label for="o-min" style="margin:0">minimum</label><input id="o-min" type="number" min="1" max="99" value="' + (num(a.lot_min_defaut) || 1) + '" style="width:64px;padding:4px 6px">' +
          '<button class="ghost small" id="o-cond">Appliquer</button></div>' : '') +
        '<div class="cats" id="o-filtres"></div>' +
        (arts.length > 20 ? '<div class="filters" style="margin-bottom:12px"><input id="o-q" placeholder="Rechercher (domaine, appellation, réf.)…">' +
          (cats.length > 1 ? '<select id="o-cat">' + options(cats, '', 'Toutes catégories') + '</select>' : '') +
          (types.length > 1 ? '<select id="o-type">' + options(types, '', 'Tous types') + '</select>' : '') +
          (accordsDispo.length ? '<select id="o-accord">' + options(accordsDispo.sort(), '', 'Tous accords') + '</select>' : '') +
          (arts.some(matArt) ? '<select id="o-garde-f">' + options([['maintenant', 'À boire maintenant'], ['garder', 'À garder'], ['passe', 'Garde dépassée'], ['inconnue', 'Garde inconnue']], '', 'Toute garde') + '</select>' : '') +
          '<select id="o-tri">' + options([['verdict', 'Tri : verdict'], ['ecart', 'Tri : écart'], ['prix', 'Tri : prix'], ['garde', 'Tri : garde la plus longue'], ['catalogue', 'Tri : n° catalogue']], 'verdict') + '</select></div>' : '') +
        '<div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start" id="o-main">' +
          '<div class="card" style="padding:0"><div class="table-wrap"><table id="o-table"></table></div></div>' +
          '<div class="card" id="o-panier" style="position:sticky;top:calc(env(safe-area-inset-top, 0px) + 70px)"></div>' +
        '</div>' +
        '<p class="small muted">Prix de marché : estimations de l’IA, à recouper pour les achats importants. « Prix rendu » = prix + part du port pour le panier en cours.</p>';
      if (window.matchMedia('(max-width: 900px)').matches) { $('#o-main').style.gridTemplateColumns = '1fr'; $('#o-panier').style.position = 'static'; }

      // Unité de vente : le panier compte des unités (bouteille, carton, lot), les prix restent par bouteille
      var parUnite = function (x) { return Math.max(1, num(x.vendu_par) || 1); };
      var dispoMax = function (x) { return a.importee && num(x.quantite_dispo) <= 1 ? 99 : num(x.quantite_dispo) || 99; };
      var libUnites = function (x, q) {
        var u = parUnite(x);
        if (u === 1) return q + ' btl';
        var cart = /^carton de/.test(x.conditionnement || '');
        return q + ' ' + (cart ? 'carton' : 'lot') + (q > 1 ? 's' : '') + ' (' + q * u + ' btl)';
      };
      function totaux() {
        var t = { lignes: 0, btl: 0, equiv: 0, sous: 0, marche: 0, marcheConnu: true };
        arts.forEach(function (x) {
          var q = num(panier[x.n]); if (!q) return;
          var b = q * parUnite(x);
          t.lignes++; t.btl += b; t.sous += b * x.prix_unitaire;
          if (!x.port_inclus) t.equiv += b * x.equiv_bouteilles;
          if (x.prix_marche) t.marche += b * x.prix_marche; else t.marcheConnu = false;
        });
        t.equiv = Math.ceil(t.equiv);
        t.port = t.lignes && !t.equiv ? 0 : calculGrille(a.frais_port, t.equiv);   // tout en port inclus
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
        var q = norm(fx.q);
        var tris = {
          verdict: function (x, y) { return VERDICT_ORDRE.indexOf(x.verdict) - VERDICT_ORDRE.indexOf(y.verdict) || (x.ecart || 0) - (y.ecart || 0); },
          ecart: function (x, y) { return (x.ecart === null ? 999 : x.ecart) - (y.ecart === null ? 999 : y.ecart); },
          prix: function (x, y) { return x.prix_unitaire - y.prix_unitaire; },
          catalogue: function (x, y) { return (num(x.num_catalogue) || x.n) - (num(y.num_catalogue) || y.n); },
          garde: function (x, y) { return (num(y.boire_avant) || num(y.apogee_fin)) - (num(x.boire_avant) || num(x.apogee_fin)); }
        };
        var l = arts.filter(function (x) {
          if (filtre && (filtre === 'panier' ? !(num(panier[x.n]) > 0) : x.verdict !== filtre)) return false;
          if (fx.cat && x.categorie !== fx.cat) return false;
          if (fx.type && x.type !== fx.type) return false;
          if (fx.garde && (fx.garde === 'inconnue' ? matArt(x) : GARDES[fx.garde].indexOf(matArt(x)) < 0)) return false;
          if (fx.accord && (x.accords || []).indexOf(fx.accord) < 0) return false;
          if (q) {
            var h = norm([x.designation, x.domaine, x.appellation, x.categorie, x.millesime, x.ref, x.num_catalogue, x.commentaire, x.etat,
              (x.accords || []).join(' '), x.distinctions, x.degustation].join(' '));
            if (!q.split(/\s+/).every(function (w) { return h.indexOf(w) > -1; })) return false;
          }
          return true;
        }).sort(tris[fx.tri] || tris.verdict);
        $('#o-table').innerHTML = '<thead><tr><th>Panier</th><th>Article</th><th>Verdict</th><th class="n">Prix u.</th><th class="n">Marché</th><th class="n">Écart</th><th class="n">Prix rendu</th></tr></thead><tbody>' +
          (l.length ? l.map(function (x) {
            var rendu = x.prix_unitaire + (x.port_inclus ? 0 : portParEquiv * x.equiv_bouteilles);
            var u = parUnite(x), qn = num(panier[x.n]) || 0;
            return '<tr><td><input type="number" min="0" max="' + dispoMax(x) + '" value="' + qn + '" data-n="' + x.n + '" aria-label="Quantité (' + (u > 1 ? 'cartons ou lots' : 'bouteilles') + ')" style="width:64px;padding:5px 6px">' +
                '<div class="small muted" style="margin-top:2px;max-width:110px">' + (u > 1 ? (qn ? libUnites(x, qn) : '× ' + u + ' btl') : 'bouteille' + (qn > 1 ? 's' : '')) +
                  (num(x.lot_min) > 1 ? '<br>min. ' + x.lot_min : '') + (dispoMax(x) < 99 ? '<br>dispo ' + dispoMax(x) : '') + '</div></td>' +
              '<td style="min-width:220px">' + dot(x.couleur) + ' <button type="button" class="lien-art" data-fiche="' + x.n + '">' + esc(x.designation) + '</button>' +
                (x.distinctions ? ' <span class="tag tag-medaille" title="' + esc(x.distinctions) + '">🏅 ' + esc(String(x.distinctions).split(/\s*,\s*/)[0]) + '</span>' : '') +
                (x.format_cl && x.format_cl !== 75 ? ' <span class="tag">' + esc(x.format_cl) + ' cl</span>' : '') +
                (estAdmin() && a.importee ? ' <button type="button" class="tag tag-cond tag-btn" data-cond="' + x.n + '" title="Modifier l’unité de vente de cette ligne">' +
                    esc(u > 1 ? x.conditionnement || 'par ' + u : 'à la bouteille') + (x.cond_source === 'defaut' ? ' ?' : '') + ' ✎</button>'
                  : u > 1 ? ' <span class="tag tag-cond">' + esc(x.conditionnement || 'par ' + u) + '</span>' : '') +
                (x.port_inclus ? ' <span class="tag">port inclus</span>' : '') +
                (enCave(x) ? ' <span class="tag">déjà en cave</span>' : '') +
                (x.millesime && String(x.designation).indexOf(String(x.millesime)) < 0 ? ' <span class="muted">' + esc(x.millesime) + '</span>' : '') +
                '<div class="small muted">' + esc([x.etat, x.commentaire].filter(Boolean).join(' · ')) + '</div>' +
                ((x.accords || []).length ? '<div class="o-acc">' + x.accords.slice(0, 5).map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
                (x.ref || x.num_catalogue || x.confiance ? '<div class="small muted o-meta">' +
                  [x.num_catalogue ? 'n° ' + esc(x.num_catalogue) : '', x.ref ? 'réf. ' + esc(x.ref) : '',
                   x.confiance && x.prix_marche ? '<span class="conf conf-' + esc(x.confiance) + '">' + esc(CONF[x.confiance] || x.confiance) +
                     (x.source_estimation === 'Gemini' ? ' (IA)' : '') + '</span>' : ''].filter(Boolean).join(' · ') + '</div>' : '') + '</td>' +
              '<td>' + pillVerdict(x.verdict) +
                (matArt(x) ? '<div style="margin-top:4px">' + pillMat(matArt(x)) + '</div><div class="small muted">' +
                    esc([num(x.boire_des) ? 'dès ' + x.boire_des : '', num(x.apogee_debut) && num(x.apogee_fin) ? 'apogée ' + x.apogee_debut + '–' + x.apogee_fin : '',
                         num(x.boire_avant) ? 'jusqu’en ' + x.boire_avant : '', x.garde_vendeur && !/plusieurs/.test(x.garde_vendeur) ? 'garde ' + x.garde_vendeur : ''].filter(Boolean).join(' · ')) + '</div>'
                  : x.a_boire ? '<div class="small muted" style="margin-top:4px">' + esc(x.a_boire) + '</div>' : '') + '</td>' +
              '<td class="n">' + eur(x.prix_unitaire, true) + (u > 1 ? '<div class="small muted">la btl</div><div class="small">' + eur(u * x.prix_unitaire, true) + ' les ' + u + '</div>' : '') +
                (x.prix_barre ? '<div class="small muted"><s>' + eur(x.prix_barre, true) + '</s></div>' : '') +
                '</td><td class="n">' + (x.prix_marche ? eur(x.prix_marche) : '-') + '</td>' +
              '<td class="n ' + (x.ecart < 0 ? 'up' : x.ecart > 0 ? 'down' : '') + '">' + (x.ecart === null ? '-' : (x.ecart > 0 ? '+' : '') + x.ecart + ' %') + '</td>' +
              '<td class="n">' + eur(rendu, true) + '</td></tr>';
          }).join('') : '<tr><td colspan="7" class="empty">' + (filtre === 'panier' ? 'Panier vide : indiquez une quantité sur les lignes qui vous intéressent.' : 'Aucun article.') + '</td></tr>') + '</tbody>';
        $$('#o-table [data-fiche]').forEach(function (bt) {
          bt.onclick = function () { ficheArticle(arts.filter(function (y) { return String(y.n) === bt.getAttribute('data-fiche'); })[0]); };
        });
        $$('#o-table [data-cond]').forEach(function (bt) {
          bt.onclick = function () {
            var x = arts.filter(function (y) { return String(y.n) === bt.getAttribute('data-cond'); })[0];
            modal('<h2>Unité de vente</h2><p class="muted" style="margin-top:-4px">' + esc(x.designation) + (x.ref ? ' · réf. ' + esc(x.ref) : '') + '</p>' +
              (x.etat ? '<p class="small">Mention du catalogue : ' + esc(x.etat) + '</p>' : '') +
              '<form id="f-cond"><div class="grid g2" style="gap:10px"><div><label for="c-u">Bouteilles par unité commandée</label><input id="c-u" type="number" min="1" max="120" value="' + parUnite(x) + '"></div>' +
              '<div><label for="c-min">Minimum (unités)</label><input id="c-min" type="number" min="1" max="99" value="' + (num(x.lot_min) || 1) + '"></div></div>' +
              '<label for="c-lib">Libellé</label><input id="c-lib" maxlength="80" value="' + esc(x.conditionnement || '') + '" placeholder="ex. carton de 6, 2 cartons de 6 dont 1 offert">' +
              '<p class="small muted">Le prix reste celui d’une bouteille (' + eur(x.prix_unitaire, true) + ') ; 1 = vente à la bouteille.</p>' +
              '<div class="row"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">Enregistrer</button></div></form>',
              function (root) {
                $('#m-annuler', root).onclick = closeModal;
                $('#f-cond', root).onsubmit = function (e) {
                  e.preventDefault();
                  var b2 = $('button[type=submit]', this); busy(b2, true);
                  api('offres.majArticle', { id: id, n: x.n, vendu_par: $('#c-u', root).value, lot_min: $('#c-min', root).value, conditionnement: $('#c-lib', root).value })
                    .then(function (r) {
                      x.vendu_par = r.vendu_par; x.conditionnement = r.conditionnement; x.lot_min = r.lot_min; x.cond_source = 'manuel';
                      if (panier[x.n] && num(panier[x.n]) < r.lot_min) panier[x.n] = r.lot_min;
                      try { localStorage.setItem(cle, JSON.stringify(panier)); } catch (err) {}
                      closeModal(); toast('Unité de vente enregistrée'); rendreTable();
                    }).catch(function (err) { busy(b2, false); fail(err); });
                };
              });
          };
        });
        $$('#o-table input[data-n]').forEach(function (i) {
          i.onchange = function () {
            var n = i.getAttribute('data-n'), x = arts.filter(function (y) { return String(y.n) === n; })[0];
            var q = Math.max(0, Math.min(num(i.max), Math.round(num(i.value))));
            if (q && x && q < num(x.lot_min)) { q = num(x.lot_min); toast('Minimum ' + q + ' pour cet article'); }
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
          ligne(t.btl + ' bouteille' + (t.btl > 1 ? 's' : '') + ' · ' + t.equiv + ' éq. btl', '') +
          ligne('Sous-total', eur(t.sous, true)) +
          ligne('Port', t.port === null ? '<span class="muted">grille absente</span>' : !t.equiv ? 'inclus' : eur(t.port, true)) +
          ((a.assurance || []).length ? '<label class="row small" style="font-weight:500;color:var(--ink);margin:4px 0"><input type="checkbox" id="o-assur" style="width:auto"' + (assurance ? ' checked' : '') + '> Assurance ' + (assurance ? eur(t.assur, true) : '') + '</label>' : '') +
          '<hr style="border:0;border-top:1px solid var(--line)">' + ligne('Total', eur(t.total, true), true) +
          ligne('Moyenne par bouteille', eur(t.total / t.btl, true)) +
          (eco !== null ? ligne('Économie vs marché', '<span class="' + (eco >= 0 ? 'up' : 'down') + '">' + eur(Math.abs(eco)) + (eco < 0 ? ' de plus' : '') + '</span>') : '') +
          (t.port !== null && a.frais_port && a.frais_port.length ? '<p class="small muted">' + conseilPort(a.frais_port, t.equiv) + '</p>' : '') +
          '<div class="row" style="margin-top:10px">' + (estAdmin() ? '<button id="o-copier">Copier la commande</button><button class="ghost" id="o-suivi">Ajouter à la prospection</button>'
            : '<button id="o-envoyer">🛒 Envoyer ma sélection à ' + esc(proprio()) + '</button>') + '</div>' +
          '<textarea id="o-cmd" readonly hidden style="margin-top:8px;min-height:150px"></textarea>'
          : '<p class="muted">Indiquez des quantités dans le tableau pour calculer le coût avec le port.</p>');
        if (!t.lignes) return;
        if ($('#o-assur')) $('#o-assur').onchange = function () { assurance = this.checked; rendreTable(); };
        var lignesPanier = function () {
          return arts.filter(function (x) { return num(panier[x.n]); }).map(function (x) {
            return '- ' + libUnites(x, num(panier[x.n])) + ' × ' + x.designation + (x.millesime && String(x.designation).indexOf(String(x.millesime)) < 0 ? ' ' + x.millesime : '') +
              (x.ref ? ' (réf. ' + x.ref + ')' : '') + (parUnite(x) > 1 && x.conditionnement ? ', ' + x.conditionnement : '') +
              ' : ' + eur(x.prix_unitaire, true) + ' la btl, soit ' + eur(num(panier[x.n]) * parUnite(x) * x.prix_unitaire, true);
          }).join('\n');
        };
        if ($('#o-envoyer')) $('#o-envoyer').onclick = function () {
          var txt = lignesPanier() + '\n\nTotal : ' + eur(t.total, true) + (t.port ? ' (dont ' + eur(t.port, true) + ' de port)' : '');
          envoyerEch(this, { type: 'selection', offre_id: id, message: txt, prix: Math.round(t.total * 100) / 100 },
            'Sélection envoyée à ' + proprio(), function () { panier = {}; try { localStorage.removeItem(cle); } catch (e) {} rendreTable(); });
        };
        if (!$('#o-copier')) return;
        $('#o-copier').onclick = function () {
          var txt = 'Bonjour' + (o.vendeur ? ' ' + o.vendeur : '') + ',\n\nJe serais intéressé par :\n' +
            arts.filter(function (x) { return num(panier[x.n]); }).map(function (x) {
              return '- ' + libUnites(x, num(panier[x.n])) + ' × ' + x.designation + (x.ref ? ' (réf. ' + x.ref + ')' : '') +
                ' : ' + eur(x.prix_unitaire, true) + (parUnite(x) > 1 ? ' la btl, soit ' + eur(num(panier[x.n]) * parUnite(x) * x.prix_unitaire, true) : '');
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
              note: libUnites(x, num(panier[x.n])) + ' · ' + (VERDICTS[x.verdict] || '') + (x.prix_marche ? ' (marché ~' + x.prix_marche + ' €)' : '') + (x.commentaire ? ' · ' + x.commentaire : '') });
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

      if ($('#o-cond')) $('#o-cond').onclick = function () {
        var bt = this; busy(bt, true);
        api('offres.conditionner', { id: id, carton: $('#o-carton').value, lot_min: $('#o-min').value }).then(function () {
          try { localStorage.removeItem(cle); } catch (e) {}
          toast('Unités de vente mises à jour (panier vidé)'); route();
        }).catch(function (e) { busy(bt, false); fail(e); });
      };
      if ($('#o-partage')) $('#o-partage').onclick = function () {
        var bt = this; busy(bt, true);
        api('users.lister').then(function (users) {
          busy(bt, false);
          var dest = users.filter(function (u) { return u.actif && !u.moi; });
          modal('<h2>Partager l’offre</h2><p class="muted" style="margin-top:-4px">Les personnes choisies voient l’offre dans leur menu Offres et peuvent vous envoyer leur sélection.</p>' +
            '<form id="f-part">' +
              [['personne', 'Personne (offre privée)'], ['tous', 'Tous les visiteurs, y compris ceux ajoutés plus tard'], ['certains', 'Seulement certaines personnes']].map(function (m) {
                return '<label class="row" style="font-weight:500;color:var(--ink);margin:4px 0"><input type="radio" name="mode" value="' + m[0] + '" style="width:auto"' + (partage.mode === m[0] ? ' checked' : '') + '> ' + m[1] + '</label>';
              }).join('') +
              '<fieldset id="p-qui" style="margin-top:8px"' + (partage.mode === 'certains' ? '' : ' hidden') + '><legend>Qui ?</legend>' +
                (dest.length ? '<div class="dest">' + dest.map(function (u) {
                  return '<label class="row"><input type="checkbox" name="qui" value="' + esc(u.email) + '" style="width:auto"' + (partage.emails.indexOf(u.email) > -1 ? ' checked' : '') + '> ' +
                    esc(u.nom || u.email) + ' <span class="small muted">' + esc(u.email) + '</span></label>';
                }).join('') + '</div>' : '<p class="muted">Ajoutez d’abord des personnes dans <a href="#/acces">Accès</a>.</p>') + '</fieldset>' +
              '<div class="row" style="margin-top:12px"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Annuler</button><button type="submit">Enregistrer</button></div></form>',
            function (root) {
              $('#m-annuler', root).onclick = closeModal;
              $$('[name=mode]', root).forEach(function (r) { r.onchange = function () { $('#p-qui', root).hidden = $('[name=mode]:checked', root).value !== 'certains'; }; });
              $('#f-part', root).onsubmit = function (e) {
                e.preventDefault();
                var mode = $('[name=mode]:checked', root).value;
                var emails = $$('[name=qui]:checked', root).map(function (c) { return c.value; });
                if (mode === 'certains' && !emails.length) return toast('Cochez au moins une personne', true);
                var b2 = $('button[type=submit]', this); busy(b2, true);
                api('offres.partager', { id: id, mode: mode, emails: emails }).then(function (r) {
                  partage = r.partage; delete cache.offres; closeModal();
                  bt.innerHTML = '👥 ' + libPartage(partage);
                  toast(partage.mode === 'personne' ? 'Offre privée' : 'Offre partagée : ' + libPartage(partage).toLowerCase());
                }).catch(function (err) { busy(b2, false); fail(err); });
              };
            });
        }).catch(function (e) { busy(bt, false); fail(e); });
      };
      if ($('#o-del')) $('#o-del').onclick = function () {
        if (!window.demoConfirm('Supprimer cette analyse ?')) return;
        api('offres.supprimer', { id: id }).then(function () { delete cache.offres; location.hash = '#/offres'; }).catch(fail);
      };
      if ($('#o-q')) $('#o-q').oninput = function () { fx.q = this.value; rendreTable(); };
      if ($('#o-cat')) $('#o-cat').onchange = function () { fx.cat = this.value; rendreTable(); };
      if ($('#o-type')) $('#o-type').onchange = function () { fx.type = this.value; rendreTable(); };
      if ($('#o-tri')) $('#o-tri').onchange = function () { fx.tri = this.value; rendreTable(); };
      function ficheArticle(x) {
        var kv = function (k, val) { return val ? '<dt>' + k + '</dt><dd>' + val + '</dd>' : ''; };
        var m = matArt(x);
        modal('<h2 style="margin-bottom:4px">' + esc(x.designation) + (x.millesime && String(x.designation).indexOf(String(x.millesime)) < 0 ? ' ' + esc(x.millesime) : '') + '</h2>' +
          '<p class="muted" style="margin-top:0">' + esc([x.type, x.couleur, x.appellation, x.categorie].filter(Boolean).filter(function (y, i, t) { return t.indexOf(y) === i; }).join(' · ')) + '</p>' +
          '<div class="row" style="gap:6px;margin-bottom:10px">' + pillVerdict(x.verdict) + (m ? pillMat(m) : '') +
            (x.distinctions ? String(x.distinctions).split(/\s*,\s*/).map(function (d) { return '<span class="tag tag-medaille">🏅 ' + esc(d) + '</span>'; }).join('') : '') + '</div>' +
          (x.degustation ? '<p>' + esc(x.degustation) + '</p>' : '') +
          ((x.accords || []).length ? '<div class="tags" style="margin-bottom:10px">' + x.accords.map(function (c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
          '<dl class="kv">' +
            kv('Garde', esc([x.garde_vendeur ? x.garde_vendeur + ' (vendeur)' : '', num(x.boire_des) ? 'dès ' + x.boire_des : '', num(x.boire_avant) ? 'jusqu’en ' + x.boire_avant : ''].filter(Boolean).join(' · '))) +
            kv('Service', esc(x.temperature)) + kv('Degré', esc(x.degre)) + kv('Sucre', esc(x.sucre)) +
            kv('Format', x.format_cl ? esc(x.format_cl) + ' cl' : '') + kv('Vente', esc(x.conditionnement || (num(x.vendu_par) > 1 ? 'par ' + x.vendu_par : 'à la bouteille'))) +
            kv('Prix', eur(x.prix_unitaire, true) + ' la btl' + (x.prix_barre ? ' <s class="muted">' + eur(x.prix_barre, true) + '</s>' : '')) +
            kv('Marché', x.prix_marche ? eur(x.prix_marche) + (x.ecart !== null ? ' (' + (x.ecart > 0 ? '+' : '') + x.ecart + ' %)' : '') + (x.commentaire ? '<div class="small muted">' + esc(x.commentaire) + '</div>' : '') : '') +
            kv('Remarque', esc(x.etat)) + kv('Référence', esc([x.ref ? 'réf. ' + x.ref : '', x.num_catalogue ? 'n° ' + x.num_catalogue : ''].filter(Boolean).join(' · '))) +
          '</dl>' +
          '<div class="row" style="margin-top:12px"><span class="spacer"></span><button type="button" class="ghost" id="m-annuler">Fermer</button>' +
            (estAdmin() ? '<a class="btn" href="#/ajouter?off=' + encodeURIComponent(id) + '&n=' + x.n + '">📥 Acheté : ajouter à la cave</a>' : '') + '</div>',
          function (root) {
            $('#m-annuler', root).onclick = closeModal;
            $$('a.btn', root).forEach(function (l) { l.addEventListener('click', closeModal); });
          });
      }
      if ($('#o-garde-f')) $('#o-garde-f').onchange = function () { fx.garde = this.value; rendreTable(); };
      if ($('#o-accord')) $('#o-accord').onchange = function () { fx.accord = this.value; rendreTable(); };
      if ($('#o-garde')) $('#o-garde').onclick = function () {
        var btn = this, total = 0;
        busy(btn, true, 'Garde…');
        (function suivant() {
          api('offres.estimerGarde', { id: id, lots: 1 }).then(function (r) {
            total = total || r.total;
            btn.innerHTML = '<span class="spin"></span> ' + (total - r.restants) + ' / ' + total;
            if (r.restants > 0 && r.restants < r.total) return suivant();
            toast(r.restants ? 'L’IA n’a pas pu tout estimer : relancez plus tard' : 'Garde estimée'); route();
          }).catch(function (e) {
            if (e.code === 'IA_QUOTA' || e.code === 'IA_SATURE') {
              btn.innerHTML = '<span class="spin"></span> pause (' + (e.code === 'IA_QUOTA' ? 'quota' : 'Gemini surchargé') + ')…';
              return setTimeout(suivant, 30000);
            }
            busy(btn, false); fail(e); route();
          });
        })();
      };
      if ($('#o-estimer')) $('#o-estimer').onclick = function () {
        var btn = this, revoir = !!($('#o-faible') && $('#o-faible').checked), total = 0;
        if (!aEstimer && !revoir) return toast('Cochez « revoir aussi… » pour relancer l’estimation', true);
        busy(btn, true, 'Estimation…');
        if ($('#o-faible')) $('#o-faible').disabled = true;
        (function suivant() {
          api('offres.estimerPrix', { id: id, revoir_faible: revoir, lots: 1 }).then(function (r) {
            total = total || r.total;
            btn.innerHTML = '<span class="spin"></span> ' + (total - r.restants) + ' / ' + total;
            if (r.restants > 0 && r.restants < r.total) return suivant();   // s'arrête si un lot n'a rien donné
            delete cache.offres; toast('Estimation terminée : ' + r.nb_affaires + ' affaires'); route();
          }).catch(function (e) {
            if (e.code === 'IA_QUOTA' || e.code === 'IA_SATURE') {
              btn.innerHTML = '<span class="spin"></span> pause (' + (e.code === 'IA_QUOTA' ? 'quota' : 'Gemini surchargé') + ')…';
              return setTimeout(suivant, 30000);
            }
            busy(btn, false); fail(e); route();
          });
        })();
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
