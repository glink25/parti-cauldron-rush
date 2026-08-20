import './style.css';

declare const parti: {
  playerId: string | null;
  onState(handler: (state: GameState) => void): () => void;
  onEvent(event: string, handler: (payload: any) => void): () => void;
  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void;
  exposeToAgent?(describe: (state: GameState) => unknown): void;
};

type ChipColor = 'white' | 'green' | 'orange' | 'red' | 'blue';
type Phase = 'lobby' | 'brewing' | 'evaluation' | 'gameEnd';
type Chip = { id:string; color:ChipColor; value:number; position?:number };
type PlayerState = {
  id:string; name:string; connected:boolean; ready:boolean; vp:number; rubies:number;
  startBonus:number; flaskReady:boolean; potPosition:number; danger:number; exploded:boolean;
  stopped:boolean; bagEmpty:boolean; pot:Chip[]; bag:Chip[]; pendingBlue:Chip[]|null;
  rewardChoice:'vp'|'shop'|null; coinValue:number; vpValue:number; shopSpent:number;
  boughtColors:ChipColor[]; evaluationDone:boolean;
};
type GameState = {
  phase:Phase; hostId:string; round:number; maxRounds:number; players:Record<string,PlayerState>;
  order:string[]; message:string; winnerIds:string[];
};

const app = document.querySelector<HTMLDivElement>('#app')!;
let state: GameState | null = null;
let toast = '';
let rulesOpen = false;
let detailOpen = false;

const labels: Record<ChipColor,string> = { white:'危险', green:'稳定', orange:'火花', red:'烈焰', blue:'预见' };
const symbols: Record<ChipColor,string> = { white:'✦', green:'☘', orange:'✧', red:'◆', blue:'◈' };
const shop = [ ['orange',1,3], ['green',1,4], ['red',1,5], ['blue',1,5], ['green',2,8], ['red',2,9], ['blue',2,10] ] as const;

function act(name:string,payload?:unknown){ void parti.action(name,payload); }
function me(){ return state && parti.playerId ? state.players[parti.playerId] : null; }
function esc(s:string){ return s.replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!)); }
function chip(c:Chip,size='sm'){ return `<span class="chip chip-${size} ${c.color}" title="${labels[c.color]} ${c.value}"><i>${symbols[c.color]}</i><b>${c.value}</b></span>`; }
function phaseName(p:Phase){ return ({lobby:'准备室',brewing:'熬制',evaluation:'结算',gameEnd:'终局'})[p]; }
function status(p:PlayerState){ if(!p.connected)return'离线'; if(p.exploded)return'爆锅'; if(p.pendingBlue)return'预见'; if(p.stopped)return'停手'; if(state!.phase==='lobby')return p.ready?'已准备':'等待'; if(state!.phase==='evaluation')return p.evaluationDone?'已结算':'结算中'; return'进行中'; }

function ensureShell(){
  if (document.querySelector('.game-shell')) return;
  app.innerHTML = `<main class="game-shell">
    <div class="scene-bg" aria-hidden="true"></div>
    <header class="game-header">
      <div class="brand"><span>PARTI ALCHEMY LEAGUE</span><h1>Cauldron Rush</h1></div>
      <div class="header-tools"><button data-ui="details">详情</button><button data-ui="rules">玩法</button></div>
    </header>
    <section class="statusbar" id="statusbar"></section>
    <section class="workspace">
      <aside class="opponents panel" id="opponents"></aside>
      <section class="board panel" id="board"></section>
      <aside class="command panel" id="command"></aside>
    </section>
    <div id="overlay"></div>
  </main>`;
}

function render(){
  if(!state) return;
  ensureShell();
  document.querySelector('.game-shell')!.className = `game-shell phase-${state.phase}`;
  const self = me();
  updateStatus(self);
  updateOpponents(self);
  updateBoard(self);
  updateCommand(self);
  updateOverlay(self);
  bindUi();
}

