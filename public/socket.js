"use strict";

function createConnection(role, handlers = {}) {
  const stationKey = `graduation-station-${role}`;
  const stationNameKey=`graduation-station-name-${role}`;
  const stationId = localStorage.getItem(stationKey) || GraduationCrypto.randomId();
  localStorage.setItem(stationKey, stationId);
  let socket, stopped = false, retry = 700;
  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.onopen = () => {
      retry = 700;
      send("REGISTER", {}, { stationId, role, name:localStorage.getItem(stationNameKey)||`${role}-${stationId.slice(0,4)}` });
      handlers.open?.();
    };
    socket.onmessage = event => { try { const message = JSON.parse(event.data); handlers.message?.(message); } catch {} };
    socket.onclose = () => { handlers.close?.(); if (!stopped) setTimeout(connect, retry = Math.min(retry * 1.7, 10000)); };
    socket.onerror = () => socket.close();
  }
  function send(type, payload = {}, extra = {}) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({
      protocolVersion:1, type, payload, eventId:GraduationCrypto.randomId(), timestamp:new Date().toISOString(),
      stationId, role, ...extra
    }));
    return true;
  }
  connect();
  return { send, stationId, isOpen:() => socket?.readyState === WebSocket.OPEN, close:() => { stopped=true; socket?.close(); } };
}
window.createGraduationConnection = createConnection;
