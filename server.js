const express=require('express'),http=require('http'),path=require('path');
const {Server}=require('socket.io');
const multer=require('multer');
const fs=require('fs');
const uploadsDir=path.join(__dirname,'public','uploads');fs.mkdirSync(uploadsDir,{recursive:true});
const upload=multer({dest:uploadsDir,limits:{fileSize:25*1024*1024}});
const app=express(),server=http.createServer(app),io=new Server(server);
const PORT=process.env.PORT||3000, PASSWORD=process.env.LOCUTOR_PASSWORD||'troque-esta-senha';
const SETTINGS_FILE=path.join(__dirname,'radio-settings.json');
// Auto DJ local: transmite arquivos MP3 da pasta public em sequência.
let ouvintesAtivos = [];
let bibliotecaMusicas = [];
let indiceMusica = 0;
let streamingAoVivo = false;
let fluxoAutoDJAtivo = false;
let radioSettings={streamUrl:process.env.RADIO_STREAM_URL||'/radio.mp3', autoDjEnabled:process.env.AUTO_DJ_ENABLED!=='false', nowPlaying:'Programação automática'};
try { const saved=JSON.parse(fs.readFileSync(SETTINGS_FILE,'utf8')); radioSettings={...radioSettings,...saved}; } catch (_) {}
if (!radioSettings.streamUrl) radioSettings.streamUrl='/radio.mp3';
function saveRadioSettings(){ try { fs.writeFileSync(SETTINGS_FILE,JSON.stringify(radioSettings,null,2)); } catch(e) { console.warn('Não foi possível salvar configurações:',e.message); } }
app.use(express.json({limit:'100kb'}));app.use(express.static(path.join(__dirname,'public')));

