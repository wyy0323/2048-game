/* ============================================================
   game.js · 2048 规则引擎（纯逻辑，不碰 DOM / 存储）
   ------------------------------------------------------------
   state = { grid: 4x4 的 tile 或 null, score, moves, won, over }
   tile  = { id, value, isNew?, hidden? }
   ============================================================ */
window.Game2048 = (function () {
  'use strict';

  var SIZE = 4;
  var uid = 1;

  function emptyGrid() {
    var grid = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push(null);
      grid.push(row);
    }
    return grid;
  }

  function create() {
    return { grid: emptyGrid(), score: 0, moves: 0, won: false, over: false };
  }

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  /** 在随机空格生成 2（90%）或 4（10%） */
  function spawn(state) {
    var empties = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!state.grid[r][c]) empties.push([r, c]);
      }
    }
    if (!empties.length) return null;
    var pick = empties[Math.floor(Math.random() * empties.length)];
    var tile = { id: uid++, value: Math.random() < 0.9 ? 2 : 4, isNew: true };
    state.grid[pick[0]][pick[1]] = tile;
    return tile;
  }

  /** 是否还有可用移动（有空格，或存在相邻同值） */
  function canMove(state) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var tile = state.grid[r][c];
        if (!tile) return true;
        if (c + 1 < SIZE && state.grid[r][c + 1] && state.grid[r][c + 1].value === tile.value) return true;
        if (r + 1 < SIZE && state.grid[r + 1][c] && state.grid[r + 1][c].value === tile.value) return true;
      }
    }
    return false;
  }

  function hasValue(state, target) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (state.grid[r][c] && state.grid[r][c].value >= target) return true;
      }
    }
    return false;
  }

  /**
   * 执行一次移动（会就地修改 state）
   * 返回 { moved, gained, ghosts, mergedIds }
   * ghosts：用于滑行动画的旧方块 [{ value, r, c, tr, tc }]
   */
  function move(state, dir) {
    var vectors = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    var vec = vectors[dir];
    if (!vec) return { moved: false, gained: 0, ghosts: [], mergedIds: [] };

    var dr = vec[0];
    var dc = vec[1];

    var rows = [0, 1, 2, 3];
    var cols = [0, 1, 2, 3];
    if (dr > 0) rows.reverse();
    if (dc > 0) cols.reverse();

    var moved = false;
    var gained = 0;
    var mergedThisMove = {};
    var ghosts = [];
    var mergedIds = [];

    for (var i = 0; i < SIZE; i++) {
      for (var j = 0; j < SIZE; j++) {
        var r = rows[i];
        var c = cols[j];
        var tile = state.grid[r][c];
        if (!tile) continue;

        var nr = r;
        var nc = c;
        while (true) {
          var tr0 = nr + dr;
          var tc0 = nc + dc;
          if (!inBounds(tr0, tc0)) break;
          if (state.grid[tr0][tc0]) break;
          nr = tr0;
          nc = tc0;
        }

        var tr = nr + dr;
        var tc = nc + dc;
        var target = inBounds(tr, tc) ? state.grid[tr][tc] : null;

        if (target && target.value === tile.value && !mergedThisMove[target.id]) {
          var mergedValue = tile.value * 2;
          var mergedTile = { id: uid++, value: mergedValue, hidden: true };

          state.grid[r][c] = null;
          state.grid[tr][tc] = mergedTile;
          mergedThisMove[mergedTile.id] = true;
          mergedIds.push(mergedTile.id);

          // 两个旧方块滑向同一格，动画结束后再亮出合并块
          ghosts.push({ value: tile.value, r: r, c: c, tr: tr, tc: tc });
          ghosts.push({ value: target.value, r: tr, c: tc, tr: tr, tc: tc });

          gained += mergedValue;
          moved = true;
        } else if (nr !== r || nc !== c) {
          state.grid[r][c] = null;
          state.grid[nr][nc] = tile;
          moved = true;
        }
      }
    }

    if (!moved) return { moved: false, gained: 0, ghosts: [], mergedIds: [] };

    state.score += gained;
    state.moves += 1;
    return { moved: true, gained: gained, ghosts: ghosts, mergedIds: mergedIds };
  }

  /** state -> 4x4 数值矩阵（存档 / 快照用） */
  function toValues(state) {
    return state.grid.map(function (row) {
      return row.map(function (tile) { return tile ? tile.value : 0; });
    });
  }

  /** 4x4 数值矩阵 -> 全新 state */
  function fromValues(values) {
    var state = create();
    state.grid = values.map(function (row) {
      return row.map(function (v) {
        return v ? { id: uid++, value: v } : null;
      });
    });
    return state;
  }

  return {
    SIZE: SIZE,
    create: create,
    spawn: spawn,
    canMove: canMove,
    hasValue: hasValue,
    move: move,
    toValues: toValues,
    fromValues: fromValues
  };
})();
