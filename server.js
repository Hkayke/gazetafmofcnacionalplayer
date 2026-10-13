const express=require('express'),http=require('http'),path=require('path');
const {Server}=require('socket.io');
const app=express(),server=http.createServer(app),io=new Server(server);
const PORT=process.env.PORT||3000, PASSWORD=process.env.LOCUTOR_PASSWORD||'troque-esta-senha';
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(_,r)=>r.json({ok:true}));
let hostId=null,hostName='',live=false; const listeners=new Set();
io.on('connection',s=>{
 s.emit('radio-state',{live,hostName});
 s.on('host-login',({password,name})=>{
  if(password!==PASSWORD)return s.emit('host-login-result',{ok:false,message:'Senha incorreta.'});
  if(hostId&&hostId!==s.id)return s.emit('host-login-result',{ok:false,message:'Já existe um locutor conectado.'});
  hostId=s.id;hostName=String(name||'Locutor').slice(0,40);s.emit('host-login-result',{ok:true});io.emit('radio-state',{live,hostName});
 });
 s.on('go-live',()=>{if(s.id===hostId){live=true;io.emit('radio-state',{live,hostName}); for(const listenerId of listeners) io.to(hostId).emit('listener-wants-stream',{listenerId});}});
 s.on('go-offline',()=>{if(s.id===hostId){live=false;io.emit('radio-state',{live,hostName});}});
 s.on('listener-join',()=>{listeners.add(s.id); if(live&&hostId)io.to(hostId).emit('listener-wants-stream',{listenerId:s.id});else s.emit('stream-unavailable');});
 s.on('webrtc-offer',d=>{if(s.id===hostId)io.to(d.target).emit('webrtc-offer',{from:s.id,offer:d.offer});});
 s.on('webrtc-answer',d=>io.to(d.target).emit('webrtc-answer',{from:s.id,answer:d.answer}));
 s.on('webrtc-ice',d=>io.to(d.target).emit('webrtc-ice',{from:s.id,candidate:d.candidate}));
 s.on('now-playing',d=>{if(s.id===hostId)io.emit('now-playing',{title:String(d.title||'GAZETA FM NACIONAL PLAYER').slice(0,100)});});
 s.on('disconnect',()=>{listeners.delete(s.id); if(s.id===hostId){hostId=null;hostName='';live=false;io.emit('radio-state',{live,hostName});}});
});
server.listen(PORT,'0.0.0.0',()=>console.log('Gazeta FM Nacional Player na porta '+PORT));