function atualizarMusicas() {
 const pastaPublic=path.join(__dirname,'public');
 try { bibliotecaMusicas=fs.readdirSync(pastaPublic).filter(arq=>arq.toLowerCase().endsWith('.mp3') && arq.toLowerCase()!=='radio.mp3'); console.log(`[AutoDJ] Músicas carregadas com sucesso: ${bibliotecaMusicas.length}`); }
 catch(e) { console.error('[Erro] Falha ao carregar músicas:',e); }
}
function processarAutoDJ() {
 if(fluxoAutoDJAtivo || streamingAoVivo || !radioSettings.autoDjEnabled) return;
 if(bibliotecaMusicas.length===0) { setTimeout(()=>{atualizarMusicas(); processarAutoDJ();},5000).unref?.(); return; }
 const musicaAtual=bibliotecaMusicas[indiceMusica];
 const caminhoCompleto=path.join(__dirname,'public',musicaAtual);
 fluxoAutoDJAtivo=true;
 radioSettings.nowPlaying=musicaAtual.replace(/\.[^.]+$/,'');
 io.emit('now-playing',{title:radioSettings.nowPlaying});
 io.emit('radio-config',{streamUrl:radioSettings.streamUrl,autoDjEnabled:radioSettings.autoDjEnabled,nowPlaying:radioSettings.nowPlaying});
 console.log(`[AutoDJ 24H] Transmitindo faixa: ${musicaAtual}`);
 const fluxoLeitura=fs.createReadStream(caminhoCompleto);
 fluxoLeitura.on('data',blocoAudio=>{ if(!streamingAoVivo && radioSettings.autoDjEnabled) ouvintesAtivos.forEach(res=>{try{res.write(blocoAudio);}catch(_){}}); });
 fluxoLeitura.on('end',()=>{ fluxoAutoDJAtivo=false; indiceMusica=(indiceMusica+1)%bibliotecaMusicas.length; processarAutoDJ(); });
 fluxoLeitura.on('error',err=>{ console.error('[AutoDJ] Erro na reprodução do arquivo:',err); fluxoAutoDJAtivo=false; indiceMusica=(indiceMusica+1)%Math.max(bibliotecaMusicas.length,1); setTimeout(processarAutoDJ,1000).unref?.(); });
}
app.get('/radio.mp3',(req,res)=>{
 res.writeHead(200,{'Content-Type':'audio/mpeg','Transfer-Encoding':'chunked','Connection':'keep-alive','Cache-Control':'no-cache, no-store, must-revalidate','Pragma':'no-cache','Expires':'0'});
 ouvintesAtivos.push(res);
 // A resposta de streaming fica aberta; remova o ouvinte quando a RESPOSTA fechar.
 res.on('close',()=>{ouvintesAtivos=ouvintesAtivos.filter(ouvinte=>ouvinte!==res);});
});
app.get('/health',(_,r)=>r.json({ok:true}));
app.get('/api/radio-config',(_,r)=>r.json({streamUrl:radioSettings.streamUrl,autoDjEnabled:radioSettings.autoDjEnabled,nowPlaying:radioSettings.nowPlaying,live,hostName}));
app.post('/api/radio-config',(req,res)=>{ if(req.body?.password!==PASSWORD)return res.status(403).json({error:'Senha incorreta.'});
 const streamUrl=String(req.body.streamUrl||'/radio.mp3').trim() || '/radio.mp3';
 if(streamUrl && streamUrl !== '/radio.mp3' && !/^https?:\/\//i.test(streamUrl)) return res.status(400).json({error:'Use /radio.mp3 ou um endereço começando com http:// ou https://.'});
 radioSettings.streamUrl=streamUrl; radioSettings.autoDjEnabled=!!req.body.autoDjEnabled;
 if(radioSettings.autoDjEnabled) processarAutoDJ();
 saveRadioSettings(); io.emit('radio-config', {streamUrl:radioSettings.streamUrl,autoDjEnabled:radioSettings.autoDjEnabled,nowPlaying:radioSettings.nowPlaying});
 res.json({ok:true,settings:{streamUrl:radioSettings.streamUrl,autoDjEnabled:radioSettings.autoDjEnabled,nowPlaying:radioSettings.nowPlaying}});
});
app.post('/api/upload-song',upload.single('song'),(req,res)=>{if(!req.file)return res.status(400).json({error:'Selecione um arquivo.'});const ext=path.extname(req.file.originalname).slice(0,10);const name=req.file.filename+ext;fs.renameSync(req.file.path,path.join(uploadsDir,name));const item={id:name,name:req.file.originalname,url:'/uploads/'+name,by:String(req.body.name||'Ouvinte').slice(0,40),at:Date.now()};requestHistory.push(item);requestHistory=requestHistory.slice(-100);io.emit('song-request',item);res.json({ok:true,item});});
app.post('/api/auto-dj/upload', upload.single('song'), (req,res)=>{
 if(req.body.password!==PASSWORD){ if(req.file) try{fs.unlinkSync(req.file.path)}catch(_){}; return res.status(403).json({error:'Senha incorreta.'}); }
 if(!req.file) return res.status(400).json({error:'Selecione um arquivo MP3.'});
 const original=path.basename(req.file.originalname||'musica.mp3');
 if(path.extname(original).toLowerCase()!=='.mp3'){ try{fs.unlinkSync(req.file.path)}catch(_){}; return res.status(400).json({error:'O Auto DJ aceita arquivos MP3.'}); }
 const safeBase=original.replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/\s+/g,' ').slice(0,100) || 'musica.mp3';
 const finalName=Date.now()+'-'+safeBase;
 const destination=path.join(__dirname,'public',finalName);
 try { fs.renameSync(req.file.path,destination); atualizarMusicas(); if(!fluxoAutoDJAtivo) processarAutoDJ(); res.json({ok:true,name:finalName,count:bibliotecaMusicas.length}); }
 catch(e){ console.error('[AutoDJ] Falha ao salvar música:',e); res.status(500).json({error:'Não foi possível salvar a música no servidor.'}); }
});
app.post('/api/upload-schedule',upload.single('image'),(req,res)=>{if(!req.file)return res.status(400).json({error:'Selecione uma imagem.'});if(req.body.password!==PASSWORD){fs.unlinkSync(req.file.path);return res.status(403).json({error:'Senha incorreta.'});}const ext=path.extname(req.file.originalname).slice(0,10)||'.jpg';const name='programacao-'+Date.now()+ext;fs.renameSync(req.file.path,path.join(uploadsDir,name));const item={url:'/uploads/'+name,name:req.file.originalname,at:Date.now()};scheduleImage=item;io.emit('schedule-image',item);res.json({ok:true,item});});
let scheduleImage=null, chatHistory=[], requestHistory=[];app.get('/api/public-data',(_,res)=>res.json({scheduleImage,chatHistory:chatHistory.slice(-60),requestHistory:requestHistory.slice(-30)}));
let hostId=null,hostName='',live=false; const listeners=new Set();
io.on('connection',s=>{
 s.emit('radio-state',{live,hostName}); s.emit('radio-config',{streamUrl:radioSettings.streamUrl,autoDjEnabled:radioSettings.autoDjEnabled,nowPlaying:radioSettings.nowPlaying}); if(scheduleImage)s.emit('schedule-image',scheduleImage);
 s.on('host-login',({password,name})=>{
  if(password!==PASSWORD)return s.emit('host-login-result',{ok:false,message:'Senha incorreta.'});
  if(hostId&&hostId!==s.id)return s.emit('host-login-result',{ok:false,message:'Já existe um locutor conectado.'});
  hostId=s.id;hostName=String(name||'Locutor').slice(0,40);s.emit('host-login-result',{ok:true});io.emit('radio-state',{live,hostName});
 });
 s.on('go-live',()=>{if(s.id===hostId){live=true;streamingAoVivo=true;io.emit('radio-state',{live,hostName}); for(const listenerId of listeners) io.to(hostId).emit('listener-wants-stream',{listenerId});}});
 s.on('go-offline',()=>{if(s.id===hostId){live=false;streamingAoVivo=false;io.emit('radio-state',{live,hostName});processarAutoDJ();}});
 s.on('listener-join',()=>{listeners.add(s.id); if(live&&hostId)io.to(hostId).emit('listener-wants-stream',{listenerId:s.id});else s.emit('stream-unavailable');});
 s.on('webrtc-offer',d=>{if(s.id===hostId)io.to(d.target).emit('webrtc-offer',{from:s.id,offer:d.offer});});
 s.on('webrtc-answer',d=>io.to(d.target).emit('webrtc-answer',{from:s.id,answer:d.answer}));
 s.on('webrtc-ice',d=>io.to(d.target).emit('webrtc-ice',{from:s.id,candidate:d.candidate}));
 s.on('chat-message',d=>{const m={name:String(d.name||'Ouvinte').slice(0,32),text:String(d.text||'').trim().slice(0,300),at:Date.now()};if(!m.text)return;chatHistory.push(m);chatHistory=chatHistory.slice(-100);io.emit('chat-message',m);});
 s.on('song-request',d=>{const m={id:String(d.id||'').slice(0,100),name:String(d.name||'Música').slice(0,180),url:String(d.url||'').startsWith('/uploads/')?String(d.url):'',by:String(d.by||'Ouvinte').slice(0,40),at:Date.now()};if(!m.url)return;requestHistory.push(m);requestHistory=requestHistory.slice(-100);io.emit('song-request',m);});
 s.on('delete-song-request',d=>{if(s.id!==hostId)return;requestHistory=requestHistory.filter(x=>x.id!==d.id);io.emit('song-request-removed',{id:d.id});});
 s.on('schedule-image',d=>{if(s.id===hostId&&scheduleImage)io.emit('schedule-image',scheduleImage);});
 s.on('now-playing',d=>{if(s.id===hostId){radioSettings.nowPlaying=String(d.title||'GAZETA FM NACIONAL PLAYER').slice(0,100);io.emit('now-playing',{title:radioSettings.nowPlaying});}});
 s.on('audio-streaming',dadosAudio=>{if(streamingAoVivo)ouvintesAtivos.forEach(res=>{try{res.write(Buffer.from(dadosAudio));}catch(_){}});});
 s.on('disconnect',()=>{listeners.delete(s.id); if(s.id===hostId){hostId=null;hostName='';live=false;streamingAoVivo=false;io.emit('radio-state',{live,hostName});processarAutoDJ();}});
});

