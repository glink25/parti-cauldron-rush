import './style.css';

declare const parti: {
  playerId: string | null;
  onState(handler: (state: GameState) => void): () => void;
  onEvent(event: string, handler: (payload: any) => void): () => void;
  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void;
  leave(): void;
  exposeToAgent?(describe: (state: GameState) => unknown): void;
};

type ChipColor = 'white' | 'green' | 'orange' | 'red' | 'blue';
type Phase = 'lobby' | 'brewing' | 'evaluation' | 'gameEnd';
type Chip = { id: string; color: ChipColor; value: number; position?: number };
type PlayerState = {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  vp: number;
  rubies: number;
  startBonus: number;
  flaskReady: boolean;
  potPosition: number;
  danger: number;
  exploded: boolean;
  stopped: boolean;
  bagEmpty: boolean;
  pot: Chip[];
  bag: Chip[];
  pendingBlue: Chip[] | null;
  rewardChoice: 'vp' | 'shop' | null;
  coinValue: number;
  vpValue: number;
  shopSpent: number;
  boughtColors: ChipColor[];
  evaluationDone: boolean;
};

type GameState = {
  phase: Phase;
  hostId: string;
  round: number;
  maxRounds: number;
  players: Record<string, PlayerState>;
  order: string[];
  message: string;
  winnerIds: string[];
};

const app = document.querySelector<HTMLDivElement>('#app')!;
let state: GameState | null = null;
let toast = '';
let rulesOpen = false;

const colorLabel: Record<ChipColor, string> = {
  white: '危险',
  green: '稳定',
  orange: '火花',
  red: '烈焰',
  blue: '预见',
};

const colorLore: Record<ChipColor, string> = {
  white: '危险值来源',
  green: '结算易得 Ruby',
  orange: '廉价推进',
  red: '后程加速',
  blue: '双候选预见',
};

const shop = [
  ['orange', 1, 3],
  ['green', 1, 4],
  ['red', 1, 5],
  ['blue', 1, 5],
  ['green', 2, 8],
  ['red', 2, 9],
  ['blue', 2, 10],
] as const;

function act(name: string, payload?: unknown) {
  void parti.action(name, payload);
}

function me() {
  return state && parti.playerId ? state.players[parti.playerId] : null;
}

function sortedPlayers() {
  return state!.order.map((id) => state!.players[id]);
}

function otherPlayers(selfId: string | null) {
  return sortedPlayers().filter((p) => p.id !== selfId);
}

function phaseTitle(phase: Phase) {
  return {
    lobby: '招募炼金师',
    brewing: '熬制阶段',
    evaluation: '轮末结算',
    gameEnd: '终局庆典',
  }[phase];
}

function phaseSubtitle(phase: Phase) {
  return {
    lobby: '准备你的药锅与第一袋原料。',
    brewing: '拉高锅位，但别让白色危险值突破阈值。',
    evaluation: '把本轮收益转化成升级与购置。',
    gameEnd: '冠军已经诞生，准备下一场锅炉对决。',
  }[phase];
}

function statusTag(p: PlayerState) {
  if (!p.connected) return '离线';
  if (p.exploded) return '爆锅';
  if (p.pendingBlue) return '预见中';
  if (p.stopped) return '已停手';
  if (state!.phase === 'lobby' && p.ready) return '已准备';
  if (state!.phase === 'evaluation' && p.evaluationDone) return '已结算';
  return state!.phase === 'lobby' ? '等待' : '进行中';
}

function toneClass(p: PlayerState) {
  if (p.exploded) return 'danger';
  if (state!.winnerIds.includes(p.id)) return 'victory';
  if (p.pendingBlue) return 'oracle';
  if (p.stopped) return 'rest';
  return 'calm';
}

function chipToken(c: Chip, size: 'sm' | 'md' | 'lg' = 'sm', note = '') {
  const caption = `${colorLabel[c.color]} ${c.value}${note ? ` · ${note}` : ''}`;
  return `<span class="chip chip-${size} ${c.color}" title="${caption}"><i>${iconFor(c.color)}</i><b>${c.value}</b></span>`;
}

