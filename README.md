# garmin-cn-sync

Garmin Connect 中国区（garmin.cn）健康数据同步工具 —— 将 Garmin 手表数据自动同步到飞书多维表格。

## 为什么需要这个

Garmin 官方不提供中国区 API。全球版 `python-garminconnect` 库无法登录 garmin.cn。本项目是**目前 GitHub 上唯一可用的 Garmin CN 数据管道**。

## 做了什么

```
Garmin CN API → 自动登录 → 拉取每日数据 → 写入飞书 Bitable
                                    ├── 睡眠（分数/深睡/REM）
                                    ├── HRV / 静息心率 / 身体电量
                                    ├── 步数 / 卡路里
                                    ├── VO₂Max / 生理年龄
                                    └── 运动记录（类型/时长/负荷/备注）
```

## 快速开始

### 1. 准备飞书应用

飞书开放平台 → 创建企业自建应用 → 开启 Bitable 权限 → 获取 `app_id` + `app_secret`

### 2. 创建飞书表格

在飞书 Bitable 中创建健康数据表，字段包括：
- 日期（日期类型）
- 睡眠分数（数字）
- HRV_ms（数字）
- 静息心率_bpm（数字）
- ...

### 3. 配置

```bash
cp .env.example .env
# 填入你的 Garmin 账号密码和飞书凭证
```

### 4. 运行

```bash
# 同步今天
node garmin_health_sync_feishu.js

# 补跑历史
node garmin_health_sync_feishu.js 2026-07-01
```

## 技术栈

- Node.js
- @gooin/garmin-connect（Garmin CN 适配）
- 飞书 Bitable REST API

## 免责声明

本工具仅供个人学习研究。使用者自行承担合规责任。本项目与 Garmin 佳明无关。

## License

MIT
