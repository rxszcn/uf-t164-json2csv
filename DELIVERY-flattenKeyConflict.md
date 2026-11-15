# 交付说明：展平键冲突处理（flatten onConflict）

## 背景与根因

采集汇聚层新旧两代埋点混流后进入同一清洗管道：旧记录把语义字段平铺成顶层键（如
`"user.id": "flat"`），新记录用嵌套对象（如 `"user": { "id": "nested" }`）。`flatten`
把两者都展平成同一列名 `user.id`。

根因在 `packages/transforms/src/flatten.ts` 的递归写入实现（原第 49 行）：

```ts
flatDataRow[newPath] = value; // 无条件覆盖
```

同一展平键被第二条来源路径写入时静默覆盖，**幸存者取决于对象键的插入顺序**
（`Object.keys` 的遍历顺序）。于是同一逻辑记录换个字段顺序导出，值和列布局都会变，且
全程零报错零告警——对账必然翻车。

复现：`{ "user.id": "flat", "user": { "id": "nested" } }` 与
`{ "user": { "id": "nested" }, "user.id": "flat" }` 在旧实现下分别得到 `"nested"` 和
`"flat"`。

## 设计决定：`onConflict: 'first' | 'last' | 'error'`，默认 `'first'`

### 冲突的判定依据（数据规范化，绝不依赖键序）

两条来源路径**只有在其某一段键本身含分隔符时**才可能展平成同一列名（例如顶层键
`"user.id"` 与嵌套路径 `["user","id"]`，或数组路径 `["tags","0"]` 与 `"tags.0"`）；
空键（`""`）也会导致子路径拼接时缺分隔符，同样纳入判定。除此之外展平键与来源路径一一对应，
不可能冲突。

发生冲突时，用**规范源路径顺序**决定胜者：

- 路径按段逐段比较，按 UTF-16 code unit 排序（`left[i] < right[i]`）；
- 一条路径是另一条前缀时，较短者在前（冲突键之间不会出现前缀关系，仅用于稳定排序）；
- 比较对象**只有路径段**，不看键的插入顺序，也不看值。

因此：**同一逻辑记录的展平结果（值 + 列布局）只由数据决定，与键序无关。**

### 三个策略的语义

| 策略 | 冲突键的胜者 | 适用 |
| --- | --- | --- |
| `'first'`（默认） | 规范顺序中**靠前**的来源路径。`["user","id"]` 排在 `["user.id"]` 之前，故**嵌套对象优先于平铺顶层键** | 新埋点为准、平铺旧字段仅作兜底 |
| `'last'` | 规范顺序中**靠后**的来源路径，即平铺顶层键优先于嵌套对象 | 旧管道以平铺字段为准，需迁移期保持 |
| `'error'` | 不选胜者，一次性抛出所有冲突键及其全部来源路径 | 对账等不容忍静默取值的场景 |

为何默认选 `'first'`（嵌套优先）：

1. `["user","id"]` 是**有结构的**数据，`"user.id"` 是**被拍平的**字符串键；结构化路径表达
   的语义更强，被拍平的键更可能来自旧格式的兼容字段。
2. 该默认对“新记录 + 旧记录混流”最稳妥：新格式天然结构化，旧格式的兼容字段在冲突时退让，
   不会反过来覆盖新格式的真实值。
3. 冲突时嵌套优先也与 `unwind` 的既有输入约定一致（字段路径以 `.` 表示层级）。

### 对存量管道的影响

- **无冲突数据零影响**：只有当某行确实出现展平键重复时才走新的处理路径；不冲突的记录
  仍走原递归写入的**完全相同的代码路径、相同的键序、相同的值**（见下方“不回退”一节，
  并有 8 万行随机差分测试为证）。
- **存在冲突的数据，导出结果会变化**——这正是修复目的。默认 `'first'` 下，此前“恰好最后
  写入”的嵌套值此前会胜出，而现在它们仍然胜出（嵌套优先）；此前因键序偶然胜出的平铺值
  会被替换为嵌套值。若存量管道希望维持“平铺值优先”，显式传 `onConflict: 'last'`
  （CLI 为 `--flatten-on-conflict last`）。
- 增量采用建议：先在 CI/对账任务上用 `onConflict: 'error'` 跑一遍，统计实际发生冲突的
  键与来源路径，再决定生产策略；`error` 抛出的消息会列出每个冲突键的全部来源路径。

## 行为保证（逐条对照需求）

1. **冲突键语义自选并说明**：见上，默认 `'first'`（嵌套优先），理由已写明。
2. **三选一**：`first` / `last` / `error` 全部实现，`first` 为默认。
3. **同一逻辑记录导出一致、与键序无关**：冲突行整行按规范源路径顺序输出（值与列位置都由
   数据决定）；属性测试对 4 组选项 × 多个冲突记录各 300 次随机键序打乱，展平行对象与
   CSV 输出均逐字节一致。
4. **不冲突路径既有展平行为逐字不回退**：`flattenStep` 保留原递归实现原样，仅在行内
   出现重复写入时切换到冲突解析；随机差分（4 组选项 × 2 万行，共 8 万行）与旧实现
   输出**完全一致**（`diffs 0`）。
5. **数组展开与自定义分隔符不回退**：`arrays`、`separator` 语义不变；差分覆盖
   `{arrays:true}`、`{separator:'__', arrays:true}`、`{objects:false, arrays:true}`。
