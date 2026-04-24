# Time Handling

## 结论

当前项目里的事件时间字段继续使用 PostgreSQL 的 `timestamptz` 是正确的。

统一规则：

- 后端存储：统一存 UTC 时间点
- 接口传输：统一返回 ISO 8601 字符串
- 前端展示：按客户端当前时区格式化显示

例如数据库或接口中的值：

```text
2026-04-20T02:05:52.372Z
```

这个值表示一个绝对时间点，不会因为北京、纽约等时区不同而失真。
不同地区客户端只是在展示时转换为本地时间。

## 为什么这样做

好处有 4 个：

1. 事件时刻唯一，不会因为时区不同而歧义
2. 便于排序、筛选、超时计算、日志分析
3. 避免夏令时导致的本地时间歧义
4. 前后端职责清晰，后端不负责替每个客户端做本地化展示

## 前端如何处理

前端拿到 ISO 时间后，直接按客户端本地时区格式化即可。

推荐优先使用浏览器内置的 `Intl.DateTimeFormat`，不一定需要额外日期库。

### 最小示例

```ts
export function formatLocalDateTime(input: string): string {
  const date = new Date(input);

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
```

这里的 `undefined` 表示：

- 使用浏览器当前语言环境
- 使用客户端当前时区

## 如果你想显式看到时区

```ts
export function formatLocalDateTimeWithZone(input: string): string {
  const date = new Date(input);

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}
```

效果会类似：

- 北京客户端：`2026/04/20 10:05:52 GMT+8`
- 纽约客户端：`2026/04/19 22:05:52 EDT`

## React 中的简单用法

```tsx
type TimeTextProps = {
  value: string;
};

export function TimeText({ value }: TimeTextProps) {
  return <time dateTime={value}>{formatLocalDateTimeWithZone(value)}</time>;
}
```

## Day.js 方案

如果前端项目已经在使用 `dayjs`，也可以用它来做本地展示。

### 只按客户端本地时区展示

这种场景不一定需要 `timezone` 插件：

```ts
import dayjs from "dayjs";

export function formatLocalDateTimeWithDayjs(input: string): string {
  return dayjs(input).format("YYYY-MM-DD HH:mm:ss");
}
```

### 支持指定时区，默认取客户端当前时区

如果你希望函数既支持手动传入时区，也支持默认使用客户端时区，可以这样：

```ts
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export function formatInTimeZone(input: string, timeZone?: string): string {
  const resolvedTimeZone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return dayjs.utc(input).tz(resolvedTimeZone).format("YYYY-MM-DD HH:mm:ss z");
}
```

这样有两个用法：

```ts
formatInTimeZone("2026-04-20T02:05:52.372Z");
formatInTimeZone("2026-04-20T02:05:52.372Z", "America/New_York");
```

第一种会自动用客户端当前时区。
第二种会强制按指定时区展示。

## 注意事项

1. 不要让后端返回“已经转成某个地区本地时间的字符串”
2. 不要把无时区字符串当成通用事件时间，例如 `2026-04-20 10:05:52`
3. 前端展示前一定先 `new Date(isoString)`
4. 如果你用 `dayjs` 且需要指定时区展示，记得启用 `utc` 和 `timezone` 插件
5. 如果后续有“提醒、日程、定时任务”类需求，再单独引入 `timezone` 字段处理用户语义时间

## 当前项目建议

现阶段按下面规则就足够：

- 数据库继续使用 `timestamptz`
- Node 继续输出 `toISOString()`
- 前端统一使用 `Intl.DateTimeFormat` 本地化展示

这已经能正确覆盖北京、纽约等不同时区客户端的事件时间显示。
