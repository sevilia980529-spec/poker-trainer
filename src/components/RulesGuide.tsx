// 德州扑克规则与术语指南弹窗：基本规则 / 位置策略 / 进阶术语
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const HAND_RANKS = [
  ['皇家同花顺', 'A K Q J 10 同花色，最大牌型'],
  ['同花顺', '五张同花色连牌'],
  ['四条', '四张同点数'],
  ['葫芦', '三条 + 一对'],
  ['同花', '五张同花色'],
  ['顺子', '五张连牌（A 可当头或尾）'],
  ['三条', '三张同点数'],
  ['两对', '两个对子'],
  ['一对', '一个对子'],
  ['高牌', '什么都不是，比单张大小'],
];

const ACTIONS: [string, string][] = [
  ['过牌 Check', '自己不下注，把行动权交给下家。只有在没人下注的轮次才能过牌。'],
  ['跟注 Call', '跟上对手当前的注额，继续留在牌局里。'],
  ['加注 Raise', '在别人下注的基础上提高注额，施加压力、榨取价值或诈唬。'],
  ['弃牌 Fold', '放弃本手牌，及时止损。牌不好时弃牌永远是对的。'],
  ['全下 All-in', '押上全部筹码。常用于强牌榨干对手，或半诈唬施压。'],
];

const POSITIONS: [string, string][] = [
  ['BTN 按钮位（庄家）', '全场最好的位置：翻牌后永远最后行动，掌握全部信息。可以多玩牌、多加注抢底池。'],
  ['CO 关煞位', '按钮位前一位，次好位置。前面没人进池时可以放宽范围偷盲注。'],
  ['MP 中间位', '位置一般，前面后面都有人，玩牌要偏保守。'],
  ['UTG 枪口位', '翻牌前第一个行动，信息最少。只玩顶级牌：大对子（10对以上）、AQ、AK。'],
  ['SB 小盲位', '被迫下小盲，翻牌后第一个行动，最难受的位置。收紧范围，少纠缠。'],
  ['BB 大盲位', '已经投了一个大盲，跟注成本低，防守范围可以宽一些，但翻牌后先行动仍要谨慎。'],
];

const TERMS: [string, string][] = [
  ['底池 Pot', '桌上所有玩家已下注的筹码总和，本手的战利品。'],
  ['胜率 Equity', '你的手牌最终赢下底池的概率，教练条上的百分比就是它。'],
  ['诈唬 Bluff', '拿弱牌下注/加注，演成强牌让对手弃掉比你好的牌。'],
  ['半诈唬 Semi-Bluff', '拿听牌下注施压：对手弃牌你直接赢，被跟注你还有补牌反超。'],
  ['价值下注 Value Bet', '拿着好牌下注，希望更差的牌跟注付钱给你。'],
  ['持续下注 C-Bet', '翻牌前加注的人在翻牌后继续下注，维持进攻者姿态。'],
  ['听牌 / 补牌 Outs', '差一张就成牌叫听牌；能让你成牌的剩余牌数叫补牌数（如两头顺听有 8 张补牌）。'],
  ['底池赔率 Pot Odds', '需要跟注的金额与底池的比例。补牌胜率高于跟注比例，就跟注划算。'],
  ['紧 / 松（Tight / Loose）', '玩牌范围窄叫紧，范围宽叫松；多下注加注叫凶（Aggressive）。'],
  ['筹码深度', '剩余筹码是盲注的多少倍。越深，翻牌后操作空间越大。'],
];

function Section({ title, items, cols }: { title: string; items: [string, string][]; cols?: boolean }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-amber-300 mb-2">{title}</h3>
      <div className={cols ? 'grid sm:grid-cols-2 gap-2' : 'space-y-2'}>
        {items.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-800/70 border border-slate-700 p-2.5">
            <p className="text-xs font-bold text-slate-100">{k}</p>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RulesGuideDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>📖 德州规则与术语</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="rules">
          <TabsList className="w-full">
            <TabsTrigger value="rules" className="flex-1">基本规则</TabsTrigger>
            <TabsTrigger value="position" className="flex-1">位置策略</TabsTrigger>
            <TabsTrigger value="terms" className="flex-1">进阶术语</TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="mt-3 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-amber-300 mb-2">一手牌的流程</h3>
              <ol className="text-xs text-slate-300 space-y-1.5 leading-relaxed list-none">
                <li>① 小盲、大盲强制下注，形成初始底池</li>
                <li>② 每人发 2 张底牌（只有你自己能看到）</li>
                <li>③ <b>翻牌前</b>：从枪口位开始第一轮下注</li>
                <li>④ <b>翻牌</b>：发出 3 张公共牌，第二轮下注</li>
                <li>⑤ <b>转牌</b>：第 4 张公共牌，第三轮下注</li>
                <li>⑥ <b>河牌</b>：第 5 张公共牌，最后一轮下注</li>
                <li>⑦ <b>摊牌</b>：用 2 张底牌 + 5 张公共牌拼出最大的 5 张牌型比大小，赢家通吃底池</li>
              </ol>
            </div>
            <Section title="牌型大小（从大到小）" items={HAND_RANKS.map(([k, v]) => [k, v] as [string, string])} cols />
            <Section title="五种行动" items={ACTIONS} />
          </TabsContent>

          <TabsContent value="position" className="mt-3 space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed rounded-lg bg-emerald-950/60 border border-emerald-800 p-2.5">
              💡 核心口诀：<b className="text-emerald-300">位置越靠后，信息越多，能玩的牌越多。</b>
              前位只玩强牌，后位可以放宽范围偷盲注。
            </p>
            <Section title="六个位置" items={POSITIONS} />
          </TabsContent>

          <TabsContent value="terms" className="mt-3">
            <Section title="进阶术语速查" items={TERMS} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
