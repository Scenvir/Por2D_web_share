# 回放与地图脚本接口

分享包内路径为 `developer/SCRIPT_INTERFACE.md`。源码仓库中示例仍位于 `tools/agent_example.cjs`，运行时使用仓库的 `dist/`。本页说明当前格式及可直接调用的 WASM 接口。源码实现位于 `src/web_bridge.cpp`、`core/include/por2/replay.hpp`、`web/replay/`。

## 可运行示例

完整解压后，在包根目录执行（Node.js 22+，无需 npm install、浏览器或编译器）：

```powershell
node developer/agent_example.cjs
node developer/agent_example.cjs "回放文件.txt"
```

示例 `developer/agent_example.cjs`演示初始化、目录读取、加载、逐帧输入、状态采集、射门、快照恢复和单双角色回放。默认演示不保证通关；指定文件时退出码 0 表示实际通关，2 表示输入耗尽但未通关，1 表示错误。

```js
const core = await require('./runtime/dist/por2.js')();
const {Player} = require('./runtime/dist/replay/player.js');
const player = new Player(core);
player.load(text);
player.step(1);
console.log(player.status()); // completed 是播放结束，cleared 才是实际通关
player.reset();               // 回到此文件的起始状态
```

浏览器使用 `createPor2()` 工厂和 `Por2Replay.Player`。每个 WASM 实例只能由一个驱动器推进，不能同时接受页面动画循环和实验脚本的输入。路径均相对于解压包；源码仓库里的 `web/replay/` 在分享包中对应 `runtime/dist/replay/`。

## 地图身份与加载

目录地图的身份是 `chapter / section / id`。chapter 为章节，section=0 为主线，正数为小节，id 为该小节内的地图 ID。不同章节、小节可复用 ID。目录的 order 是显示顺序，不参与加载。

| WASM 接口 | 约定 |
| --- | --- |
| `_web_catalog_json()` | 返回包含 sections 和 maps 的 JSON；地图条目含 chapter、section、id、order、players、name、hidden。 |
| `_web_catalog_map(chapter,section,id)` | 返回对应地图初始定义 JSON；失败为空串，立即读 `_web_error()`。 |
| `_web_load_catalog(chapter,section,id,player,snapshotPointer)` | 统一加载目录地图，按地图 playerCount 自动选择单双角色；player 为操作角色 0/1，无快照显式传 0。成功 1、失败 0。 |
| `_web_load_map(jsonPointer,player,snapshotPointer)` | 加载自定义地图 JSON，其余参数同上。单人地图 player 只能为 0。 |
| `_web_export_level_json()` | 导出当前地图初始定义，支持目录和自定义地图，保留双方出生点、出口。 |
| `_web_level_json()` | 仅返回自定义地图源 JSON；目录地图为空串。 |

目录加载失败、角色参数非法或快照无效时，不替换当前场景。主线保持原有过关推进；小节作为独立地图，过关后结束。

```js
const read = p => core.UTF8ToString(p);
const catalog = JSON.parse(read(core._web_catalog_json()));
const m = catalog.maps.find(m => m.chapter === 1 && m.section === 1);
if (!m) throw Error('此包没有指定小节地图');
if (!core._web_load_catalog(m.chapter, m.section, m.id, 0, 0))
  throw Error(read(core._web_error()));
const initialMap = JSON.parse(read(core._web_export_level_json()));
```

所有返回字符串指针都要立即复制，不能保留到下次接口调用，也不能自行释放。传入字符串使用 UTF-8 字节数加 1 分配，写尾部零字节，同步调用后 `_free`；示例的 `withText()` 提供完整实现。地图限制 1 MiB，禁止字符串内嵌 NUL。

## 输入、状态与快照

| 接口 | 约定 |
| --- | --- |
| `_web_tick(flags)` | 普通单人输入帧；回放模式由 Player 驱动。 |
| `_web_coop_tick(p1Flags,p2Flags)` | 两名角色同时推进一帧。 |
| `_web_shot(portal,x,y)` | 为下一单人帧排队射门。 |
| `_web_coop_shot(player,portal,x,y)` | 为指定角色下一帧排队射门。 |
| `_web_state()` | JSON 状态指针，字段说明见下文。 |
| `_web_snapshot()` | 当前核心状态文本，立即复制。 |
| `_web_restore_snapshot(pointer)` | 在相同地图、模式、兼容规则下恢复，成功 1、失败 0；不重置 JS 播放器进度。 |
| `_web_clear_input()` | 清空单人待发射门及当前操作角色的双人待发射门；调用者仍须清空自身按键状态。 |
| `_web_error()` | 最近受检操作错误字符串；失败后立即读取。 |

每帧为 25 ms，1× 为 40 Hz；程序实验不必等待墙钟时间。保存/恢复检查点成功的输入帧不推进物理。清除跳跃缓冲事件使用下一帧的 256 标志。

门编号 0=蓝、1=橙。直接射门接口只接受有限的画布坐标 `0≤x<1000, 0≤y<600`，每名角色最多排队 16 次；非法或超限请求忽略，接口无成功返回值。排队不意味着放门成功，结果还受墙面和身体碰撞限制。

