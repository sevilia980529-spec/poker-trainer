# 扑克陪练 App 图标提示词清单

> 用途：把 AI 生成的图标 PNG 放进 `public/icons/<name>.png`，代码里 `Icon name="<name>"` 会自动读取。
> 图片缺失时自动回退成 emoji，不会破图。
>
> **统一视觉规范（与已有 bulb/target/crown/book/coins/star/heart/check/arrow 这批一致）**：
> 已有图标是「实心金/琥珀色扁平 2D 填充图标，透明背景，无圆形徽章，无绿绒底，无金边」。
> 色值参考：金 `rgb(192,160,64)` → `rgb(224,160,64)`（琥珀金渐变），2D 扁平、无立体感。
>
> 生成建议：1024×1024，透明背景，2D 扁平金色填充，主体居中占画面 60%~70%。

---

## 一、界面选项里缺图、需重做的（6 个，已生成一版 3D 徽章风但和已有图标不统一，改扁平金填充）

统一前缀：
`Flat 2D poker app icon, solid warm gold gradient fill (amber gold rgb 192 160 64 to 224 160 64), clean vector silhouette, transparent background, no circular badge, no background,`

统一后缀：
`, centered, simple game UI icon style, high detail, clean edges`

| 文件名 | name | 用在哪 | 主体描述（拼在前后缀之间） |
|---|---|---|---|
| `seedling.png` | seedling | 大厅「新手」难度选项 | `a small sprouting seedling with two leaves` |
| `zap.png` | zap | 大厅「高手」难度选项 | `a bold lightning bolt` |
| `cards.png` | cards | 训练中心「位置与起手牌」专题 | `two overlapping playing cards showing ace of spades and king of hearts` |
| `ruler.png` | ruler | 训练中心「下注尺度」专题 | `a straight ruler with tick marks` |
| `robot.png` | robot | 牌桌座位默认机器人头像 | `a cute robot head with antenna and round visor` |
| `people.png` | people | 好友房入口图标 | `two person silhouettes facing each other` |

---

## 二、扩展备用（iconMap 已映射但界面暂未引用，同样改扁平金填充）

统一前缀 / 后缀同一。

| 文件名 | name | 主体描述 |
|---|---|---|
| `house.png` | house | `a cozy cabin / poker club house` |
| `gift.png` | gift | `a wrapped gift box with a bow` |
| `bar-chart.png` | bar-chart | `a rising bar chart with an upward arrow` |
| `pin.png` | pin | `a location pin drop` |
| `beans.png` | beans | `a small pile of poker chips` |
| `refresh.png` | refresh | `a circular refresh arrow` |
| `trophy.png` | trophy | `a champion trophy` |
| `book2.png` | book2 | `an open book with spade emblem` |
| `warn.png` | warn | `a warning triangle with exclamation` |
| `numbers.png` | numbers | `dice showing pips` |
| `pencil.png` | pencil | `a pencil over a small notepad` |
| `info.png` | info | `an info circle with letter i` |

---

## 三、已生成、无需再做的（确认，风格已是扁平金填充）

线框/填充金色图标（已有 PNG）：arrow-left / arrow-right / arrow-down / bulb / target / joker / fire / graduation / party / crown / book / coins / check / cross / medal-bronze / medal-silver / medal-gold / gem / gem-blue / star / fox / leopard / capybara / owl / collie / pig / rock / scale / spade / heart / diamond / club。

筹码图（已有，已接入 ChipStack）：chip-10 / 20 / 50 / 100 / 500 / 1000。

用户头像（已有 12 张，已修复下移居中，已 push）：avatars/1.png ~ 12.png。

---

## 四、统一提示词模板（直接复制改主体）

```
Flat 2D poker app icon, solid warm gold gradient fill (amber gold rgb 192 160 64 to 224 160 64), clean vector silhouette, transparent background, no circular badge, no background, <这里填主体描述>, centered, simple game UI icon style, high detail, clean edges
```

把 `<这里填主体描述>` 换成「一」或「二」表格里对应的那句即可。