function iconFor(color: ChipColor) {
  return { white: '✦', green: '☘', orange: '✧', red: '🔥', blue: '◈' }[color];
}

function bagStats(p: PlayerState) {
  const counts: Record<ChipColor, number> = { white: 0, green: 0, orange: 0, red: 0, blue: 0 };
  for (const chip of p.bag) counts[chip.color] += 1;
  return (Object.keys(counts) as ChipColor[]).map((color) => ({ color, count: counts[color] }));
}

function topLeader() {
  const players = sortedPlayers();
  if (!players.length) return '等待玩家';
  const leader = [...players].sort((a, b) => b.vp - a.vp || b.potPosition - a.potPosition)[0];
  return `${leader.name} · ${leader.vp} VP`;
}

function render() {
  if (!state) return;
  const self = me();
  const players = sortedPlayers();
  const selfId = parti.playerId;
  const others = otherPlayers(selfId);

  app.innerHTML = `
    <main class="game-shell phase-${state.phase}">
      <div class="backdrop backdrop-stars"></div>
      <div class="backdrop backdrop-smoke"></div>
      <header class="topbar panel glass">
        <div class="brand-block">
          <span class="eyebrow">PARTI ALCHEMY LEAGUE</span>
          <h1>Cauldron Rush</h1>
          <p class="subtitle">${phaseSubtitle(state.phase)}</p>
        </div>
        <div class="topbar-side">
          <div class="phase-badge">
            <span>${phaseTitle(state.phase)}</span>
            <strong>${state.phase === 'lobby' ? '准备室' : `第 ${state.round}/${state.maxRounds} 轮`}</strong>
          </div>
          <button class="rules-button" data-ui="rules">玩法</button>
        </div>
      </header>

      <section class="hud-strip">
        <article class="hud-card panel glass"><span>房间状态</span><strong>${toast || state.message}</strong></article>
        <article class="hud-card panel glass"><span>当前领先</span><strong>${escapeHtml(topLeader())}</strong></article>
        <article class="hud-card panel glass"><span>炼金师</span><strong>${players.length}/${state.order.length || 0}</strong></article>
      </section>

      <section class="table-layout">
        <aside class="column column-left">
          <section class="panel glass rival-panel">
            <div class="section-head"><span class="section-kicker">对手看板</span><h2>炼金师席位</h2></div>
            <div class="rival-list">
              ${others.length ? others.map((p) => rivalCard(p)).join('') : '<div class="empty-note">你是当前唯一可见玩家，等待其他炼金师加入。</div>'}
            </div>
          </section>
          <section class="panel glass log-panel">
            <div class="section-head"><span class="section-kicker">当前局势</span><h2>炼金提示</h2></div>
            ${sceneNarrative(self)}
          </section>
        </aside>

        <section class="board-stage panel glass">
          ${self ? cauldronStage(self) : spectatorStage()}
        </section>

        <aside class="column column-right">
          ${self ? controlDeck(self) : '<section class="panel glass info-panel"><h2>观战中</h2><p>等待加入玩家席位或等待房主开始。</p></section>'}
        </aside>
      </section>

      ${rulesOpen ? rulesPanel() : ''}
    </main>
  `;

  bind();
}

function rivalCard(p: PlayerState) {
  const progress = Math.min(100, (p.potPosition / 35) * 100);
  const recent = p.pot.slice(-4).map((c) => chipToken(c, 'sm')).join('') || '<span class="tiny-note">暂无抽取</span>';
  return `
    <article class="rival-card ${toneClass(p)}">
      <div class="rival-head">
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <span>${statusTag(p)}</span>
        </div>
        <div class="rival-score">${p.vp} VP</div>
      </div>
      <div class="rival-rail"><i style="width:${progress}%"></i></div>
      <div class="rival-meta">锅位 ${p.potPosition} · 危险 ${p.danger}/7 · 💎${p.rubies}</div>
      <div class="mini-chips">${recent}</div>
    </article>
  `;
}