状态包含：catalogChapter（自定义地图为 0）、section、level（地图 ID）、index（供界面使用的主线位置，小节及自定义为 -1）、chapter（游戏章节）、x/y、vx/vy、gravity、direction、blue/orange、ticks、finished 等。x/y 是身体定位点，blue/orange 是门编码。players 数组提供双方位置、朝向、退出状态等，但不包含双方完整速度；完整内部状态应保存快照。回放进度使用 `Player.status().frame`，不能使用 ticks 替代。

快照限制 64 KiB，包含角色、门、检查点和物理时钟等核心状态，不含待发射门队列或 JS 播放器进度。不要修改其内部字段。普通本机录制仍从关卡起点开始；这里的快照恢复接口不等同于“从当前状态重新录制”功能。

## 回放头与规则版本

单人文件使用 `version 3`，双角色文件使用 `por2-script 3`。均须声明 `rules 1`、chapter、section，并以 level 或 map 指定地图。文件版本与物理 rules 版本独立；规则不匹配拒绝加载。所有头须在操作之前，chapter、section、level/map 依次出现。

第一章主线地图 0 的单人例子：

```text
version 3
rules 1
chapter 1
section 0
level 0
f 10 2 0
f 1 0 1 0 260 389
f 1 16 0
```

该示例仅说明语法，不保证通关。第三章同样显式写 chapter 3。小节使用对应正整数 section，level 始终为地图 ID。单人文件必须指向单人地图，双角色文件必须指向双角色地图，不能仅靠章节推断角色数量。

自定义地图使用 chapter 0、section 0，并以一行 `map {完整 JSON}` 替换 level；不依赖浏览器本地地图列表。双角色自定义 JSON 必须声明 playerCount=2。

UTF-8 文本支持 BOM、空行和 # 注释；map 行按完整 JSON 解析，名称中的 # 保留。统一播放器拒绝 NUL，文件限制 8 MiB，总帧数最多 1,000,000。

## 单人帧格式

- 完整帧：`f 帧数 标志 射门数 [门 x y]...`。帧数为正整数，整行输入包括射门在每帧重复。单次射门单独占一帧。
- 标志可按位组合：1=左、2=右、4=跳、8=重试、16=交互/出口、64=检查点、128=下、256=清除跳跃缓冲；不接受 32。
- 简写：`a/d/w/aw/dw/z/e/r/c 帧数`，依次为左、右、跳、左跳、右跳、等待、交互、重试、检查点。
- `s 门 x y` 射门并推进一帧。
- 原生解析器每帧最多 256 次射门，坐标须有限，但没有画布范围限制；其单独接口没有文件字节限制，建议经统一 JS Player 加载。
- 核心先处理重试、检查点及出口，再推进移动和射门；成功保存/恢复检查点的帧不推进物理，重试优先。
- 实际通关或输入耗尽时停止，输入耗尽不等于通关。

## 双角色帧格式

```text
por2-script 3
rules 1
chapter 2
section 1
level 0
f 10 2 0 0
f 1 0 0 1 1 0 260 389
```

- 完整帧：`f 帧数 P1标志 P2标志 射门数 [玩家 门 x y]...`，玩家 0=P1、1=P2。
- 标志包含单人全部标志，另有 32=切换观察者，可组合到 511。256 只清除对应角色的跳跃缓冲。
- 简写移动：`玩家 a/d/w/aw/dw/z/e/r/c 帧数`；另一角色无输入，但正常推进物理。
- 简写射门：`玩家 s 门 x y`；本帧两名角色均无移动输入。
- 全部输入每帧重复。每名角色每帧最多 16 次射门，坐标有限且在 1000×600 画布内；最多 50,000 段。
- 每帧先排队射门，再调用一次 coop_tick；核心在移动后按 P1、P2 顺序射门。
- 双角色检查点要求两名角色均在门外连续静止 25 帧；同帧重试优先于保存。

联机中途加入的录制可在 level/map 后、操作前带一行 `state por2-state-1 ...`，播放器先载入起始快照，再执行后续输入。该记录只覆盖快照之后的操作，不能当作从出生点完成的证明。

```js
const {Recorder} = require('./runtime/dist/replay/script.js');
const recorder = new Recorder({chapter: 2, section: 1, level: 0});
// 自定义：new Recorder({map: JSON.stringify(twoPlayerMap)})
recorder.capture([2, 5], [{player: 1, portal: 0, x: 290, y: 400.1}]);
const text = recorder.text();
```

调用者必须在实际执行帧处 capture，从指定地图起点或提供的起始快照开始记录。无帧时 text 为空串；capture 返回 false 表示达到容量上限，active=false，reason 给出原因。录制不包含聊天、网络等待或倍速墙钟时间，关闭页面前需导出。

## 播放器与验证

打开 `/replay/`，可读取单双人文件、暂停、逐帧、调速和定位。向后定位从文件起始状态确定性重放，不改变游戏存档。

页面就绪后，`window.por2ScriptViewer` 提供 `load(text)`、`play()`、`pause()`、`step(n=1)`、异步 `seek(frame)`、`state()`。state 包含 frame、totalFrames、completed、cleared、action、state，并增加 playing、busy。非法加载不替换当前回放。

源码仓库可执行：

```powershell
node tools/replay_solo.cjs <单人文件>
node tools/replay_script.cjs <双角色文件>
node tests/catalog_replay_test.cjs
```

分享包使用前述 agent_example.cjs。地图或物理规则改变后，需要重新验证实际通关。显示不可信名称和回放内容须使用 textContent，不执行回放文本。
