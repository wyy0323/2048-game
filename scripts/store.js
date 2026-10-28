/* ============================================================
   store.js · 本地持久化层
   ------------------------------------------------------------
   只负责「读写 localStorage + 数据校验」，不含游戏规则。
   存档结构（version 1）：
   {
     version: 1,
     values: [[2,0,...], ...]   // 4x4 棋盘数值
     score, moves, won, over,
     best,
     history: [ snapshot, ... ],// 最多 50 步，最旧在前
     savedAt: 时间戳
   }
   ============================================================ */
window.SaveStore = (function () {
  'use strict';

  var KEY = 'paper2048.save.v1';
  var BEST_KEY = 'paper2048.best.v1';
  var HISTORY_LIMIT = 50;
  var SIZE = 4;

  function getRaw(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function setRaw(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      // 隐私模式 / 配额已满时静默失败
      return false;
    }
  }

  function isValues(values) {
    if (!Array.isArray(values) || values.length !== SIZE) return false;
    for (var r = 0; r < SIZE; r++) {
      var row = values[r];
      if (!Array.isArray(row) || row.length !== SIZE) return false;
      for (var c = 0; c < SIZE; c++) {
        var v = row[c];
        if (typeof v !== 'number' || !isFinite(v) || v < 0) return false;
      }
    }
    return true;
  }

  function isSnapshot(snap) {
    return !!snap && typeof snap === 'object' && isValues(snap.values);
  }

  function read() {
    var raw = getRaw(KEY);
    if (!raw) return null;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return null; }
    if (!data || typeof data !== 'object' || !isValues(data.values)) return null;
    if (data.version !== 1) return null;
    return data;
  }

  function write(payload) {
    return setRaw(KEY, JSON.stringify(payload));
  }

  function readBest() {
    var n = Number(getRaw(BEST_KEY) || 0);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function writeBest(value) {
    setRaw(BEST_KEY, String(Math.floor(value)));
  }

  function clear() {
    try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return {
    KEY: KEY,
    BEST_KEY: BEST_KEY,
    HISTORY_LIMIT: HISTORY_LIMIT,
    isSnapshot: isSnapshot,
    read: read,
    write: write,
    readBest: readBest,
    writeBest: writeBest,
    clear: clear
  };
})();