function sceneNarrative(self: PlayerState | null) {
  if (!self) return '<p class="body-copy">当前为观战视角，可从玩家席位加入后参与熬制。</p>';

  const notes: string[] = [];
  if (state!.phase === 'lobby') {
    notes.push('每位玩家从同一套基础袋开始：7 白 + 1 绿 + 1 橙。');
    notes.push('房主可在至少 2 人且其他人都已准备后开局。');
  }
  if (state!.phase === 'brewing') {
    notes.push(self.exploded ? '你的锅炉已经失控，本轮只能等待其他玩家完成。' : '继续抽取可换来更高锅位，但白色危险值一旦超过 7 就会爆锅。');
    notes.push(self.pendingBlue ? '蓝色预见已触发：从两枚候选中选 1 枚进锅，另一枚回袋。' : `Flask ${self.flaskReady ? '仍可使用，可撤回刚抽且未爆锅的白色筹码。' : '本轮已经消耗。'}`);
  }
  if (state!.phase === 'evaluation') {
    notes.push(`你本轮结算面值：${self.vpValue} VP / ${self.coinValue} 金币。`);
    notes.push(self.exploded ? '爆锅后必须在“拿 VP”和“去购物”之间二选一。' : '未爆锅会自动获得 VP，并保留购物资格。');
  }
  if (state!.phase === 'gameEnd') {
    notes.push(state!.winnerIds.includes(self.id) ? '你的炼金术压过了全场，恭喜夺冠。' : '比较最终积分与袋中非白筹码总价值，冠军已经揭晓。');
    notes.push('房主可以立即发起 Rematch，保留玩家阵容重新开始。');
  }

  const oracle = bagStats(self)
    .filter((x) => x.count > 0)
    .map((x) => `<span class="oracle-pill ${x.color}">${colorLabel[x.color]} × ${x.count}</span>`)
    .join('');

  return `
    <div class="oracle-stack">
      <div class="oracle-pills">${oracle}</div>
      <ul class="narrative-list">${notes.map((note) => `<li>${note}</li>`).join('')}</ul>
    </div>
  `;
}

function spectatorStage() {
  return `
    <div class="stage-head">
      <div>
        <span class="section-kicker">主舞台</span>
        <h2>中央炼金台</h2>
      </div>
    </div>
    <div class="spectator-card">
      <div class="cauldron large idle"><div class="brew-core"><span>👁</span><strong>观战中</strong><p>等待加入席位后，中央药锅会显示你的个人熬制进度。</p></div></div>
    </div>
  `;
}