function updateStatus(self:PlayerState|null){
  const node=document.querySelector('#statusbar')!;
  const players=state!.order.map(id=>state!.players[id]);
  const leader=[...players].sort((a,b)=>b.vp-a.vp||b.potPosition-a.potPosition)[0];
  node.innerHTML=`
    <div class="round-pill"><span>${phaseName(state!.phase)}</span><b>${state!.phase==='lobby'?'准备中':`${state!.round}/${state!.maxRounds}`}</b></div>
    <div class="status-message ${toast?'error':''}">${toast||state!.message}</div>
    <div class="quick-stats"><span>领先 <b>${leader?`${esc(leader.name)} ${leader.vp}VP`:'—'}</b></span>${self?`<span>你 <b>${self.vp}VP · 💎${self.rubies}</b></span>`:''}</div>`;
}

function updateOpponents(self:PlayerState|null){
  const node=document.querySelector('#opponents')!;
  const others=state!.order.map(id=>state!.players[id]).filter(p=>!self||p.id!==self.id);
  node.innerHTML=`<div class="panel-head"><div><span>RIVALS</span><h2>对手</h2></div><b>${state!.order.length} 人</b></div>
  <div class="opponent-scroll">${others.length?others.map(opponentCard).join(''):'<p class="muted">等待其他炼金师加入。</p>'}</div>`;
}

function opponentCard(p:PlayerState){
  return `<article class="opponent-card ${p.exploded?'is-danger':''}">
    <div class="opponent-top"><strong>${esc(p.name)}</strong><span>${status(p)}</span></div>
    <div class="opponent-score"><b>${p.vp}</b> VP <i>·</i> 锅位 ${p.potPosition}</div>
    <div class="progress"><i style="width:${Math.min(100,p.potPosition/35*100)}%"></i></div>
    <div class="opponent-bottom"><span>危险 ${p.danger}/7</span><span>💎${p.rubies}</span><span>${p.pot.slice(-3).map(c=>chip(c)).join('')}</span></div>
  </article>`;
}

function updateBoard(self:PlayerState|null){
  const node=document.querySelector('#board')!;
  if(!self){ node.innerHTML=`<div class="board-empty"><div class="cauldron idle"><div class="liquid"></div><div class="cauldron-label">观战中</div></div><p>加入玩家席位后，这里会显示你的个人药锅。</p></div>`; return; }
  const progress=Math.min(100,self.potPosition/35*100);
  const danger=Math.min(100,self.danger/8*100);
  node.innerHTML=`
    <div class="board-top">
      <div><span>YOUR CAULDRON</span><h2>${esc(self.name)} 的药锅</h2></div>
      <div class="board-badges"><b>${status(self)}</b><span>🧪 ${self.flaskReady?'可用':'已用'}</span></div>
    </div>
    <div class="score-row">
      <div><span>VP</span><b>${self.vp}</b></div><div><span>Ruby</span><b>${self.rubies}</b></div><div><span>袋中</span><b>${self.bag.length}</b></div><div><span>起点</span><b>+${self.startBonus}</b></div>
    </div>
    <div class="core-stage">
      <div class="track-head"><span>锅轨</span><b>${self.potPosition}/35</b></div>
      <div class="track"><i style="width:${progress}%"></i></div>
      <div class="cauldron ${self.exploded?'danger':self.pendingBlue?'oracle':''}"><div class="liquid"></div><div class="bubbles"></div><div class="cauldron-label"><b>${self.exploded?'💥 爆锅':self.stopped?'✓ 已停手':'⚗ 熬制中'}</b><span>${self.exploded?'等待轮末二选一':self.stopped?'等待其他玩家':'继续抽取或及时停手'}</span></div></div>
      <div class="danger-box"><div><span>危险值</span><b>${self.danger}/7</b></div><div class="danger-track"><i style="width:${danger}%"></i></div></div>
    </div>
    <div class="pot-strip"><span>本轮筹码</span><div>${self.pot.length?self.pot.slice(-8).map(c=>chip(c,'md')).join(''):'<em>尚未抽取</em>'}</div></div>`;
}

