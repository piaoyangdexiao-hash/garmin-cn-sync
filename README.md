# garmin-cn-sync

Garmin Connect 中国区（garmin.cn）健康数据同步工具 —— 将 Garmin 手表数据自动同步到飞书多维表格。

## 为什么

Garmin 官方不提供中国区 API。全球版 `python-garminconnect` 库无法登录 garmin.cn。本项目是**目前 GitHub 上唯一可用的 Garmin CN 数据管道**。

## 效果

```bash
$ node garmin_health_sync_feishu.js

⌚ 佳明健康数据同步 → 飞书 · 目标日期：2026-07-15

✅ 佳明国内区登录成功

✅ 每日摘要  步数:8523  静息心率:48
✅ 睡眠  分数:86  时长:510m
✅ HRV   64 ms
✅ VO₂Max  49
✅ 算法生理年龄  34.5 岁

📝 写入飞书...
✅ 飞书记录已更新

🎉 同步完成！
```

## 数据流

```
Garmin CN API → 自动登录 → 拉取每日数据 → 写入飞书 Bitable
                                    ├── 睡眠（分数/深睡/REM）
                                    ├── HRV / 静息心率 / 身体电量
                                    ├── 步数 / 卡路里
                                    ├── VO₂Max / 生理年龄
                                    └── 运动记录（类型/时长/负荷/备注）
```

## 快速开始

### 1. 飞书应用

飞书开放平台 → 创建企业自建应用 → 开启 Bitable 权限 → 获取 `app_id` + `app_secret`

### 2. 飞书表格

在飞书 Bitable 中创建健康数据表

### 3. 配置

```bash
cp .env.example .env
# 填入 Garmin 账号密码和飞书凭证
```

### 4. 运行

```bash
node garmin_health_sync_feishu.js           # 同步昨天
node garmin_health_sync_feishu.js 2026-07-01 # 补跑
```

## 技术栈

- Node.js + @gooin/garmin-connect（Garmin CN 适配）
- 飞书 Bitable REST API

## 免责声明

仅供个人学习研究。与 Garmin 佳明无关。

## License

MIT
