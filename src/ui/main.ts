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
type Chip = { id: string; color: ChipColor; value: number; position?: number };
type PlayerState = { id:string; name:string; connected:boolean; ready:boolean; vp:number; rubies:number; startBonus:number; flaskReady:boolean; potPosition:number; danger:number; exploded:boolean; stopped:boolean; bagEmpty:boolean; pot:Chip[]; bag:Chip[]; pendingBlue:Chip[]|null; rewardChoice:'vp'|'shop'|null; coinValue:number; vpValue:number; shopSpent:number; boughtColors:ChipColor[]; evaluationDone:boolean };
type GameState = { phase:'lobby'|'brewing'|'evaluation'|'gameEnd'; hostId:string; round:number; maxRounds:number; players:Record<string,PlayerState>; order:string[]; message:string; winnerIds:string[] };

const app = document.querySelector<HTMLDivElement>('#app')!;
let state: GameState | null = null;
let toast = '';
let rulesOpen = false;
const colorLabel: Record<ChipColor,string> = { white:'危险', green:'稳定', orange:'火花', red:'烈焰', blue:'预见' };
const shop = [ ['orange',1,3], ['green',1,4], ['red',1,5], ['blue',1,5], ['green',2,8], ['red',2,9], ['blue',2,10] ] as const;

function act(name:string,payload?:unknown){ void parti.action(name,payload); }
function chipHtml(c:Chip){ return `<span class="chip ${c.color}" title="${colorLabel[c.color]}"><b>${c.value}</b></span>`; }
function me(){ return state && parti.playerId ? state.players[parti.playerId] : null; }

function render() {
  if (!state) return;
  const self = me();
  app.innerHTML = `<main class="shell">
    <header><div><span class="eyebrow">PARTI ALCHEMY LEAGUE</span><h1>Cauldron Rush</h1></div><div class="header-actions"><button class="rules-button" data-ui="rules">玩法</button><div class="round">${state.phase==='lobby'?'准备室':`第 ${state.round}/${state.maxRounds} 轮`}</div></div></header>
    <section class="status">${toast || state.message}</section>
    <section class="players">${state.order.map(id=>playerCard(state!.players[id], id===parti.playerId)).join('')}</section>
    ${self ? controls(self) : '<section class="panel">观战中</section>'}
    ${rulesOpen ? rulesPanel() : ''}
  </main>`;
  bind();
}

function playerCard(p:PlayerState,isMe:boolean){
  const flags=[p.exploded?'💥 爆锅':'',p.stopped&&!p.exploded?'✓ 停手':'',!p.connected?'离线':''].filter(Boolean).join(' · ');
  return `<article class="player ${isMe?'self':''}"><div class="player-head"><strong>${escapeHtml(p.name)}${isMe?' · 你':''}</strong><span>${p.vp} VP · 💎${p.rubies}</span></div><div class="track"><i style="width:${Math.min(100,p.potPosition/35*100)}%"></i></div><div class="mini">锅位 ${p.potPosition} · 危险 ${p.danger}/7 · 袋中 ${p.bag.length}${flags?` · ${flags}`:''}</div><div class="chips">${p.pot.slice(-7).map(chipHtml).join('')}</div></article>`;
}

function controls(p:PlayerState){
  if(state!.phase==='lobby') return `<section class="panel controls"><h2>准备炼金</h2><p>2–5 人，所有非房主玩家准备后即可开始。</p><div class="actions"><button data-a="setReady" data-p='{"ready":${!p.ready}}'>${p.ready?'取消准备':'我准备好了'}</button>${parti.playerId===state!.hostId?'<button class="primary" data-a="startGame">开始 7 轮竞速</button>':''}</div></section>`;
  if(state!.phase==='brewing'){
    if(p.pendingBlue) return `<section class="panel controls"><h2>蓝色预见</h2><p>选择一枚放入锅，另一枚返回袋中。</p><div class="candidate">${p.pendingBlue.map(c=>`<button class="chip-button" data-a="chooseBlueCandidate" data-p='{"instanceId":"${c.id}"}'>${chipHtml(c)}<span>${colorLabel[c.color]} ${c.value}</span></button>`).join('')}</div></section>`;
    return `<section class="panel controls"><h2>${p.exploded?'锅炉失控！':p.stopped?'本轮已停手':'继续，还是收手？'}</h2><div class="meter"><span>危险值</span><b>${p.danger}/7</b></div><div class="actions"><button class="primary" data-a="drawChip" ${p.stopped||p.exploded?'disabled':''}>抽一枚筹码</button><button data-a="stop" ${p.stopped||p.exploded?'disabled':''}>停手</button><button data-a="useFlask" ${!p.flaskReady||p.exploded?'disabled':''}>🧪 Flask</button></div></section>`;
  }
  if(state!.phase==='evaluation'){
    const remain=p.coinValue-p.shopSpent;
    const reward = p.exploded && !p.rewardChoice
      ? `<div class="actions"><button class="primary" data-a="chooseExplosionReward" data-p='{"choice":"vp"}'>拿 VP</button><button data-a="chooseExplosionReward" data-p='{"choice":"shop"}'>去购物</button></div>`
      : '';
    const store = (!p.exploded || p.rewardChoice==='shop') && !p.evaluationDone
      ? `<h3>商店 · 剩余 ${remain} 金币</h3><div class="shop">${shop.map(([c,v,price])=>`<button data-a="buyChip" data-p='{"color":"${c}","value":${v}}' ${price>remain||p.boughtColors.includes(c)?'disabled':''}>${chipHtml({id:'',color:c,value:v})}<span>${price} 金币</span></button>`).join('')}</div>`
      : '';
    return `<section class="panel controls"><h2>轮末结算</h2><p>本轮锅位可得 <b>${p.vpValue} VP</b> 与 <b>${p.coinValue} 金币</b>${p.exploded?'；爆锅只能二选一':''}。</p>${reward}${store}<div class="actions"><button data-a="spendRubies" data-p='{"option":"advance"}' ${p.rubies<2||p.startBonus>=5?'disabled':''}>💎2 起点 +1</button><button class="primary" data-a="finishShopping" ${p.evaluationDone||(p.exploded&&!p.rewardChoice)?'disabled':''}>完成结算</button></div></section>`;
  }
  return `<section class="panel controls gameover"><h2>${state!.winnerIds.includes(p.id)?'🏆 你赢了！':'炼金竞速结束'}</h2><p>${state!.message}</p>${parti.playerId===state!.hostId?'<button class="primary" data-a="rematch">再来一局</button>':''}</section>`;
}

