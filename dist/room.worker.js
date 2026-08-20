import { defineRoom } from '@parti/worker-sdk';
const START_BAG = [
    ['white', 1, 4], ['white', 2, 2], ['white', 3, 1], ['green', 1, 1], ['orange', 1, 1],
];
const SHOP = {
    green: { 1: 4, 2: 8 },
    orange: { 1: 3 },
    red: { 1: 5, 2: 9 },
    blue: { 1: 5, 2: 10 },
};
function initialState() {
    return { phase: 'lobby', hostId: '', round: 0, maxRounds: 7, players: {}, order: [], message: '等待炼金师加入', log: [], nextChipId: 1, winnerIds: [] };
}
function log(state, type, detail, playerId, rng) {
    state.log.push({ n: state.log.length + 1, round: state.round, type, detail, playerId, rng });
    if (state.log.length > 80)
        state.log.splice(0, state.log.length - 80);
}
function chip(state, color, value) {
    return { id: `c${state.nextChipId++}`, color, value };
}
function makeBag(state) {
    const bag = [];
    for (const [color, value, count] of START_BAG)
        for (let i = 0; i < count; i++)
            bag.push(chip(state, color, value));
    return bag;
}
function makePlayer(state, p) {
    return {
        id: p.id, name: p.name, connected: true, ready: false, vp: 0, rubies: 0, startBonus: 0, flaskReady: true,
        potPosition: 0, danger: 0, exploded: false, stopped: false, bagEmpty: false, pot: [], bag: makeBag(state), pendingBlue: null,
        rewardChoice: null, coinValue: 0, vpValue: 0, shopSpent: 0, boughtColors: [], evaluationDone: false,
    };
}
function scoring(position) {
    const p = Math.max(0, Math.min(35, position));
    return { vp: Math.floor(p / 5), coins: Math.min(15, 1 + Math.floor(p / 2)), ruby: p > 0 && p % 5 === 0 };
}
function resetRoundPlayer(p) {
    p.potPosition = p.startBonus;
    p.danger = 0;
    p.exploded = false;
    p.stopped = false;
    p.bagEmpty = p.bag.length === 0;
    p.pot = [];
    p.pendingBlue = null;
    p.rewardChoice = null;
    p.coinValue = 0;
    p.vpValue = 0;
    p.shopSpent = 0;
    p.boughtColors = [];
    p.evaluationDone = false;
}
function beginRound(state) {
    state.round += 1;
    state.phase = 'brewing';
    for (const id of state.order)
        resetRoundPlayer(state.players[id]);
    state.message = `第 ${state.round} 轮：抽取筹码或及时停手`;
    log(state, 'roundStart', `round ${state.round}`);
}
function allBrewingDone(state) {
    return state.order.every((id) => {
        const p = state.players[id];
        return p.stopped || p.exploded || p.bagEmpty;
    });
}
function enterEvaluation(state) {
    state.phase = 'evaluation';
    for (const id of state.order) {
        const p = state.players[id];
        const s = scoring(p.potPosition);
        p.vpValue = s.vp;
        p.coinValue = s.coins;
        if (s.ruby)
            p.rubies += 1;
        if (!p.exploded) {
            p.vp += p.vpValue;
            p.rewardChoice = 'shop';
        }
        const nonWhite = p.pot.filter((c) => c.color !== 'white');
        const lastTwo = nonWhite.slice(-2);
        if (lastTwo.some((c) => c.color === 'green'))
            p.rubies += 1;
    }
    state.message = '结算：爆锅玩家先选择奖励，然后购物/结束结算';
    log(state, 'evaluation', 'all players resolved brewing');
}
function maybeEnterEvaluation(state) {
    if (state.phase === 'brewing' && allBrewingDone(state))
        enterEvaluation(state);
}
function removeRandom(p, rand) {
    if (!p.bag.length)
        return null;
    const i = Math.min(p.bag.length - 1, Math.floor(rand * p.bag.length));
    return p.bag.splice(i, 1)[0] ?? null;
}
function placeChip(state, p, c) {
    let advance = c.value;
    if (c.color === 'red' && p.pot.filter((x) => x.color === 'red').length >= 2)
        advance += 1;
    p.potPosition += advance;
    p.pot.push({ ...c, position: p.potPosition, drawIndex: p.pot.length });
    if (c.color === 'white')
        p.danger += c.value;
    if (p.danger > 7) {
        p.exploded = true;
        p.stopped = true;
        log(state, 'explode', `danger ${p.danger}`, p.id);
    }
    if (!p.bag.length) {
        p.bagEmpty = true;
        p.stopped = true;
    }
}
function draw(ctx, p) {
    if (p.pendingBlue)
        return invalid(ctx, p.id, '请先选择蓝色候选');
    if (p.stopped || p.exploded || p.bagEmpty)
        return invalid(ctx, p.id, '本轮已不能继续抽取');
    const r = ctx.random();
    const first = removeRandom(p, r);
    if (!first) {
        p.bagEmpty = true;
        p.stopped = true;
        maybeEnterEvaluation(ctx.state);
        return;
    }
    log(ctx.state, 'draw', `${first.id}:${first.color}${first.value}`, p.id, r);
    if (first.color === 'blue' && p.bag.length > 0) {
        const r2 = ctx.random();
        const second = removeRandom(p, r2);
        if (second) {
            p.pendingBlue = [first, second];
            log(ctx.state, 'blueCandidates', `${first.id},${second.id}`, p.id, r2);
            return;
        }
    }
    placeChip(ctx.state, p, first);
    maybeEnterEvaluation(ctx.state);
}
function chooseBlue(ctx, p, instanceId) {
    if (!p.pendingBlue)
        return invalid(ctx, p.id, '当前没有蓝色候选');
    const chosen = p.pendingBlue.find((c) => c.id === instanceId);
    if (!chosen)
        return invalid(ctx, p.id, '候选筹码无效');
    const other = p.pendingBlue.find((c) => c.id !== instanceId);
    p.pendingBlue = null;
    if (other)
        p.bag.push(other);
    placeChip(ctx.state, p, chosen);
    log(ctx.state, 'blueChoose', chosen.id, p.id);
    maybeEnterEvaluation(ctx.state);
}
function invalid(ctx, playerId, message) {
    ctx.send(playerId, 'game:invalid', { message });
}
function activePlayer(ctx, playerId) {
    const p = ctx.state.players[playerId];
    if (!p) {
        invalid(ctx, playerId, '玩家不在房间');
        return null;
    }
    return p;
}
function maybeFinishEvaluation(state) {
    if (!state.order.every((id) => state.players[id].evaluationDone))
        return;
    if (state.round >= state.maxRounds) {
        state.phase = 'gameEnd';
        const maxVp = Math.max(...state.order.map((id) => state.players[id].vp));
        let tied = state.order.filter((id) => state.players[id].vp === maxVp);
        if (tied.length > 1) {
            const nonWhiteValue = (id) => state.players[id].bag.filter((c) => c.color !== 'white').reduce((s, c) => s + c.value, 0);
            const maxBag = Math.max(...tied.map(nonWhiteValue));
            tied = tied.filter((id) => nonWhiteValue(id) === maxBag);
        }
        state.winnerIds = tied;
        state.message = tied.length === 1 ? `${state.players[tied[0]].name} 赢得炼金竞速！` : `并列胜利：${tied.map((id) => state.players[id].name).join('、')}`;
        log(state, 'gameEnd', state.message);
    }
    else
        beginRound(state);
}
function finishEvaluation(state, p) {
    if (p.exploded && !p.rewardChoice)
        return false;
    p.evaluationDone = true;
    maybeFinishEvaluation(state);
    return true;
}
function canShop(p) {
    return !p.exploded || p.rewardChoice === 'shop';
}
function buy(ctx, p, color, value) {
    if (ctx.state.phase !== 'evaluation' || p.evaluationDone)
        return invalid(ctx, p.id, '当前不能购物');
    if (!canShop(p))
        return invalid(ctx, p.id, '你选择了胜利分，不能购物');
    if (color === 'white')
        return invalid(ctx, p.id, '白色危险筹码不可购买');
    if (p.boughtColors.includes(color))
        return invalid(ctx, p.id, '每轮同色最多购买一次');
    if (p.boughtColors.length >= 2)
        return invalid(ctx, p.id, '每轮最多购买 2 枚筹码');
    const price = SHOP[color]?.[value];
    if (!Number.isFinite(price))
        return invalid(ctx, p.id, '商店中涋有该筹码');
    if (p.shopSpent + price > p.coinValue)
        return invalid(ctx, p.id, '金币不足');
    p.shopSpent += price;
    p.boughtColors.push(color);
    p.bag.push(chip(state, color, value));
    log(ctx.state, 'buy', `${color}${value} for ${price}`, p.id);
}
function syncName(state, player) {
    const p = state.players[player.id];
    if (p) {
        p.name = player.name;
        p.connected = true;
    }
}
const __test = { initialState, makePlayer, placeChip, scoring, enterEvaluation, finishEvaluation, beginRound, maybeFinishEvaluation };
export default defineRoom({
    meta: { name: 'Cauldron Rush', minPlayers: 2, maxPlayers: 5 },
    initialState,
    onJoin(ctx, player) {
        if (player.role === 'spectator')
            return;
        if (ctx.state.phase !== 'lobby' && !ctx.state.players[player.id])
            return ctx.kick(player.id, '本局已开始');
        if (!ctx.state.players[player.id]) {
            ctx.state.players[player.id] = makePlayer(ctx.state, player);
            ctx.state.order.push(player.id);
            if (!ctx.state.hostId || player.role === 'host')
                ctx.state.hostId = player.id;
            ctx.state.message = '准备后由房主开始游戏';
        }
        else
            syncName(ctx.state, player);
    },
    onReconnect(ctx, player) { syncName(ctx.state, player); },
    onLeave(ctx, player) {
        const p = ctx.state.players[player.id];
        if (!p)
            return;
        p.connected = false;
        if (ctx.state.phase === 'lobby') {
            delete ctx.state.players[player.id];
            ctx.state.order = ctx.state.order.filter((id) => id !== player.id);
            if (ctx.state.hostId === player.id)
                ctx.state.hostId = ctx.state.order[0] ?? '';
        }
    },
    onReady(ctx, player) { syncName(ctx.state, player); },
    actions: {
        setReady(ctx, { player, payload }) {
            const p = activePlayer(ctx, player.id);
            if (!p || ctx.state.phase !== 'lobby')
                return;
            p.ready = Boolean(payload?.ready);
      },
      startGame(ctx, { player }) {
            if (ctx.state.phase !== 'lobby')
                return invalid(ctx, player.id, '游戏已经开始');
            if (player.id !== ctx.state.hostId)
                return invalid(ctx, player.id, '只才承开始的戻丹');
            if (ctx.state.order.length < 2)
                return invalid(ctx, player.id, '即少严 2 名玩家');
            if (!ctx.state.order.every((id) => ctx.state.players[id].ready || id === ctx.state.hostId))
                return invalid(ctx, player.id, '当前不能开始游戏';
            beginRound(ctx.state);
        },
        drawChip(ctx, { player }) {
            const p = activePlayer(ctx, player.id);
            if (!p)
                return;
            if (ctx.state.phase !== 'brewing')
                return invalid(ctx, player.id, '当前不是熬制阶段');
            draw(ctx, p);
        },
        chooseBlueCandidate(ctx, { player, payload }) {
            const p = activePlayer(ctx, player.id);
            if (!p)
                return;
            if (ctx.state.phase !== 'brewing')
                return invalid(ctx, player.id, '当前不是熬制阶段');
            chooseBlue(ctx, p, typeof payload?.instanceId === 'string' ? payload.instanceId : '');
        },
        stop(ctx, { player }) {
            const p = activePlayer(ctx, player.id);
            if (!p)
                return;
            if (ctx.state.phase !== 'brewing' || p.exploded || p.stopped || p.pendingBlue)
                return invalid(ctx, player.id, '当前不能停手');
            p.stopped = true;
            log(ctx.state, 'stop', 'player stopped', p.id);
            maybeEnterEvaluation(ctx.state);
        },
        useFlask(ctx, { player }) {
            const p = activePlayer(ctx, player.id);
            if (!p)
                return;
            if (ctx.state.phase !== 'brewing' || !p.flaskReady || p.exploded || p.pendingBlue)
                return invalid(ctx, p.id, '当前不能使用 Flask');
            const last = p.pot[p.pot.length - 1];
            if (!last || last.color !== 'white' || p.danger > 7)
                return invalid(ctx, p.id, 'Flask 只能撤回刚抽且未爆锅的白色筹码');
            p.pot.pop();
            p.potPosition -= last.value;
            p.danger -= last.value;
            p.bag.push({ id: last.id, color: last.color, value: last.value });
            p.flaskReady = false;
            p.bagEmpty = false;
            p.stopped = false;
            log(ctx.state, 'flask', last.id, p.id);
        },
        chooseExplosionReward(ctx, { player, payload }) {
            const p = activePlayer(ctx, player.id);
            if (!p)
                return;
            if (ctx.state.phase !== 'evaluation' || !p.exploded || p.rewardChoice)
                return invalid(ctx, p.id, '当前不能选择爆锅奖励');
            const choice = payload?.choice;
            if (choice !== 'vp' && choice !== 'shop')
                return invalid(ctx, p.id, '奖励选择无效');
            p.rewardChoice = choice;
            if (choice === 'vp')
                p.vp += p.vpValue;
            log(ctx.state, 'explosionReward', choice, p.id);
        },
        buyChip(ctx, { player, payload }) {
            const p = activePlayer(ctx, player.id);
            if (!p)
                return;
            const color = payload?.color;
            const value = Number(payload?.value);
            if (!['green', 'orange', 'red', 'blue'].includes(color))
                return invalid(ctx, p.id, '颜色无效');
            buy(ctx, p, color, value);
        },
        finishShopping(ctx, { player }) {
            const p = activePlayer(ctx, player.id);
            if (!p || ctx.state.phase !== 'evaluation' || p.evaluationDone)
                return invalid(ctx, player.id, '当前不能结束购物');
            if (!finishEvaluation(ctx.state, p))
                invalid(ctx, p.id, '请先选择爆锅奖励');
        },
        spendRubies(ctx, { player, payload }) {
            const p = activePlayer(ctx, player.id);
            if (!p || ctx.state.phase !== 'evaluation' || p.evaluationDone)
                return invalid(ctx, player.id, '当前不能花费宝石');
            if (p.rubies < 2)
                return invalid(ctx, p.id, '宝石不足');
            const option = payload?.option;
            if (option === 'advance') {
                if (p.startBonus >= 5)
                    return invalid(ctx, p.id, '起始加成已达上限');
                p.rubies -= 2;
                p.startBonus += 1;
            }
            else if (option === 'flask') {
                if (p.flaskReady)
                    return invalid(ctx, p.id, 'Flask 已经可用');
                p.rubies -= 2;
                p.flaskReady = true;
            }
            else
                return invalid(ctx, p.id, '宝石用途无效');
            log(ctx.state, 'rubies', String(option), p.id);
        },
        rematch(ctx, { player }) {
            if (ctx.state.phase !== 'gameEnd' || player.id !== ctx.state.hostId)
                return invalid(ctx, player.id, '当前不能重赛');
            for (const id of ctx.state.order) {
                const old = ctx.state.players[id];
                const fresh = makePlayer(ctx.state, { id, name: old.name, role: id === ctx.state.hostId ? 'host' : 'player' });
                fresh.ready = id === ctx.state.hostId;
                ctx.state.players[id] = fresh;
            }
            ctx.state.round = 0;
            ctx.state.phase = 'lobby';
            ctx.state.winnerIds = [];
            ctx.state.message = '重赛准备中';
        }
    }
});