function updateCommand(p:PlayerState|null){
  const node=document.querySelector('#command')!;
  if(!p){ node.innerHTML=`<div class="panel-head"><div><span>ACTIONS</span><h2>操作台</h2></div></div><p class="muted">观战状态下没有玩家操作。</p>`; return; }
  node.innerHTML=`<div class="panel-head command-head"><div><span>ACTIONS</span><h2>${commandTitle(p)}</h2></div><small>${commandHint(p)}</small></div><div class="command-body">${controls(p)}</div>`;
}

function commandTitle(p:PlayerState){
  if(state!.phase==='lobby') return '准备开局';
  if(state!.phase==='brewing') return p.pendingBlue?'蓝色预见':p.exploded?'锅炉失控':p.stopped?'已停手':'你的回合';
  if(state!.phase==='evaluation') return '轮末结算';
  return state!.winnerIds.includes(p.id)?'你赢了！':'比赛结束';
}
function commandHint(p:PlayerState){
  if(state!.phase==='brewing'&&!p.stopped&&!p.exploded) return `危险 ${p.danger}/7`;
  if(state!.phase==='evaluation') return `${p.coinValue-p.shopSpent} 金币可用`;
  return '';
}

function controls(p:PlayerState){
  if(state!.phase==='lobby'){
    return `<div class="action-primary-zone"><button class="action ${p.ready?'selected':''}" data-a="setReady" data-p='{"ready":${!p.ready}}'>${p.ready?'取消准备':'我准备好了'}</button>${parti.playerId===state!.hostId?'<button class="action primary" data-a="startGame">开始游戏</button>':''}</div><p class="tip">至少 2 人；非房主玩家准备完成后由房主开始。</p>`;
  }
  if(state!.phase==='brewing'){
    if(p.pendingBlue) return `<div class="candidate-list">${p.pendingBlue.map(c=>`<button class="candidate" data-a="chooseBlueCandidate" data-p='{"instanceId":"${c.id}"}'>${chip(c,'lg')}<span><b>${labels[c.color]} ${c.value}</b><small>选择后放入锅中</small></span></button>`).join('')}</div>`;
    return `<div class="action-primary-zone brewing-actions"><button class="action primary" data-a="drawChip" ${p.stopped||p.exploded?'disabled':''}>抽一枚筹码</button><button class="action" data-a="stop" ${p.stopped||p.exploded?'disabled':''}>停手</button><button class="action" data-a="useFlask" ${!p.flaskReady||p.exploded?'disabled':''}>🧪 Flask</button></div><p class="tip">白色危险值超过 7 才爆锅；正好 7 仍安全。</p>`;
  }
  if(state!.phase==='evaluation'){
    const remain=p.coinValue-p.shopSpent;
    const reward=p.exploded&&!p.rewardChoice?`<div class="reward-row"><button class="action primary" data-a="chooseExplosionReward" data-p='{"choice":"vp"}'>拿 ${p.vpValue} VP</button><button class="action" data-a="chooseExplosionReward" data-p='{"choice":"shop"}'>去购物</button></div>`:'';
    const canShop=(!p.exploded||p.rewardChoice==='shop')&&!p.evaluationDone;
    const market=canShop?`<div class="market-title"><b>市场</b><span>剩余 ${remain} 金币 · 最多 2 枚不同颜色</span></div><div class="market-scroll">${shop.map(([c,v,price])=>`<button class="shop-item ${c}" data-a="buyChip" data-p='{"color":"${c}","value":${v}}' ${price>remain||p.boughtColors.includes(c)?'disabled':''}>${chip({id:'',color:c,value:v},'md')}<span>${labels[c]} ${v}<b>${price} 金币</b></span></button>`).join('')}</div>`:'';
    return `<div class="settlement-summary"><span>本轮</span><b>${p.vpValue} VP / ${p.coinValue} 金币</b></div>${reward}${market}<div class="upgrade-row"><button class="action compact" data-a="spendRubies" data-p='{"option":"advance"}' ${p.rubies<2||p.startBonus>=5?'disabled':''}>💎2 起点+1</button><button class="action compact" data-a="spendRubies" data-p='{"option":"flask"}' ${p.rubies<2||p.flaskReady?'disabled':''}>💎2 补 Flask</button></div><button class="action primary finish" data-a="finishShopping" ${p.evaluationDone||(p.exploded&&!p.rewardChoice)?'disabled':''}>完成结算</button>`;
  }
  return `${state!.winnerIds.includes(p.id)?'<div class="winner-banner">🏆 炼金冠军</div>':'<div class="winner-banner muted-banner">本局结束</div>'}${parti.playerId===state!.hostId?'<button class="action primary finish" data-a="rematch">再来一局</button>':'<p class="tip">等待房主开始下一局。</p>'}`;
}

