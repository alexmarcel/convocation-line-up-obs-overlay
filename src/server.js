"use strict";

const http=require("node:http"),fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),crypto=require("node:crypto");
const {WebSocketServer,WebSocket}=require("ws");
const MIME={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json",".webp":"image/webp",".mp3":"audio/mpeg",".wav":"audio/wav",".svg":"image/svg+xml"};
function json(res,status,data){const body=Buffer.from(JSON.stringify(data));res.writeHead(status,{"Content-Type":"application/json","Content-Length":body.length,"Cache-Control":"no-store"});res.end(body)}

function backgroundSettings(manifest){
  const value=manifest?.presentation?.projectorBackground||{};
  return{useProjectorBackground:!!value.enabled,projectorBackgroundOverlay:Number(value.overlay??35)};
}
function initialClientSync(role,sync){return role==="controller"?"online":sync||"connecting"}
function startServer({publicRoot,libraryRoot,getManifest,eventLedger,outputRegistry,onStateChange,onSettingsChange,initialSettings={},port=4173}){
  const clients=new Map(),seenEvents=new Set(),pending=new Map(),resetAcknowledgements=new Map();let resetting=false;
  const state={currentStudentId:null,settings:{accent:"#00d2ff",chroma:"#00ff00",obsBackgroundMode:"transparent",audioTarget:"projector",playAudioOnController:false,audioFadeInSeconds:0,audioFadeOutSeconds:0,studentTransitionStyle:"fade",studentTransitionSeconds:.5,eventName:"",hideProjectorHeader:false,...initialSettings,...backgroundSettings(getManifest())}};
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,"http://localhost"),remoteAddress=req.socket.remoteAddress||"";
      const isLocal=remoteAddress==="127.0.0.1"||remoteAddress==="::1"||remoteAddress.endsWith("::ffff:127.0.0.1");
      if((url.pathname==="/"||url.pathname==="/controller")&&!isLocal)return json(res,403,{error:"The controller is available only on the host computer."});
      if(url.pathname==="/api/manifest"){const manifest=getManifest();return manifest?json(res,200,manifest):json(res,404,{error:"No ceremony library has been imported."})}
      if(url.pathname.startsWith("/api/assets/")){const relative=decodeURIComponent(url.pathname.slice("/api/".length)),filePath=path.resolve(libraryRoot,relative);if(!filePath.startsWith(path.resolve(libraryRoot)+path.sep))return json(res,403,{error:"Forbidden"});return serveFile(req,res,filePath,true)}
      if(url.pathname.startsWith("/vendor/lucide/")){const root=path.resolve(publicRoot,"..","node_modules","lucide","dist","esm"),relative=decodeURIComponent(url.pathname.slice("/vendor/lucide/".length)),filePath=path.resolve(root,relative);if(!filePath.startsWith(root+path.sep)||path.extname(filePath)!==".js")return json(res,403,{error:"Forbidden"});return serveFile(req,res,filePath,false)}
      const routeFile={"/":"controller.html","/controller":"controller.html","/scanner":"display.html","/projector":"display.html","/obs":"display.html"}[url.pathname];
      const filePath=path.resolve(publicRoot,routeFile||url.pathname.replace(/^\/+/,""));if(!filePath.startsWith(path.resolve(publicRoot)+path.sep))return json(res,403,{error:"Forbidden"});return serveFile(req,res,filePath,false);
    }catch(error){json(res,500,{error:error.message})}
  });
  const wss=new WebSocketServer({server,path:"/ws"});
  const envelope=(type,payload={})=>({protocolVersion:1,type,eventId:crypto.randomUUID(),timestamp:new Date().toISOString(),libraryVersion:getManifest()?.version||null,payload});
  const send=(socket,message)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message))};
  const broadcast=(message,roles)=>{for(const client of clients.values())if(!roles||roles.includes(client.role))send(client.socket,message)};
  function outputSnapshot(){return outputRegistry.list().map(output=>{const client=clients.get(output.stationId);return{...output,connected:!!client,sync:client?.sync||"offline",progress:client?.progress,libraryVersion:client?.libraryVersion,lastSeen:client?.lastSeen||output.lastSeen}})}
  function snapshot(){return{devices:[...clients.values()].map(({socket,...client})=>client),outputs:outputSnapshot(),pending:[...pending.values()],state,manifest:getManifest()?{version:getManifest().version,counts:getManifest().counts,unmatched:getManifest().unmatched}:null}}
  function notifyController(){const data=envelope("SERVER_STATUS",snapshot());broadcast(data,["controller"]);onStateChange?.(snapshot())}
  function showStudent(id,source){const manifest=getManifest();if(!manifest?.students[id])return{ok:false,error:`Student ${id} was not found.`};state.currentStudentId=id;broadcast(envelope("SHOW_STUDENT",{id,source}),["controller","projector","obs","scanner"]);return{ok:true}}
  function canGoLive(sourceClient){
    const version=getManifest()?.version;if(!version)return{ok:false,error:"No ceremony library is active."};
    if(sourceClient.sync!=="ready"||sourceClient.libraryVersion!==version)return{ok:false,error:"This scanner has not finished synchronizing the current library."};
    const required=outputRegistry.list().filter(output=>output.required);
    if(!required.length)return{ok:false,error:"No required Projector or OBS output is designated."};
    for(const output of required){const client=clients.get(output.stationId);if(!client)return{ok:false,error:`Required ${output.role} "${output.name}" is offline.`};if(client.sync!=="ready"||client.libraryVersion!==version)return{ok:false,error:`Required ${output.role} "${output.name}" is not ready.`}}
    return{ok:true};
  }
  function rememberEvent(id){seenEvents.add(id);if(seenEvents.size>20000)seenEvents.delete(seenEvents.values().next().value)}
  wss.on("connection",socket=>{
    let stationId;socket.isAlive=true;socket.lastSeen=new Date().toISOString();
    socket.on("pong",()=>{socket.isAlive=true;socket.lastSeen=new Date().toISOString();if(stationId){const client=clients.get(stationId);if(client)client.lastSeen=socket.lastSeen;outputRegistry.touch(stationId)}});
    socket.on("message",async raw=>{
      try{
        socket.isAlive=true;socket.lastSeen=new Date().toISOString();
        const message=JSON.parse(raw);
        if(message.type==="REGISTER"){
          stationId=String(message.stationId||crypto.randomUUID());
          const client={socket,stationId,role:message.role,name:message.name||stationId,muted:false,audioUnlocked:false,sync:initialClientSync(message.role,message.sync),connectedAt:new Date().toISOString(),lastSeen:socket.lastSeen};
          outputRegistry.register(client);const saved=outputRegistry.get(stationId);if(saved){client.name=saved.name;client.muted=saved.muted}
          clients.set(stationId,client);
          send(socket,envelope("DEVICE_SETTINGS",{name:client.name,muted:client.muted}));
          send(socket,envelope("STATE_SNAPSHOT",{state,manifest:getManifest()?{version:getManifest().version,counts:getManifest().counts}:null}));
          if(!getManifest()&&["scanner","projector","obs"].includes(client.role))send(socket,envelope("RESET_CEREMONY_CACHE",{resetId:crypto.randomUUID()}));
          notifyController();return;
        }
        if(!stationId||seenEvents.has(message.eventId))return;rememberEvent(message.eventId);
        const client=clients.get(stationId);client.lastSeen=socket.lastSeen;
        if(message.type==="RESET_CEREMONY_CACHE_COMPLETE"){resetAcknowledgements.get(String(message.payload.resetId))?.delete(stationId);return}
        if(resetting)return;
        if(message.type==="SYNC_STATUS"){client.sync=message.payload.status;client.progress=message.payload.progress;client.libraryVersion=message.payload.libraryVersion||null;notifyController()}
        else if(message.type==="AUDIO_STATUS"&&["projector","obs"].includes(client.role)){client.audioUnlocked=!!message.payload.unlocked;notifyController()}
        else if(message.type==="SCAN"){const readiness=canGoLive(client),result=readiness.ok?showStudent(String(message.payload.id),stationId):readiness;send(socket,envelope("ACK",{eventId:message.eventId,...result}));notifyController()}
        else if(message.type==="QUEUED_SCANS"){
          for(const event of message.payload.events||[]){
            const resolved=eventLedger.get(event.eventId);
            if(resolved)send(socket,envelope("QUEUE_RESOLVED",{eventId:event.eventId,decision:resolved.decision}));
            else if(!pending.has(event.eventId))pending.set(event.eventId,{...event,stationId});
          }
          notifyController();
        }else if(message.type==="QUEUE_DECISION"&&client.role==="controller"){
          const decision=message.payload.decision;if(!["approve","discard"].includes(decision))throw new Error("Invalid queue decision.");
          for(const id of message.payload.eventIds||[]){
            const event=pending.get(id);if(!event)continue;
            if(decision==="approve"){const readiness=canGoLive({sync:"ready",libraryVersion:getManifest()?.version});if(!readiness.ok){send(client.socket,envelope("ERROR",{message:readiness.error}));continue}showStudent(String(event.id),event.stationId)}
            await eventLedger.resolve(id,decision);pending.delete(id);
            const origin=clients.get(event.stationId);if(origin)send(origin.socket,envelope("QUEUE_RESOLVED",{eventId:id,decision}));
          }
          notifyController();
        }else if(message.type==="OUTPUT_REQUIRED"&&client.role==="controller"){
          await outputRegistry.setRequired(String(message.payload.stationId),!!message.payload.required);notifyController();
        }else if(message.type==="DEVICE_UPDATE"&&client.role==="controller"){
          const target=clients.get(String(message.payload.stationId));if(!target)throw new Error("Connected device was not found.");
          const changes={};
          if(message.payload.name!==undefined){const name=String(message.payload.name).trim().slice(0,80);if(!name)throw new Error("Device name cannot be empty.");changes.name=name;target.name=name}
          if(["projector","obs"].includes(target.role))await outputRegistry.update(target.stationId,changes);
          send(target.socket,envelope("DEVICE_SETTINGS",{name:target.name,muted:target.muted}));notifyController();
        }else if(message.type==="CLEAR_OUTPUTS"&&client.role==="controller"){
          await outputRegistry.clear();
          for(const connected of clients.values())outputRegistry.register(connected);
          await outputRegistry.writeChain;notifyController();
        }else if(message.type==="CLEAR"&&client.role==="controller"){state.currentStudentId=null;broadcast(envelope("CLEAR"),["controller","projector","obs","scanner"]);notifyController()}
        else if(message.type==="SETTINGS"&&client.role==="controller"){state.settings={...state.settings,...message.payload};state.settings=await onSettingsChange?.(state.settings)||state.settings;broadcast(envelope("SETTINGS",state.settings))}
      }catch(error){send(socket,envelope("ERROR",{message:error.message}))}
    });
    socket.on("close",()=>{
      if(stationId&&clients.get(stationId)?.socket===socket)clients.delete(stationId);
      notifyController();
    });
  });
  const heartbeat=setInterval(()=>{for(const socket of wss.clients){if(socket.isAlive===false){socket.terminate();continue}socket.isAlive=false;socket.ping()}notifyController()},10000);
  heartbeat.unref?.();
  server.listen(port,"0.0.0.0");
  return{
    port,
    close:()=>new Promise(resolve=>{clearInterval(heartbeat);for(const client of wss.clients)client.close();server.close(resolve)}),
    libraryChanged:()=>{state.settings={...state.settings,...backgroundSettings(getManifest())};broadcast(envelope("SETTINGS",state.settings));broadcast(envelope("LIBRARY_AVAILABLE",{version:getManifest()?.version}));notifyController()},
    applySettings:settings=>{state.settings={...state.settings,...settings,...backgroundSettings(getManifest())};broadcast(envelope("SETTINGS",state.settings));notifyController()},
    clearDisplay:()=>{state.currentStudentId=null;broadcast(envelope("CLEAR"),["controller","projector","obs","scanner"]);notifyController()},
    resetRemoteCaches:async()=>{resetting=true;state.currentStudentId=null;pending.clear();const resetId=crypto.randomUUID(),waiting=new Set([...clients.values()].filter(client=>["scanner","projector","obs"].includes(client.role)).map(client=>client.stationId));resetAcknowledgements.set(resetId,waiting);broadcast(envelope("RESET_CEREMONY_CACHE",{resetId}),["scanner","projector","obs"]);const deadline=Date.now()+2000;while(waiting.size&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,40));resetAcknowledgements.delete(resetId);return{acknowledged:waiting.size===0,unreachable:[...waiting]}},
    snapshot
  };
}
async function serveFile(req,res,filePath,immutable){
  let stat;try{stat=await fsp.stat(filePath)}catch{return json(res,404,{error:"Not found"})}if(!stat.isFile())return json(res,404,{error:"Not found"});
  const headers={"Content-Type":MIME[path.extname(filePath).toLowerCase()]||"application/octet-stream","Accept-Ranges":"bytes","Cache-Control":immutable?"public, max-age=31536000, immutable":"no-cache"},range=req.headers.range;
  if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match){res.writeHead(416);return res.end()}const start=match[1]?Number(match[1]):0,end=match[2]?Number(match[2]):stat.size-1;if(start>end||end>=stat.size){res.writeHead(416);return res.end()}res.writeHead(206,{...headers,"Content-Range":`bytes ${start}-${end}/${stat.size}`,"Content-Length":end-start+1});return fs.createReadStream(filePath,{start,end}).pipe(res)}
  res.writeHead(200,{...headers,"Content-Length":stat.size});fs.createReadStream(filePath).pipe(res);
}
module.exports={startServer,initialClientSync};
