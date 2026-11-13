/**
 * Speech2Action chess domain — PURE deterministic policy and demonstration codecs.
 * NO speech-to-text, no neural inference, no ESP32 instruction set emulation.
 * Copyright (c) 2026 Long Ngo. MIT. Not a safety certified controller.
 */
export const POLICY_VERSION = 1;
export const THRESHOLD = 0.85;
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ ";
export const PIECE_NAMES = { "tốt":"p", "tot":"p", "mã":"n", "ma":"n", "ngựa":"n", "tượng":"b", "tuong":"b", "xe":"r", "hậu":"q", "hau":"q", "vua":"k" };
export function normalize(text) {
  return String(text ?? "").normalize("NFC").toLocaleLowerCase("vi").trim().replace(/\s+/g, " ");
}
export function parseCommand(text) {
  const raw = normalize(text).replace(/[.!?]+$/g, "").trim();
  if (/^(dừng|dừng lại|dừng khẩn cấp|stop|emergency stop)$/.test(raw)) {
    return { type:"STOP", sourceText:text };
  }
  // "Không đi e2 e4" or "đừng e2 e4" may never be interpreted as a move.
  if (/(^|\s)(không|đừng|chớ|hủy|huỷ|cancel)(\s|$)/u.test(raw)) {
    return { type:"UNKNOWN", reason:"NEGATED_COMMAND", sourceText:text };
  }
  const pieces = Object.keys(PIECE_NAMES).join("|");
  const pattern = new RegExp("^(?:(?:hãy |xin |cho )?(?:đi |di chuyển |đưa |kéo |đẩy )?(?:("+pieces+") )?)?([a-h][1-8])\\s*(?:đến|tới|sang|qua|->|-| )?\\s*([a-h][1-8])\\s*([qrbn])?$", "u");
  const match = raw.match(pattern);
  if (!match) return { type:"UNKNOWN", reason:"UNRECOGNIZED_GRAMMAR", sourceText:text };
  const from = match[2], to = match[3];
  if (from === to) return { type:"UNKNOWN", reason:"SAME_SQUARE", sourceText:text };
  return { type:"CHESS_MOVE", from, to, promotion:match[4] || "q", pieceClaim:match[1] ? PIECE_NAMES[match[1]] : null, sourceText:text };
}
export function decide(intent, context={}) {
  if (intent?.type === "STOP") return {pass:true, reason:"STOP_PRIORITY", action:"STOP"};
  if (intent?.type !== "CHESS_MOVE") return {pass:false, reason:intent?.reason || "UNKNOWN_COMMAND", action:"NO_OP"};
  if (context.estop) return {pass:false, reason:"ESTOP_LATCHED", action:"NO_OP"};
  if (context.keepout) return {pass:false, reason:"KEEP_OUT", action:"NO_OP"};
  if (context.heartbeat === false) return {pass:false, reason:"HEARTBEAT_LOST", action:"NO_OP"};
  if (context.policyVersion !== undefined && context.policyVersion !== POLICY_VERSION) return {pass:false, reason:"POLICY_VERSION_MISMATCH", action:"NO_OP"};
  if (context.mode !== "simulation") return {pass:false, reason:"REAL_ACTUATION_DISABLED", action:"NO_OP"};
  const branch = context.branch || "A";
  if (branch === "B") {
    if (context.provenance !== "synthetic") return {pass:false, reason:"UNTRAINED_AUDIO_MODEL", action:"NO_OP"};
    const v = context.confidence;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return {pass:false, reason:"INVALID_CONFIDENCE", action:"NO_OP"};
    if (v < THRESHOLD) return {pass:false, reason:"LOW_CONFIDENCE", action:"NO_OP"};
  } else if (branch !== "A" || context.provenance !== "exact_typed_text") {
    return {pass:false, reason:"UNVERIFIED_PERCEPTION", action:"NO_OP"};
  }
  if (context.turn !== "w") return {pass:false, reason:"NOT_YOUR_TURN", action:"NO_OP"};
  if (intent.pieceClaim && intent.pieceClaim !== context.actualPiece) return {pass:false, reason:"PIECE_MISMATCH", action:"NO_OP"};
  if (typeof context.isLegal !== "function") return {pass:false, reason:"NO_CHESS_RULE_ENGINE", action:"NO_OP"};
  try {
    if (!context.isLegal(intent)) return {pass:false, reason:"ILLEGAL_CHESS_MOVE", action:"NO_OP"};
  } catch {
    return {pass:false, reason:"RULE_ENGINE_FAILED", action:"NO_OP"};
  }
  return {pass:true, reason:"PASS", action:"CHESS_MOVE"};
}
export function base27Trits(input) {
  const str=String(input).toUpperCase();
  if ([...str].some(c=>!ALPHABET.includes(c))) throw new Error("BASE27_ALPHABET_REQUIRED");
  return [...str].map(c=>{
    const k=ALPHABET.indexOf(c);
    return [Math.floor(k/9), Math.floor((k%9)/3), k%3].join("");
  });
}
export function fromBase27Trits(items) {
  return items.map(trio=>{
    if (!/^[012]{3}$/.test(trio)) throw new Error("BAD_TRIT_TRIPLE");
    const k=Number(trio[0])*9+Number(trio[1])*3+Number(trio[2]);
    return ALPHABET[k];
  }).join("");
}
export function packBase27(input) {
  const str=String(input).toUpperCase();
  if (str.length>255) throw new Error("BASE27_TOO_LONG");
  base27Trits(str); // validate alphabet
  const out=[str.length];
  for(let i=0;i<str.length;i+=5){
    const group=str.slice(i,i+5).padEnd(5,"A");
    let val=0;
    for(const ch of group)val=val*27+ALPHABET.indexOf(ch);
    out.push(val&255,(val>>8)&255,(val>>16)&255);
  }
  return Uint8Array.from(out);
}
export function unpackBase27(bytes) {
  if(!bytes || bytes.length<1)throw new Error("BASE27_EMPTY_FRAME");
  const length=bytes[0],groups=Math.ceil(length/5);
  if(bytes.length!==1+groups*3)throw new Error("BASE27_BAD_FRAME_LENGTH");
  let str="";
  for(let i=0;i<groups;i++){
    const at=1+i*3;
    let val=bytes[at]+(bytes[at+1]<<8)+(bytes[at+2]<<16);
    if(val>=14348907)throw new Error("BASE27_BAD_GROUP");
    let sub="";
    for(let p=0;p<5;p++){sub=ALPHABET[val%27]+sub;val=Math.floor(val/27)}
    str+=sub;
  }
  return str.slice(0,length);
}
export function crc8(bytes) {
  let crc=0;
  for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc&128)?((crc<<1)^0x07)&255:(crc<<1)&255}
  return crc;
}
export function chessPacket(intent,sequence=1) {
  if(intent?.type!=="CHESS_MOVE")throw new Error("PACKET_MOVE_ONLY");
  function idx(square){const f=square.charCodeAt(0)-97,r=Number(square[1])-1;if(f<0||f>7||r<0||r>7)throw new Error("BAD_SQUARE");return r*8+f}
  // Synthetic, single-byte seq rolls over; this frame MUST NOT be used as a live motor protocol.
  const bytes=[POLICY_VERSION,sequence&255,idx(intent.from),idx(intent.to),25]; // TTL: 25*10 ms demo
  return Uint8Array.from([...bytes,crc8(bytes)]);
}
export function verifyChessPacket(packet) {
  if(packet?.length!==6)return false;
  return packet[0]===POLICY_VERSION && crc8(packet.slice(0,5))===packet[5] && packet[2]<64 && packet[3]<64;
}
