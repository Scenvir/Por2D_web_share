'use strict';
// Only ordered server frames advance co-op physics.
class CoopConnection {
  constructor(onEvent) {
    this.onEvent = onEvent; this.socket = null; this.player = -1;
    this.code = ''; this.epoch = 0; this.sequence = 0; this.active = false; this.paused = true;
    this.speed = 1; this.role = -1; this.members = 0; this.owners = [];
    this.roster = []; this.locked = false;
    this.lastFrameAt = null;
    this.pingId = 0; this.nextPingAt = 0; this.resetDiagnostics();
  }
  // Retain the cooldown across toggle/visibility changes to avoid probe bursts.
  resetDiagnostics() { this.pendingPing = null; this.rtt = null; this.lastPongAt = null; }
  sampleDiagnostics(now = globalThis.performance?.now() ?? Date.now()) {
    if (this.lastPongAt !== null && now-this.lastPongAt >= 10000) this.rtt = null;
    if (this.pendingPing && now-this.pendingPing.at >= 10000) this.pendingPing = null;
    if (!this.code || this.socket?.readyState !== WebSocket.OPEN || this.pendingPing || now < this.nextPingAt) return;
    this.pingId = this.pingId % 1000000 + 1;
    this.pendingPing = {id:this.pingId,at:now}; this.nextPingAt = now+5000;
    this.send({type:'ping',id:this.pingId});
  }
  // Local receipt age, not network latency or a server-wide metric.
  frameAge(now = globalThis.performance?.now() ?? Date.now()) {
    return this.active && !this.paused && this.lastFrameAt !== null ? Math.max(0,now-this.lastFrameAt) : null;
  }
  get connected() { return !!this.socket; }
  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({epoch:this.epoch,...message}));
  }
  connect(request) {
    if (this.connected) return;
    const url = new URL('/coop',location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = this.socket = new WebSocket(url);
    const timer = setTimeout(() => { if (this.socket === ws && !this.code) this.leave('连接超时，请检查网络，并确认房主已按分享包内 START-HERE.txt 的说明启动联机服务。'); },8000);
    ws.onopen = () => this.send({...request,protocol:11});
    ws.onmessage = event => {
      if (this.socket !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong') {
          const now = globalThis.performance?.now() ?? Date.now();
          if (this.pendingPing && msg.id === this.pendingPing.id) {
            const elapsed = now-this.pendingPing.at;
            if (elapsed >= 0 && elapsed < 10000) { this.rtt = Math.round(elapsed); this.lastPongAt = now; }
            this.pendingPing = null;
          }
          return;
        }
        if (msg.type === 'joined') { this.player = msg.player; this.code = msg.code; clearTimeout(timer); }
        if (msg.type === 'status') { this.player = msg.player; this.roster = msg.roster || []; this.locked = msg.locked === true; }
        if (msg.owners) { this.owners = msg.owners; this.role = this.owners.indexOf(this.player); }
        if (msg.members) this.members = msg.members;
        if (msg.type === 'start') { this.active = true; this.epoch = msg.epoch; this.sequence = msg.sequence || 0; this.paused = true; this.lastFrameAt = null; }
        if (msg.type === 'status') this.paused = msg.waiting || msg.paused.some(Boolean);
        if (msg.type === 'status' || msg.type === 'speed') this.speed = msg.speed;
        if (msg.type === 'frame') {
          if (msg.epoch !== this.epoch) return;
          if (msg.sequence !== this.sequence+1) throw Error('同步帧序号不一致');
          this.sequence = msg.sequence;
          this.lastFrameAt = globalThis.performance?.now() ?? Date.now();
        }
        if (msg.type === 'ended') return this.leave(msg.reason);
        if (msg.type === 'error' && !this.code) return this.leave(msg.message === '版本不一致，请刷新双方网页。' ? '版本不一致，请重启联机服务并刷新双方网页。' : msg.message);
        this.onEvent(msg);
        if (msg.type === 'frame') this.send({type:'ack',sequence:this.sequence});
      } catch (e) { this.leave(`联机已停止：${e.message}`); }
    };
    ws.onerror = () => this.leave('无法连接联机服务。请房主按分享包内 START-HERE.txt 的说明启动服务，并让所有玩家访问同一主机的地址和端口。');
    ws.onclose = () => { clearTimeout(timer); if (this.socket === ws) this.leave('连接已断开，请重新创建或加入房间。'); };
  }
  leave(reason = '已离开房间。') {
    const ws = this.socket; this.send({type:'leave'});
    this.socket = null; this.active = false; this.paused = true; this.player = -1; this.code = '';
    this.owners = []; this.role = -1;
    this.roster = []; this.locked = false; this.members = 0;
    this.lastFrameAt = null;
    this.nextPingAt = 0;
    this.resetDiagnostics();
    if (ws) { ws.onerror = null; ws.close(); }
    this.onEvent({type:'ended',reason});
  }
}