function cauldronStage(p: PlayerState) {
  const progress = Math.min(100, (p.potPosition / 35) * 100);
  const danger = Math.min(100, (p.danger / 8) * 100);
  const recentPot = p.pot.slice(-8);
  const recentTokens = recentPot.map((c) => chipToken(c, 'md', `落点 ${c.position ?? 0}`)).join('');
  const bag = bagStats(p);

  return `
    <div class="stage-head">
      <div>
        <span class="section-kicker">你的锅炉</span>
        <h2>${escapeHtml(p.name)} 的炼金台</h2>
      </div>
      <div class="badge-row">
        <span class="crest ${toneClass(p)}">${statusTag(p)}</span>
        <span class="crest">🧪 Flask ${p.flaskReady ? '就绪' : '已使用'}</span>
      </div>
    </div>

    <div class="cauldron-board ${p.exploded ? 'is-exploded' : ''}">
      <section class="vault panel soft-card stats-card">
        <div class="stat-grid">
          <article><span>总分</span><strong>${p.vp}</strong></article>
          <article><span>Ruby</span><strong>${p.rubies}</strong></article>
          <article><span>起始加成</span><strong>+${p.startBonus}</strong></article>
          <article><span>袋中筹码</span><strong>${p.bag.length}</strong></article>
        </div>
      </section>

      <section class="cauldron-scene">
        <div class="alchemy-orbit orbit-left"></div>
        <div class="alchemy-orbit orbit-right"></div>
        <div class="track-banner"><span>锅轨进度</span><strong>${p.potPosition} / 35</strong></div>
        <div class="track-line"><i style="width:${progress}%"></i></div>
        <div class="track-labels">${trackLabels(p.potPosition)}</div>

        <div class="cauldron ${p.exploded ? 'danger' : p.pendingBlue ? 'oracle' : 'stable'}">
          <div class="brew-liquid"></div>
          <div class="brew-glow"></div>
          <div class="brew-core">
            <span>${p.exploded ? '💥' : p.pendingBlue ? '◈' : '⚗'}</span>
            <strong>${p.exploded ? '锅炉失控' : state!.phase === 'evaluation' ? '收益已锁定' : '炼金进行中'}</strong>
            <p>${p.exploded ? '造成爆锅的筹码仍已计入锅位。' : p.stopped ? '你已停手，等待其他玩家。' : '继续抽取可获得更高收益。'}</p>
          </div>
        </div>

        <div class="danger-ring">
          <div class="danger-label"><span>危险值</span><strong>${p.danger}/7</strong></div>
          <div class="danger-meter"><i style="width:${danger}%"></i></div>
        </div>
      </section>

      <section class="vault panel soft-card potion-history">
        <div class="section-head compact"><span class="section-kicker">本轮投入</span><h3>药锅轨迹</h3></div>
        <div class="chip-ribbon ${recentPot.length ? '' : 'empty'}">${recentTokens || '<span class="empty-note">尚未抽取筹码</span>'}</div>
      </section>

      <section class="vault panel soft-card bag-vault">
        <div class="section-head compact"><span class="section-kicker">袋中构成</span><h3>原料储备</h3></div>
        <div class="bag-grid">
          ${bag.map((entry) => `
            <article class="bag-slot ${entry.color}">
              <div class="bag-chip-row">${chipToken({ id: '', color: entry.color, value: entry.count || 0 }, 'sm')}</div>
              <strong>${entry.count}</strong>
              <span>${colorLabel[entry.color]}</span>
              <small>${colorLore[entry.color]}</small>
            </article>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}

function trackLabels(position: number) {
  const markers = [0, 5, 10, 15, 20, 25, 30, 35];
  return markers
    .map((mark) => `<span class="${position >= mark ? 'reached' : ''}">${mark}</span>`)
    .join('');
}

function controlDeck(p: PlayerState) {
  return `
    <section class="panel glass command-panel">
      <div class="section-head"><span class="section-kicker">操作台</span><h2>${phaseTitle(state!.phase)}</h2></div>
      ${controls(p)}
    </section>
    <section class="panel glass dossier-panel">
      <div class="section-head"><span class="section-kicker">玩家档案</span><h2>你的状态</h2></div>
      <div class="dossier-grid">
        <article><span>VP</span><strong>${p.vp}</strong></article>
        <article><span>Ruby</span><strong>${p.rubies}</strong></article>
        <article><span>锅位</span><strong>${p.potPosition}</strong></article>
        <article><span>危险</span><strong>${p.danger}/7</strong></article>
        <article><span>起点</span><strong>+${p.startBonus}</strong></article>
        <article><span>袋数</span><strong>${p.bag.length}</strong></article>
      </div>
    </section>
  `;
}

