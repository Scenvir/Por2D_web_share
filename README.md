# Por2D Web

二维传送门解谜游戏 · A 2D portal puzzle game

[中文](#中文) | [English](#english)

## 中文

用蓝、橙两扇传送门探索关卡，调整位置与朝向，抵达出口。第二章支持双人合作：两名角色共用一对传送门，可以互相配合完成谜题。

### 下载

**[下载最新分享包](https://github.com/Scenvir/Por2D_web_share/releases/latest/download/Por2D-Web-Coop-Share.zip)** · [全部版本](https://github.com/Scenvir/Por2D_web_share/releases)

推荐下载 Release 附件中的 `Por2D-Web-Coop-Share.zip`。也可以使用本仓库的 **Code → Download ZIP** 下载当前运行文件，完整解压后按相同步骤启动。旧版本 Release 中自动生成的 **Source code** 压缩包可能不包含运行文件，请选择上述分享包附件。

### 开始游玩

1. 完整解压 ZIP，并打开解压目录中的 `START-HERE.txt`。
2. 房主安装 [Node.js 22 或更新版本](https://nodejs.org/en/download)。队友只需要浏览器，无需 `npm install`、Python 或构建工具。
3. Windows 双击 `start-local.cmd`；macOS / Linux 在解压目录运行：

   ```sh
   node runtime/server.cjs --host 127.0.0.1 --port 8000
   ```

4. 浏览器打开 <http://127.0.0.1:8000>。第一次玩，先看菜单里的“玩法指南”，再选第一章 Level 0「概念」。
5. 游玩期间保持终端窗口开启，结束后按 `Ctrl+C` 停止服务。

请保留完整的 `runtime/` 目录，通过上述 HTTP 地址游玩，不要直接打开 HTML 文件。

### 双人联机

先停止本机服务，再双击 `start-lan.cmd`；macOS / Linux 使用：

```sh
node runtime/server.cjs --host 0.0.0.0 --port 8000
```

队友打开终端显示的房主局域网地址。房主在“多人联机”菜单创建房间，队友输入房间码加入。队友不能用 `localhost`、`127.0.0.1` 或 `0.0.0.0` 连接房主。

默认用于同一局域网；房间码本身不提供跨网络连接。详细步骤见包内 `如何双人联机.txt`。

### 基本操作

| 操作 | 按键 |
| --- | --- |
| 移动 / 跳跃 | A、D / W |
| 放置蓝门 / 橙门 | 鼠标左键 / 右键，松开时发射 |
| 交互 / 进入出口 | E |
| 保存 / 恢复检查点 | C / R |
| 放门预览 | Q |
| 菜单 | Esc |

第三章的方向键行为随重力变化，详见游戏内教程。设置、进度和自定义地图保存在当前浏览器中；重要地图与录制请导出备份。

### 反馈

[报告问题](https://github.com/Scenvir/Por2D_web_share/issues)时，请附上版本、操作系统、浏览器及复现步骤。

本仓库提供游戏运行文件、启动脚本和玩家说明。详细操作见 [游玩指南](PLAYER-GUIDE.md)，首次启动见 [START-HERE.txt](START-HERE.txt)。

## English

Explore puzzles with a blue and an orange portal. Align your character with the exit to complete each level. Chapter 2 supports cooperative play: two characters share a pair of portals and work together to solve puzzles.

### Download

**[Download the latest game bundle](https://github.com/Scenvir/Por2D_web_share/releases/latest/download/Por2D-Web-Coop-Share.zip)** · [All releases](https://github.com/Scenvir/Por2D_web_share/releases)

The recommended download is `Por2D-Web-Coop-Share.zip` from the release assets. You can also use **Code → Download ZIP** to download the current runtime files from this repository, extract everything, and follow the same launch steps. Automatically generated **Source code** archives on older releases may lack the runtime files; choose the game bundle attachment instead.

### Getting started

1. Extract the entire ZIP and open `START-HERE.txt` in the extracted folder.
2. The host needs [Node.js 22 or newer](https://nodejs.org/en/download). Other players only need a browser. No `npm install`, Python, or build tools are required.
3. On Windows, double-click `start-local.cmd`. On macOS / Linux, open a terminal in the extracted folder and run:

   ```sh
   node runtime/server.cjs --host 127.0.0.1 --port 8000
   ```

4. Open <http://127.0.0.1:8000> in your browser. Start with the in-game guide, then Chapter 1, Level 0. You can select English in the game settings.
5. Keep the terminal open while playing. Press `Ctrl+C` to stop the server when finished.

Keep the entire `runtime/` folder. Play through the HTTP address above instead of opening an HTML file directly.

### Co-op over a local network

Stop the local server first. On Windows, double-click `start-lan.cmd`. On macOS / Linux, run:

```sh
node runtime/server.cjs --host 0.0.0.0 --port 8000
```

Other players open the host's LAN address shown in the terminal. The host creates a room from the multiplayer menu and shares the room code. Other players must not use `localhost`, `127.0.0.1`, or `0.0.0.0` as the host address.

The default setup is for players on the same local network. A room code alone does not connect different networks. The bundle includes further instructions in `如何双人联机.txt` (Chinese).

### Controls

| Action | Input |
| --- | --- |
| Move / jump | A, D / W |
| Blue / orange portal | Left / right mouse button; fires on release |
| Interact / enter exit | E |
| Save / restore checkpoint | C / R |
| Toggle portal preview | Q |
| Menu | Esc |

Movement in Chapter 3 depends on gravity; see the in-game tutorial. Settings, progress, and custom maps are stored in your current browser. Export important maps and recordings for backup.

### Feedback

When [reporting an issue](https://github.com/Scenvir/Por2D_web_share/issues), include the release version, operating system, browser, and steps to reproduce it.

This repository provides game runtime files, launch scripts, and player documentation. See the [player guide](PLAYER-GUIDE.md) (Chinese) and [START-HERE.txt](START-HERE.txt) (Chinese) for more details.