// Opcional: defina ICECAST_STATUS_URL como https://seu-servidor/status-json.xsl
// para ler o título informado pelo Icecast e atualizar "Tocando agora".
const ICECAST_STATUS_URL=process.env.ICECAST_STATUS_URL||'';
async function refreshIcecastTitle(){
 if(!ICECAST_STATUS_URL)return;
 try{
  const response=await fetch(ICECAST_STATUS_URL,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)return;
  const data=await response.json(); let sources=data?.icestats?.source||[];
  if(!Array.isArray(sources))sources=[sources];
  const source=sources.find(x=>String(x.listenurl||x.listen_url||'').includes('live.mp3'))||sources[0];
  const title=String(source?.title||source?.yp_currently_playing||'').trim();
  if(title && title!==radioSettings.nowPlaying){radioSettings.nowPlaying=title.slice(0,100);io.emit('radio-config',{streamUrl:radioSettings.streamUrl,autoDjEnabled:radioSettings.autoDjEnabled,nowPlaying:radioSettings.nowPlaying});}
 }catch(_){}
}
setInterval(refreshIcecastTitle,15000).unref();

// Inicializa o Auto DJ sem interferir nos recursos existentes do painel.
atualizarMusicas();
processarAutoDJ();

server.listen(PORT,'0.0.0.0',()=>console.log('Gazeta FM Nacional Player na porta '+PORT));