6. **空对象 / 空数组语义不回退**：空对象/空数组照旧不产生任何键（不会凭空出现列），
   既有 `flattenEmptyArray` 测试原样通过。
7. **命令行展平选项同步生效**：新增 `--flatten-on-conflict <strategy>`（默认 `first`），
   同时支持 `--config` 配置文件的同名字段；程序化 `flatten({ onConflict })` 一致。
8. **平铺×嵌套双键序对照测试**：新增 fixture 与 plainjs/node/CLI 三层对照用例（见下）。
9. **全量既有测试通过**：`npm test` 全绿（727 → 729，见“验证”）。

## 实现方式

`packages/transforms/src/flatten.ts`：

- `flattenStep`：**原递归实现**（逐字保留原有展平逻辑），并统计写入次数 `written`。
- 行处理完后若 `written === Object.keys(result).length`，说明没有任何键被写过两次，
  直接返回该结果——即**原来的行为、原来的对象、原来的键序**，不产生额外分配。
- 仅当写入次数多于不同键数（确实发生冲突）时，才用 `collect` 重新遍历一遍收集
  `{ path, sourcePath: string[], value }`，再按规范源路径顺序解析：
  - `error`：先汇总所有冲突键及来源路径，一次性抛出；
  - `first`/`last`：每个冲突键按 `compareSourcePaths` 选胜者；胜者确定后，**整行**
    按规范源路径顺序（同序时以路径字符串稳定兜底）写入输出对象，使列布局也与键序无关。
- `__proto__` 顶层键特殊处理：赋值不会创建自有属性，快速路径不计入写入次数，保持与
  旧实现一致的“静默无操作”，不误判成冲突。
- 新增导出 `FlattenConflictStrategy` 类型；非法策略值在 `flatten()` 构造时即抛错。

性能：无冲突快路径相比旧实现仅多一次写入计数（本机 20 万行深度嵌套基准约 +12%；
冲突行需额外一遍收集与排序，仅在确有冲突时发生）。

## 改动清单

### 源码

- `packages/transforms/src/flatten.ts`：冲突解析、`onConflict` 选项、规范路径排序、
  `__proto__` 与快路径处理。
- `packages/transforms/src/index.ts`：导出 `FlattenConflictStrategy`。
- `packages/cli/src/json2csv.ts`：新增 `--flatten-on-conflict <strategy>` 并透传给
  `flatten()`；`TransformsOptions` 增加 `flattenOnConflict`。

### 测试与夹具

- 新增 JSON 夹具：`flattenConflictFlatFirst.json`（平铺键在前）、
  `flattenConflictNestedFirst.json`（同一条记录、嵌套键在前，键序完全颠倒）。
- 新增 CSV 夹具：`flattenedConflictDeterministic.csv`（默认 `first`，两种键序共同期望）、
  `flattenedConflictLast.csv`（`last` 期望）；换行与既有夹具一致（CRLF、无尾换行）。
- 新增配置夹具：`fields/flattenConflictConfig.json`（`--config` 透传 `flattenOnConflict`）。
- `packages/plainjs/test/Parser.test.ts`：平铺 vs 嵌套对象、平铺 vs 数组的双键序对照；
  多冲突确定性；整行对象（值 + 键序）完全一致；`first`/`last`/`error` 策略；
  非法策略；无冲突时保留原首见列序；双层 fixture 对照。
- `packages/plainjs/test/StreamParser.test.ts`、`packages/node/test/AsyncParser.test.ts`：
  流式入口的双键序对照与 `onConflict` 生效。
- `packages/cli/test/CLI.test.ts`：命令行双键序对照、`--flatten-on-conflict last`、
  经 `--config` 生效、`error` 策略报错包含全部冲突键。

### 文档

- `docs/advanced-options/transforms.md`、`packages/transforms/README.md`：新增 `onConflict`
  选项说明与 “Flattened key collisions” 小节（含默认策略理由）。
- `docs/parsers/cli.md`、`packages/cli/README.md`：补 `--flatten-on-conflict`。
- `dist/cdn/transforms/flatten.js`：CDN 制品为独立发布产物，已按 `npm run build:cdn`
  重新生成（仅 flatten 变化；构建脚本在本机产生的无关 CRLF 路径格式差异已还原）。

## 验证

- `npm test`（CJS 冒烟 + build 前置 + vitest）：**729/729 通过**（既有 708 全绿，新增 21）。
- 覆盖率：statements 96.78% / branches 91.89% / functions 99.22% / lines 97.23%，
  均高于阈值（93/86/95/93）；`flatten.ts` 语句/行/函数 100%。
- `biome check packages/transforms/src packages/cli/src` 干净（未触碰文件与持仓基线
  的 CRLF 格式告警无关）。
- 差分回归：与原始递归实现逐字节对比 8 万随机行（4 组选项），**无冲突路径 0 差异**；
  冲突用例的差异全部来自“旧实现按插入顺序取胜”这一待修行为。
- 属性测试：冲突记录各 300 次随机键序打乱，展平对象与 CSV 输出恒等。
- 边界复核：空键 `""`、`"x."`/`"x":{"":...}`、`"a..b"`、`objects:false`、
  `separator:""`、`__proto__`（`JSON.parse` 的自有键）均与预期一致。
- 端到端 CLI 冒烟确认：两种键序输入产出同一 CSV、`--flatten-on-conflict last` 取值切换、
  `error` 时 stderr 列出全部冲突键。
