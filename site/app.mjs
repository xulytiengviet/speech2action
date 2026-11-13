/* Speech2Action browser chess demo.
 * REAL: chess.js move legality, deterministic gate, FFT/mel features, Base27 codec.
 * SYNTHETIC: voice model confidence, trained CNN, ESP32 instruction-level behavior.
 */
import {parseCommand,decide,POLICY_VERSION,ALPHABET,base27Trits,fromBase27Trits,packBase27,unpackBase27,chessPacket,verifyChessPacket} from "./core.mjs";
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const PIECE={w:{k:"♔",q:"♕",r:"♖",b:"♗",n:"♘",p:"♙"},b:{k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"}};
const VALUE={p:100,n:315,b:330,r:500,q:900,k:20000};
let Chess,game,branch="A",estop=false,selected=null,lastMove=null,busy=false,generation=0,asrDerived=false,sequence=0;
let audioFeatures=null,runAudit=[],eventLines=[],lastLatency=0,voiceUtterance=null;
const statusMessages={
  PASS:"Lệnh hợp lệ",STOP_PRIORITY:"Dừng khẩn cấp",UNKNOWN_COMMAND:"Lệnh không nhận diện",
  UNRECOGNIZED_GRAMMAR:"Không đúng cú pháp",NEGATED_COMMAND:"Lệnh phủ định bị từ chối",
  SAME_SQUARE:"Ô xuất phát trùng ô đến",ESTOP_LATCHED:"STOP đang khóa",
  KEEP_OUT:"Đã kích hoạt vùng cấm",HEARTBEAT_LOST:"Mất tín hiệu heartbeat",
  POLICY_VERSION_MISMATCH:"Sai phiên bản chính sách",
  REAL_ACTUATION_DISABLED:"Cấm phát lệnh lên phần cứng",
  UNTRAINED_AUDIO_MODEL:"Chưa có mô hình audio CNN kiểm chứng",
  INVALID_CONFIDENCE:"Confidence không hợp lệ",LOW_CONFIDENCE:"Confidence dưới 0,85",
  UNVERIFIED_PERCEPTION:"Đầu vào chưa được xác minh",
  NOT_YOUR_TURN:"Chưa đến lượt quân trắng",PIECE_MISMATCH:"Tên quân không khớp",
  NO_CHESS_RULE_ENGINE:"Thiếu bộ kiểm chứng luật cờ",ILLEGAL_CHESS_MOVE:"Nước đi sai luật",
  RULE_ENGINE_FAILED:"Bộ luật cờ bị lỗi"};
function log(text,type="info"){
  const ts=new Date().toLocaleTimeString("vi-VN",{hour12:false});
  const line="["+ts+"] "+type.toUpperCase()+"  "+text;
  eventLines.push(line);if(eventLines.length>90)eventLines.shift();
  $("events").textContent=eventLines.slice(-50).join("\n");
  $("events").scrollTop=$("events").scrollHeight;
}
function setBlock(i,s,main,description){
  const e=$("stage"+i);e.classList.remove("pass","run","reject");if(s==="RUN")e.classList.add("run");if(s==="PASS")e.classList.add("pass");if(s==="REJECT")e.classList.add("reject");
  $("stage"+i+"State").textContent=s;
  if(main!==undefined)$("stage"+i+"Main").textContent=main;
  if(description!==undefined)$("stage"+i+"Desc").textContent=description;
}
function verdict(decision){
  const el=$("verdict");el.classList.remove("pass","reject");el.classList.add(decision.pass?"pass":"reject");
  $("verdictValue").textContent=decision.reason+" · "+(statusMessages[decision.reason]||"Từ chối");
  $("verdictIcon").textContent=decision.pass?"✓":"✕";
}
function setBranch(value){
  branch=value;
  $("branchA").classList.toggle("selected",branch==="A");$("branchB").classList.toggle("selected",branch==="B");
  $("branchA").setAttribute("aria-pressed",String(branch==="A"));
  $("branchB").setAttribute("aria-pressed",String(branch==="B"));
  $("branchBTools").hidden=branch!=="B";
  $("sourceValue").textContent=branch==="A"?"typed / ASR unverified":"synthetic CNN";
  log("Chọn nhánh "+branch+": "+(branch==="A"?"transcript-to-intent":"synthetic direct-action"),"mode");
}
function updateEstop(){
  const badge=$("estopState");badge.textContent=estop?"E-STOP: LATCHED":"E-STOP: DISARMED";badge.classList.toggle("latched",estop);
}
function noteRook(message,title="RookLab"){
  $("rookTitle").textContent=title;$("rookSpeech").textContent=message;
  if($("voiceOut").checked && "speechSynthesis" in window){
    try{window.speechSynthesis.cancel();voiceUtterance=new SpeechSynthesisUtterance(message);voiceUtterance.lang="vi-VN";voiceUtterance.rate=1.02;window.speechSynthesis.speak(voiceUtterance)}catch{/* cosmetic only */}
  }
}
function boardStatus(){
  if(!game)return;
  if(game.isCheckmate()){$("gameState").textContent="Chiếu hết";$("turnInfo").textContent=game.turn()==="w"?"Rook thắng":"Bạn thắng";}
  else if(game.isDraw()){$("gameState").textContent="Hòa";$("turnInfo").textContent="Trò chơi kết thúc";}
  else{$("gameState").textContent=game.isCheck()?"Đang bị chiếu":"Đang chơi";$("turnInfo").textContent=game.turn()==="w"?"Lượt bạn · quân trắng":"Rook đang suy nghĩ · quân đen";}
  const h=game.history();$("plyInfo").textContent=h.length+" nửa nước";
  $("moveHistory").replaceChildren();
  if(!h.length){const span=document.createElement("span");span.className="muted";span.textContent="Chưa có nước đi nào.";$("moveHistory").append(span);}
  for(let i=0;i<h.length;i+=2){const span=document.createElement("span");span.textContent=(i/2+1)+". "+h[i]+(h[i+1]?" "+h[i+1]:"");$("moveHistory").append(span);}
}
function drawBoard(){
  if(!game)return;
  const board=$("board");board.replaceChildren();
  const allowed=selected&&game.turn()==="w"?new Set(game.moves({square:selected,verbose:true}).map(m=>m.to)):new Set();
  let checking=null;
  if(game.isCheck()){for(const rank of game.board())for(const piece of rank){if(piece?.type==="k" && piece.color===game.turn())checking=piece.square;}}
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const sq=String.fromCharCode(97+x)+(8-y),piece=game.get(sq);
    const button=document.createElement("button");
    button.className="square "+((x+y)%2===0?"light":"dark");
    if(lastMove&&(lastMove.from===sq||lastMove.to===sq))button.classList.add("last");
    if(selected===sq)button.classList.add("selected");
    if(allowed.has(sq))button.classList.add("legal");
    if(sq===checking)button.classList.add("check");
    button.setAttribute("role","gridcell");button.setAttribute("aria-label",sq+(piece?" "+(piece.color==="w"?"trắng":"đen")+" "+piece.type:" ô trống"));
    if(piece){const span=document.createElement("span");span.className="piece "+piece.color;span.textContent=PIECE[piece.color][piece.type];button.append(span);}
    button.onclick=()=>onSquare(sq);
    board.append(button);
  }
  boardStatus();
}
async function onSquare(sq){
  if(!game||busy||game.isGameOver()||game.turn()!=="w")return;
  if(selected){
    if(selected===sq){selected=null;drawBoard();return;}
    const was=selected;selected=null;drawBoard();
    await runCommand("đi "+was+" đến "+sq,{fromBoard:true,forceBranch:"A"});
    return;
  }
  const p=game.get(sq);
  if(p&&p.color==="w"){selected=sq;drawBoard();}
}
function isLegal(intent){
  if(!game||game.isGameOver())return false;
  return game.moves({square:intent.from,verbose:true}).some(m=>m.to===intent.to && (m.promotion||"q")===intent.promotion);
}
function botHeuristic(){
  if(!game||game.turn()!=="b"||game.isGameOver())return null;
  const moves=game.moves({verbose:true});
  let best=null,top=-1e10;
  for(const m of moves){
    game.move({from:m.from,to:m.to,promotion:m.promotion||"q"});
    let value=0;
    if(game.isCheckmate())value+=100000;
    else if(game.isCheck())value+=35;
    for(const rank of game.board())for(const p of rank){if(p)value+=(p.color==="b"?1:-1)*(VALUE[p.type]||0);}
    // Prefer active centralization, weak exploration noise omitted for reproducibility.
    value+=(3.5-Math.abs(3.5-(m.to.charCodeAt(0)-97)))*0.7;
    game.undo();
    if(value>top || (value===top&&(!best||m.san<best.san))){top=value;best=m;}
  }
  return best;
}
async function botReply(runGeneration){
  if(!game||game.turn()!=="b"||estop||game.isGameOver())return;
  $("opponentStatus").textContent="Đang chọn nước";
  await sleep(420);
  if(estop||runGeneration!==generation||game.turn()!=="b"||game.isGameOver())return;
  const m=botHeuristic();
  if(!m)return;
  const played=game.move({from:m.from,to:m.to,promotion:m.promotion||"q"});
  lastMove=played;drawBoard();
  $("opponentStatus").textContent="Sẵn sàng";
  log("ROOK [heuristic]: "+played.san+", không dùng Stockfish","robot");
  if(game.isGameOver())noteRook("Ván cờ đã kết thúc. "+(game.isCheckmate()?"Chiếu hết.":"Hòa."),"Trạng thái cuối");
  else noteRook("Rook chọn "+played.san+". Đến lượt bạn.","Robot đã phản hồi");
  runAudit.push({kind:"bot_move",time:new Date().toISOString(),san:played.san,fen:game.fen(),engine:"local_one_ply_material_heuristic"});
}
async function runCommand(text,options={}){
  if(!game){log("Luật cờ chưa tải; không thể thực thi lệnh","error");return}
  if(busy){log("Pipeline đang xử lý một lệnh khác","warn");return}
  const myGeneration=++generation;
  busy=true;$("run").disabled=true;
  const started=performance.now(),selectedBranch=options.forceBranch||branch;
  const provenance=options.audioInput?"recorded_audio":selectedBranch==="B"?"synthetic":(asrDerived?"web_speech":"exact_typed_text");
  const rawText=text;const proposal=parseCommand(rawText);
  const trace={schema:"speech2action-chess-v1",time:new Date().toISOString(),simulation:true,input:rawText,
    branch:selectedBranch,provenance,synthetic_confidence:selectedBranch==="B"?Number($("confidence").value):null,
    proposal:proposal.type==="CHESS_MOVE"?{type:proposal.type,from:proposal.from,to:proposal.to,pieceClaim:proposal.pieceClaim}: {type:proposal.type,reason:proposal.reason||null},
    fen_before:game.fen(),policy_version:POLICY_VERSION};
  [1,2,3].forEach(i=>setBlock(i,"IDLE"));
  $("irValue").textContent="—";$("cvnssValue").textContent="Chưa xác minh codec";
  try{
    setBlock(1,"RUN",selectedBranch==="A"?"STT transcript (demo) → intent":"Log-Mel → Tiny CNN (synthetic)","Phân tích cú pháp, chưa có quyền hành động");
    log("B1 ["+selectedBranch+"] "+provenance+": "+String(text).slice(0,90),"perception");
    if(proposal.type!=="STOP")await sleep(160);
    if(myGeneration!==generation)return;
    const ir=proposal.type==="CHESS_MOVE"?proposal.from+" → "+proposal.to:proposal.type;
    $("irValue").textContent=ir;
    $("sourceValue").textContent=provenance;
    setBlock(1,"PASS","Proposal: "+ir,selectedBranch==="B"?"Synthetic prediction; không có mô hình đã huấn luyện":"Typed exact phrase; không phải confidence STT");
    setBlock(2,"RUN","Safety checks","Bộ luật cờ + safety dùng chung");
    const actualPiece=proposal.type==="CHESS_MOVE"?game.get(proposal.from)?.type:null;
    const decision=decide(proposal,{
      mode:"simulation",branch:selectedBranch,provenance,
      confidence:selectedBranch==="B"?Number($("confidence").value):undefined,
      heartbeat:$("heartbeat").checked,keepout:$("keepout").checked,estop,
      turn:game.turn(),actualPiece,policyVersion:POLICY_VERSION,isLegal
    });
    trace.decision=decision.reason;trace.approved=decision.pass;
    if(proposal.type!=="STOP")await sleep(120);
    if(myGeneration!==generation)return;
    setBlock(2,decision.pass?"PASS":"REJECT",decision.reason,statusMessages[decision.reason]||"Kiểm tra đã hoàn tất");verdict(decision);
    log("B2 "+decision.reason+(decision.pass?" · authorized":" · fail-closed"),decision.pass?"pass":"reject");
    if(!decision.pass){
      setBlock(3,"REJECT","NO_OP · quân không di chuyển","Từ chối trước khi gọi ChessEnvironment");
      noteRook(statusMessages[decision.reason]||"Lệnh bị từ chối.","Safety Gate");
      trace.execution="NO_OP";trace.fen_after=game.fen();
      return;
    }
    if(decision.action==="STOP"){
      // Higher-priority stop; latch until explicit manual reset.
      estop=true;updateEstop();$("packetHex").textContent="STOP · NO MOVE PACKET";
      $("packetSize").textContent="0 byte (chess action)";
      $("packetState").textContent="E-STOP latched";
      setBlock(3,"PASS","STOP: robot tạm dừng","Bàn cờ giữ nguyên; không thực thi nước mới");
      trace.execution="STOP_LATCHED";trace.fen_after=game.fen();noteRook("Đã dừng. Không phát thêm nước đi cho đến khi xác nhận khôi phục.","DỪNG KHẨN CẤP");
      log("B3 STOP latched / no chess moves","stop");return;
    }
    setBlock(3,"RUN","UCI → ChessEnvironment","Chuẩn bị gói tin giả lập và áp dụng nước đi");
    const packet=chessPacket(proposal,++sequence),valid=verifyChessPacket(packet);
    const hex=[...packet].map(b=>b.toString(16).padStart(2,"0")).join(" ");
    $("packetHex").textContent=hex;$("packetSize").textContent=packet.length+" bytes";
    $("packetState").textContent=valid?"CRC8: VALID (random errors only)":"CRC8: INVALID";
    if(!valid)throw new Error("Packet integrity check failed");
    const played=game.move({from:proposal.from,to:proposal.to,promotion:proposal.promotion});
    if(!played)throw new Error("Unexpected move failure after rules gate");
    lastMove=played;selected=null;drawBoard();setBlock(3,"PASS","EXECUTED "+played.san,"Nước đi hợp lệ đã cập nhật bàn cờ");
    trace.execution="SIMULATED_MOVE";trace.san=played.san;trace.packet_hex=hex;trace.fen_after=game.fen();
    log("B3 executed "+played.san+" · packet "+hex,"execute");
    noteRook("Đã kiểm chứng và thực hiện "+played.san+". Đang tính nước phản hồi.","RookLab");
  }catch(err){
    log("EXECUTION ERROR: "+err.message,"error");
    setBlock(3,"REJECT","FAIL-CLOSED · "+err.message,"Không được dùng cho robot thật");
    trace.execution="ERROR";trace.error=String(err.message);trace.fen_after=game?.fen();
  }finally{
    lastLatency=performance.now()-started;$("elapsed").textContent=lastLatency.toFixed(1)+" ms · BROWSER";
    trace.browser_pipeline_ms=Number(lastLatency.toFixed(2));
    runAudit.push(trace);if(runAudit.length>500)runAudit.shift();
    busy=false;$("run").disabled=false;
  }
  // The opponent acts only after a successfully executed human move.
  if(trace.execution==="SIMULATED_MOVE")botReply(myGeneration);
}
function emergencyStop(){
  generation++;busy=false;$("run").disabled=false;estop=true;updateEstop();
  if("speechSynthesis" in window)window.speechSynthesis.cancel();
  const event={kind:"priority_stop",time:new Date().toISOString(),fen:game?.fen(),source:"direct_button"};
  runAudit.push(event);log("PRIORITY STOP before model. LATCHED.","stop");
  setBlock(2,"PASS","STOP_PRIORITY","Lệnh dừng độc lập với confidence");
  setBlock(3,"PASS","NO_OP · STOP LATCHED","Giữ nguyên bàn cờ, hủy phản hồi đối thủ");
  verdict({pass:true,reason:"STOP_PRIORITY"});noteRook("Dừng khẩn cấp đã kích hoạt. Cần xác nhận khôi phục.","STOP");
}
function resetStop(){
  if(!estop)return;
  estop=false;updateEstop();generation++;log("STOP reset by explicit operator acknowledgement","operator");
  noteRook("Đã xác nhận khôi phục. Có thể tiếp tục thử nghiệm.","Operator ack");
  if(game?.turn()==="b")botReply(generation);
}
function clearGame(){
  if(!game)return;generation++;busy=false;$("run").disabled=false;game.reset();selected=null;lastMove=null;
  drawBoard();$("opponentStatus").textContent="Sẵn sàng";[1,2,3].forEach(i=>setBlock(i,"IDLE"));
  $("verdict").classList.remove("pass","reject");$("verdictValue").textContent="WAITING FOR COMMAND";$("verdictIcon").textContent="◌";
  noteRook("Ván cờ mới! Hãy nhập đi tốt e2 đến e4.","RookLab");log("NEW GAME, policy and E-STOP states retained","reset");
}
function undoRound(){
  if(!game||busy)return;generation++;
  if(game.turn()==="w")game.undo();
  game.undo();lastMove=null;selected=null;drawBoard();log("UNDO local chess turn. Not a real actuator reversal.","operator");
}
function updateCodec(){
 try{
  const raw=$("codecInput").value.toUpperCase();
  const words=base27Trits(raw),packed=packBase27(raw),back=unpackBase27(packed);
  $("triples").textContent=words.slice(0,9).join(" ")+(words.length>9?" …":"");
  $("packed").textContent=raw.length+" ASCII bytes → "+packed.length+" bytes (incl length)";
  $("roundtrip").textContent=back===raw?"✓ LOSSLESS FOR A–Z+SPACE":"✕ ERROR";
  $("roundtrip").style.color=back===raw?"var(--green)":"var(--red)";
 }catch(e){$("triples").textContent="ALPHABET A–Z + SPACE";$("packed").textContent="INVALID INPUT";$("roundtrip").textContent="✕ "+e.message;$("roundtrip").style.color="var(--red)"}
}
function drawSyntheticSpectrum(){
 const c=$("spectrum"),g=c.getContext("2d"),w=c.width,h=c.height;g.clearRect(0,0,w,h);
 for(let x=0;x<80;x++)for(let y=0;y<20;y++){const v=(Math.sin(x*.31+y*.47)+Math.cos(x*.13-y*.37)+2)/4;g.fillStyle="hsl("+Math.round(220-170*v)+",80%,"+Math.round(8+40*v)+"%)";g.fillRect(x*w/80,(19-y)*h/20,Math.ceil(w/80),Math.ceil(h/20))}
 g.fillStyle="#fff";g.font="11px monospace";g.fillText("SYNTHETIC · UPLOAD FILE FOR REAL FFT",10,16);
}
function fftPower(buffer,start,N=512){
 const re=new Float64Array(N),im=new Float64Array(N);
 for(let i=0;i<N;i++){const s=start+i<buffer.length?buffer[start+i]:0;re[i]=s*(.5-.5*Math.cos(2*Math.PI*i/(N-1)))}
 for(let i=1,j=0;i<N;i++){
  let bit=N>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
  if(i<j){let t=re[i];re[i]=re[j];re[j]=t;}
 }
 for(let len=2;len<=N;len<<=1){const angle=-2*Math.PI/len,cos=Math.cos(angle),sin=Math.sin(angle);
  for(let i=0;i<N;i+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){const a=i+j,b=a+len/2;
   const tr=wr*re[b]-wi*im[b],ti=wr*im[b]+wi*re[b];re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;
   const nr=wr*cos-wi*sin;wi=wr*sin+wi*cos;wr=nr;
  }}
 }
 return Float64Array.from({length:N/2+1},(_,i)=>re[i]*re[i]+im[i]*im[i]);
}
function calcLogMel(wave,sr,frames=80,filters=24){
 const N=512,nBins=N/2+1,out=[];
 const toMel=f=>2595*Math.log10(1+f/700),fromMel=m=>700*(Math.pow(10,m/2595)-1);
 const maxMel=toMel(sr/2),points=Array.from({length:filters+2},(_,i)=>Math.floor((N+1)*fromMel(i*maxMel/(filters+1))/sr));
 const hop=Math.max(160,Math.floor(Math.max(0,wave.length-N)/Math.max(1,frames-1)));
 for(let f=0;f<frames;f++){
  const start=f*hop;if(start>=wave.length)break;
  const power=fftPower(wave,start,N),bins=[];
  for(let m=0;m<filters;m++){let total=0,l=points[m],c=points[m+1],r=points[m+2];
   for(let k=l;k<c&&k<nBins;k++)if(c>l)total+=power[k]*(k-l)/(c-l);
   for(let k=c;k<r&&k<nBins;k++)if(r>c)total+=power[k]*(r-k)/(r-c);
   bins.push(Math.log1p(total));
  }
  out.push(bins);
 }
 return out;
}
function paintMel(data){
 const c=$("spectrum"),g=c.getContext("2d"),w=c.width,h=c.height;g.clearRect(0,0,w,h);
 const flat=data.flat(),min=Math.min(...flat),max=Math.max(...flat),dy=h/(data[0]?.length||1),dx=w/data.length;
 data.forEach((column,x)=>column.forEach((value,y)=>{const v=(value-min)/(max-min+1e-6);g.fillStyle="hsl("+Math.round(230-v*205)+",90%,"+Math.round(7+55*v)+"%)";g.fillRect(x*dx,h-(y+1)*dy,Math.ceil(dx),Math.ceil(dy))}));
 g.fillStyle="#ffffff";g.font="10px monospace";g.fillText("REAL AUDIO · FFT → 24 MEL FILTERS",10,13);
}
async function importAudio(file){
 if(!file)return;
 if(file.size>16000000){$("audioInfo").textContent="Tệp quá lớn (>16 MB).";return}
 try{
  const AudioC=window.AudioContext||window.webkitAudioContext;
  if(!AudioC)throw Error("Web Audio API không khả dụng");
  const ac=new AudioC(),decoded=await ac.decodeAudioData(await file.arrayBuffer());
  const n=Math.min(decoded.length,Math.floor(decoded.sampleRate*4)),mono=new Float32Array(n);
  for(let ch=0;ch<decoded.numberOfChannels;ch++){const src=decoded.getChannelData(ch);for(let i=0;i<n;i++)mono[i]+=src[i]/decoded.numberOfChannels}
  const t=performance.now(),data=calcLogMel(mono,decoded.sampleRate);
  paintMel(data);audioFeatures={file:file.name,frames:data.length,sr:decoded.sampleRate,time_ms:performance.now()-t};
  $("audioInfo").textContent="WAV/audio "+file.name+" · "+n+" mẫu / "+decoded.sampleRate+" Hz · "+data.length+" frames × 24 mel · FFT JS "+audioFeatures.time_ms.toFixed(1)+" ms (browser). KHÔNG inference.";
  $("tryAudio").disabled=false;log("AUDIO real FFT "+audioFeatures.frames+" frames; model untrained, no actuation","feature");
  await ac.close();
 }catch(err){audioFeatures=null;$("tryAudio").disabled=true;$("audioInfo").textContent="Không đọc được âm thanh: "+err.message;log("AUDIO ERROR "+err.message,"error")}
}
async function testAudioFailClosed(){
 if(!audioFeatures)return;
 await runCommand($("command").value,{audioInput:true,forceBranch:"B"});
}
function downloadAudit(){
 const report={schema:"speech2action-chess-browser-v1",license:"MIT",runtime:"BROWSER_NOT_ESP32_S3",engine:"chess.js@1.4.0",test_runs:runAudit,events:eventLines,last_fen:game?.fen(),audio_feature_metadata:audioFeatures};
 const a=document.createElement("a"),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));
 a.href=url;a.download="speech2action-chess-audit.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function selfTest(){
 if(!Chess){log("Không tải được chess.js; self-test cờ vua bị chặn","error");return}
 let ok=0,failed=0;const cases=[];
 const check=(name,cond)=>{cases.push([name,cond]);cond?ok++:failed++};
 const fresh=new Chess(),legal=p=>fresh.moves({square:p.from,verbose:true}).some(m=>m.to===p.to);
 const ctx={mode:"simulation",branch:"A",provenance:"exact_typed_text",heartbeat:true,turn:"w",policyVersion:POLICY_VERSION,isLegal:legal};
 check("e2e4",decide(parseCommand("e2e4"),ctx).pass);
 check("e2e5 illegal",!decide(parseCommand("e2e5"),ctx).pass);
 check("negation",!decide(parseCommand("không đi e2e4"),ctx).pass);
 check("no heartbeat",!decide(parseCommand("e2e4"),{...ctx,heartbeat:false}).pass);
 check("keep-out",!decide(parseCommand("e2e4"),{...ctx,keepout:true}).pass);
 check("STOP priority",decide(parseCommand("dừng lại"),{...ctx,estop:true}).pass);
 check("B low-confidence",!decide(parseCommand("e2e4"),{...ctx,branch:"B",provenance:"synthetic",confidence:.5}).pass);
 check("audio untrained",!decide(parseCommand("e2e4"),{...ctx,branch:"B",provenance:"recorded_audio",confidence:1}).pass);
 const p=packBase27("MOVE E TWO FOUR");check("Base27 roundtrip",unpackBase27(p)==="MOVE E TWO FOUR");
 const packet=chessPacket(parseCommand("e2e4"));check("CRC8",verifyChessPacket(packet)&&!verifyChessPacket(Uint8Array.from([...packet.slice(0,5),packet[5]^1])));
 cases.forEach(([name,result])=>log("SELF-TEST "+(result?"PASS":"FAIL")+" "+name,result?"pass":"error"));
 log("SELF-TEST "+ok+"/"+(ok+failed)+" PASSED (JS/browser; not hardware)",failed?"error":"pass");
 noteRook(ok+"/"+(ok+failed)+" kiểm thử trình duyệt đạt. Đây không phải kết quả đo ESP32-S3.","Self-test");
}
function initializeEvents(){
 $("branchA").onclick=()=>setBranch("A");$("branchB").onclick=()=>setBranch("B");
 $("confidence").oninput=()=>{$("confValue").textContent=Number($("confidence").value).toFixed(2)};
 $("run").onclick=()=>runCommand($("command").value);
 $("command").onkeydown=e=>{if(e.key==="Enter")runCommand($("command").value)};
 $("command").addEventListener("input",()=>{asrDerived=false});
 $("stop").onclick=emergencyStop;$("resetEstop").onclick=resetStop;$("newGame").onclick=clearGame;$("undo").onclick=undoRound;
 $("codecInput").addEventListener("input",updateCodec);$("downloadLog").onclick=downloadAudit;$("selfTest").onclick=selfTest;
 $("audioFile").onchange=e=>importAudio(e.target.files?.[0]);$("tryAudio").onclick=testAudioFailClosed;
 document.querySelectorAll("[data-example]").forEach(b=>b.onclick=()=>{$("command").value=b.dataset.example;asrDerived=false});
 const examples={
  legal:{text:"đi tốt e2 đến e4",b:"A",keep:false,conf:.94},
  invalid:{text:"đi e2 đến e5",b:"A",keep:false,conf:.94},
  negation:{text:"không đi e2e4",b:"A",keep:false,conf:.94},
  low:{text:"đi e2 đến e4",b:"B",keep:false,conf:.62},
  keepout:{text:"đi e2 đến e4",b:"A",keep:true,conf:.94},
  stop:{text:"dừng lại",b:"A",keep:false,conf:.12}
 };
 document.querySelectorAll("[data-scenario]").forEach(b=>b.onclick=()=>{
  const q=examples[b.dataset.scenario];if(q.b==="B")setBranch("B");else setBranch("A");
  $("command").value=q.text;$("confidence").value=q.conf;$("confValue").textContent=q.conf.toFixed(2);$("keepout").checked=q.keep;
  asrDerived=false;if(q.text==="dừng lại"){emergencyStop();}else runCommand(q.text);
 });
 $("mic").onclick=()=>{
  const Rec=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Rec){log("Web Speech API không có trong trình duyệt này","warn");$("audioInfo").textContent="Web Speech API không được hỗ trợ. Hãy nhập transcript hoặc tải WAV.";return}
  const rec=new Rec();rec.lang="vi-VN";rec.interimResults=false;rec.maxAlternatives=1;
  log("Web Speech API có thể gửi audio ra ngoài. Kết quả sẽ CHƯA ĐƯỢC PHÊ DUYỆT.","warn");
  rec.onresult=e=>{$("command").value=e.results[0][0].transcript;asrDerived=true;setBranch("A");log("BROWSER ASR unverified transcript; safety will reject execution","perception")};
  rec.onerror=e=>log("Browser ASR "+e.error,"error");try{rec.start()}catch(e){log("Browser mic "+e.message,"error")}
 };
}
initializeEvents();setBranch("A");updateCodec();drawSyntheticSpectrum();updateEstop();
try{
 const dependency=await import("https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm");
 Chess=dependency.Chess;game=new Chess();drawBoard();$("opponentStatus").textContent="Sẵn sàng";
 log("READY chess.js@1.4.0 / BSD-2-Clause; actual chess legality check enabled","ready");
 log("Browser is virtual ESP32-S3; actual firmware, STT and trained CNN NOT RUNNING","warning");
}catch(err){
 log("FATAL: Không tải được chess.js@1.4.0. Bàn cờ bị khóa: "+err.message,"error");
 $("board").textContent="Không tải được bộ luật cờ. Kiểm tra mạng/CDN hoặc mở lại trang.";
 $("opponentStatus").textContent="Rules engine offline";$("run").disabled=true;
 $("turnInfo").textContent="Fail-closed: không chạy nước đi khi không có chess.js";
}
