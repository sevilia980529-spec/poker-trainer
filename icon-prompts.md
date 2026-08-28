# 扑克陪练 App 图标提示词清单

> 用途：把 AI 生成的图标 PNG 放进 `public/icons/<name>.png`，代码里 `Icon name="<name>"` 会自动读取。
> 图片缺失时自动回退成 emoji，不会破图。
> 统一视觉规范（所有图标保持一致风格）：
> `Premium poker app icon, circular badge, dark green casino felt background with subtle spade pattern, thin gold metallic rim, `
> 结尾统一加：
> `, warm gold and ivory tones, realistic 3D render with soft studio lighting, centered composition, transparent background, high detail, clean edges, game UI icon style`

生成建议：1024×1024，透明背景，风格统一（圆形徽章+绿绒底+金边）。

---

## 一、界面选项里缺图、建议必做的（6 个）✅ 已完成

| 文件名 | name | 用在哪 | 主体描述（拼在规范前后缀之间） |
|---|---|---|---|
| `seedling.png` | seedling | 大厅「新手」难度选项 | `a small golden seedling sprouting from a white poker chip, soft glow` |
| `zap.png` | zap | 大厅「高手」难度选项 | `a sharp golden lightning bolt striking through a red poker chip, electric glow` |
| `cards.png` | cards | 训练中心「位置与起手牌」专题 | `two overlapping playing cards (ace of spades and king of hearts) fanned out, gold edges` |
| `ruler.png` | ruler | 训练中心「下注尺度」专题 | `a golden ruler crossed over a poker chip with measurement markings, clean` |
| `robot.png` | robot | 牌桌座位默认机器人头像（无风格时回退） | `a cute metallic robot head with antenna and gold visor, friendly, centered` |
| `people.png` | people | 好友房入口图标（首页/菜单） | `two stylized human silhouettes facing each other over a small poker chip` |

---

## 二、扩展备用（iconMap 已映射但界面暂未引用，可一并做以防后续用）

| 文件名 | name | 主体描述 |
|---|---|---|
| `house.png` | house | `a cozy casino cabin / poker club house icon, gold door` |
| `gift.png` | gift | `a wrapped gift box with a poker chip ribbon, gold bow` |
| `bar-chart.png` | bar-chart | `a gold bar chart rising with an upward arrow, clean` |
| `pin.png` | pin | `a gold location pin drop with spade emblem` |
| `beans.png` | beans | `a small pile of poker beans / tokens, gold` |
| `refresh.png` | refresh | `a circular arrow refresh icon in gold, clean` |
| `trophy.png` | trophy | `a gold champion trophy on green felt, celebrate` |
| `book2.png` | book2 | `an open rulebook with spade emblem, gold edges` |
| `warn.png` | warn | `a gold warning triangle with exclamation, clean` |
| `numbers.png` | numbers | `gold numbers / dice showing pips, clean` |
| `pencil.png` | pencil | `a gold pencil over a small notepad, clean` |
| `info.png` | info | `a gold info circle with i, clean` |

---

## 三、已生成、无需再做的（确认）

线性图标（已有 PNG）：arrow-left / arrow-right / arrow-down / bulb / target / joker / fire / graduation / party / crown / book / coins / check / cross / medal-bronze / medal-silver / medal-gold / gem / gem-blue / star / fox / leopard / capybara / owl / collie / pig / rock / scale / spade / heart / diamond / club。

选项图标（已有 PNG）：seedling / zap / cards / ruler / robot / people。

筹码图（已有，已接入 ChipStack）：chip-10 / 20 / 50 / 100 / 500 / 1000。

用户头像（已有 12 张，已修复下移居中，已 push）：avatars/1.png ~ 12.png。

---

## 四、统一提示词模板（直接复制改主体）

```
Premium poker app icon, circular badge, dark green casino felt background with subtle spade pattern, thin gold metallic rim, <这里填主体描述>, warm gold and ivory tones, realistic 3D render with soft studio lighting, centered composition, transparent background, high detail, clean edges, game UI icon style
```

把 `<这里填主体描述>` 换成「一」或「二」表格里对应的那句即可。