function controls(p: PlayerState) {
  if (state!.phase === 'lobby') {
    const hostAction = parti.playerId === state!.hostId
      ? '<button class="action primary" data-a="startGame">⚗ 点燃炉火</button>'
      : '<div class="tiny-note">等待房主开始 7 轮竞速。</div>';
    return `
      <div class="body-copy">至少 2 名玩家且所有非房主玩家准备后即可开局。</div>
      <div class="action-stack">
        <button class="action" data-a="setReady" data-p='{"ready":${!p.ready}}'>${p.ready ? '取消准备' : '我准备好了'}</button>
        ${hostAction}
      </div>
    `;
  }

  if (state!.phase === 'brewing') {
    if (p.pendingBlue) {
      return `
        <div class="body-copy">蓝色预见触发：选 1 枚入锅，另 1 枚返回袋中。</div>
        <div class="candidate-grid">
          ${p.pendingBlue.map((c) => `
            <button class="candidate-card" data-a="chooseBlueCandidate" data-p='{"instanceId":"${c.id}"}'>
              ${chipToken(c, 'lg')}
              <div><strong>${colorLabel[c.color]} ${c.value}</strong><span>${colorLore[c.color]}</span></div>
            </button>
          `).join('')}
        </div>
      `;
    }

    return `
      <div class="control-status ${p.exploded ? 'danger' : p.stopped ? 'rest' : ''}">
        <strong>${p.exploded ? '锅炉失控' : p.stopped ? '已停手待结算' : '继续提炼'}</strong>
        <span>${p.exploded ? '本轮无法再抽取，但锅位已经锁定。' : '高收益意味着更高风险。'}</span>
      </div>
      <div class="action-stack action-stack-3">
        <button class="action primary" data-a="drawChip" ${p.stopped || p.exploded ? 'disabled' : ''}>抽一枚筹码</button>
        <button class="action" data-a="stop" ${p.stopped || p.exploded ? 'disabled' : ''}>及时停手</button>
        <button class="action" data-a="useFlask" ${!p.flaskReady || p.exploded ? 'disabled' : ''}>🧪 使用 Flask</button>
      </div>
    `;
  }

  if (state!.phase === 'evaluation') {
    const remain = p.coinValue - p.shopSpent;
    const rewardChoice = p.exploded && !p.rewardChoice
      ? `
        <div class="reward-choice">
          <button class="action primary" data-a="chooseExplosionReward" data-p='{"choice":"vp"}'>拿 ${p.vpValue} VP</button>
          <button class="action" data-a="chooseExplosionReward" data-p='{"choice":"shop"}'>去购物</button>
        </div>
      `
      : '';

    const shopCards = (!p.exploded || p.rewardChoice === 'shop') && !p.evaluationDone
      ? `
        <div class="market-head"><strong>市场剩余 ${remain} 金币</strong><span>每轮最多购买 2 枚且颜色不同</span></div>
        <div class="shop-grid">
          ${shop.map(([c, v, price]) => `
            <button class="shop-card ${c}" data-a="buyChip" data-p='{"color":"${c}","value":${v}}' ${price > remain || p.boughtColors.includes(c) ? 'disabled' : ''}>
              ${chipToken({ id: '', color: c, value: v }, 'md')}
              <div>
                <strong>${colorLabel[c]} ${v}</strong>
                <span>${price} 金币</span>
              </div>
            </button>
          `).join('')}
        </div>
      `
      : '<div class="tiny-note">你当前不可购物，或已完成本轮结算。</div>';

    return `
      <div class="body-copy emphasis">本轮收益：<b>${p.vpValue} VP</b> / <b>${p.coinValue} 金币</b>${p.exploded ? ' · 爆锅必须二选一' : ''}</div>
      ${rewardChoice}
      ${shopCards}
      <div class="upgrade-row">
        <button class="action" data-a="spendRubies" data-p='{"option":"advance"}' ${p.rubies < 2 || p.startBonus >= 5 ? 'disabled' : ''}>💎2 起点 +1</button>
        <button class="action" data-a="spendRubies" data-p='{"option":"flask"}' ${p.rubies < 2 || p.flaskReady ? 'disabled' : ''}>💎2 补充 Flask</button>
      </div>
      <button class="action primary full" data-a="finishShopping" ${p.evaluationDone || (p.exploded && !p.rewardChoice) ? 'disabled' : ''}>完成本轮结算</button>
    `;
  }

  return `
    <div class="end-banner ${state!.winnerIds.includes(p.id) ? 'winner' : ''}">
      <strong>${state!.winnerIds.includes(p.id) ? '🏆 你赢了！' : '炼金竞速结束'}</strong>
      <span>${state!.message}</span>
    </div>
    ${parti.playerId === state!.hostId ? '<button class="action primary full" data-a="rematch">再来一局</button>' : '<div class="tiny-note">等待房主开启下一局。</div>'}
  `;
}

