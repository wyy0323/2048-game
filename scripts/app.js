/* ============================================================
   app.js · 视图与交互控制
   ------------------------------------------------------------
   视觉结构与参考稿一致：tile 外层负责位移，内层负责外观与动画
   负责：布局、渲染、输入、撤回栈、自动存档状态
   ============================================================ */
(function () {
  'use strict';

  var SIZE = 4;
  var HISTORY_LIMIT = 50;

  var els = {
    board: document.getElementById('board'),
    grid: document.getElementById('grid'),
    tiles: document.getElementById('tiles'),
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    undoBtn: document.getElementById('btn-undo'),
    undoBadge: document.getElementById('undo-badge'),
    newBtn: document.getElementById('btn-new'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayText: document.getElementById('overlay-text'),
    overlayUndo: document.getElementById('ov-undo'),
    overlayNew: document.getElementById('ov-new'),
    overlayContinue: document.getElementById('ov-continue'),
    saveDot: document.getElementById('save-dot'),
    saveText: document.getElementById('save-text'),
    roundTime: document.getElementById('round-time'),
    totalTime: document.getElementById('total-time'),
    toast: document.getElementById('toast')
  };

  var tileEls = new Map();   // id -> { el, inner, value }
  var state = Game2048.create();
  var history = [];
  var best = SaveStore.readBest();
  var toastTimer = null;
  var gap = 12;
  var cell = 90;
  var totalMs = 0;           // 累计游玩时长（跨局、跨会话）
  var roundMs = 0;           // 当前对局游玩时长
  var lastTick = 0;

  /* ---------------- 布局 ---------------- */
  for (var i = 0; i < SIZE * SIZE; i++) {
    var cellEl = document.createElement('div');
    cellEl.className = 'cell';
    els.grid.appendChild(cellEl);
  }

  function layout() {
    var w = els.board.clientWidth || 400;
    gap = Math.max(7, Math.round(w * 0.027));
    cell = (w - gap * (SIZE + 1)) / SIZE;
    els.board.style.setProperty('--gap', gap + 'px');
    els.board.style.setProperty('--cell', cell + 'px');
    repositionAll();
  }

  function positionTile(el, r, c) {
    el.style.transform = 'translate(' + (gap + c * (cell + gap)) + 'px, ' +
      (gap + r * (cell + gap)) + 'px)';
  }

  function repositionAll() {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var tile = state.grid[r][c];
        if (!tile) continue;
        var rec = tileEls.get(tile.id);
        if (rec) positionTile(rec.el, r, c);
      }
    }
  }

  /* ---------------- 渲染 ---------------- */
  function setTileValue(inner, value) {
    inner.textContent = value;
    inner.dataset.value = value <= 2048 ? String(value) : 'super';
  }

  function render() {
    var alive = {};

    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var tile = state.grid[r][c];
        if (!tile) continue;
        alive[tile.id] = true;

        var rec = tileEls.get(tile.id);
        if (!rec) {
          var el = document.createElement('div');
          el.className = 'tile';
          var inner = document.createElement('div');
          inner.className = 'tile-inner';
          setTileValue(inner, tile.value);

          positionTile(el, r, c);      // 先定位再入 DOM，避免从左上角滑入
          el.appendChild(inner);
          els.tiles.appendChild(el);

          if (tile.isNew || tile.hidden) inner.classList.add('appear');
          tile.isNew = false;

          tileEls.set(tile.id, { el: el, inner: inner, value: tile.value });
        } else {
          positionTile(rec.el, r, c);
          if (rec.value !== tile.value) {
            setTileValue(rec.inner, tile.value);
            rec.value = tile.value;
          }
        }
      }
    }

    tileEls.forEach(function (rec, id) {
      if (!alive[id]) {
        rec.el.remove();
        tileEls.delete(id);
      }
    });
  }

  /** 合并前的两块旧方块：先在场，再滑到目标格，随后移除 */
  function spawnGhosts(ghosts) {
    if (!ghosts.length) return;

    var items = ghosts.map(function (g) {
      var el = document.createElement('div');
      el.className = 'tile absorbed';
      var inner = document.createElement('div');
      inner.className = 'tile-inner';
      setTileValue(inner, g.value);
      el.appendChild(inner);
      positionTile(el, g.r, g.c);
      els.tiles.appendChild(el);
      return { el: el, g: g };
    });

    void els.tiles.offsetWidth;   // 提交初始位置，让下一步产生过渡

    items.forEach(function (item) {
      positionTile(item.el, item.g.tr, item.g.tc);
    });

    setTimeout(function () {
      items.forEach(function (item) { item.el.remove(); });
    }, 140);
  }

  /* ---------------- 快照 / 撤回 ---------------- */
  function snapshot() {
    return {
      values: Game2048.toValues(state),
      score: state.score,
      moves: state.moves,
      won: state.won,
      over: state.over
    };
  }

  function applySnapshot(snap) {
    Array.prototype.forEach.call(els.tiles.querySelectorAll('.tile'), function (el) { el.remove(); });
    tileEls.clear();

    state = Game2048.fromValues(snap.values);
    state.score = snap.score || 0;
    state.moves = snap.moves || 0;
    state.won = !!snap.won;
    state.over = !!snap.over;
    if (!Game2048.canMove(state)) state.over = true;

    render();
    updateHud();
  }

  function undo() {
    if (!history.length) return;
    applySnapshot(history.pop());
    hideOverlay();
    updateHud();
    saveNow();
  }

  /* ---------------- 一局流程 ---------------- */
  function startNew(options) {
    Array.prototype.forEach.call(els.tiles.querySelectorAll('.tile'), function (el) { el.remove(); });
    tileEls.clear();

    state = Game2048.create();
    history = [];
    roundMs = 0;
    Game2048.spawn(state);
    Game2048.spawn(state);

    hideOverlay();
    render();
    updateHud();
    updateTimers();
    saveNow(false);
    if (!options || !options.silent) toast('新的一局开始了');
  }

  function doMove(dir) {
    if (state.over) return;

    var before = snapshot();
    var result = Game2048.move(state, dir);
    if (!result.moved) return;

    history.push(before);
    if (history.length > HISTORY_LIMIT) history.shift();

    if (state.score > best) {
      best = state.score;
      SaveStore.writeBest(best);
    }

    spawnGhosts(result.ghosts);
    render();
    Game2048.spawn(state);
    render();

    if (result.gained > 0) bumpScore();
    updateHud();

    if (!state.won && Game2048.hasValue(state, 2048)) {
      state.won = true;
      showOverlay('win');
    }

    if (!Game2048.canMove(state)) {
      state.over = true;
      showOverlay('over');
    }

    saveNow();
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    els.score.textContent = state.score;
    els.best.textContent = best;
    els.undoBadge.textContent = history.length;
    els.undoBtn.disabled = history.length === 0;
    els.overlayUndo.disabled = history.length === 0;
  }

  function bumpScore() {
    els.score.classList.remove('bump');
    void els.score.offsetWidth;
    els.score.classList.add('bump');
  }

  /* ---------------- 游玩时长 ---------------- */
  function formatDuration(ms) {
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + ':' + two(m) + ':' + two(s);
    return two(m) + ':' + two(s);
  }

  function updateTimers() {
    els.roundTime.textContent = formatDuration(roundMs);
    els.totalTime.textContent = formatDuration(totalMs);
  }

  /** 只统计页面可见时的时长；切到后台不补算 */
  function tickClock() {
    var now = Date.now();
    var delta = now - lastTick;
    lastTick = now;

    if (document.visibilityState !== 'visible') return;
    if (delta < 0 || delta > 3000) delta = 1000;

    totalMs += delta;
    if (!state.over) roundMs += delta;
    updateTimers();
  }

  function showOverlay(type) {
    els.overlay.dataset.type = type;
    if (type === 'win') {
      els.overlayTitle.textContent = '拼出 2048 了';
      els.overlayText.textContent = '继续挑战更高分，试试 4096';
    } else {
      els.overlayTitle.textContent = '游戏结束';
      els.overlayText.textContent = '没有可以移动的方向了 · 本局得分 ' + state.score;
    }
    els.overlay.classList.add('show');
  }

  function hideOverlay() {
    els.overlay.classList.remove('show');
  }

  function isOverlayOpen() {
    return els.overlay.classList.contains('show');
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('show');
    }, 2600);
  }

  /* ---------------- 持久化 ---------------- */
  function two(n) { return n < 10 ? '0' + n : String(n); }

  function clockOf(ts) {
    var d = new Date(ts);
    return two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function pulseDot() {
    els.saveDot.classList.remove('pulse');
    void els.saveDot.offsetWidth;
    els.saveDot.classList.add('pulse');
  }

  /** 每一步、切后台、关闭页面都会调用 */
  function saveNow(withPulse) {
    var payload = snapshot();
    payload.version = 1;
    payload.best = best;
    payload.roundMs = roundMs;
    payload.totalMs = totalMs;
    payload.history = history.slice(-HISTORY_LIMIT);
    payload.savedAt = Date.now();

    if (!SaveStore.write(payload)) {
      els.saveText.textContent = '本地存档不可用';
      return;
    }
    els.saveText.textContent = '已保存 ' + clockOf(payload.savedAt);
    if (withPulse !== false) pulseDot();
  }

  /* ---------------- 恢复上一局 ---------------- */
  function boot() {
    var saved = SaveStore.read();

    if (saved) {
      history = (Array.isArray(saved.history) ? saved.history : [])
        .filter(SaveStore.isSnapshot)
        .slice(-HISTORY_LIMIT);
      best = Math.max(best, Number(saved.best) || 0);
      totalMs = Math.max(0, Number(saved.totalMs) || 0);
      roundMs = Math.max(0, Number(saved.roundMs) || 0);

      applySnapshot(saved);
      updateTimers();

      if (saved.savedAt) {
        els.saveText.textContent = '上次存档 ' + clockOf(saved.savedAt);
      }

      if (state.over) {
        showOverlay('over');
      } else {
        toast('已恢复上次进度 · 得分 ' + state.score);
      }
      return;
    }

    startNew({ silent: true });
  }

  /* ---------------- 输入：键盘 ---------------- */
  var keyMap = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right'
  };

  window.addEventListener('keydown', function (e) {
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // 参考稿同样支持 Ctrl + Z
    if (key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    var dir = keyMap[key];
    if (dir) {
      e.preventDefault();
      if (isOverlayOpen() && !state.over) hideOverlay();
      doMove(dir);
      return;
    }

    if (key === 'z') {
      e.preventDefault();
      undo();
    } else if (key === 'n') {
      e.preventDefault();
      els.newBtn.click();
    } else if (key === 'Escape') {
      hideOverlay();
    }
  }, { passive: false });

  /* ---------------- 输入：触摸滑动 ---------------- */
  var touchStart = null;

  els.board.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  els.board.addEventListener('touchmove', function (e) {
    if (touchStart && e.cancelable) e.preventDefault();
  }, { passive: false });

  els.board.addEventListener('touchend', function (e) {
    if (!touchStart) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStart.x;
    var dy = t.clientY - touchStart.y;
    touchStart = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;

    var dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');

    if (isOverlayOpen() && !state.over) hideOverlay();
    doMove(dir);
  }, { passive: true });

  /* ---------------- 按钮 ---------------- */
  els.undoBtn.addEventListener('click', undo);
  els.overlayUndo.addEventListener('click', undo);
  els.overlayContinue.addEventListener('click', hideOverlay);
  els.overlayNew.addEventListener('click', function () { startNew(); });

  els.newBtn.addEventListener('click', function () {
    var playing = state.score > 0 && !state.over;
    if (playing && !window.confirm('重新开局？当前这一局会被清空，且无法撤回。')) return;
    startNew();
  });

  /* ---------------- 退出前自动存档 ---------------- */
  window.addEventListener('pagehide', function () { saveNow(false); });
  window.addEventListener('beforeunload', function () { saveNow(false); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      saveNow(false);
    } else {
      lastTick = Date.now();   // 回到前台重新计时，不补算后台时间
    }
  });

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  /* ---------------- 启动 ---------------- */
  layout();
  boot();
  updateTimers();
  lastTick = Date.now();
  window.setInterval(tickClock, 1000);
})();
