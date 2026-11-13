import test from "node:test";
import assert from "node:assert/strict";
import {parseCommand,decide,base27Trits,fromBase27Trits,packBase27,unpackBase27,chessPacket,verifyChessPacket,crc8} from "./core.mjs";

const accepted={mode:"simulation",branch:"A",provenance:"exact_typed_text",turn:"w",heartbeat:true,isLegal:()=>true};
test("two-square Vietnamese text maps to typed chess move",()=>{
 const p=parseCommand("Di chuyển mã g1 đến f3");
 assert.equal(p.type,"CHESS_MOVE");assert.equal(p.from,"g1");assert.equal(p.to,"f3");assert.equal(p.pieceClaim,"n");
 assert.equal(decide(p,{...accepted,actualPiece:"n"}).pass,true);
});
test("no substring-based action through negation",()=>{
 const p=parseCommand("không đi e2 e4");
 assert.equal(p.type,"UNKNOWN");assert.equal(decide(p,accepted).pass,false);
});
test("unsafe compound command rejected",()=>assert.equal(parseCommand("e2e4 rồi g1f3").type,"UNKNOWN"));
test("emergency stop bypasses keepout & estop",()=>{
 assert.equal(decide(parseCommand("Dừng lại!"),{mode:"simulation",estop:true,keepout:true}).action,"STOP");
});
test("rejects unrecognized command",()=>assert.equal(decide(parseCommand("di chuyển tới đâu"),accepted).pass,false));
test("rejects same-square move",()=>assert.equal(decide(parseCommand("e2e2"),accepted).reason,"SAME_SQUARE"));
test("rejects keepout",()=>assert.equal(decide(parseCommand("e2e4"),{...accepted,keepout:true}).reason,"KEEP_OUT"));
test("rejects estop",()=>assert.equal(decide(parseCommand("e2e4"),{...accepted,estop:true}).reason,"ESTOP_LATCHED"));
test("rejects missing heartbeat",()=>assert.equal(decide(parseCommand("e2e4"),{...accepted,heartbeat:false}).reason,"HEARTBEAT_LOST"));
test("rejects tampered policy version",()=>assert.equal(decide(parseCommand("e2e4"),{...accepted,policyVersion:99}).reason,"POLICY_VERSION_MISMATCH"));
test("rejects illegal chess move",()=>assert.equal(decide(parseCommand("e2e5"),{...accepted,isLegal:()=>false}).reason,"ILLEGAL_CHESS_MOVE"));
test("rejects incorrect named piece",()=>assert.equal(decide(parseCommand("mã e2 e4"),{...accepted,actualPiece:"p"}).reason,"PIECE_MISMATCH"));
test("rejects live actuation",()=>assert.equal(decide(parseCommand("e2e4"),{...accepted,mode:"live"}).reason,"REAL_ACTUATION_DISABLED"));
test("branch B synthetic confidence must exceed 0.85",()=>{
 const p=parseCommand("e2e4");
 const b={...accepted,branch:"B",provenance:"synthetic",confidence:0.82};
 assert.equal(decide(p,b).reason,"LOW_CONFIDENCE");
 assert.equal(decide(p,{...b,confidence:0.95}).pass,true);
 assert.equal(decide(p,{...b,confidence:NaN}).reason,"INVALID_CONFIDENCE");
 assert.equal(decide(p,{...b,provenance:"recorded_audio",confidence:1}).reason,"UNTRAINED_AUDIO_MODEL");
});
test("A can't masquerade as calibrated microphone",()=>assert.equal(decide(parseCommand("e2e4"),{...accepted,provenance:"stt"}).reason,"UNVERIFIED_PERCEPTION"));
test("base27 trits round trip",()=>{
 const phrase="MOVE E TWO FOUR";
 assert.equal(fromBase27Trits(base27Trits(phrase)),phrase);
 assert.equal(base27Trits("A Z").join(" "),"000 222 221");
});
test("base27 rejects unsupported Unicode",()=>assert.throws(()=>packBase27("TIẾN LÊN"),/BASE27_ALPHABET/));
test("base27 pack/unpack 1-255 chars",()=>{
 for(let n=0;n<=255;n++){
   const str="ABCDEFGHIJKLMNOPQRSTUVWXYZ ".repeat(10).slice(0,n);
   const bytes=packBase27(str);
   assert.equal(unpackBase27(bytes),str);
 }
});
test("base27 malformed frames fail closed",()=>{
 assert.throws(()=>unpackBase27(Uint8Array.from([7,1])),/BASE27_BAD_FRAME/);
 assert.throws(()=>unpackBase27(Uint8Array.from([5,255,255,255])),/BASE27_BAD_GROUP/);
});
test("chess packet CRC detects corruption",()=>{
 const p=chessPacket(parseCommand("e2e4"),12);
 assert.ok(verifyChessPacket(p));p[3]^=1;assert.equal(verifyChessPacket(p),false);
 assert.equal(crc8(Uint8Array.of(0)),0);
});