function rulesPanel() {
  return `
    <div class="rules-backdrop" data-ui="close-rules">
      <section class="rules-modal panel glass" role="dialog" aria-modal="true" aria-label="Cauldron Rush 游戏规则" onclick="event.stopPropagation()">
        <div class="rules-title">
          <div>
            <span class="eyebrow">HOW TO PLAY</span>
            <h2>炼金竞速规则</h2>
          </div>
          <button class="rules-close" data-ui="close-rules" aria-label="关闭规则">×</button>
        </div>
        <div class="rules-grid">
          <article><h3>🎯 目标</h3><p>2–5 人进行 7 轮，尽可能把锅位推高，赚取更多 VP 与金币，最终以 VP 决出冠军。</p></article>
          <article><h3>🔥 抽取与爆锅</h3><p>每次可选择继续抽取或停手。白色筹码累计危险值 <b>超过 7</b> 才爆锅；正好 7 仍安全。造成爆锅的筹码仍会计入锅位。</p></article>
          <article><h3>🧪 Flask</h3><p>每轮一次，可撤回刚抽且尚未导致爆锅的白色筹码，把它放回袋中并撤销推进。</p></article>
          <article><h3>🎨 筹码效果</h3><ul><li><b>White</b>：推进并增加危险值。</li><li><b>Green</b>：若位于本轮最后两枚非白筹码之一，结算 +1 Ruby。</li><li><b>Orange</b>：普通推进，便宜稳定。</li><li><b>Red</b>：锅内已有至少 2 枚 Red 时，新 Red 额外 +1 锅位。</li><li><b>Blue</b>：出现 2 个候选，选 1 个入锅，另 1 个回袋。</li></ul></article>
          <article><h3>💰 轮末结算</h3><p>未爆锅时自动获得 VP，并保留购物资格；爆锅时必须在“拿 VP”和“去购物”之间二选一。</p></article>
          <article><h3>🛍 购物与 Ruby</h3><p>每轮最多买 2 枚筹码、且颜色必须不同。花费 2 Ruby 可提升永久起点，或补充 Flask。</p></article>
          <article><h3>🏆 胜负</h3><p>第 7 轮后比总 VP；若平手，则比较袋中非白筹码总价值，再平手则共享胜利。</p></article>
          <article><h3>💡 策略提示</h3><p>前期优先扩充非白筹码能显著降低后期爆锅概率；中后期再用 Red / Blue 追求高额收益。</p></article>
        </div>
      </section>
    </div>
  `;
}

function bind() {
  document.querySelectorAll<HTMLElement>('[data-a]').forEach((el) =>
    el.addEventListener('click', () => {
      const name = el.dataset.a!;
      const payload = el.dataset.p ? JSON.parse(el.dataset.p) : undefined;
      act(name, payload);
    }),
  );
  document.querySelectorAll<HTMLElement>('[data-ui="rules"]').forEach((el) =>
    el.addEventListener('click', () => {
      rulesOpen = true;
      render();
    }),
  );
  document.querySelectorAll<HTMLElement>('[data-ui="close-rules"]').forEach((el) =>
    el.addEventListener('click', () => {
      rulesOpen = false;
      render();
    }),
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

parti.onState((next) => {
  state = next;
  toast = '';
  render();
});

parti.onEvent('game:invalid', (p) => {
  toast = `⚠ ${p?.message ?? '操作无效'}`;
  render();
  setTimeout(() => {
    toast = '';
    render();
  }, 1400);
});

parti.exposeToAgent?.((s) => ({
  game: 'Cauldron Rush',
  phase: s.phase,
  round: s.round,
  message: s.message,
  you: parti.playerId ? s.players[parti.playerId] : null,
  actions: ['setReady', 'startGame', 'drawChip', 'chooseBlueCandidate', 'stop', 'useFlask', 'chooseExplosionReward', 'buyChip', 'finishShopping', 'spendRubies', 'rematch'],
}));

parti.ready();