function rulesPanel(){
  return `<div class="rules-backdrop" data-ui="close-rules"><section class="rules-modal" role="dialog" aria-modal="true" aria-label="Cauldron Rush 游戏规则" onclick="event.stopPropagation()">
    <div class="rules-title"><div><span class="eyebrow">HOW TO PLAY</span><h2>炼金竞速规则</h2></div><button class="rules-close" data-ui="close-rules" aria-label="关闭规则">×</button></div>
    <div class="rules-grid">
      <article><h3>🎯 目标</h3><p>2–5 人进行 7 轮。不断抽筹码推进锅轨、赚取 VP 与金币；第 7 轮结束后 VP 最高者获胜。</p></article>
      <article><h3>🔥 抽取与爆锅</h3><p>轮到你操作时可继续“抽一枚筹码”或“停手”。白色筹码累计危险值 <b>超过 7</b> 才爆锅；正好 7 仍安全。造成爆锅的那枚筹码仍会推进锅位。</p></article>
      <article><h3>🧪 Flask</h3><p>每轮一次：刚抽到白色筹码且尚未爆锅时，可用 Flask 把它放回袋中，并撤销该筹码的推进。爆锅后不能使用。</p></article>
      <article><h3>🎨 筹码效果</h3><ul><li><b>White</b>：推进并增加危险值。</li><li><b>Green</b>：若位于本轮最后两枚非白筹码之一，结算 +1 Ruby。</li><li><b>Orange</b>：普通推进，无额外风险。</li><li><b>Red</b>：锅内已有至少 2 枚 Red 时，新 Red 额外 +1 锅位。</li><li><b>Blue</b>：展示 2 个候选，选 1 个入锅，另 1 个放回袋中。</li></ul></article>
      <article><h3>💰 轮末结算</h3><p>未爆锅：获得锅位对应 VP，并可用金币购物。爆锅：必须在“拿 VP”和“购物”之间二选一。</p></article>
      <article><h3>🛍 购物与 Ruby</h3><p>每轮最多买 2 枚筹码，且颜色必须不同，总价不能超过金币。花 2 Ruby 可让之后每轮起点永久 +1（最多 +5），或补充 Flask。</p></article>
      <article><h3>🏆 胜负</h3><p>7 轮后比较 VP；平手时比较袋中非白筹码总价值；仍相同则共享胜利。</p></article>
      <article><h3>💡 新手提示</h3><p>锅位越远，收益越高，但危险值也更容易失控。前期适当扩充非白筹码，能显著降低后几轮爆锅概率。</p></article>
    </div>
  </section></div>`;
}

function bind(){
  document.querySelectorAll<HTMLElement>('[data-a]').forEach(el=>el.addEventListener('click',()=>{ const name=el.dataset.a!; const payload=el.dataset.p?JSON.parse(el.dataset.p):undefined; act(name,payload); }));
  document.querySelectorAll<HTMLElement>('[data-ui="rules"]').forEach(el=>el.addEventListener('click',()=>{ rulesOpen=true; render(); }));
  document.querySelectorAll<HTMLElement>('[data-ui="close-rules"]').forEach(el=>el.addEventListener('click',()=>{ rulesOpen=false; render(); }));
}
function escapeHtml(s:string){ return s.replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!)); }

parti.onState((next)=>{ state=next; toast=''; render(); });
parti.onEvent('game:invalid',(p)=>{ toast=`⚠ ${p?.message ?? '操作无效'}`; render(); setTimeout(()=>{toast='';render();},1400); });
parti.exposeToAgent?.((s)=>({ game:'Cauldron Rush', phase:s.phase, round:s.round, message:s.message, you:parti.playerId?s.players[parti.playerId]:null, actions:['setReady','startGame','drawChip','chooseBlueCandidate','stop','useFlask','chooseExplosionReward','buyChip','finishShopping','spendRubies','rematch'] }));
parti.ready();