function updateOverlay(self:PlayerState|null){
  const node=document.querySelector('#overlay')!;
  if(rulesOpen){ node.innerHTML=rulesPanel(); return; }
  if(detailOpen){ node.innerHTML=detailsPanel(self); return; }
  node.innerHTML='';
}

function detailsPanel(p:PlayerState|null){
  if(!p) return modal('局内详情','<p>观战中暂无个人袋信息。</p>');
  const counts:Record<ChipColor,number>={white:0,green:0,orange:0,red:0,blue:0}; p.bag.forEach(c=>counts[c.color]++);
  return modal('你的炼金详情',`<div class="detail-grid">${(Object.keys(counts) as ChipColor[]).map(c=>`<div class="detail-chip">${chip({id:'',color:c,value:counts[c]},'md')}<span>${labels[c]}<b>${counts[c]} 枚</b></span></div>`).join('')}</div><div class="detail-stats"><span>VP <b>${p.vp}</b></span><span>Ruby <b>${p.rubies}</b></span><span>起点 <b>+${p.startBonus}</b></span><span>Flask <b>${p.flaskReady?'可用':'已用'}</b></span></div>`);
}
function rulesPanel(){
  return modal('Cauldron Rush 玩法',`<div class="rules-grid"><article><h3>目标</h3><p>2–5 人进行 7 轮，最终 VP 最高者获胜。</p></article><article><h3>抽取与爆锅</h3><p>继续抽取会推进锅位。白色危险累计超过 7 才爆锅；正好 7 安全。</p></article><article><h3>特殊筹码</h3><p>Green 轮末可能给 Ruby；Red 后程加速；Blue 触发双候选；Orange 稳定推进。</p></article><article><h3>轮末</h3><p>未爆锅自动拿 VP 并购物；爆锅只能在 VP 与购物间二选一。</p></article><article><h3>购物</h3><p>每轮最多 2 枚且颜色不同。2 Ruby 可提高永久起点或补 Flask。</p></article><article><h3>胜负</h3><p>第 7 轮后比 VP；平手比较袋中非白筹码总价值。</p></article></div>`);
}
function modal(title:string,body:string){ return `<div class="overlay" data-ui="close"><section class="modal panel" onclick="event.stopPropagation()"><div class="modal-head"><h2>${title}</h2><button data-ui="close">×</button></div><div class="modal-scroll">${body}</div></section></div>`; }

function bindUi(){
  document.querySelectorAll<HTMLElement>('[data-a]').forEach(el=>el.onclick=()=>act(el.dataset.a!,el.dataset.p?JSON.parse(el.dataset.p):undefined));
  document.querySelectorAll<HTMLElement>('[data-ui="rules"]').forEach(el=>el.onclick=()=>{rulesOpen=true;detailOpen=false;render();});
  document.querySelectorAll<HTMLElement>('[data-ui="details"]').forEach(el=>el.onclick=()=>{detailOpen=true;rulesOpen=false;render();});
  document.querySelectorAll<HTMLElement>('[data-ui="close"]').forEach(el=>el.onclick=()=>{rulesOpen=false;detailOpen=false;render();});
}

parti.onState(next=>{ state=next; toast=''; render(); });
parti.onEvent('game:invalid',p=>{ toast=`⚠ ${p?.message??'操作无效'}`; render(); setTimeout(()=>{toast='';render();},1600); });
parti.exposeToAgent?.(s=>({game:'Cauldron Rush',phase:s.phase,round:s.round,message:s.message,you:parti.playerId?s.players[parti.playerId]:null,actions:['setReady','startGame','drawChip','chooseBlueCandidate','stop','useFlask','chooseExplosionReward','buyChip','finishShopping','spendRubies','rematch']}));
parti.ready();
